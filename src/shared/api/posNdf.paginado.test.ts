// La lectura del PoS no puede truncar en 1.000 filas.
//
// PostgREST devuelve su `max-rows` (1.000) y **no avisa que hay más**: sin error, sin warning,
// sin flag. La consulta parece haber traído todo. Es el mismo bug que ya se arregló en
// `getAllCashMovements` (`cash.paginado.test.ts`) y en `getAllVentasDias`
// (`ventas.limit.test.ts`); acá pegaba en la fuente del PoS, que es la más grande que tiene la
// app: en staging, **39.470 tickets y 221.639 líneas** (~5,6 líneas por factura).
//
// El daño no era un error en pantalla, era peor: Paridad concluía que "el PoS no tiene esos
// días" y Saloneros x línea repartía un día que era el 2,5% del real. Los dos números se leían
// como plausibles.
import { describe, it, expect, vi } from 'vitest'

/** El `max-rows` del servidor. El doble corta acá, como el PostgREST de verdad. */
const MAX_ROWS = 1000

interface Fila { [k: string]: unknown }

/**
 * Doble de PostgREST.
 *
 * Se comporta como el real en las dos cosas que importan:
 *   · Sin `Range` (sin `.range()`), devuelve como mucho `MAX_ROWS` filas y NO avisa.
 *   · Con `.range(a, b)`, devuelve esa ventana, recortada igual a `MAX_ROWS`.
 * Y ordena de verdad por las columnas que le pidieron, para poder ver si el orden alcanza para
 * paginar sin repetir ni saltear.
 */
function fakePostgrest(filas: Fila[]) {
  const viajes: { rango: [number, number] | null; orden: string[]; in?: unknown[] }[] = []

  const nuevo = () => {
    let datos = filas
    const orden: string[] = []
    let rango: [number, number] | null = null
    let filtroIn: unknown[] | undefined

    const resolver = () => {
      const ordenadas = [...datos].sort((a, b) => {
        for (const c of orden) {
          const x = String(a[c] ?? ''), y = String(b[c] ?? '')
          if (x !== y) return x < y ? -1 : 1
        }
        return 0   // sin desempate: el motor puede devolver CUALQUIER orden (ver test de abajo)
      })
      viajes.push({ rango, orden: [...orden], in: filtroIn })
      const [a, b] = rango ?? [0, MAX_ROWS - 1]
      return { data: ordenadas.slice(a, a + Math.min(b - a + 1, MAX_ROWS)), error: null }
    }

    const api = {
      from:   () => api,
      select: () => api,
      eq:     () => api,
      gte:    () => api,
      lt:     () => api,
      in:     (_c: string, ids: unknown[]) => {
        filtroIn = ids
        datos = filas.filter(f => ids.includes(f.ticket_id))
        return api
      },
      order:  (c: string) => { orden.push(c); return api },
      range:  (a: number, b: number) => { rango = [a, b]; return Promise.resolve(resolver()) },
      then:   (r: (v: ReturnType<typeof resolver>) => unknown) => r(resolver()),
    }
    return api
  }

  // Las funciones de la mig 067 (`pos_ventas_tickets_rango` / `pos_ventas_lineas`): ordenan por
  // un orden TOTAL y aplican `limit`/`offset` ADENTRO, recortado igual a `MAX_ROWS`.
  const rpcViajes: { fn: string; offset: number; limit: number; ids?: unknown[] }[] = []
  const rpc = (fn: string, a: Record<string, unknown>) => {
    const offset = Number(a.p_offset ?? 0), limit = Math.min(Number(a.p_limit ?? MAX_ROWS), MAX_ROWS)
    const ids = a.p_ticket_ids as unknown[] | undefined
    rpcViajes.push({ fn, offset, limit, ids })
    const base = fn === 'pos_ventas_lineas' ? filas.filter(f => ids!.includes(f.ticket_id)) : filas
    const clave = fn === 'pos_ventas_lineas' ? ['ticket_id', 'id'] : ['fecha_registra', 'id']
    const ordenadas = [...base].sort((x, y) => {
      for (const c of clave) { const p = String(x[c] ?? ''), q = String(y[c] ?? ''); if (p !== q) return p < q ? -1 : 1 }
      return 0
    })
    return Promise.resolve({ data: ordenadas.slice(offset, offset + limit), error: null })
  }

  return { from: () => nuevo(), rpc, viajes, rpcViajes }
}

