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

  return { from: () => nuevo(), viajes }
}

const mock = vi.hoisted(() => ({ cliente: { from: (): unknown => ({}) } }))
vi.mock('./supabase', () => ({ supabase: mock.cliente }))

const { getLineasDeTickets, getNetoPorJornada, getTicketsRango } = await import('./posNdf')

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

// ── getTicketsRango ────────────────────────────────────────────────────────────────────────

describe('getTicketsRango — no puede quedarse en 1.000 facturas', () => {
  it('devuelve las 39.470 de staging, no las 1.000 que corta PostgREST', async () => {
    const fake = fakePostgrest(tickets(39_470))
    mock.cliente.from = fake.from

    const filas = await getTicketsRango('santa-teresa', { desde: '2026-08-01', hasta: '2026-08-31' })

    // Ésta es LA aserción del bug: contra el código viejo daba 1.000.
    expect(filas).toHaveLength(39_470)
    expect(new Set(filas.map(t => t.id)).size).toBe(39_470)   // ni un duplicado
  })

  it('no saltea ninguna: están la primera, la del borde de página y la última', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.from = fake.from

    const ids = new Set((await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' }))
      .map(t => t.id))

    expect(ids.has('t000000')).toBe(true)
    expect(ids.has('t000999')).toBe(true)   // última de la página 1
    expect(ids.has('t001000')).toBe(true)   // primera de la página 2
    expect(ids.has('t002499')).toBe(true)
  })

  it('pagina con `.range()` en todos los viajes, nunca a pelo', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.from = fake.from
    await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' })

    expect(fake.viajes.every(v => v.rango !== null)).toBe(true)
    expect(fake.viajes.map(v => v.rango)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('ordena por `id` además de `fecha_registra`: sin ese desempate la paginación repite filas', async () => {
    // `fecha_registra` no es única (decenas de facturas por segundo). Con un orden que empata,
    // el motor puede devolver la misma fila en dos páginas y perder otra. El orden TOTAL es lo
    // que hace correcta a la paginación por posición, no un detalle de prolijidad.
    const fake = fakePostgrest(tickets(1_200))
    mock.cliente.from = fake.from
    await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-31' })

    expect(fake.viajes[0].orden).toEqual(['fecha_registra', 'id'])
  })

  it('un rango chico no paga viajes de más', async () => {
    const fake = fakePostgrest(tickets(12))
    mock.cliente.from = fake.from

    expect(await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-01' })).toHaveLength(12)
    expect(fake.viajes).toHaveLength(1)   // vino incompleta: no hace falta preguntar de nuevo
  })

  it('sin facturas devuelve vacío', async () => {
    mock.cliente.from = fakePostgrest([]).from
    expect(await getTicketsRango('x', { desde: '2026-08-01', hasta: '2026-08-01' })).toEqual([])
  })
})

// ── getLineasDeTickets ─────────────────────────────────────────────────────────────────────

describe('getLineasDeTickets — una tanda de 200 facturas YA pasa las 1.000 líneas', () => {
  it('no pierde ninguna de las 1.400 líneas de una sola tanda', async () => {
    // 200 facturas × 7 líneas = 1.400. Con el corte de PostgREST se veían 1.000 y las otras 400
    // desaparecían: la venta de esa tanda salía corta y nadie se enteraba.
    const ids = tickets(200).map(t => String(t.id))
    const fake = fakePostgrest(lineas(ids, 7))
    mock.cliente.from = fake.from

    const filas = await getLineasDeTickets(ids)

    expect(filas).toHaveLength(1_400)
    expect(new Set(filas.map(l => `${l.ticket_id}`)).size).toBe(200)
  })

  it('a escala de staging: 450 facturas × 6 líneas, en tandas de 200 y sin perder nada', async () => {
    const ids = tickets(450).map(t => String(t.id))
    const fake = fakePostgrest(lineas(ids, 6))
    mock.cliente.from = fake.from

    const filas = await getLineasDeTickets(ids)

    expect(filas).toHaveLength(2_700)
    // Las tandas de ids siguen siendo de 200 (la URL no puede crecer), y cada una se pagina.
    // 200 ids -> 1.200 líneas -> dos páginas; los 50 últimos -> 300 líneas -> una.
    expect(fake.viajes.map(v => v.in?.length)).toEqual([200, 200, 200, 200, 50])
    expect(fake.viajes.every(v => v.rango !== null)).toBe(true)
  })

  it('ordena por una columna ÚNICA (`id`), que es lo que `.range()` necesita', async () => {
    const ids = tickets(10).map(t => String(t.id))
    const fake = fakePostgrest(lineas(ids, 3))
    mock.cliente.from = fake.from
    await getLineasDeTickets(ids)

    expect(fake.viajes[0].orden).toEqual(['ticket_id', 'id'])
  })

  it('sin ids no consulta', async () => {
    const fake = fakePostgrest([])
    mock.cliente.from = fake.from
    expect(await getLineasDeTickets([])).toEqual([])
    expect(fake.viajes).toHaveLength(0)
  })
})

// ── getNetoPorJornada ──────────────────────────────────────────────────────────────────────

describe('getNetoPorJornada — el neto no puede salir corto por truncación', () => {
  it('suma las 2.500 facturas del rango, no las primeras 1.000', async () => {
    const fake = fakePostgrest(tickets(2_500))
    mock.cliente.from = fake.from

    const neto = await getNetoPorJornada('x', ['2026-08-30'])

    // 2.500 × ₡1.000. Truncado daban ₡1.000.000 — un día flojo perfectamente creíble.
    expect(neto['2026-08-30']).toBe(2_500_000)
  })

  it('pagina con `.range()` y con orden total', async () => {
    const fake = fakePostgrest(tickets(1_500))
    mock.cliente.from = fake.from
    await getNetoPorJornada('x', ['2026-08-30'])

    expect(fake.viajes.every(v => v.rango !== null)).toBe(true)
    expect(fake.viajes[0].orden).toEqual(['fecha_registra', 'id'])
  })

  it('sin fechas no consulta', async () => {
    const fake = fakePostgrest(tickets(10))
    mock.cliente.from = fake.from
    expect(await getNetoPorJornada('x', [])).toEqual({})
    expect(fake.viajes).toHaveLength(0)
  })
})
