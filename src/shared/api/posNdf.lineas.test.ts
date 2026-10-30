// `getLineasDeTickets` tiene que PEDIR `usuario_registra` en su select.
//
// Es el habilitador de la atribución por línea. El puente ya persiste
// `FAC_FacturasDet.UsuarioRegistra` en `pos_ndf_ticket_lines.usuario_registra` (Parte A), pero
// la app leía la tabla con una lista de columnas escrita a mano que NO lo incluía: PostgREST
// devuelve exactamente lo que se le pide, así que la columna llegaba `undefined` y no había
// forma de saber qué mesero comandó cada línea. Sin ESO no hay lente de "venta propia": una
// factura partida entre dos meseros se le atribuye entera al del ticket.
//
// El select es una string literal; el compilador no la mira. Por eso el test.
import { describe, it, expect, vi } from 'vitest'

interface Fila {
  ticket_id:        string
  codigo_producto:  string | null
  nombre:           string | null
  cantidad:         number | null
  monto:            number | null
  familia:          number | null
  usuario_registra: string | null
}

const linea = (ticket_id: string, usuario_registra: string | null): Fila => ({
  ticket_id,
  codigo_producto: '677',
  nombre:          'PAX',
  cantidad:        2,
  monto:           0,
  familia:         9,
  usuario_registra,
})

/**
 * Doble de la función `pos_ventas_lineas` (mig 067). El contrato de columnas vive ahora en el
 * `returns table` de la migración (ver `posNdf.contrato067.test.ts`); acá se prueba que lo que la
 * función devuelve llega entero a la app, tanda por tanda.
 */
function fakeSupabase(filas: Fila[]) {
  const tandas: string[][] = []
  const rpc = (_fn: string, a: { p_ticket_ids: string[]; p_offset: number; p_limit: number }) => {
    if (a.p_offset === 0) tandas.push(a.p_ticket_ids)
    const deLaTanda = filas.filter(f => a.p_ticket_ids.includes(f.ticket_id))
    return Promise.resolve({ data: deLaTanda.slice(a.p_offset, a.p_offset + a.p_limit), error: null })
  }
  return { rpc, tandas }
}

const mock = vi.hoisted(() => ({ cliente: {
  from: (): unknown => ({}),
  rpc:  ((): unknown => ({})) as (fn: string, args: never) => unknown,
} }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getLineasDeTickets } = await import('./posNdf')

describe('getLineasDeTickets — trae el mesero de la línea', () => {
  it('devuelve el login que comandó cada línea, no `undefined`', async () => {
    const { rpc } = fakeSupabase([linea('t1', '023'), linea('t2', '235')])
    mock.cliente.rpc = rpc

    const filas = await getLineasDeTickets(['t1', 't2'])

    // La aserción del bug: sin la columna en el select esto daba `[undefined, undefined]`.
    expect(filas.map(f => f.usuario_registra)).toEqual(['023', '235'])
  })

  it('una MISMA factura con dos meseros conserva los dos', async () => {
    // La factura partida es justo el caso que el mesero-por-ticket no puede representar.
    const { rpc } = fakeSupabase([linea('t1', '023'), linea('t1', '01')])
    mock.cliente.rpc = rpc

    const filas = await getLineasDeTickets(['t1'])

    expect(filas.map(f => f.usuario_registra)).toEqual(['023', '01'])
  })

  it('acepta el `null` del histórico sin inventarle un mesero', async () => {
    const { rpc } = fakeSupabase([linea('t1', null)])
    mock.cliente.rpc = rpc

    expect((await getLineasDeTickets(['t1']))[0].usuario_registra).toBeNull()
  })

  it('el mesero viaja también cuando hay más tickets que una tanda', async () => {
    // Se pide de a 200 ids; el select se arma en cada vuelta y tiene que llevarlo en TODAS.
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`)
    const { rpc, tandas } = fakeSupabase(ids.map(id => linea(id, '555')))
    mock.cliente.rpc = rpc

    const filas = await getLineasDeTickets(ids)

    expect(tandas.map(t => t.length)).toEqual([200, 200, 50])
    expect(filas).toHaveLength(450)
    expect(filas.every(f => f.usuario_registra === '555')).toBe(true)
  })

  it('sin ids no consulta', async () => {
    const { rpc, tandas } = fakeSupabase([])
    mock.cliente.rpc = rpc

    expect(await getLineasDeTickets([])).toEqual([])
    expect(tandas).toEqual([])
  })
})

// La lente de "mesa propia" cuenta MESAS distintas, no facturas: hace falta el número de mesa.
// Desde la mig 067 la columna la decide el `returns table` de `pos_ventas_tickets_rango`
// (`posNdf.contrato067.test.ts` exige `mesa`); acá, que la app la deje pasar.
describe('getTicketsRango — trae el número de mesa', () => {
  it('la `mesa` que devuelve la función llega a la app', async () => {
    mock.cliente.rpc = () => Promise.resolve({ data: [{ id: 't1', mesa: '14' }], error: null })
    const { getTicketsRango } = await import('./posNdf')
    const filas = await getTicketsRango('santa-teresa', { desde: '2026-09-01', hasta: '2026-09-01' })
    expect(filas[0].mesa).toBe('14')
  })
})
