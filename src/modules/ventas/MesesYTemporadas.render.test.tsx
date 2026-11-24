// @vitest-environment happy-dom
//
// «Tiempos» → «Meses y temporadas» (Ventas v2 · 3.5.3) en el DOM: cada % nombra contra qué año y con qué fechas
// (criterio 5), sin «índice» (criterio 6), lee del PoS desde su corte hasta AYER (reloj de noche en CR: 23:30 del
// 18-nov = 05:30 UTC del 19), suma 2023 de `ventas_hist` solo para Santa Teresa (no tiene local), y si su lectura
// falla, el resto de «Tiempos» se ve igual. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistMap } from '../../shared/types/ventas'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: 'owner' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/posNdf', async () => ({ ...(await vi.importActual<object>('../../shared/api/posNdf')), getSaloneroNombres: async () => ({}) }))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'

const a = datos('2025-10-01', 92, 3), b = datos('2026-09-01', 79, 7)
const lect = armarLectura([...a.tickets, ...b.tickets], [...a.lineas, ...b.lineas])
let fallaHistoria = false
const cargar = vi.fn(async (_local: string, rangos: { desde: string; hasta: string }[]) => {
  if (fallaHistoria && rangos.length === 1 && rangos[0].desde === '2024-01-05') throw new Error('caída')
  return lect
})
let locales = [{ id: 'santa-teresa', nombre: 'Local A' }, { id: 'local-b', nombre: 'Local B' }]
vi.mock('./tiemposV2Datos', () => ({
  cargarLecturaDeRangos: (...x: unknown[]) => cargar(...(x as [string, { desde: string; hasta: string }[]])),
  cargarTiempos: vi.fn(async () => null),
  cargarTurnos: vi.fn(async () => []),
  getLocalesVentas: vi.fn(async () => locales),
}))

import VentasTiempos from './VentasTiempos'

const HIST: HistMap = {
  '2023-11-10': { ventaBruta: 500_000, ventaNeta: 400_000, iva: 0, serv: 0, salon: 300_000, delivery: 100_000, pax: 20, promPax: 0, source: 'hist' },
}

