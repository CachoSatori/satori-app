// @vitest-environment happy-dom
//
// Ventas v2 · 3.5.3 — PARIDAD (SPEC-ventas-v2 §12.5, criterio 7). Antes de retirar «Análisis» («Año vs Año») y
// «Calendario»: con los MISMOS datos, cada cifra que se mueve de lugar da lo mismo en la pantalla nueva que en la
// vieja.
//
//   · «Lo de antes» se LEE de las pantallas viejas pintadas (`VentasAnalisis` y `VentasCalendario`, que quedan en el
//     repo solo para esta prueba hasta la 3.5.5) con el `dias` y el `hist` que les pasaba el shell en `main`.
//   · «Lo de ahora» se LEE de «Tiempos» pintada («Meses y temporadas», «Calendario» y «Día de semana»), con el lector
//     de la base simulado.
//   · Los datos: fixture ficticia (`resumenV2.fixture.ts`) en tres años del PoS (oct–dic 2024, oct–dic 2025 y
//     1-sep → HOY 2026: hoy no tiene que entrar) + 2023 y 1–4 ene 2024 del resumen diario viejo (`ventas_hist`) + DOS
//     FACTURAS ANULADAS (`X`) con plata que solo recibe el lector nuevo: si alguna cuenta nueva las sumara, esta
//     prueba cae (criterio 15).
//   · Tres períodos: ayer (17-nov), mes a la fecha (1–17 nov) y el último mes cerrado (octubre).
//
// Diferencias DECLARADAS (no se prueban como iguales; el PR las dice):
//   1. Venta por persona de cada año: la nueva estima las mesas sin pax (D4, excepción 1 de §12.5). 2023 (sin
//      facturas) no se puede estimar: muestra la de antes, rotulada «sin estimar». Se prueba que 2023 da igual.
//   2. Los % del año y de los totales pasan de 0 a 1 decimal (mismo número: se prueba con la tolerancia del redondeo
//      viejo). Los del mes y del trimestre ya tenían 1 decimal: se prueban exactos.
//   3. «Calendario» viejo sumaba HOY (en curso) en el mes abierto; «Tiempos» no (D2). Se prueba hasta ayer.
//   4. «Calendario» viejo promediaba cada día de semana sobre TODA la historia (2023 incluido); «Día de semana» lo hace
//      sobre el período de la barra. Con «Rango» de todo el PoS da lo mismo (se prueba); 2023 ya no entra ahí.
//   5. «Por trimestre»: un año sin ventas en el trimestre decía «₡0»; ahora «—» (sin comparación, como «Mes por mes»;
//      verificador del #339). Con ventas, la misma cifra.
//
// Reloj fijo DE NOCHE en CR (23:30 del 18-nov = 05:30 UTC del 19): hoy = 18-nov, ayer = 17-nov.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { LineaNdfRow, TicketVentaRow } from '../../../shared/api/posNdf'
import type { HistMap } from '../../../shared/types/ventas'

