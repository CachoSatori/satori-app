// @vitest-environment happy-dom
//
// Ventas v2 · 3.5.2 — PARIDAD (SPEC-ventas-v2 §12.5, criterio 7). Antes de retirar «Hoy», «Ventas» e «Histórico»:
// para el MISMO período y los MISMOS datos, cada cifra que se mueve de lugar da lo mismo al colón en la pantalla
// nueva que en la vieja. Tres períodos: ayer, mes a la fecha y el último mes cerrado.
//
//   · «Lo de antes» se calcula con las MISMAS funciones que usaban las vistas retiradas en `main` (siguen en
//     `ventasUtils.ts`): «Ventas» = `getContabilidadDays` + `totalesContabilidad`; «Hoy» = `getDayStats`,
//     `aggGeneral`, `mixComBeb`, `topProds`, `aggSalonero`; «Histórico» = `aggGeneral` sobre el rango.
//   · «Lo de ahora» se LEE de la pantalla pintada («Resumen», «Salón en detalle», 📤 y «Regalías»).
//   · Los datos: la fixture ficticia del Resumen (`resumenV2.fixture.ts`) + productos clasificados a mano como
//     cortesía y comida del personal + UNA FACTURA ANULADA (`X`) que el lector de la pantalla recibe: si alguna
//     cuenta nueva la sumara, esta prueba cae (criterio 15).
//
// Excepciones declaradas (§12.5): venta por persona estimada (1), meta y proyección (2), «Contexto {día}» (3). No se
// prueban acá. Desde la 3.2b, «Bebidas por persona» (catálogo por código): la de «Hoy» se compara contra el «antes». Reloj fijo DE NOCHE en CR (23:30 del 18-nov = 05:30 UTC del 19).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { LineaNdfRow, TicketVentaRow } from '../../../shared/api/posNdf'
import type { Meta, ProductMap } from '../../../shared/types/ventas'

let role = 'owner'
vi.mock('../../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../../shared/api/posNdf', async orig => ({
  ...(await orig<typeof import('../../../shared/api/posNdf')>()),
  getPromPaxAgregado: vi.fn(async () => []),
  getSaloneroNombres: vi.fn(async () => ({})),
  // 3.2b: el catálogo por código (bebidas por persona). Vacío acá: esta paridad mira lo de «Hoy»; la cifra nueva la
  // prueban `SalonEnDetalle.bebidas.render.test.tsx` y `VentasResumen.352.render.test.tsx`.
  getVentasProductos: vi.fn(async () => ({ productos: [], meses: [], catalogo: [], familias: [], sinLineas: { facturas: 0, cts: 0 }, netaCts: 0 })),
}))

import { datos, l, t } from '../resumenV2.fixture'
import { armarLectura } from '../resumenV2'
import { armarDiasMap } from '../ventasDiasDesdePos'
import {
  aggGeneral, aggSalonero, allSaloneros, fi, fusionarProductMap, getContabilidadDays, getDayStats, mixComBeb,
  topProds, totalesContabilidad,
} from '../ventasUtils'
import { diaCRDeFactura } from '../indicadores'
import { dayOfWeek, dowAverages } from '../ventasUtils'
import { porDiaSemana } from '../tiemposV2'
import { diaSemana } from '../periodosPromPax'

// ── Los datos ────────────────────────────────────────────────────────────────────────────────
const base = datos('2026-09-01', 78)
const extraT: TicketVentaRow[] = []
const extraL: LineaNdfRow[] = []
const linea = (ticket_id: string, nombre: string, familia: number, monto: number, cantidad = 1): LineaNdfRow =>
  ({ ...l(ticket_id, monto, familia), nombre, codigo_producto: nombre, cantidad })
for (const f of ['2026-10-08', '2026-10-21', '2026-11-03', '2026-11-17']) {
  // Una mesa con un producto clasificado como cortesía y otro como comida del personal (a mano, en «Productos»).
  extraT.push(t({ id: `${f}-CP`, fecha_registra: `${f}T19:30:00-06:00`, fecha_cierra: `${f}T23:50:00-06:00`, salonero_login: '027', pax: 3 }))
  extraL.push(linea(`${f}-CP`, 'ROLL CORTESIA FICTICIO', 3, 6_500, 2), linea(`${f}-CP`, 'ALMUERZO PERSONAL FICTICIO', 4, 4_200))
}
// LA ANULADA: el día de «ayer», con plata. Ninguna cifra la cuenta.
const ANULADA = t({ id: 'X-1', estado: 'X', fecha_registra: '2026-11-17T20:30:00-06:00', fecha_cierra: '2026-11-17T21:00:00-06:00', pax: 4, total_crc: 99_999 })
const LINEAS_ANULADA = [linea('X-1', 'ROLL CORTESIA FICTICIO', 3, 77_777, 5), linea('X-1', 'PRODUCTO 2', 2, 55_555)]

