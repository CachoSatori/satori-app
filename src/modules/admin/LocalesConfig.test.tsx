// @vitest-environment happy-dom
// Mig 195: Admin → Locales (correo base por local) y el alias en Admin → Usuarios / «+ Nuevo empleado».
// Correos ficticios (@ejemplo.com).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const loc = vi.hoisted(() => ({ getLocalesCorreo: vi.fn(), guardarCorreoBase: vi.fn(), getAliasDelLocal: vi.fn() }))
const api = vi.hoisted(() => ({ getAllProfiles: vi.fn(), updateProfileRole: vi.fn(), setProfileActive: vi.fn(), getCambiosPermisos: vi.fn() }))
const clave = vi.hoisted(() => ({ pedidosCambioClave: vi.fn(), pedirCambioClave: vi.fn(), sacarPedidoCambioClave: vi.fn() }))
vi.mock('../../shared/api/locales', () => loc)
vi.mock('../../shared/api/admin', () => api)
vi.mock('../../shared/api/cambioClave', () => clave)
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import LocalesConfig from './LocalesConfig'
import UserApprovals from './UserApprovals'
import NuevoEmpleado from './NuevoEmpleado'
import { FALTA_CORREO_LOCAL } from './aliasCorreo'
import { NO_SE_PUDO_LEER } from './AliasCorreoTexto'

beforeEach(() => {
  Object.values(loc).forEach(f => f.mockReset())
  Object.values(api).forEach(f => f.mockReset())
  Object.values(clave).forEach(f => f.mockReset())
  api.getAllProfiles.mockResolvedValue([])
  clave.pedidosCambioClave.mockResolvedValue([])
  loc.getLocalesCorreo.mockResolvedValue([
    { id: 'santa-teresa', name: 'Local Ficticio A', is_active: true, correo_base: null },
    { id: 'nosara', name: 'Local Ficticio B', is_active: false, correo_base: 'b@ejemplo.com' },
  ])
})

const campo = (nombre: string) => screen.getByLabelText(`Correo base de ${nombre}`) as HTMLInputElement

describe('Admin → Locales: correo base', () => {
  it('lista los locales con su correo y el alias de ejemplo', async () => {
    render(<LocalesConfig />)
    await waitFor(() => expect(campo('Local Ficticio B').value).toBe('b@ejemplo.com'))
    expect(campo('Local Ficticio A').value).toBe('')
    expect(screen.getByText('b+nombre@ejemplo.com')).toBeTruthy()
    expect(screen.getByText('(apagado)')).toBeTruthy()
  })

  it('formato inválido: muestra el error y NO llama a guardar', async () => {
    render(<LocalesConfig />)
    await waitFor(() => campo('Local Ficticio A'))
    fireEvent.change(campo('Local Ficticio A'), { target: { value: 'a+b@ejemplo.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/«\+»/)
    fireEvent.change(campo('Local Ficticio A'), { target: { value: 'sin-arroba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Revisá el correo/)
    expect(loc.guardarCorreoBase).not.toHaveBeenCalled()
  })

  it('válido: guarda ESE local con lo escrito y muestra el alias nuevo', async () => {
    loc.guardarCorreoBase.mockResolvedValue('a@ejemplo.com')
    render(<LocalesConfig />)
    await waitFor(() => campo('Local Ficticio A'))
    fireEvent.change(campo('Local Ficticio A'), { target: { value: 'a@ejemplo.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await screen.findByText('✓ Guardado')
    expect(loc.guardarCorreoBase).toHaveBeenCalledWith('santa-teresa', 'a@ejemplo.com')
    expect(screen.getByText('a+nombre@ejemplo.com')).toBeTruthy()
  })

  it('si la base no lo guarda (sin permiso), se ve el motivo', async () => {
    loc.guardarCorreoBase.mockRejectedValue(new Error('No se guardó: solo el owner puede cambiar los datos del local'))
    render(<LocalesConfig />)
    await waitFor(() => campo('Local Ficticio A'))
    fireEvent.change(campo('Local Ficticio A'), { target: { value: 'a@ejemplo.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/solo el owner/)
  })
})

describe('Admin → Usuarios: el alias sale del local (no del build)', () => {
  it('con correo base: muestra el alias armado y el local', async () => {
    loc.getAliasDelLocal.mockResolvedValue({ local: 'Local Ficticio A', alias: 'a+nombre@ejemplo.com' })
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    await waitFor(() => expect(screen.getByTestId('alias-correo').textContent).toBe('a+nombre@ejemplo.com (Local Ficticio A)'))
    expect(screen.queryByText(FALTA_CORREO_LOCAL)).toBeNull()
  })

  it('sin correo base: «Cargá el correo del local en Admin → Locales» en lugar del alias', async () => {
    loc.getAliasDelLocal.mockResolvedValue({ local: 'Local Ficticio A', alias: null })
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    await waitFor(() => expect(screen.getByTestId('alias-correo').textContent).toBe(FALTA_CORREO_LOCAL))
    expect(document.body.textContent).not.toMatch(/\+nombre@/)
  })

  it('si no se puede leer: lo dice (no inventa un alias ni pide cargar algo que quizá está)', async () => {
    loc.getAliasDelLocal.mockRejectedValue(new Error('red'))
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    await waitFor(() => expect(screen.getByTestId('alias-correo').textContent).toBe(NO_SE_PUDO_LEER))
  })

  it('«+ Nuevo empleado» muestra el mismo alias que recibe', () => {
    render(<NuevoEmpleado employees={[]} alias={{ estado: 'ok', local: null, alias: 'a+nombre@ejemplo.com' }} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByTestId('alias-correo').textContent).toBe('a+nombre@ejemplo.com')
  })

  it('«+ Nuevo empleado» sin correo base pide cargarlo', () => {
    render(<NuevoEmpleado employees={[]} alias={{ estado: 'ok', local: 'X', alias: null }} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByTestId('alias-correo').textContent).toBe(FALTA_CORREO_LOCAL)
  })
})
