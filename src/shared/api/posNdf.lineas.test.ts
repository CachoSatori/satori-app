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
 * Doble de PostgREST que se comporta como el de verdad en lo único que importa acá: devuelve
 * SOLO las columnas pedidas. Si el select no nombra `usuario_registra`, la fila sale sin él.
 */
function fakeSupabase(filas: Fila[]) {
  const selects: string[] = []
  const tandas: string[][] = []
  const api = {
    from: () => api,
    select: (cols: string) => {
      selects.push(cols)
      return api
    },
    in: (_col: string, ids: string[]) => {
      tandas.push(ids)
      const pedidas = selects[selects.length - 1].split(',').map(c => c.trim())
      const data = filas
        .filter(f => ids.includes(f.ticket_id))
        .map(f => Object.fromEntries(pedidas.filter(c => c in f).map(c => [c, f[c as keyof Fila]])))
      return Promise.resolve({ data, error: null })
    },
  }
  return { api, selects, tandas }
}

const mock = vi.hoisted(() => ({ cliente: { from: (): unknown => ({}) } }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getLineasDeTickets } = await import('./posNdf')

describe('getLineasDeTickets — trae el mesero de la línea', () => {
  it('pide `usuario_registra` en el select', async () => {
    const { api, selects } = fakeSupabase([linea('t1', '023')])
    mock.cliente.from = () => api

    await getLineasDeTickets(['t1'])

    expect(selects).toHaveLength(1)
    expect(selects[0].split(',').map(c => c.trim())).toContain('usuario_registra')
  })

  it('devuelve el login que comandó cada línea, no `undefined`', async () => {
    const { api } = fakeSupabase([linea('t1', '023'), linea('t2', '235')])
    mock.cliente.from = () => api

    const filas = await getLineasDeTickets(['t1', 't2'])

    // La aserción del bug: sin la columna en el select esto daba `[undefined, undefined]`.
    expect(filas.map(f => f.usuario_registra)).toEqual(['023', '235'])
  })

  it('una MISMA factura con dos meseros conserva los dos', async () => {
    // La factura partida es justo el caso que el mesero-por-ticket no puede representar.
    const { api } = fakeSupabase([linea('t1', '023'), linea('t1', '01')])
    mock.cliente.from = () => api

    const filas = await getLineasDeTickets(['t1'])

    expect(filas.map(f => f.usuario_registra)).toEqual(['023', '01'])
  })

  it('acepta el `null` del histórico sin inventarle un mesero', async () => {
    const { api } = fakeSupabase([linea('t1', null)])
    mock.cliente.from = () => api

    expect((await getLineasDeTickets(['t1']))[0].usuario_registra).toBeNull()
  })

  it('el mesero viaja también cuando hay más tickets que una tanda', async () => {
    // Se pide de a 200 ids; el select se arma en cada vuelta y tiene que llevarlo en TODAS.
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`)
    const { api, selects, tandas } = fakeSupabase(ids.map(id => linea(id, '555')))
    mock.cliente.from = () => api

    const filas = await getLineasDeTickets(ids)

    expect(tandas.map(t => t.length)).toEqual([200, 200, 50])
    expect(selects.every(s => s.includes('usuario_registra'))).toBe(true)
    expect(filas).toHaveLength(450)
    expect(filas.every(f => f.usuario_registra === '555')).toBe(true)
  })

  it('sin ids no consulta', async () => {
    const { api, selects } = fakeSupabase([])
    mock.cliente.from = () => api

    expect(await getLineasDeTickets([])).toEqual([])
    expect(selects).toEqual([])
  })
})

// La lente de "mesa propia" cuenta MESAS distintas, no facturas: una mesa que pidió la cuenta en
// dos tandas son dos facturas y una sola mesa. Para eso hace falta el número de mesa, que la
// tabla siempre tuvo y el select del ticket no pedía.
describe('getTicketsRango / getTicketsJornada — traen el número de mesa', () => {
  it('`mesa` está en las columnas que se piden', async () => {
    const selects: string[] = []
    const api = {
      from:   () => api,
      select: (cols: string) => { selects.push(cols); return api },
      eq:     () => api,
      gte:    () => api,
      lt:     () => api,
      order:  () => Promise.resolve({ data: [], error: null }),
    }
    mock.cliente.from = () => api

    const { getTicketsRango } = await import('./posNdf')
    await getTicketsRango('santa-teresa', { desde: '2026-09-01', hasta: '2026-09-01' })

    expect(selects[0].split(',').map(c => c.trim())).toContain('mesa')
  })
})