const abrir = async (q = 'p=anioALaFecha') => {
  render(<MemoryRouter initialEntries={[`/ventas?tab=tiempos&${q}`]}><VentasTiempos hist={HIST} /></MemoryRouter>)
  await screen.findByRole('table', { name: 'Día de semana' })
}
const seccion = () => document.querySelector('[data-bloque="meses"]')!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  fallaHistoria = false
  locales = [{ id: 'santa-teresa', nombre: 'Local A' }, { id: 'local-b', nombre: 'Local B' }]
  cargar.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('«Tiempos» → «Meses y temporadas»', () => {
  it('lee del PoS desde su primer día hasta AYER (hoy no entra), del local elegido', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(cargar).toHaveBeenCalledWith('santa-teresa', [{ desde: '2024-01-05', hasta: '2026-11-17' }])
    expect(seccion().textContent).toContain('2026 va a la fecha: 1 de enero al 17 de noviembre (321 días), hasta ayer (hoy no entra)')
    expect(seccion().querySelector('[data-en-curso="si"] td')!.textContent).toBe('Noviembre · a la fecha (1 al 17)')
  })

  it('criterio 5: cada % dice qué año contra cuál y con qué fechas; las columnas, «AAAA vs AAAA»', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    const cambios = [...seccion().querySelectorAll('[data-cambio]')]
    expect(cambios.length).toBeGreaterThan(10)
    for (const e of cambios) {
      // Un lado sin días (diciembre de 2026, todavía no llegó) dice «sin días» y el % es «—».
      expect(e.getAttribute('title')).toMatch(/^\d{4} contra \d{4}: (sin días|.*\d{4}) contra (sin días|.*\d{4})$/)
      if (e.getAttribute('title')!.includes('sin días')) expect(e.textContent).toBe('—')
    }
    expect(cambios.filter(e => !e.getAttribute('title')!.includes('sin días')).length).toBeGreaterThan(10)
    expect([...seccion().querySelectorAll('th[data-col="cambio"]')].map(t => t.textContent)).toEqual(['2026 vs 2025', '2025 vs 2023'])
    // La tarjeta del año: el % con el año base y sus fechas al lado.
    expect(seccion().querySelector('.vt-kpi[data-anio="2026"] .vt-kpi-delta')!.textContent).toMatch(/[+−]\d+,\d % vs 2025 a la misma fecha \(1 ene – 17 nov 2025\)$/)
    // Ningún «vs anterior» a secas ni «índice» en toda la pestaña (criterio 6).
    expect(document.body.textContent).not.toMatch(/vs anterior\b/i)
    expect(document.body.textContent).not.toMatch(/índice/i)
  })

  it('2023 sale de `ventas_hist` en Santa Teresa; en otro local no (el histórico viejo no tiene local)', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(seccion().querySelector('.vt-kpi[data-anio="2023"]')!.textContent).toContain('₡400.000')
    expect(seccion().querySelector('.vt-kpi[data-anio="2023"]')!.textContent).toContain('(sin estimar: resumen diario viejo)')
    cleanup()
    await abrir('p=anioALaFecha&local=local-b')
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(cargar).toHaveBeenCalledWith('local-b', [{ desde: '2024-01-05', hasta: '2026-11-17' }])
    expect(seccion().querySelector('.vt-kpi[data-anio="2023"]')).toBeNull()
    expect([...seccion().querySelectorAll('.vt-kpi[data-anio]')].map(e => e.getAttribute('data-anio'))).toEqual(['2026', '2025'])
  })

  it('la venta por persona del año es la D4 (con las mesas sin pax estimadas) y lo dice', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(seccion().querySelector('.vt-kpi[data-anio="2026"] [data-dato="personas"]')!.textContent).toMatch(/venta por persona ₡[\d.]+ \(incluye \d+ % estimado\)/)
  })

  it('si la lectura de los años falla, lo dice y el resto de «Tiempos» se ve igual', async () => {
    fallaHistoria = true
    await abrir()
    expect(await screen.findByText('No se pudieron leer los años anteriores. El resto de la pestaña está bien.')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Quincenas' })).toBeTruthy()
    expect(document.querySelector('[data-bloque="calendario"]')).toBeTruthy()
  })

  it('va entre «Quincenas» y «Calendario», y apunta a «Temporada» de la barra para ver por temporada', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    const orden = [...document.querySelectorAll('[data-bloque]')].map(e => e.getAttribute('data-bloque'))
    expect(orden).toEqual(['dia-semana', 'hora-turno', 'sentados', 'quincenas', 'meses', 'calendario'])
    expect(seccion().querySelector('[data-nota="temporadas"]')!.textContent).toContain('elegí «Temporada» en el «Período» de arriba')
  })
  it('«Por trimestre»: un año sin días en ese trimestre dice «—», nunca «₡0» (como «Mes por mes»)', async () => {
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    // T3 de 2025: la fixture de 2025 arranca en octubre. T4 de 2025 sí tiene ventas.
    const neta = (q: number, y: number) => seccion().querySelector(`[data-trimestre="${q}"] [data-anio="${y}"] [data-dato="neta"]`)!.textContent
    expect(neta(3, 2025)).toBe('—')
    expect(neta(1, 2023)).toBe('—')
    expect(neta(4, 2025)).toMatch(/^₡[\d.]+$/)
    expect(neta(4, 2025)).not.toBe('₡0')
    expect(seccion().querySelector('[data-trimestre]')!.closest('section')!.textContent).not.toMatch(/₡0(?![\d.,])/)
  })
})

// Bug del verificador del #339 (23-nov): el ancho de 4 columnas iba en línea y le ganaba a la regla de pantalla
// chica de `index.css`; a 390 px las tarjetas de 2024 y 2023 quedaban cortadas. happy-dom evalúa el @media.
describe('«Meses y temporadas» en el teléfono (390 px, con el CSS de la app)', () => {
  let estilo: HTMLStyleElement
  const hd = () => (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM
  // El viewport va ANTES de cargar el CSS: happy-dom evalúa el @media al insertar la hoja.
  const conCss = (width: number) => {
    hd().setViewport({ width, height: 800 })
    estilo = document.createElement('style')
    estilo.textContent = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
    document.head.appendChild(estilo)
  }
  afterEach(() => { estilo.remove(); hd().setViewport({ width: 1024, height: 768 }) })

  const grilla = () => seccion().querySelector('.vt-kpi[data-anio]')!.parentElement as HTMLElement

  it('a 390 px las tarjetas por año se apilan (una columna) y no llevan el ancho en línea', async () => {
    conCss(390)
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(window.innerWidth).toBe(390)
    expect(grilla().style.gridTemplateColumns).toBe('')
    expect(getComputedStyle(grilla()).gridTemplateColumns).toBe('1fr')
  })

  it('en escritorio, una columna por año (3 años → 3 columnas)', async () => {
    conCss(1280)
    await abrir()
    await screen.findByRole('table', { name: 'Mes por mes' })
    expect(grilla().style.getPropertyValue('--vt-anios')).toBe('3')
    expect(getComputedStyle(grilla()).gridTemplateColumns).toMatch(/^repeat\(var\(--vt-anios, 4\), minmax\(0, 1fr\)\)$|^repeat\(3, minmax\(0(px)?, 1fr\)\)$/)
  })
})