const TICKETS_C = [...base.tickets, ...extraT]
const LINEAS_C = [...base.lineas, ...extraL]
/** Lo que recibe el lector de la pantalla nueva: con la anulada adentro. */
const TICKETS_LECTOR = [...TICKETS_C, ANULADA]
const LINEAS_LECTOR = [...LINEAS_C, ...LINEAS_ANULADA]

const CURADO: ProductMap = {
  'ROLL CORTESIA FICTICIO':     { tipo: 'cortesia', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
  'ALMUERZO PERSONAL FICTICIO': { tipo: 'personal', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
}
const RANGO_DATOS = { desde: '2026-09-01', hasta: '2026-11-17' }

/** «Lo de antes»: el `DiasMap` y el `ProductMap` del shell de Ventas en `main` (solo facturas cerradas, como la 067). */
const antes = (() => {
  const { dias, pm } = armarDiasMap(TICKETS_C, LINEAS_C, RANGO_DATOS, { uploadedAt: 'x', avisar: () => {} })
  return { dias, pm: fusionarProductMap(CURADO, pm) }
})()

// ── El lector de la pantalla nueva (mock de la base), con la anulada adentro ──────────────────
const lectura = armarLectura(TICKETS_LECTOR, LINEAS_LECTOR, {})
vi.mock('../resumenV2Datos', () => ({
  cargarLecturaResumen: vi.fn(async () => lectura),
  cargarLecturaRango: vi.fn(async () => lectura),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))
vi.mock('../lineasPeriodo', async orig => {
  const real = await orig<typeof import('../lineasPeriodo')>()
  return {
    ...real,
    cargarLineasPeriodo: vi.fn(async (_local: string, r: { desde: string; hasta: string }) => {
      const { dias, pm } = armarDiasMap(TICKETS_LECTOR, LINEAS_LECTOR, r, { uploadedAt: 'x', avisar: () => {} })
      return { dias, pm: fusionarProductMap(CURADO, pm) }
    }),
  }
})

import VentasResumen from '../VentasResumen'
import VentasRegalias from '../VentasRegalias'
// La vieja «Ventas» (retirada del menú en el 3.5.2; el archivo queda hasta la 3.5.5 por el contrato de la Edge).
import VentasContabilidad from '../VentasContabilidad'

const METAS = { restaurante: {}, margen: { '2026-10': 30 }, global: { bebPax: 0 }, salMetas: {} } as unknown as Meta

const PERIODOS = [
  { nombre: 'ayer (17-nov)', q: 'p=ayer', desde: '2026-11-17', hasta: '2026-11-17' },
  { nombre: 'mes a la fecha (1–17 nov)', q: 'p=mes&d=2026-11-17', desde: '2026-11-01', hasta: '2026-11-17' },
  { nombre: 'último mes cerrado (octubre)', q: 'p=mes&d=2026-10-01', desde: '2026-10-01', hasta: '2026-10-31' },
] as const

const fechasDe = (desde: string, hasta: string) => Object.keys(antes.dias).filter(f => f >= desde && f <= hasta).sort()
/** «Ventas → Contabilidad» (y «Hoy» para un día): la fila TOTAL del detalle por día. */
function contabilidad(desde: string, hasta: string) {
  const dias = getContabilidadDays(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)), antes.dias, {})
    .filter(d => d.fecha >= desde && d.fecha <= hasta)
  return { dias, tot: totalesContabilidad(dias) }
}
const facturasC = (desde: string, hasta: string) =>
  TICKETS_C.filter(x => { const d = diaCRDeFactura(x.fecha_registra); return d >= desde && d <= hasta }).length

let copiado = ''
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  copiado = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s: string) => { copiado = s } } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const abrirResumen = (q: string) =>
  render(<MemoryRouter initialEntries={[`/ventas?tab=resumen&${q}`]}><VentasResumen metas={METAS} /></MemoryRouter>)
const abrirRegalias = (q: string) =>
  render(<MemoryRouter initialEntries={[`/ventas?tab=regalias&${q}`]}><VentasRegalias /></MemoryRouter>)

async function abrirSalon() {
  const det = document.querySelector('details[data-bloque="salon-detalle"]') as HTMLDetailsElement
  det.open = true
  fireEvent(det, new Event('toggle'))
  await screen.findByText('Lo más vendido del período')
}
const val = (sel: string) => document.querySelector(`${sel} .vt-kpi-val`)!.textContent

