// Ventas v2 · «Resumen» por la función de la 190 (`pos_ventas_resumen`): el camino agregado da lo MISMO
// que el camino de filas de la 067. Datos ficticios. `jsonComoLaFuncion` es una copia en TS de lo que hace
// el SQL (ventana, neta, céntimos, facturas de salón, lotes); la paridad contra el SQL real, con datos de
// prod en solo lectura, está en el PR (scripts/sql/190_pruebas.sql + la corrida de paridad).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../shared/api/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
const getTicketsRango = vi.fn()
const getLineasDeTickets = vi.fn()
vi.mock('../../shared/api/posNdf', async (orig) => ({
  ...(await orig<typeof import('../../shared/api/posNdf')>()),
  getTicketsRango: (...a: unknown[]) => getTicketsRango(...a),
  getLineasDeTickets: (...a: unknown[]) => getLineasDeTickets(...a),
  getSaloneroNombres: async () => ({}),
}))

import type { LineaNdfRow, TicketVentaRow } from '../../shared/api/posNdf'
import { ventanaRangoJornadas } from '../../shared/api/posNdf'
import { fechaCR } from '../../shared/ndf/jornada'
import { calcularPeriodo, type PeriodoV2, type Rango } from './periodos'
import { alertaDeAyer, armarLectura, armarLecturaAgregada, cifrasDelRango } from './resumenV2'
import { parsearResumenAgregado } from './resumenV2Agregado'
import { cargarLecturaResumen, esFuncionInexistente, juntarPartes, limpiarCacheResumen, partirTramo,
  tramosDeLectura } from './resumenV2Datos'
import { datos, l, t } from './resumenV2.fixture'

const ANCLA = '2026-11-18'
const cts = (x: number) => Math.floor(x * 100 + 0.5)

/** Lo que devuelve el SQL de la 190 para un tramo, armado en TS sobre las mismas filas. */
function jsonComoLaFuncion(tickets: readonly TicketVentaRow[], lineas: readonly LineaNdfRow[], r: Rango) {
  const v = ventanaRangoJornadas(r.desde, r.hasta)
  const d0 = Date.parse(v.desde), d1 = Date.parse(v.hasta)
  const ts = tickets.filter(x => x.estado === 'C' && Date.parse(x.fecha_registra) >= d0 && Date.parse(x.fecha_registra) < d1)
    .sort((a, b) => Date.parse(a.fecha_registra) - Date.parse(b.fecha_registra) || a.id.localeCompare(b.id))
  const porT = new Map<string, LineaNdfRow[]>()
  for (const x of lineas) porT.set(x.ticket_id, [...(porT.get(x.ticket_id) ?? []), x])
  const f = ts.map(x => {
    const ls = porT.get(x.id)
    const neta = !ls ? (x.valor_servido_crc ?? 0)
      : ls.filter(y => y.familia === null || ![6, 17, 20].includes(y.familia)).reduce((s, y) => s + (y.monto ?? 0), 0)
    const duenos = !ls ? null : ls.filter(y => y.familia === 28).reduce((s, y) => s + (y.monto ?? 0), 0)
    const pax = (x.pax_articulo ?? 0) > 0 ? x.pax_articulo! : (x.pax ?? 0)
    return { x, neta, duenos, pax, dia: fechaCR(x.fecha_registra)! }
  })
  const dias = new Map<string, number[]>()
  for (const e of f) {
    if (e.dia < r.desde || e.dia > r.hasta) continue
    const a = dias.get(e.dia) ?? [0, 0, 0, 0, 0, 0]
    a[0] += cts(e.neta); a[1] += cts(e.x.iva_crc ?? 0); a[2] += cts(e.x.servicio_crc ?? 0)
    if (e.x.canal === 'delivery') a[3] += cts(e.neta)
    a[4] += e.pax; a[5] += 1
    dias.set(e.dia, a)
  }
  const lotes = new Map<string, [string | null, string | null, string]>()
  for (const e of f) {
    const cierre = e.x.fecha_cierra ? new Date(e.x.fecha_cierra).toISOString() : null
    const k = `${e.x.cajero_login}|${cierre}|${cierre ? '' : e.dia}`
    const previo = lotes.get(k)
    if (!previo || Date.parse(e.x.fecha_registra) < Date.parse(previo[2])) lotes.set(k, [e.x.cajero_login, e.x.fecha_cierra, e.x.fecha_registra])
  }
  return {
    dias: [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, a]) => [d, ...a]),
    facturas: f.filter(e => e.x.canal === 'salon').map(e => [e.x.id, e.x.fecha_registra, e.x.salonero_login,
      e.x.pax, e.x.pax_articulo, e.neta, e.duenos, e.x.total_crc, e.x.cajero_login, e.x.fecha_cierra]),
    lotes: [...lotes.values()].sort((a, b) => Date.parse(a[2]) - Date.parse(b[2])),
  }
}

