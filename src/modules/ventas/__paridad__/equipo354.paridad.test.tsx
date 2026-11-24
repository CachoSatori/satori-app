// @vitest-environment happy-dom
//
// Ventas v2 · 3.5.4 — PARIDAD (SPEC-ventas-v2 §12.5, criterio 7). Antes de retirar «Saloneros» y «Evaluación»: para el
// MISMO período y los MISMOS datos, cada cifra que se mueve a «Equipo» da lo mismo que en la vista vieja. Tres
// períodos: ayer, mes a la fecha y el último mes cerrado.
//
//   · «Lo de antes» se LEYÓ de las vistas viejas PINTADAS (`VentasSaloneros` y `VentasEvaluacion`), con el `DiasMap`
//     recortado al período (su «Personalizado» sin fechas y su «Todo» toman todos los días que reciben: así miraban
//     exactamente el período). La 3.5.5 borró esas vistas: lo que pintaban con ESTA fixture quedó FIJADO en
//     `antes-equipo354.json` (capturado en `main` 764613b2, antes de borrarlas; los saloneros por su login del PoS,
//     sin nombres). Si la fixture cambia, esta prueba cae: no se regenera, se revisa.
//   · «Lo de ahora» se LEE de «Equipo» pintado, con la barra en la URL.
//   · La venta por persona del equipo se compara con la del «Resumen» (`cifrasDelRango`, la misma lectura).
//   · Los datos: la fixture ficticia del Resumen + UNA FACTURA ANULADA (`X`) que reciben los lectores de «Equipo»: si
//     alguna cuenta nueva la sumara, esta prueba cae (criterio 15).
//
// Diferencia DECLARADA (excepción 1 del criterio 7 y §5.3): «Venta por persona» de cada salonero es la D4 (estima las
// mesas sin pax); la cifra vieja sigue al lado como «Prom/PAX cargado» y es la que se compara acá. La tendencia (7
// contra 7) se muestra solo con 14 días trabajados o más en el período («Evaluación» la calculaba con menos).
// Reloj fijo DE NOCHE en CR (23:30 del 18-nov = 05:30 UTC del 19).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TicketVentaRow } from '../../../shared/api/posNdf'
import type { Meta } from '../../../shared/types/ventas'

let role = 'owner'
vi.mock('../../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../../shared/api/admin', () => ({ getAllEmployees: vi.fn(async () => []) }))
vi.mock('../equipoPropinas', () => ({ getPropinasRango: vi.fn(async () => []) }))

import { datos, t } from '../resumenV2.fixture'
import { armarLectura, cifrasDelRango } from '../resumenV2'
import { armarDiasMap } from '../ventasDiasDesdePos'
import { fi } from '../ventasUtils'
import { SALONEROS_CONOCIDOS } from '../../../shared/ndf/mapTicket'

// ── Los datos ────────────────────────────────────────────────────────────────────────────────
const base = datos('2026-09-01', 78)
const ANULADA: TicketVentaRow = t({ id: 'X-1', estado: 'X', fecha_registra: '2026-11-17T20:30:00-06:00', fecha_cierra: '2026-11-17T21:00:00-06:00', salonero_login: '026', pax: 4, total_crc: 99_999 })
const LINEAS_ANULADA = [{ ticket_id: 'X-1', codigo_producto: 'P2', nombre: 'PRODUCTO 2', cantidad: 3, monto: 88_888, familia: 2, usuario_registra: null }]
const TICKETS_LECTOR = [...base.tickets, ANULADA]
const LINEAS_LECTOR = [...base.lineas, ...LINEAS_ANULADA]

const lectura = armarLectura(TICKETS_LECTOR, LINEAS_LECTOR, {})

vi.mock('../resumenV2Datos', async orig => ({
  ...(await orig<typeof import('../resumenV2Datos')>()),
  cargarLecturaResumen: vi.fn(async () => lectura),
  cargarLecturaRango: vi.fn(async () => lectura),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))
vi.mock('../lineasPeriodo', async orig => {
  const real = await orig<typeof import('../lineasPeriodo')>()
  return {
    ...real,
    cargarLineasPeriodo: vi.fn(async (_local: string, r: { desde: string; hasta: string }) =>
      armarDiasMap(TICKETS_LECTOR, LINEAS_LECTOR, r, { uploadedAt: 'x', avisar: () => {} })),
  }
})

import VentasEquipo from '../VentasEquipo'

/** Lo que pintaban «Saloneros» y «Evaluación» (3.5.5: fijado; ver la cabecera). Clave: `desde_hasta`; salonero por login. */
const ANTES = JSON.parse(readFileSync('src/modules/ventas/__paridad__/antes-equipo354.json', 'utf8')) as {
  saloneros: Record<string, { filas: [string, string[]][]; general: string[] }>
  evaluacion: Record<string, [string, { dias: string; consistencia: number; tendencia: string; racha: string }][]>
}
const nombre = (login: string) => SALONEROS_CONOCIDOS[login] ?? login

const METAS = { restaurante: {}, margen: {}, global: { promPax: 9_000, bebPax: 0, ratioCB: 0, ticketItem: 0, ventas: 0 }, salMetas: {} } as unknown as Meta

const PERIODOS = [
  { nombre: 'ayer (17-nov)', q: 'p=ayer', desde: '2026-11-17', hasta: '2026-11-17' },
  { nombre: 'mes a la fecha (1–17 nov)', q: 'p=mes&d=2026-11-17', desde: '2026-11-01', hasta: '2026-11-17' },
  { nombre: 'último mes cerrado (octubre)', q: 'p=mes&d=2026-10-01', desde: '2026-10-01', hasta: '2026-10-31' },
] as const

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
})
afterEach(() => { cleanup(); vi.useRealTimers() })

