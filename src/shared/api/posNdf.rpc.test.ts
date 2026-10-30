// Mig 067 — las lecturas de ventas del PoS van por las funciones `pos_ventas_*`, el MISMO camino
// para todos los roles. Acá se prueba el contrato con PostgREST: qué función, qué parámetros y que
// la paginación (limit/offset DENTRO de la función) no corte callado.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: H.rpc, from: H.from } }))

const { getTicketsRango, getLineasDeTickets, getLatidoVentas, ventanaRangoJornadas } = await import('./posNdf')

const filas = (n: number, pref: string) => Array.from({ length: n }, (_, i) => ({ id: `${pref}${i}` }))

beforeEach(() => { vi.clearAllMocks() })

describe('getTicketsRango → pos_ventas_tickets_rango', () => {
  it('pide la ventana del rango y pagina de a 1.000 hasta una página corta', async () => {
    H.rpc
      .mockResolvedValueOnce({ data: filas(1000, 'a'), error: null })
      .mockResolvedValueOnce({ data: filas(3, 'b'), error: null })
    const r = await getTicketsRango('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-31' })
    const v = ventanaRangoJornadas('2026-10-01', '2026-10-31')
    expect(r).toHaveLength(1003)
    expect(H.rpc).toHaveBeenNthCalledWith(1, 'pos_ventas_tickets_rango',
      { p_local: 'santa-teresa', p_desde: v.desde, p_hasta: v.hasta, p_limit: 1000, p_offset: 0 })
    expect(H.rpc).toHaveBeenNthCalledWith(2, 'pos_ventas_tickets_rango',
      { p_local: 'santa-teresa', p_desde: v.desde, p_hasta: v.hasta, p_limit: 1000, p_offset: 1000 })
    expect(H.from).not.toHaveBeenCalled()      // ya no lee la tabla
  })

  it('un error de la función se propaga (no se traga como «sin datos»)', async () => {
    H.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(getTicketsRango('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-02' })).rejects.toThrow('boom')
  })
})

describe('getLineasDeTickets → pos_ventas_lineas', () => {
  it('parte los ids en tandas de 200 y pagina las filas de cada tanda', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`)
    H.rpc
      .mockResolvedValueOnce({ data: filas(1000, 'x'), error: null })   // tanda 1, página 1
      .mockResolvedValueOnce({ data: filas(10, 'y'), error: null })     // tanda 1, página 2
      .mockResolvedValueOnce({ data: filas(5, 'z'), error: null })      // tanda 2
    const r = await getLineasDeTickets(ids)
    expect(r).toHaveLength(1015)
    expect(H.rpc).toHaveBeenNthCalledWith(1, 'pos_ventas_lineas', { p_ticket_ids: ids.slice(0, 200), p_limit: 1000, p_offset: 0 })
    expect(H.rpc).toHaveBeenNthCalledWith(2, 'pos_ventas_lineas', { p_ticket_ids: ids.slice(0, 200), p_limit: 1000, p_offset: 1000 })
    expect(H.rpc).toHaveBeenNthCalledWith(3, 'pos_ventas_lineas', { p_ticket_ids: ids.slice(200), p_limit: 1000, p_offset: 0 })
    expect(H.from).not.toHaveBeenCalled()
  })

  it('sin ids no consulta', async () => {
    expect(await getLineasDeTickets([])).toEqual([])
    expect(H.rpc).not.toHaveBeenCalled()
  })
})

describe('getLatidoVentas → pos_ventas_latido', () => {
  it('una fila = tiene acceso (con o sin hora de poll)', async () => {
    H.rpc.mockResolvedValueOnce({ data: [{ last_poll_at: '2026-10-30T15:00:00Z' }], error: null })
    expect(await getLatidoVentas('santa-teresa')).toEqual({ acceso: true, ultimoPollAt: '2026-10-30T15:00:00Z' })
    H.rpc.mockResolvedValueOnce({ data: [{ last_poll_at: null }], error: null })
    expect(await getLatidoVentas('santa-teresa')).toEqual({ acceso: true, ultimoPollAt: null })
    expect(H.rpc).toHaveBeenCalledWith('pos_ventas_latido', { p_local: 'santa-teresa' })
  })

  it('cero filas = sin acceso', async () => {
    H.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await getLatidoVentas('santa-teresa')).toEqual({ acceso: false, ultimoPollAt: null })
  })
})