/** El camino de filas, como `cargarLecturaResumen` con la 067 (cada tramo por su ventana). */
function lecturaFilas(tickets: TicketVentaRow[], lineas: LineaNdfRow[], p: PeriodoV2) {
  const partes = tramosDeLectura(p).map(r => {
    const v = ventanaRangoJornadas(r.desde, r.hasta)
    const ts = tickets.filter(x => x.estado === 'C' && Date.parse(x.fecha_registra) >= Date.parse(v.desde) && Date.parse(x.fecha_registra) < Date.parse(v.hasta))
    const ids = new Set(ts.map(x => x.id))
    return { tickets: ts, lineas: lineas.filter(x => ids.has(x.ticket_id)) }
  })
  return armarLectura(...juntarPartes(partes))
}

function lecturaAgregada(tickets: TicketVentaRow[], lineas: LineaNdfRow[], p: PeriodoV2, max?: number) {
  const partes = tramosDeLectura(p).flatMap(r => partirTramo(r, max))
    .map(r => parsearResumenAgregado(JSON.parse(JSON.stringify(jsonComoLaFuncion(tickets, lineas, r)))))
  return armarLecturaAgregada(partes)
}

const sinNombres = (d: object) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'saloneroNames'))

function compararPeriodo(tickets: TicketVentaRow[], lineas: LineaNdfRow[], p: PeriodoV2, max?: number) {
  const a = lecturaFilas(tickets, lineas, p)
  const b = lecturaAgregada(tickets, lineas, p, max)
  const rangos: Rango[] = [p, ...Object.values(p.bases).filter((x): x is NonNullable<typeof x> => !!x)]
  for (const r of rangos) {
    const ca = cifrasDelRango(a, r), cb = cifrasDelRango(b, r)
    expect(cb.dias).toEqual(ca.dias.map(sinNombres))
    expect(cb.totales).toEqual(ca.totales)
    expect(cb.facturas).toBe(ca.facturas)
    expect(cb.diasAbiertos).toBe(ca.diasAbiertos)
    const { valor: va, valorSoloConPax: sa, netaSalon: na, netaSinReferencia: ra, netaMesasDuenos: da, netaRegaliasTotales: ga, ...ia } = ca.vpp
    const { valor: vb, valorSoloConPax: sb, netaSalon: nb, netaSinReferencia: rb, netaMesasDuenos: db, netaRegaliasTotales: gb, ...ib } = cb.vpp
    expect(ib).toEqual(ia) // conteos y personas: exactos
    for (const [x, y] of [[va, vb], [sa, sb], [na, nb], [ra, rb], [da, db], [ga, gb]] as const) {
      if (x === null || y === null) expect(y).toBe(x)
      else expect(Math.abs(x - y)).toBeLessThan(1e-6)
    }
  }
  expect(alertaDeAyer(b, p)).toEqual(alertaDeAyer(a, p))
}

describe('pos_ventas_resumen (190) = camino de filas (067)', () => {
  const { tickets, lineas } = datos('2025-08-01', 475)

  it.each(['ayer', 'mesALaFecha', 'anioALaFecha', 'temporada', 'semana'] as const)('%s: días, TOTAL, facturas, PAX y venta por persona', tipo => {
    compararPeriodo(tickets, lineas, calcularPeriodo({ tipo, ancla: ANCLA }))
  })

  it('partido en pedidos cortos (30 días) da lo mismo', () => {
    compararPeriodo(tickets, lineas, calcularPeriodo({ tipo: 'anioALaFecha', ancla: ANCLA }), 30)
  })

  it('el lote que abre con una factura que no es de salón: el día de sesión sale igual (anclas)', () => {
    // La caja de la noche abre el 2-nov con un delivery a las 17:05 y sigue con mesas pasada la medianoche,
    // después de que la jornada del 3-nov ya cerró sus primeras mesas. Sin el ancla, las mesas de las
    // 00:30 se irían al 3-nov.
    const extra: TicketVentaRow[] = [
      t({ id: 'zz-del', canal: 'delivery', fecha_registra: '2026-11-02T17:05:00-06:00', fecha_cierra: '2026-11-03T01:10:00-06:00', cajero_login: '222', pax: 0, pax_articulo: 0 }),
      t({ id: 'zz-m1', fecha_registra: '2026-11-03T00:30:00-06:00', fecha_cierra: '2026-11-03T01:10:00-06:00', cajero_login: '222', pax: 0, pax_articulo: 0 }),
      t({ id: 'zz-m2', fecha_registra: '2026-11-03T00:40:00-06:00', fecha_cierra: '2026-11-03T01:10:00-06:00', cajero_login: '222', pax: 3, pax_articulo: 3 }),
    ]
    const ls = [l('zz-del', 5_000), l('zz-m1', 12_000), l('zz-m2', 30_000)]
    const ts = [...tickets.filter(x => !x.fecha_registra.startsWith('2026-11-02') && !x.fecha_registra.startsWith('2026-11-03')), ...extra]
    const p = calcularPeriodo({ tipo: 'rango', desde: '2026-11-02', hasta: '2026-11-02', ancla: ANCLA })
    compararPeriodo(ts, [...lineas, ...ls], p)
    const b = lecturaAgregada(ts, [...lineas, ...ls], p)
    expect(cifrasDelRango(b, p).vpp.personasCargadas).toBe(3) // las mesas de las 00:30 son del 2-nov
  })
})

