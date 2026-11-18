// Mig 191 — `getSaloneroNombres` junta la tabla `employees` (lo que deja el RLS) con `pos_nombres_por_login` (solo
// login → nombre, incluidos los inactivos, para owner/manager/contador). Decisión del dueño 18-nov 11:50: el
// contador ve el nombre del salonero en «Ayer: mesas sin pax» del Resumen. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: H.rpc, from: H.from } }))

const { getSaloneroNombres } = await import('./posNdf')

/** `from('employees').select(...).not(...)` → la respuesta dada. */
function tabla(resp: { data: unknown; error: { message: string } | null }) {
  H.from.mockReturnValue({ select: () => ({ not: () => Promise.resolve(resp) }) })
}

beforeEach(() => { vi.clearAllMocks() })

describe('getSaloneroNombres (tabla + pos_nombres_por_login)', () => {
  it('el contador: la tabla solo trae activos y la función suma el inactivo', async () => {
    tabla({ data: [{ pos_login: '901', full_name: 'Persona Ficticia A' }], error: null })
    H.rpc.mockResolvedValue({ data: [
      { pos_login: '901', nombre: 'Persona Ficticia A' },
      { pos_login: ' 902 ', nombre: ' Persona Ficticia B ' },
    ], error: null })
    expect(await getSaloneroNombres()).toEqual({ '901': 'Persona Ficticia A', '902': 'Persona Ficticia B' })
    expect(H.rpc).toHaveBeenCalledWith('pos_nombres_por_login')
  })

  it('un rol sin acceso (0 filas) o la función todavía sin aplicar: queda lo de la tabla, como antes', async () => {
    tabla({ data: [{ pos_login: '901', full_name: 'Persona Ficticia A' }], error: null })
    H.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await getSaloneroNombres()).toEqual({ '901': 'Persona Ficticia A' })
    H.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function not found' } })
    expect(await getSaloneroNombres()).toEqual({ '901': 'Persona Ficticia A' })
  })

  it('un error de la tabla se propaga', async () => {
    tabla({ data: null, error: { message: 'boom' } })
    H.rpc.mockResolvedValue({ data: [], error: null })
    await expect(getSaloneroNombres()).rejects.toThrow('boom')
  })
})