describe.each(PERIODOS)('paridad 3.5.2 · $nombre', ({ q, desde, hasta }) => {
  it('«Ventas»/«Hoy» → «Resumen»: venta neta, bruta, IVA, servicio, salón, delivery, personas, Prom/PAX y facturas, al colón', async () => {
    const { dias, tot } = contabilidad(desde, hasta)
    abrirResumen(q)
    await screen.findByRole('table', { name: 'Detalle por día' })
    // Cifras de arriba.
    expect(val('[data-cifra="ventaNeta"]')).toBe(fi(tot.ventaNeta))
    expect(val('[data-cifra="personas"]')).toBe(tot.pax.toLocaleString('es-CR'))
    expect(document.querySelector('[data-cifra="cuentaPromedio"]')!.textContent).toContain(`${facturasC(desde, hasta)} facturas`)
    // Fila TOTAL, columna por columna (la de «Ventas» + Prom/PAX).
    const total = [...document.querySelectorAll('[data-fila="total"] td')].map(td => td.textContent)
    expect(total).toEqual(['TOTAL', '', fi(tot.ventaBruta), fi(tot.iva), fi(tot.serv), fi(tot.ventaNeta),
      fi(tot.salon), fi(tot.delivery), String(tot.pax), fi(tot.promPax)])
    // Cada día: lo mismo que la fila de «Ventas → Detalle por día» (con su Prom/PAX).
    const filas = [...document.querySelectorAll('table[aria-label="Detalle por día"] tbody tr:not([data-fila])')]
    expect(filas.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).toEqual(dias.map(d => [
      d.fecha, expect.any(String), fi(d.ventaBruta), fi(d.iva), fi(d.serv), fi(d.ventaNeta), fi(d.salon), fi(d.delivery),
      String(d.pax), fi(d.promPax),
    ]))
    if (desde === hasta) {
      // «Hoy»: «Venta Total Restaurante», «Salón» y «Delivery» del día = la cuenta del día (`getDayStats`).
      const s = getDayStats(antes.dias[desde])
      expect([s.ventaNeta, s.salon, s.delivery, s.pax].map(fi)).toEqual([tot.ventaNeta, tot.salon, tot.delivery, tot.pax].map(fi))
    }
  })

  it('«Hoy»/«Histórico» → «Salón en detalle»: plato, bebida, Beb/PAX, ratio C/B, comidas, bebidas, saloneros y lo más vendido', async () => {
    const f = fechasDe(desde, hasta)
    const gen = aggGeneral(f, antes.dias, antes.pm)
    const { com, beb } = mixComBeb(antes.dias, f, antes.pm)
    abrirResumen(q)
    await screen.findByRole('table', { name: 'Detalle por día' })
    await abrirSalon()
    expect(val('[data-salon="ventaSaloneros"]')).toBe(fi(gen.total))           // «Ventas Salón» de «Hoy» = «Salón» de «Histórico»
    expect(val('[data-salon="promPlato"]')).toBe(fi(gen.iCom > 0 ? com / gen.iCom : 0))
    expect(val('[data-salon="promBebida"]')).toBe(fi(gen.iBeb > 0 ? beb / gen.iBeb : 0))
    // 3.2b (excepción firmada, SPEC-ventas-v2 §4.1): la cifra principal pasa a «Bebidas por persona» del catálogo por
    // código (su prueba: `SalonEnDetalle.bebidas.render.test.tsx`); la de «Hoy» queda al lado como «antes».
    expect(document.querySelector('[data-testid="beb-pax-antes"]')!.textContent).toContain(gen.bebPax.toFixed(2).replace('.', ','))
    // 3.2c (excepción, decisión del dueño 26-nov): el Ratio C/B principal sale del catálogo por categoría; el de «Hoy»
    // queda al lado como «antes».
    expect(document.querySelector('[data-testid="ratio-cb-antes"]')!.textContent).toContain(`${(beb > 0 ? com / beb : 0).toFixed(2).replace('.', ',')}:1`)
    expect(val('[data-salon="comidas"]')).toBe(fi(com))
    expect(val('[data-salon="bebidas"]')).toBe(fi(beb))
    expect(document.querySelector('[data-salon="comidas"] .vt-kpi-sub')!.textContent).toContain(`${gen.iCom} platos`)
    expect(document.querySelector('[data-salon="bebidas"] .vt-kpi-sub')!.textContent).toContain(`${gen.iBeb} bebidas`)
    // Lo más vendido = el «Top Productos» de «Hoy» y el «Top productos del período» de «Histórico».
    const top = topProds(gen.prods, 'monto', 10, undefined, antes.pm)
    const filas = [...document.querySelectorAll('[data-bloque="mas-vendidos"] .vt-prod-row')]
    expect(filas.map(r => [r.querySelector('.vt-prod-name')!.firstChild!.textContent, r.querySelector('.vt-prod-stats')!.textContent]))
      .toEqual(top.map(p => [p.nombre, `${p.q} uds${fi(p.m)}`]))
  })

  it('📤 compartir: venta, PAX, Prom/PAX, delivery, Beb/PAX, ratio y los tres primeros saloneros (venta y Prom/PAX)', async () => {
    const f = fechasDe(desde, hasta)
    const gen = aggGeneral(f, antes.dias, antes.pm)
    const { com, beb } = mixComBeb(antes.dias, f, antes.pm)
    const { tot } = contabilidad(desde, hasta)
    const sal = allSaloneros(Object.fromEntries(f.map(d => [d, antes.dias[d]])))
      .map(n => aggSalonero(n, f, antes.dias, antes.pm)).sort((a, b) => b.promPax - a.promPax).slice(0, 3)
    abrirResumen(q)
    await screen.findByRole('table', { name: 'Detalle por día' })
    await abrirSalon()
    fireEvent.click(screen.getByRole('button', { name: 'Compartir el resumen' }))
    await waitFor(() => expect(copiado).not.toBe(''))
    expect(copiado).toContain(`💰 Ventas: *${fi(tot.ventaNeta)}*`)
    expect(copiado).toContain(`👥 PAX: ${gen.pax}  •  Prom/PAX: *${fi(gen.promPax)}*`)
    if (tot.delivery > 0) expect(copiado).toContain(`🛵 Delivery: ${fi(tot.delivery)}`)
    // 3.2b y 3.2c: Beb/PAX y el ratio salen del catálogo (vacío en esta prueba: 0,00 y, sin bebida, «—»); los de «Hoy»
    // quedan al lado de cada tarjeta como «antes» (arriba).
    void com; void beb
    expect(copiado).toContain('🍺 Beb/PAX: 0.00  •  Ratio C/B: —')
    for (const s of sal) expect(copiado).toContain(`${s.nombre}: ${fi(s.total)} · ${fi(s.promPax)}/PAX`)
    expect(copiado).toContain('_Satori · Local A, CR_')
  })

  it('«Hoy» → «Regalías»: cortesías, comida del personal y desconocidos del período, al colón', async () => {
    const f = fechasDe(desde, hasta)
    const gen = aggGeneral(f, antes.dias, antes.pm)
    const desc = topProds(gen.prods, 'monto', 8, ['desconocido'], antes.pm)
    abrirRegalias(q)
    await screen.findByRole('table', { name: 'Regalías por tipo' })
    const valor = (id: string) => document.querySelector(`[data-regalia="${id}"] td:nth-child(2)`)!.textContent
    expect(valor('cortesias')).toBe(fi(gen.cortTotal))
    expect(valor('personal')).toBe(fi(gen.persTotal))
    expect(valor('desconocidos')).toBe(fi(desc.reduce((s, p) => s + p.m, 0)))
    // Un solo producto de cortesía en la fixture: «el más grande», en singular (no «los 1 más grandes»).
    expect(document.querySelector('[data-regalia="cortesias"] td:nth-child(4)')!.textContent).toMatch(/uds \(el más grande\)$/)
    // La fixture SÍ tiene cortesías y comida del personal en los tres períodos: la prueba no pasa en vacío.
    expect(gen.cortTotal).toBeGreaterThan(0)
    expect(gen.persTotal).toBeGreaterThan(0)
    // Las tarjetas con los productos, como en «Hoy».
    expect(document.querySelector('[data-tarjeta="Regalías / Cortesías"]')!.textContent).toContain('ROLL CORTESIA FICTICIO')
    expect(document.querySelector('[data-tarjeta="Comida Personal"]')!.textContent).toContain('ALMUERZO PERSONAL FICTICIO')
    // Cada % nombra su base y sus fechas.
    expect(screen.getByRole('table', { name: 'Regalías por tipo' }).querySelector('thead')!.textContent)
      .toMatch(/% de la venta neta del período \([^)]*\d+[^)]*: ₡[\d.]+\)/)
  })
})

