// @vitest-environment happy-dom
// Mig 185: Admin → Usuarios → «Pedir cambio de contraseña». El owner obliga a un usuario a cambiar la contraseña la
// próxima vez que entra (con confirmación), ve quién lo tiene pendiente y puede sacar un pedido puesto por error.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Profile } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getAllProfiles: vi.fn(), updateProfileRole: vi.fn(), setProfileActive: vi.fn(), getCambiosPermisos: vi.fn(),
}))
const clave = vi.hoisted(() => ({ pedidosCambioClave: vi.fn(), pedirCambioClave: vi.fn(), sacarPedidoCambioClave: vi.fn() }))
vi.mock('../../shared/api/admin', () => api)
vi.mock('../../shared/api/cambioClave', () => clave)
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import UserApprovals from './UserApprovals'

const perfiles = [
  { id: 'o1', full_name: 'Dueña Ficticia', email: null, role: 'owner', is_active: true, created_at: '', updated_at: 'a' },
  { id: 'a1', full_name: 'Socio Ficticio', email: null, role: 'owner', is_active: true, created_at: '', updated_at: 'a' },
  { id: 'c1', full_name: 'Cajera Ficticia', email: null, role: 'cajero', is_active: true, created_at: '', updated_at: 'a' },
] as Profile[]

const confirmar = vi.fn(() => true)
beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  Object.values(clave).forEach(f => f.mockReset())
  api.getAllProfiles.mockResolvedValue(perfiles)
  clave.pedidosCambioClave.mockResolvedValue([])
  clave.pedirCambioClave.mockResolvedValue(undefined)
  clave.sacarPedidoCambioClave.mockResolvedValue(undefined)
  confirmar.mockReset().mockReturnValue(true)
  window.confirm = confirmar
})

describe('Admin → Usuarios → pedir cambio de contraseña', () => {
  it('un botón por usuario, menos uno mismo (eso es «Cambiar mi contraseña»)', async () => {
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Pedir cambio de contraseña' })).toHaveLength(2))
  })

  it('con confirmación: marca al usuario y muestra que quedó pendiente', async () => {
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    const botones = await screen.findAllByRole('button', { name: 'Pedir cambio de contraseña' })
    clave.pedidosCambioClave.mockResolvedValue([{ user_id: 'a1', marcado_en: '2026-11-17T21:00:00Z', marcado_por: 'o1' }])
    fireEvent.click(botones[0])   // «Socio Ficticio» (orden de la lista)
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(String(confirmar.mock.calls[0])).toMatch(/¿Obligar a Socio Ficticio a cambiar la contraseña\?/)
    await waitFor(() => expect(clave.pedirCambioClave).toHaveBeenCalledWith('a1'))
    const aviso = await screen.findByTestId('clave-pendiente')
    expect(aviso.textContent).toBe('🔑 Cambio de contraseña pendiente · pedido el 17-nov-2026 15:00')
    expect(screen.getByTestId('clave-pendientes-resumen').textContent).toMatch(/1 usuario tiene pendiente/)
    expect(screen.getByRole('button', { name: 'Sacar pedido de contraseña' })).toBeTruthy()
  })

  it('si cancela la confirmación, no marca nada', async () => {
    confirmar.mockReturnValue(false)
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pedir cambio de contraseña' }))[1])
    expect(confirmar).toHaveBeenCalled()
    expect(clave.pedirCambioClave).not.toHaveBeenCalled()
  })

  it('sacar un pedido puesto por error (con confirmación)', async () => {
    clave.pedidosCambioClave.mockResolvedValue([{ user_id: 'c1', marcado_en: '2026-11-17T21:00:00Z', marcado_por: 'o1' }])
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    const b = await screen.findByRole('button', { name: 'Sacar pedido de contraseña' })
    clave.pedidosCambioClave.mockResolvedValue([])
    fireEvent.click(b)
    expect(String(confirmar.mock.calls[0])).toMatch(/¿Sacar el pedido de cambio de contraseña de Cajera Ficticia\?/)
    await waitFor(() => expect(clave.sacarPedidoCambioClave).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(screen.queryByTestId('clave-pendiente')).toBeNull())
  })

  it('error de la base al marcar: se muestra el mensaje', async () => {
    clave.pedirCambioClave.mockRejectedValue(new Error('Solo el dueño puede pedir el cambio de contraseña.'))
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pedir cambio de contraseña' }))[0])
    expect(await screen.findByText('Solo el dueño puede pedir el cambio de contraseña.')).toBeTruthy()
  })

  it('si no se pueden leer los pedidos: aviso y sin botones (la pantalla sigue)', async () => {
    clave.pedidosCambioClave.mockRejectedValue(new Error('x'))
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    expect(await screen.findByText(/No se pudo ver quién tiene pendiente el cambio de contraseña/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Pedir cambio de contraseña' })).toHaveLength(0)
    expect(screen.getByText('Socio Ficticio')).toBeTruthy()
  })
})
