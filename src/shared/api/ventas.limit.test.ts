// `getAllVentasDias` tiene que traer TODO el histórico, aunque haya más filas que el `max_rows`
// de PostgREST.
//
// Es el MISMO bug que ya se arregló en `getAllCashMovements` (ver `cash.paginado.test.ts`): el
// select no tenía `.limit()`, PostgREST cortaba en 1.000 filas y devolvía esa página SIN AVISAR
// —sin error, sin warning—. La app veía solo la última página y los días más viejos
// simplemente no existían. En la pantalla de Paridad eso se leía como "el PoS tiene días que el
// xls no tiene", que es exactamente la conclusión equivocada para firmar el swap de fuente.
//
// (Se midió después: `ventas_dias` hoy arranca en enero 2026, así que todavía no llega a las
// 1.000 filas — la que sí las pasa es `ventas_hist`, con 2023-2025. El corte igual es cuestión
// de tiempo a ~1 fila por día, y el test lo fija antes de que vuelva a morder.)
//
// `getVentasHist()` ya ponía `.limit(5000)` por este motivo; este test fija que su hermano
// tampoco se vuelva a quedar sin él.
import { describe, it, expect, vi } from 'vitest'

type Fila = { session_date: string; data: { fileName: string; uploadedAt: string; saloneros: Record<string, never> } }

const fila = (session_date: string): Fila => ({
  session_date,
  data: { fileName: `x ${session_date}`, uploadedAt: 'x', saloneros: {} },
})

/** `2023-01-01` + n días. */
const dia = (n: number): string =>
  new Date(Date.UTC(2023, 0, 1 + n)).toISOString().slice(0, 10)

/**
 * Doble de PostgREST: corta en `maxRows` SALVO que le pidan un `.limit()` menor o mayor.
 * Es el comportamiento real: el límite del cliente sobrepasa el default del servidor.
 */
function fakeSupabase(filas: Fila[], maxRows: number) {
  const limites: number[] = []
  const api = {
    from: () => api,
    select: () => api,
    gte: () => api,
    order: () => api,
    limit: (n: number) => {
      limites.push(n)
      return Promise.resolve({ data: filas.slice(0, n), error: null })
    },
    // Sin `.limit()`, la promesa se resuelve con el corte del servidor.
    then: (resolver: (v: { data: Fila[]; error: null }) => unknown) =>
      resolver({ data: filas.slice(0, maxRows), error: null }),
  }
  return { api, limites }
}

const mock = vi.hoisted(() => ({ cliente: { from: (): unknown => ({}) } }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getAllVentasDias } = await import('./ventas')

describe('getAllVentasDias — no se puede truncar en 1.000 filas', () => {
  it('devuelve los 1.096 días del histórico, no los 1.000 que corta PostgREST', async () => {
    const filas = Array.from({ length: 1096 }, (_, i) => fila(dia(i)))
    const { api, limites } = fakeSupabase(filas, 1000)
    mock.cliente.from = () => api

    const dias = await getAllVentasDias()

    // El conteo devuelto == el conteo real de la tabla. Esta es la aserción del bug.
    expect(Object.keys(dias)).toHaveLength(1096)
    expect(limites).toEqual([5000])
  })

  it('los días MÁS VIEJOS son los que se perdían: tienen que estar', async () => {
    const filas = Array.from({ length: 1096 }, (_, i) => fila(dia(i)))
    const { api } = fakeSupabase(filas, 1000)
    mock.cliente.from = () => api

    const dias = await getAllVentasDias()
    const fechas = Object.keys(dias).sort()

    expect(fechas[0]).toBe('2023-01-01')                 // el primero del histórico
    expect(fechas[fechas.length - 1]).toBe(dia(1095))
    // Sin el `.limit()` esto traía 1.000 filas y el día 1.001 en adelante desaparecía.
    expect(dias[dia(1050)]).toBeDefined()
  })

  it('un histórico chico pasa igual, sin que el limit lo recorte', async () => {
    const filas = [fila('2026-09-04'), fila('2026-09-05')]
    const { api } = fakeSupabase(filas, 1000)
    mock.cliente.from = () => api

    expect(Object.keys(await getAllVentasDias())).toEqual(['2026-09-04', '2026-09-05'])
  })
})