const mock = vi.hoisted(() => ({ cliente: {
  from: (): unknown => ({}),
  rpc:  ((): unknown => ({})) as (fn: string, args: never) => unknown,
} }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getLineasDeTickets, getTicketsDeJornadas, getTicketsRango } = await import('./posNdf')

/** Facturas de una misma jornada, con `fecha_registra` REPETIDA a propósito (ver más abajo). */
const tickets = (n: number): Fila[] =>
  Array.from({ length: n }, (_, i) => ({
    id:                `t${String(i).padStart(6, '0')}`,
    numero_factura:    String(100000 + i),
    // A propósito solo 60 instantes distintos para 39.470 facturas: en el PoS real hay decenas
    // de facturas por segundo, y `fecha_registra` NO es una clave de orden única.
    fecha_registra:    `2026-08-30T${String(12 + (i % 6)).padStart(2, '0')}:00:${String(i % 10).padStart(2, '0')}-06:00`,
    valor_servido_crc: 1000,
  }))

const lineas = (ids: string[], porTicket: number): Fila[] =>
  ids.flatMap(t => Array.from({ length: porTicket }, (_, k) => ({
    id: `${t}-l${k}`, ticket_id: t, codigo_producto: '100', nombre: 'ROLL',
    cantidad: 1, monto: 1000, familia: 2, usuario_registra: '032',
  })))

// ── getTicketsRango (mig 067: por `pos_ventas_tickets_rango`) ───────────────────────────────

describe('getTicketsRango — no puede quedarse en 1.000 facturas', () => {
  it('devuelve las 39.470 de staging, no las 1.000 que corta PostgREST', async () => {
    const fake = fakePostgrest(tickets(39_470))
    mock.cliente.rpc = fake.rpc

    const filas = await getTicketsRango('santa-teresa', { desde: '2026-08-01', hasta: '2026-08-31' })

    expect(filas).toHaveLength(39_470)
    expect(new Set(filas.map(t => t.id)).size).toBe(39_470)   // ni un duplicado
  })

  it('no saltea ninguna: están la primera, la del borde de página y la última', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.rpc = fake.rpc

    const ids = new Set((await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' }))
      .map(t => t.id))

    expect(ids.has('t000000')).toBe(true)
    expect(ids.has('t000999')).toBe(true)   // última de la página 1
    expect(ids.has('t001000')).toBe(true)   // primera de la página 2
    expect(ids.has('t002499')).toBe(true)
  })

  it('pagina en todos los viajes (offset/limit a la función), nunca a pelo', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.rpc = fake.rpc
    await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' })

    expect(fake.rpcViajes.map(v => [v.fn, v.offset, v.limit])).toEqual([
      ['pos_ventas_tickets_rango', 0, 1000],
      ['pos_ventas_tickets_rango', 1000, 1000],
      ['pos_ventas_tickets_rango', 2000, 1000],
    ])
  })

  it('lee por la función, no por la tabla (el mismo camino para todos los roles)', async () => {
    const fake = fakePostgrest(tickets(5))
    mock.cliente.rpc = fake.rpc
    await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' })
    expect(fake.viajes).toHaveLength(0)   // ningún `.from('pos_ndf_tickets')`
  })

  it('un rango chico no paga viajes de más', async () => {
    const fake = fakePostgrest(tickets(12))
    mock.cliente.rpc = fake.rpc

    expect(await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-01' })).toHaveLength(12)
    expect(fake.rpcViajes).toHaveLength(1)   // vino incompleta: no hace falta preguntar de nuevo
  })

  it('sin facturas devuelve vacío', async () => {
    mock.cliente.rpc = fakePostgrest([]).rpc
    expect(await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-01' })).toEqual([])
  })
})

// ── getLineasDeTickets (mig 067: por `pos_ventas_lineas`) ───────────────────────────────────

describe('getLineasDeTickets — una tanda de 200 facturas YA pasa las 1.000 líneas', () => {
  it('no pierde ninguna de las 1.400 líneas de una sola tanda', async () => {
    const ids = tickets(200).map(t => String(t.id))
    const fake = fakePostgrest(lineas(ids, 7))
    mock.cliente.rpc = fake.rpc

    const filas = await getLineasDeTickets(ids)

    expect(filas).toHaveLength(1_400)
    expect(new Set(filas.map(l => `${l.ticket_id}`)).size).toBe(200)
  })

  it('a escala de staging: 450 facturas × 6 líneas, en tandas de 200 y sin perder nada', async () => {
    const ids = tickets(450).map(t => String(t.id))
    const fake = fakePostgrest(lineas(ids, 6))
    mock.cliente.rpc = fake.rpc

    const filas = await getLineasDeTickets(ids)

    expect(filas).toHaveLength(2_700)
    // 200 ids -> 1.200 líneas -> dos páginas; los 50 últimos -> 300 líneas -> una.
    expect(fake.rpcViajes.map(v => v.ids?.length)).toEqual([200, 200, 200, 200, 50])
    expect(fake.rpcViajes.map(v => v.offset)).toEqual([0, 1000, 0, 1000, 0])
  })

  it('sin ids no consulta', async () => {
    const fake = fakePostgrest([])
    mock.cliente.rpc = fake.rpc
    expect(await getLineasDeTickets([])).toEqual([])
    expect(fake.rpcViajes).toHaveLength(0)
  })
})

// ── getTicketsDeJornadas ───────────────────────────────────────────────────────────────────

describe('getTicketsDeJornadas — la comparativa no puede salir corta por truncación', () => {
  it('devuelve las 2.500 facturas del rango, no las primeras 1.000', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.from = fake.from

    const filas = await getTicketsDeJornadas('x', ['2026-08-30'])

    // Truncado daban 1.000 — un día flojo perfectamente creíble.
    expect(filas).toHaveLength(2_500)
  })

  it('pagina con `.range()` y con orden total', async () => {
    const fake = fakePostgrest(tickets(1_500))
    mock.cliente.from = fake.from
    await getTicketsDeJornadas('x', ['2026-08-30'])

    expect(fake.viajes.every(v => v.rango !== null)).toBe(true)
    expect(fake.viajes[0].orden).toEqual(['fecha_registra', 'id'])
  })

  it('sin fechas no consulta', async () => {
    const fake = fakePostgrest(tickets(10))
    mock.cliente.from = fake.from
    expect(await getTicketsDeJornadas('x', [])).toEqual([])
    expect(fake.viajes).toHaveLength(0)
  })
})