describe('partirTramo y el error de «no existe»', () => {
  it('parte sin huecos ni pisadas', () => {
    expect(partirTramo({ desde: '2025-01-01', hasta: '2025-01-10' }, 4)).toEqual([
      { desde: '2025-01-01', hasta: '2025-01-04' }, { desde: '2025-01-05', hasta: '2025-01-08' },
      { desde: '2025-01-09', hasta: '2025-01-10' }])
    expect(partirTramo({ desde: '2025-01-01', hasta: '2025-01-01' })).toEqual([{ desde: '2025-01-01', hasta: '2025-01-01' }])
  })
  it('solo «la función no existe» cae al camino viejo; un 42501 no', () => {
    expect(esFuncionInexistente({ code: 'PGRST202', message: 'Could not find the function public.pos_ventas_resumen' })).toBe(true)
    expect(esFuncionInexistente({ code: '42883', message: 'function public.pos_ventas_resumen does not exist' })).toBe(true)
    expect(esFuncionInexistente({ code: '42501', message: 'No autorizado' })).toBe(false)
    expect(esFuncionInexistente(null)).toBe(false)
  })
})

describe('cargarLecturaResumen', () => {
  const p = calcularPeriodo({ tipo: 'ayer', ancla: ANCLA })
  beforeEach(() => { limpiarCacheResumen(); rpc.mockReset(); getTicketsRango.mockReset(); getLineasDeTickets.mockReset() })

  it('con la función: un pedido por tramo y ninguna lectura de filas', async () => {
    rpc.mockImplementation(async (fn: string) => fn === 'pos_ventas_internas' ? { data: [], error: null }
      : { data: { dias: [['2026-11-17', 1_000_000, 0, 0, 0, 2, 1]], facturas: [], lotes: [] }, error: null })
    const lec = await cargarLecturaResumen('santa-teresa', p)
    const deResumen = rpc.mock.calls.filter(c => c[0] === 'pos_ventas_resumen')
    expect(deResumen).toHaveLength(tramosDeLectura(p).length)
    // Y las mesas internas (193), un pedido por tramo.
    expect(rpc.mock.calls.filter(c => c[0] === 'pos_ventas_internas')).toHaveLength(tramosDeLectura(p).length)
    expect(getTicketsRango).not.toHaveBeenCalled()
    expect(cifrasDelRango(lec, p).totales.ventaNeta).toBe(10_000)
  })

  it('sin la función (base sin la 190): cae a la 067 y no la vuelve a pedir', async () => {
    rpc.mockImplementation(async (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }))
    getTicketsRango.mockResolvedValue([t({ id: 'a1', fecha_registra: '2026-11-17T19:00:00-06:00' })])
    getLineasDeTickets.mockResolvedValue([l('a1', 7_000)])
    const lec = await cargarLecturaResumen('santa-teresa', p)
    expect(cifrasDelRango(lec, p).totales.ventaNeta).toBe(7_000)
    const llamadas = rpc.mock.calls.length
    await cargarLecturaResumen('santa-teresa', calcularPeriodo({ tipo: 'semana', ancla: ANCLA }))
    expect(rpc.mock.calls.length).toBe(llamadas)
  })

  it('si el resumen falla, la lectura de mesas internas (que va en paralelo) no deja una promesa sin atender', async () => {
    const sueltas: unknown[] = []
    const oir = (e: unknown) => { sueltas.push(e) }
    process.on('unhandledRejection', oir)
    try {
      rpc.mockImplementation(async (fn: string) => fn === 'pos_ventas_internas'
        ? { data: null, error: { code: '42501', message: 'No autorizado (internas)' } }
        : { data: null, error: { code: '42501', message: 'No autorizado' } })
      await expect(cargarLecturaResumen('santa-teresa', p)).rejects.toThrow('No autorizado')
      await new Promise(r => setTimeout(r, 0))
      expect(sueltas).toEqual([])
    } finally { process.off('unhandledRejection', oir) }
  })

  it('si solo fallan las mesas internas, el error llega (no se tapa)', async () => {
    rpc.mockImplementation(async (fn: string) => fn === 'pos_ventas_internas'
      ? { data: null, error: { code: '42501', message: 'No autorizado (internas)' } }
      : { data: { dias: [], facturas: [], lotes: [] }, error: null })
    await expect(cargarLecturaResumen('santa-teresa', p)).rejects.toThrow('No autorizado (internas)')
  })

  it('otro error (42501) no se tapa con el camino viejo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'No autorizado' } })
    await expect(cargarLecturaResumen('santa-teresa', p)).rejects.toThrow('No autorizado')
    expect(getTicketsRango).not.toHaveBeenCalled()
  })
})