describe('paridad 3.5.2 · «Ventas» del mes: margen bruto (lo de «Análisis → Detalle anual»)', () => {
  it('octubre con 30 % cargado: margen ₡ = venta bruta del mes × 30 %, al colón', async () => {
    const { tot } = contabilidad('2026-10-01', '2026-10-31')
    abrirResumen('p=mes&d=2026-10-01')
    await screen.findByRole('table', { name: 'Detalle por día' })
    const m = document.querySelector('[data-fila="margen"]')!.textContent!
    expect(m).toContain('30,0 %')
    expect(m).toContain(fi(tot.ventaBruta * 30 / 100))
    expect(m).toContain('1–31 oct')
  })

  it('sin % cargado para el mes no aparece la fila de margen; con «Ayer» tampoco', async () => {
    abrirResumen('p=mes&d=2026-11-17')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(document.querySelector('[data-fila="margen"]')).toBeNull()
    cleanup()
    abrirResumen('p=ayer')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(document.querySelector('[data-fila="margen"]')).toBeNull()
  })
})

describe('3.5.2 · «Histórico» (retirado por el dueño, D15): diferencia DECLARADA de su venta neta', () => {
  // «Histórico» sumaba la neta del rango por persona (`aggGeneral`: Σ saloneros + Σ cajas, sin redondear por día).
  // El «Resumen» usa la regla firmada el 18-nov (#288, opción A): cada día un redondeo y el período = Σ días, la
  // misma de «Ventas» y del correo al contador. La guía 6.4 ya marcaba «Histórico» como «todavía no» con esa regla.
  // Personas, salón de saloneros, Beb/PAX y ratio sí dan igual (pruebas de arriba).
  it.each(PERIODOS)('$nombre: Σ por persona vs Σ días, a lo sumo ₡1 por día', ({ desde, hasta }) => {
    const f = fechasDe(desde, hasta)
    const gen = aggGeneral(f, antes.dias, antes.pm)
    const { tot } = contabilidad(desde, hasta)
    expect(Math.abs(gen.total + gen.cajTotal - tot.ventaNeta)).toBeLessThanOrEqual(f.length)
    expect(gen.pax).toBe(tot.pax)
  })
})

