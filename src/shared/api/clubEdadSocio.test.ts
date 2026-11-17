// Mig 188 · getEdadSocio lee el rol de socio por la función de la base `club_socio_edad` (con control de local), no la
// tabla club_miembro_roles directo. Se simula `supabase`: la prueba cae si vuelve a leer la tabla o cambia la llamada.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: H.rpc, from: H.from } }))

import { getEdadSocio } from './club'

const ROL = { estado: 'activo', baja_por: null, alta_por: 'caja', validado_en: '2026-11-17T12:00:00Z', mayor_edad_en: null }

describe('getEdadSocio (mig 188)', () => {
  beforeEach(() => { H.rpc.mockReset(); H.from.mockReset() })
  it('llama a club_socio_edad con el miembro y no lee la tabla', async () => {
    H.rpc.mockResolvedValue({ data: ROL, error: null })
    expect(await getEdadSocio('m1')).toEqual(ROL)
    expect(H.rpc).toHaveBeenCalledWith('club_socio_edad', { p_miembro: 'm1' })
    expect(H.from).not.toHaveBeenCalled()
  })
  it('sin rol de socio: null', async () => {
    H.rpc.mockResolvedValue({ data: null, error: null })
    expect(await getEdadSocio('m1')).toBeNull()
  })
  it('ficha de otro local (manager): rechaza, no devuelve null (así la pantalla muestra la casilla)', async () => {
    H.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Ficha de otro local' } })
    await expect(getEdadSocio('m1')).rejects.toBeTruthy()
  })
})