/** «Saloneros» viejo, modo tabla: nombre → [Ventas, PAX, Prom/PAX, Ticket/ítem, Beb/PAX, Ratio C/B, Prom/plato]. */
function leerSaloneros(desde: string, hasta: string) {
  const g = ANTES.saloneros[`${desde}_${hasta}`]
  expect(g, `sin lectura fijada para ${desde}_${hasta}`).toBeDefined()
  return { filas: new Map(g.filas.map(([l, c]) => [nombre(l), c])), general: g.general }
}

/** «Evaluación» vieja, «Todo» + modo tabla: nombre → { dias, consistencia, tendencia, racha }. */
function leerEvaluacion(desde: string, hasta: string) {
  const g = ANTES.evaluacion[`${desde}_${hasta}`]
  expect(g, `sin lectura fijada para ${desde}_${hasta}`).toBeDefined()
  return new Map(g.map(([l, v]) => [nombre(l), v]))
}

async function abrirEquipo(q: string) {
  const r = render(<MemoryRouter initialEntries={[`/ventas?tab=equipo&${q}`]}><VentasEquipo metas={METAS} /></MemoryRouter>)
  await screen.findByRole('table', { name: 'Equipo' })
  const filas = new Map<string, Record<string, string>>()
  for (const tr of r.container.querySelectorAll('table[aria-label="Equipo"] tbody tr')) {
    const o: Record<string, string> = {}
    for (const td of tr.querySelectorAll('td[data-col]')) o[td.getAttribute('data-col')!] = td.textContent ?? ''
    filas.set(tr.getAttribute('data-salonero')!, o)
  }
  return { r, filas }
}

describe.each(PERIODOS)('paridad 3.5.4 · $nombre', ({ q, desde, hasta }) => {
  it('«Saloneros» → «Equipo»: por salonero, venta y personas al colón, y Prom/PAX, ticket, Beb/PAX, comida/bebida y plato iguales', async () => {
    const viejo = leerSaloneros(desde, hasta)
    const { filas } = await abrirEquipo(q)
    expect([...filas.keys()].sort()).toEqual([...viejo.filas.keys()].sort())
    expect(filas.size).toBeGreaterThan(0)
    for (const [nombre, [venta, pax, promPax, ticket, bebPax, ratio, plato]] of viejo.filas) {
      const n = filas.get(nombre)!
      expect([n.venta, n.personas, n.promPax, n.ticketItem, n.bebPax, n.ratioCB, n.promPlato], nombre)
        .toEqual([venta, pax, promPax, ticket, bebPax, ratio, plato])
    }
    // La fila GENERAL: venta y personas del equipo.
    const gen = [...document.querySelectorAll('[data-fila="general"] td')].map(td => td.textContent)
    expect([gen[1], gen[2]]).toEqual([viejo.general[1], viejo.general[2]])
  })

  it('«Evaluación» → «Equipo»: días, consistencia y racha iguales; tendencia igual cuando hay 14 días trabajados', async () => {
    const viejo = leerEvaluacion(desde, hasta)
    const { filas } = await abrirEquipo(q)
    // Que la prueba compare algo: los tres saloneros de la fixture, y en octubre con tendencia y alguna racha.
    expect(viejo.size).toBe(filas.size)
    if (desde === '2026-10-01') {
      expect([...viejo.values()].some(v => Number(v.dias) >= 14 && v.tendencia !== '→')).toBe(true)
      expect([...filas.values()].some(f => f.racha !== '—')).toBe(true)
    }
    for (const [nombre, v] of viejo) {
      const n = filas.get(nombre)!
      expect(n.dias, nombre).toBe(v.dias)
      expect(n.consistencia, nombre).toBe(`${v.consistencia} %`)
      expect(n.racha === '—' ? '—' : n.racha.replace(' d', ''), nombre).toBe(v.racha === '—' ? '—' : v.racha.replace('🔥', '').replace('d', ''))
      if (Number(v.dias) >= 14) {
        // CON su signo: ▼ / − / - es negativo; ▲ / + positivo (la vieja escribe «▼ 3.2%», la nueva «▼ −3,2 %»).
        const conSigno = (s: string) => {
          const v = Number(s.replace(/[▲▼+−\-\s%]/g, '').replace(',', '.'))
          return v === 0 ? 0 : /[▼−-]/.test(s) ? -v : v
        }
        expect(conSigno(n.tendencia), `${nombre}: «${n.tendencia}» vs «${v.tendencia}»`).toBe(conSigno(v.tendencia))
      } else expect(n.tendencia, nombre).toBe('—')
    }
  })

  it('la venta por persona del equipo es la del «Resumen» (D4, misma lectura)', async () => {
    const esperado = cifrasDelRango(lectura, { desde, hasta }).vpp.valor
    await abrirEquipo(q)
    expect(document.querySelector('[data-cifra="vpp"] .vt-kpi-val')!.textContent).toBe(esperado === null ? '—' : fi(Math.round(esperado)))
  })
})

describe('la anulada no entra (criterio 15)', () => {
  it('la factura X del 17-nov (88 888 de un salonero) no suma a nadie', async () => {
    const viejo = leerSaloneros('2026-11-17', '2026-11-17')
    const { filas } = await abrirEquipo('p=ayer')
    const totalNuevo = [...filas.values()].reduce((s, f) => s + Number(f.venta.replace(/\D/g, '')), 0)
    const totalViejo = [...viejo.filas.values()].reduce((s, f) => s + Number(f[0].replace(/\D/g, '')), 0)
    expect(totalNuevo).toBe(totalViejo)
  })
})