describe('paridad 3.5.2 · «⬇ CSV por día» = el «⬇ CSV» de la vieja «Ventas»', () => {
  /** Lo que se descarga al tocar un botón: el texto del Blob. */
  async function descargado(boton: HTMLElement): Promise<string> {
    let blob: Blob | null = null
    const crear = vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blob = b as Blob; return 'blob:x' })
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(boton)
    crear.mockRestore(); clic.mockRestore()
    return blob ? await (blob as Blob).text() : ''
  }
  it.each(['2026-10', '2026-11'])('%s: mismo archivo, byte a byte (columnas, comillas, Prom/PAX redondeado)', async ym => {
    const { container } = render(<VentasContabilidad dias={antes.dias} hist={{}} metas={METAS} pm={antes.pm} />)
    const sel = [...container.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === ym))!
    fireEvent.change(sel, { target: { value: ym } })
    const viejo = await descargado(screen.getByRole('button', { name: '⬇ CSV' }))
    cleanup()
    abrirResumen(`p=mes&d=${ym}-01`)
    await screen.findByRole('table', { name: 'Detalle por día' })
    const nuevo = await descargado(screen.getByRole('button', { name: '⬇ CSV por día' }))
    expect(viejo.split('\n').length).toBeGreaterThan(15)
    expect(nuevo).toBe(viejo)
  })
})

describe('paridad 3.5.2 · «Ventas» → «Promedio por día de semana» = «Tiempos» → «Día de semana» (ya existía)', () => {
  it.each(PERIODOS.filter(p => p.desde !== p.hasta))('$nombre: el promedio de cada día de semana, al colón', ({ desde, hasta }) => {
    const { dias } = contabilidad(desde, hasta)
    const viejo = dowAverages(dias)                    // lo que pintaba la vieja «Ventas»: Math.round(sum ÷ cnt)
    const nuevo = porDiaSemana(dias)                   // lo que pinta «Tiempos» (lunes = 0)
    for (const d of dias) {
      const v = viejo[dayOfWeek(d.fecha)]
      expect(fi(nuevo[diaSemana(d.fecha)].promedio)).toBe(fi(Math.round(v.sum / v.cnt)))
    }
  })
})

describe('paridad 3.5.2 · la anulada no entra (criterio 15)', () => {
  it('la fixture del lector trae una factura X con plata el día de ayer', () => {
    expect(TICKETS_LECTOR.some(x => x.estado === 'X' && diaCRDeFactura(x.fecha_registra) === '2026-11-17')).toBe(true)
    expect(LINEAS_LECTOR.filter(x => x.ticket_id === 'X-1').reduce((s, x) => s + (x.monto ?? 0), 0)).toBeGreaterThan(100_000)
  })
})
