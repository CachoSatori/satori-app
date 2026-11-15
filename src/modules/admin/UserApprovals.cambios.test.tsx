// @vitest-environment happy-dom
// B10 (mig 165): Admin → Usuarios → «Cambios»: lista de cambios de permisos del usuario, más reciente primero, solo
// lectura; vacía con el aviso de que la bitácora arrancó vacía.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Profile } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getAllProfiles: vi.fn(), updateProfileRole: vi.fn(), setProfileActive: vi.fn(), getCambiosPermisos: vi.fn(),
}))
vi.mock('../../shared/api/admin', () => api)
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import UserApprovals from './UserApprovals'

const perfiles = [
  { id: 'o1', full_name: 'Dueña Ficticia', email: null, role: 'owner', is_active: true, created_at: '', updated_at: 'a' },
  { id: 's1', full_name: 'Salonero Ficticio', email: null, role: 'cajero', is_active: true, created_at: '', updated_at: 'a' },
] as Profile[]

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  api.getAllProfiles.mockResolvedValue(perfiles)
})

describe('Admin → Usuarios → Cambios', () => {
  it('abre la lista del usuario: más reciente primero, de qué a qué, quién y hora CR', async () => {
    api.getCambiosPermisos.mockResolvedValue([
      { id: 1, profile_id: 's1', campo: 'activo', antes: 'false', despues: 'true', cambiado_por: null, origen: 'sistema', cambiado_en: '2026-11-14T15:00:00Z' },
      { id: 2, profile_id: 's1', campo: 'rol', antes: 'salonero', despues: 'cajero', cambiado_por: 'o1', origen: 'sesion', cambiado_en: '2026-11-15T05:30:00Z' },
    ])
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    const botones = await screen.findAllByRole('button', { name: 'Cambios' })
    fireEvent.click(botones[1])   // la fila de «Salonero Ficticio» (orden de la lista: activos)
    const panel = await screen.findByTestId('cambios-permisos')
    expect(api.getCambiosPermisos).toHaveBeenCalledWith('s1')
    const items = within(panel).getAllByRole('listitem').map(li => li.textContent)
    expect(items).toEqual([
      '14-nov-2026 23:30Rol: Salonero → Cajeropor Dueña Ficticia',
      '14-nov-2026 09:00Cuenta: deshabilitada → habilitadapor Sistema',
    ])
    // solo lectura: el panel no tiene botones ni campos
    expect(within(panel).queryAllByRole('button')).toHaveLength(0)
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar cambios' }))
    expect(screen.queryByTestId('cambios-permisos')).toBeNull()
  })

  it('sin cambios: lo dice y aclara que la bitácora arrancó vacía', async () => {
    api.getCambiosPermisos.mockResolvedValue([])
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Cambios' }))[0])
    const panel = await screen.findByTestId('cambios-permisos')
    expect(panel.textContent).toMatch(/Sin cambios registrados/)
    expect(panel.textContent).toMatch(/los cambios anteriores no quedaron registrados/)
  })

  it('error de la base: se muestra, no rompe la pantalla', async () => {
    api.getCambiosPermisos.mockRejectedValue(new Error('permission denied for table bitacora_permisos'))
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Cambios' }))[0])
    await waitFor(() => expect(screen.getByText(/No se pudieron cargar los cambios/)).toBeTruthy())
    expect(screen.getByText('Usuarios activos (2)')).toBeTruthy()
  })

  it('después de cambiar un rol, la lista se vuelve a pedir', async () => {
    api.getCambiosPermisos.mockResolvedValue([])
    api.updateProfileRole.mockResolvedValue(undefined)
    render(<UserApprovals employees={[]} currentUserId="o1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Cambios' }))[1])
    await screen.findByTestId('cambios-permisos')
    expect(api.getCambiosPermisos).toHaveBeenCalledTimes(1)
    api.getAllProfiles.mockResolvedValue([perfiles[0], { ...perfiles[1], role: 'runner', updated_at: 'b' }])
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'runner' } })
    await waitFor(() => expect(api.getCambiosPermisos).toHaveBeenCalledTimes(2))
  })
})