vi.mock('../../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: 'owner' } }) }))
vi.mock('../../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../../shared/api/posNdf', async orig => ({
  ...(await orig<typeof import('../../../shared/api/posNdf')>()),
  getSaloneroNombres: vi.fn(async () => ({})),
}))

import { datos, l, t } from '../resumenV2.fixture'
import { armarLectura } from '../resumenV2'
import { armarDiasMap } from '../ventasDiasDesdePos'
import { fi, getContabilidadDays, totalesContabilidad } from '../ventasUtils'
import { diaCRDeFactura } from '../indicadores'

// ── Los datos ────────────────────────────────────────────────────────────────────────────────
const tramos = [datos('2024-10-01', 92, 3), datos('2025-10-01', 92, 5), datos('2026-09-01', 79, 7)] // el último llega a HOY (18-nov)
const TICKETS_C: TicketVentaRow[] = tramos.flatMap(x => x.tickets)
const LINEAS_C: LineaNdfRow[] = tramos.flatMap(x => x.lineas)
// LAS ANULADAS: ayer y un día de octubre, con plata. Ninguna cifra las cuenta.
const ANULADAS = [
  t({ id: 'X-1', estado: 'X', fecha_registra: '2026-11-17T20:30:00-06:00', fecha_cierra: '2026-11-17T21:00:00-06:00', pax: 4, total_crc: 99_999 }),
  t({ id: 'X-2', estado: 'X', fecha_registra: '2026-10-15T13:30:00-06:00', fecha_cierra: '2026-10-15T14:00:00-06:00', pax: 2, total_crc: 88_888 }),
]
const LINEAS_ANULADAS = [l('X-1', 77_777, 2), l('X-2', 66_666, 5)]
const TICKETS_LECTOR = [...TICKETS_C, ...ANULADAS]
const LINEAS_LECTOR = [...LINEAS_C, ...LINEAS_ANULADAS]

/** 2023 y 1–4 ene 2024 del resumen diario viejo (antes del corte del PoS). Valores ficticios con céntimos. */
const HIST: HistMap = {}
for (const [desde, n, base] of [['2023-01-02', 20, 410_000.5], ['2023-10-01', 61, 520_000.25], ['2023-12-20', 16, 640_000], ['2024-01-01', 4, 300_000]] as const) {
  for (let i = 0; i < n; i++) {
    const f = new Date(Date.parse(`${desde}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
    const v = base + i * 1_234.75
    HIST[f] = { ventaBruta: v * 1.23, ventaNeta: v, iva: v * 0.13, serv: v * 0.1, salon: v * 0.82, delivery: v * 0.18, pax: 20 + (i % 9), promPax: 0, source: 'hist' }
  }
}

/** «Lo de antes»: el `DiasMap` del shell de Ventas en `main` (historia completa del PoS, solo facturas cerradas, HOY incluido). */
const DIAS_ANTES = armarDiasMap(TICKETS_C, LINEAS_C, { desde: '2024-01-05', hasta: '2026-11-18' }, { uploadedAt: 'x', avisar: () => {} }).dias

// ── El lector de la pantalla nueva (mock de la base), con las anuladas adentro ─────────────────
const lectura = armarLectura(TICKETS_LECTOR, LINEAS_LECTOR, {})
vi.mock('../tiemposV2Datos', () => ({
  cargarLecturaDeRangos: vi.fn(async () => lectura),
  cargarTiempos: vi.fn(async () => null),
  cargarTurnos: vi.fn(async () => []),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))

import VentasTiempos from '../VentasTiempos'
import VentasAnalisis from '../VentasAnalisis'
import VentasCalendario from '../VentasCalendario'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const abrirTiempos = async (q: string) => {
  render(<MemoryRouter initialEntries={[`/ventas?tab=tiempos&${q}`]}><VentasTiempos hist={HIST} /></MemoryRouter>)
  await screen.findByRole('table', { name: 'Día de semana' })
}
const abrirMeses = async () => {
  await abrirTiempos('p=anioALaFecha')
  await screen.findByRole('table', { name: 'Mes por mes' })
  return document.querySelector('[data-bloque="meses"]')!
}
const txt = (e: Element | null | undefined) => (e?.textContent ?? '').trim()

/** «▲ +5.2%» / «▼ 3%» / «▲ +0.0%» (lo viejo) y «+5,2 %» / «−3,0 %» / «0,0 %» (lo nuevo) → número. «—» → null. */
function pctViejo(s: string): number | null {
  const m = s.match(/([▲▼])\s*\+?(\d+(?:\.\d+)?)%/)
  if (!m) return null
  return (m[1] === '▼' ? -1 : 1) * Number(m[2])
}
function pctNuevo(s: string): number | null {
  const m = s.match(/([+−]?)(\d+(?:,\d+)?) %/)
  if (!m) return null
  return (m[1] === '−' ? -1 : 1) * Number(m[2].replace(',', '.'))
}
/** Mismo % con 1 decimal en las dos pantallas (el 0 sin signo). */
const igual1 = (viejo: string, nuevo: string) => {
  const a = pctViejo(viejo), b = pctNuevo(nuevo)
  expect(a === null ? null : Math.abs(a) < 0.05 ? 0 : a).toBe(b === null ? null : Math.abs(b) < 0.05 ? 0 : b)
}
/** Lo viejo con 0 decimales, lo nuevo con 1: el mismo número dentro del redondeo viejo. */
const igual0 = (viejo: string, nuevo: string) => {
  const a = pctViejo(viejo), b = pctNuevo(nuevo)
  expect(a === null).toBe(b === null)
  if (a !== null && b !== null) expect(Math.abs(a - b)).toBeLessThanOrEqual(0.55)
}

describe('paridad 3.5.3 · «Análisis» → «Año vs Año» = «Tiempos» → «Meses y temporadas»', () => {
  it('los años: venta neta y días, al colón; personas; el % contra el año anterior', async () => {
    render(<VentasAnalisis dias={DIAS_ANTES} hist={HIST} />)
    const viejo = Object.fromEntries([2026, 2025, 2024, 2023].map(y => [y, txt(screen.getByTestId(`an-anio-${y}`))]))
    const valViejo = Object.fromEntries([2026, 2025, 2024, 2023].map(y => [y, txt(screen.getByTestId(`an-anio-${y}`).querySelector('.vt-kpi-val'))]))
    const paxViejo = Object.fromEntries([2026, 2025, 2024, 2023].map(y => [y, txt(screen.getByTestId(`an-anio-${y}`).querySelector('.vt-kpi-sub'))]))
    cleanup()
    const s = await abrirMeses()
    for (const y of [2026, 2025, 2024, 2023]) {
      const nuevo = s.querySelector(`.vt-kpi[data-anio="${y}"]`)!
      const v = viejo[y]
      expect(txt(nuevo.querySelector('.vt-kpi-val'))).toBe(valViejo[y])                  // venta neta
      expect(txt(nuevo.querySelector('.vt-kpi-label')).match(/(\d+) días/)![1]).toBe(v.match(/(\d+) días/)![1])
      // es-CR separa miles con espacio duro: «1 234».
      expect(txt(nuevo.querySelector('[data-dato="personas"]')).match(/^([\d\s\u00a0\u202f]+) personas/)![1].trim())
        .toBe(paxViejo[y].match(/^([\d\s\u00a0\u202f]+) PAX/)![1].trim())
      const delta = nuevo.querySelector('.vt-kpi-delta')
      if (y === 2023) expect(delta).toBeNull()
      else igual0(v, txt(delta))
    }
    // 2026 va a la fecha: contra 2025 a la misma fecha, como antes.
    expect(viejo[2026]).toContain('vs 2025 a la misma fecha')
    expect(txt(s.querySelector('.vt-kpi[data-anio="2026"] .vt-kpi-delta'))).toContain('vs 2025 a la misma fecha (1 ene – 17 nov 2025)')
    // Diferencia declarada 1: 2023 no tiene facturas → la venta por persona de antes, rotulada.
    const vpp2023 = paxViejo[2023].match(/(₡[\d.]+)\/PAX/)![1]
    expect(txt(s.querySelector('.vt-kpi[data-anio="2023"] [data-dato="personas"]'))).toContain(`venta por persona ${vpp2023} (sin estimar: resumen diario viejo)`)
  })

  it('mes por mes (con «mes a la fecha» = noviembre y «último mes cerrado» = octubre), «A LA FECHA» y «AÑO COMPLETO»', async () => {
    render(<VentasAnalisis dias={DIAS_ANTES} hist={HIST} />)
    const tabla = screen.getByTestId('an-tabla-meses')
    const filasViejas = [...tabla.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(txt))
    const pie = [...tabla.querySelectorAll('tfoot tr')].map(tr => [...tr.querySelectorAll('td')].map(txt))
    cleanup()
    const s = await abrirMeses()
    const nueva = s.querySelector('table[aria-label="Mes por mes"]')!
    const filasNuevas = [...nueva.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(txt))
    expect(filasNuevas.map(f => f[0])).toEqual(filasViejas.map(f => f[0]))        // mismos meses, mismo rótulo
    expect(filasNuevas.map(f => f[0])).toContain('Noviembre · a la fecha (1 al 17)')
    expect(filasNuevas.map(f => f[0])).toContain('Octubre')
    for (const [i, fv] of filasViejas.entries()) {
      const fn = filasNuevas[i]
      expect(fn.slice(1, 5)).toEqual(fv.slice(1, 5))                                 // 2026, 2025, 2024, 2023: al colón
      for (let k = 5; k < 8; k++) igual1(fv[k], fn[k])                               // 2026 vs 2025, 2025 vs 2024, 2024 vs 2023
    }
    // El pie: A LA FECHA y AÑO COMPLETO, al colón; sus % dentro del redondeo viejo; «—» donde antes «—».
    const pieNuevo = [...nueva.querySelectorAll('tfoot tr')].map(tr => [...tr.querySelectorAll('td')].map(txt))
    expect(pieNuevo.map(f => f[0])).toEqual(pie.map(f => f[0]))
    for (const [i, fv] of pie.entries()) {
      expect(pieNuevo[i].slice(1, 5)).toEqual(fv.slice(1, 5))
      for (let k = 5; k < 8; k++) igual0(fv[k], pieNuevo[i][k])
    }
    // AÑO COMPLETO no compara 2026 (en curso) contra 2025 entero.
    expect(pieNuevo[1][5]).toBe('—')
  })

  it('por trimestre: venta y % de cada año, iguales (el 4.º va a la fecha)', async () => {
    render(<VentasAnalisis dias={DIAS_ANTES} hist={HIST} />)
    const viejo = [1, 2, 3, 4].map(q => txt(screen.getByTestId(`an-q${q}`)))
    const filasViejas = [1, 2, 3, 4].map(q => [...screen.getByTestId(`an-q${q}`).querySelectorAll(':scope > div:not(:first-child)')]
      .map(d => [txt(d.querySelector('span')), txt(d.querySelector('div > div:first-child')), txt(d.querySelector('div > div:nth-child(2)'))]))
    cleanup()
    const s = await abrirMeses()
    for (const q of [1, 2, 3, 4]) {
      const card = s.querySelector(`[data-trimestre="${q}"]`)!
      expect(txt(card.firstElementChild).includes('a la fecha')).toBe(viejo[q - 1].includes('a la fecha'))
      const filas = [...card.querySelectorAll('[data-anio]')].map(d => [d.getAttribute('data-anio'), txt(d.querySelector('[data-dato="neta"]')),
        txt(d.querySelector('[data-cambio]'))])
      expect(filas.map(f => f[0])).toEqual(filasViejas[q - 1].map(f => f[0]))
      expect(filas.map(f => f[1])).toEqual(filasViejas[q - 1].map(f => (f[1] === '₡0' ? '—' : f[1])))
      for (const [i, f] of filas.entries()) igual1(filasViejas[q - 1][i][2] || '—', f[2] || '—')
    }
  })
})

describe('paridad 3.5.3 · «Calendario» → «Tiempos» («Calendario» y «Día de semana») y «Resumen» → «Detalle por día»', () => {
  /** El mes `ym` de la vieja «Calendario» desplegado: filas [dd/mm/aaaa, ventas, PAX, Prom/PAX], mejor, peor y TOTAL. */
  function mesViejo(ym: string) {
    render(<VentasCalendario dias={DIAS_ANTES} hist={HIST} />)
    const [y, m] = ym.split('-')
    const MN = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    const cab = screen.getByText(`${MN[Number(m)]} ${y}`).closest('div[style*="cursor"]') as HTMLElement
    if (!cab.nextElementSibling) fireEvent.click(cab)
    const tabla = cab.parentElement!.querySelector('table')!
    const filas = [...tabla.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(txt))
    const out = {
      dias: Object.fromEntries(filas.map(f => {
        const [dd, mm, aa] = f[0].replace(/^[★▼] /, '').split('/')
        return [`${aa}-${mm}-${dd}`, { venta: f[2], pax: f[3], vpp: f[4] }]
      })),
      mejor: filas.find(f => f[0].startsWith('★'))?.[0].slice(2),
      peor: filas.find(f => f[0].startsWith('▼'))?.[0].slice(2),
      total: [...tabla.querySelectorAll('tfoot td')].map(txt),
    }
    cleanup()
    return out
  }
  const fechaCorta = (f: string) => `${f.slice(8)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
  const conta = (desde: string, hasta: string) => [10, 11].flatMap(m => getContabilidadDays(2026, m, DIAS_ANTES, {}))
    .filter(d => d.fecha >= desde && d.fecha <= hasta)

  const PERIODOS = [
    { nombre: 'ayer (17-nov)', q: 'p=ayer', ym: '2026-11', desde: '2026-11-17', hasta: '2026-11-17' },
    { nombre: 'mes a la fecha (1–17 nov)', q: 'p=mes&d=2026-11-17', ym: '2026-11', desde: '2026-11-01', hasta: '2026-11-17' },
    { nombre: 'último mes cerrado (octubre)', q: 'p=mes&d=2026-10-01', ym: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' },
  ] as const

  it.each(PERIODOS)('$nombre: la venta de cada día del calendario nuevo = «Ventas» de la fila del calendario viejo, al colón', async ({ q, ym, desde, hasta }) => {
    const viejo = mesViejo(ym)
    await abrirTiempos(q)
    const celdas = Object.fromEntries([...document.querySelectorAll('[data-bloque="calendario"] [data-fecha]')]
      .map(c => [c.getAttribute('data-fecha')!, txt(c.lastElementChild)]))
    const fechas = Object.keys(viejo.dias).filter(f => f >= desde && f <= hasta).sort()
    expect(fechas.length).toBeGreaterThan(0)
    expect(Object.keys(celdas).sort()).toEqual(fechas)
    for (const f of fechas) expect(celdas[f]).toBe(viejo.dias[f].venta)
    // HOY (18-nov, en curso) estaba en el calendario viejo y no está en el nuevo (diferencia declarada 3).
    if (ym === '2026-11') { expect(viejo.dias['2026-11-18']).toBeDefined(); expect(celdas['2026-11-18']).toBeUndefined() }
    // Las personas y la venta por persona de cada día: las de «Detalle por día» de «Resumen» (= Contabilidad; ver la
    // paridad del 3.5.2), que son las mismas que pintaba el calendario viejo.
    for (const d of conta(desde, hasta)) {
      expect(viejo.dias[d.fecha].pax).toBe(d.pax > 0 ? d.pax.toLocaleString('es-CR') : '—')
      expect(viejo.dias[d.fecha].vpp).toBe(d.promPax > 0 ? fi(d.promPax) : '—')
    }
  })

  it('octubre (mes cerrado): mejor y peor día iguales; el TOTAL del mes = la venta del período en «Tiempos»', async () => {
    const viejo = mesViejo('2026-10')
    await abrirTiempos('p=mes&d=2026-10-01')
    expect(document.querySelector('[data-bloque="calendario"] .dia.mejor')!.getAttribute('data-fecha')).toBe(
      viejo.mejor!.split('/').reverse().join('-'))
    expect(document.querySelector('[data-bloque="calendario"] .dia.peor')!.getAttribute('data-fecha')).toBe(
      viejo.peor!.split('/').reverse().join('-'))
    const tot = totalesContabilidad(conta('2026-10-01', '2026-10-31'))
    expect(viejo.total[1]).toBe(fi(tot.ventaNeta))
    expect(txt(document.querySelector('[data-fila="total"] [data-neta="total"]'))).toBe(fi(tot.ventaNeta))
    expect(viejo.total[2]).toBe(tot.pax.toLocaleString('es-CR'))
    expect(fechaCorta('2026-10-01')).toBe('01/10/2026')
  })

  it('«Promedios por día de semana» de toda la historia del PoS = «Día de semana» con «Rango» 5-ene-2024 → ayer', async () => {
    // Lo viejo, sin 2023 ni HOY (diferencias declaradas 3 y 4): el mismo conjunto de días que el rango nuevo.
    const sinHoy = Object.fromEntries(Object.entries(DIAS_ANTES).filter(([f]) => f <= '2026-11-17'))
    render(<VentasCalendario dias={sinHoy} hist={{}} />)
    const tarjetas = document.querySelectorAll('.vt-section > div')[1].querySelectorAll(':scope > div')   // [0] es el título
    const viejo = [...tarjetas].map(c => [...c.querySelectorAll('div')].map(txt))   // [día, N×, venta, Prom/PAX]
    cleanup()
    await abrirTiempos('p=rango&desde=2024-01-05&hasta=2026-11-17')
    const filas = [...document.querySelectorAll('table[aria-label="Día de semana"] tbody tr[data-dow]')]
    expect(filas).toHaveLength(7)
    // Lunes a domingo en los dos.
    for (const [i, tr] of filas.entries()) {
      const prom = txt(tr.querySelectorAll('td')[1])
      expect(prom).toBe(viejo[i][2])
      expect(txt(tr.querySelector('[data-detalle="dia"]'))).toMatch(new RegExp(`^${viejo[i][1].replace('×', '')} días? abiertos?`))
    }
  })
})

describe('paridad 3.5.3 · las anuladas no entran (criterio 15)', () => {
  it('el lector nuevo recibe dos facturas X con plata, ayer y en octubre', () => {
    expect(TICKETS_LECTOR.filter(x => x.estado === 'X').map(x => diaCRDeFactura(x.fecha_registra))).toEqual(['2026-11-17', '2026-10-15'])
    expect(LINEAS_LECTOR.filter(x => x.ticket_id.startsWith('X-')).reduce((s, x) => s + (x.monto ?? 0), 0)).toBeGreaterThan(100_000)
  })
  it('la fixture tiene datos en los cuatro años (la prueba no pasa en vacío)', async () => {
    const s = await abrirMeses()
    await waitFor(() => expect(s.querySelectorAll('.vt-kpi[data-anio]')).toHaveLength(4))
  })
})
