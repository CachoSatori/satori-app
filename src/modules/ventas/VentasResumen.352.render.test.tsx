// @vitest-environment happy-dom
//
// 3.5.2 · «Resumen» completo (SPEC §5.1 ítems 6, 7 y 10) en el DOM: «Qué explica el cambio» con el período y la
// base de la barra; «Salón en detalle» que lee las líneas recién al abrirse; «🖨 Reporte» solo con «Mes»; el
// seguimiento de la meta suma «meta por día» y «falta para la meta». Datos ficticios; reloj de noche en CR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { FilaAgregada } from './ventasPromPaxExplicado'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

/** Filas ficticias del RPC 080: salón, un salonero, mañana y noche; la base (sep) gasta menos por persona. */
const fila = (dia: string, franja: FilaAgregada['franja'], pax: number, neta: number): FilaAgregada =>
  ({ dia, franja, salonero_login: '026', canal: 'salon', tickets: pax, pax, neta, neta_sin_pax: 0, tickets_sin_pax: 0 })
const FILAS: FilaAgregada[] = []
for (let d = 1; d <= 30; d++) {
  const sep = `2026-09-${String(d).padStart(2, '0')}`, oct = `2026-10-${String(d).padStart(2, '0')}`
  FILAS.push(fila(sep, 'mañana', 4, 40_000), fila(sep, 'noche', 6, 60_000), fila(oct, 'mañana', 4, 44_000), fila(oct, 'noche', 6, 72_000))
}
const posNdf = vi.hoisted(() => ({ getPromPaxAgregado: vi.fn(), getSaloneroNombres: vi.fn(async () => ({})), getVentasProductos: vi.fn() }))
vi.mock('../../shared/api/posNdf', async orig => ({ ...(await orig<typeof import('../../shared/api/posNdf')>()), ...posNdf }))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
const fx = datos('2026-09-01', 78)
vi.mock('./resumenV2Datos', () => ({
  cargarLecturaResumen: vi.fn(async () => armarLectura(fx.tickets, fx.lineas, {})),
  cargarLecturaRango: vi.fn(async () => armarLectura(fx.tickets, fx.lineas, {})),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))
const lineas = vi.hoisted(() => ({ cargarLineasPeriodo: vi.fn(), cargarLineasDeRangos: vi.fn() }))
vi.mock('./lineasPeriodo', async orig => ({ ...(await orig<typeof import('./lineasPeriodo')>()), ...lineas }))
vi.mock('./ventasFuente', async orig => ({ ...(await orig<typeof import('./ventasFuente')>()), cargarHistEager: vi.fn(async () => ({})) }))
vi.mock('./ReporteMensual', () => ({ default: ({ ym }: { ym: string }) => <div data-testid="reporte">reporte {ym}</div> }))

import VentasResumen from './VentasResumen'
import { analizar } from './ventasPromPaxExplicado'
import type { Meta } from '../../shared/types/ventas'

const METAS = { restaurante: { '2026-11': 5_000_000 }, margen: {}, global: {}, salMetas: {} } as unknown as Meta
const abrir = (q: string) => render(<MemoryRouter initialEntries={[`/ventas?tab=resumen&${q}`]}><VentasResumen metas={METAS} /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  posNdf.getPromPaxAgregado.mockReset().mockResolvedValue(FILAS)
  posNdf.getVentasProductos.mockReset().mockRejectedValue(new Error('sin catálogo en esta prueba'))
  lineas.cargarLineasPeriodo.mockReset().mockResolvedValue({ dias: {}, pm: {} })
  lineas.cargarLineasDeRangos.mockReset().mockResolvedValue({ dias: {}, pm: {} })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('«Qué explica el cambio» (ítem 6)', () => {
  it('octubre contra el mes anterior: lee el período y la base de la barra, del local, y muestra las frases del análisis', async () => {
    abrir('p=mes&d=2026-10-01&c=anterior')
    const frases = await screen.findByTestId('explica-frases')
    expect(posNdf.getPromPaxAgregado).toHaveBeenCalledWith('santa-teresa', '2026-09-01', '2026-10-31')
    const esperado = analizar(FILAS, { desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-09-01', hasta: '2026-09-30' })
    expect([...frases.querySelectorAll('p')].map(p => p.textContent)).toEqual(esperado.explicacion.frases.slice(0, 3))
    expect(frases.textContent).toContain('Las ventas subieron')
    // La base se nombra con sus fechas; el detalle completo está a un clic.
    expect(document.querySelector('[data-bloque="explica"]')!.textContent).toContain('mes anterior (1–30 sep)')
    expect(document.querySelector('details[data-bloque="explica-detalle"]')).toBeTruthy()
  })

  it('el título «Qué explica el cambio» aparece una sola vez, también con el detalle abierto', async () => {
    abrir('p=mes&d=2026-10-01&c=anterior')
    await screen.findByTestId('explica-frases')
    const det = document.querySelector('details[data-bloque="explica-detalle"]') as HTMLDetailsElement
    det.open = true
    const titulos = () => [...document.querySelectorAll('.vt-sl')].filter(e => e.textContent === 'Qué explica el cambio').length
    expect(titulos()).toBe(1)
    // Con un turno elegido, sus frases van rotuladas por el turno, no con el título repetido.
    fireEvent.click(screen.getByRole('button', { name: 'Noche' }))
    expect(await screen.findByText('Con el turno noche')).toBeTruthy()
    expect(titulos()).toBe(1)
  })

  it('con «Año pasado, mismo día de semana» explica contra esa base', async () => {
    abrir('p=mes&d=2026-10-01&c=anio')
    await screen.findByTestId('explica-frases')
    expect(posNdf.getPromPaxAgregado).toHaveBeenCalledWith('santa-teresa', '2025-10-02', '2026-10-31')
  })
})

describe('«Salón en detalle» (ítem 10)', () => {
  it('abrir «Resumen» no lee las líneas; abrir el desplegable sí, solo del período y del local', async () => {
    abrir('p=ayer')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(lineas.cargarLineasPeriodo).not.toHaveBeenCalled()
    const det = document.querySelector('details[data-bloque="salon-detalle"]') as HTMLDetailsElement
    det.open = true
    fireEvent(det, new Event('toggle'))
    await waitFor(() => expect(lineas.cargarLineasPeriodo).toHaveBeenCalledWith('santa-teresa', { desde: '2026-11-17', hasta: '2026-11-17' }))
    expect(await screen.findByText('No hay ventas del PoS en este período.')).toBeTruthy()
  })
})

describe('3.2b · «Bebidas por persona» en «Salón en detalle»', () => {
  it('bebidas vendidas de salón ÷ las MISMAS personas de la venta por persona (cargadas + estimadas)', async () => {
    const { armarDiasMap } = await import('./ventasDiasDesdePos')
    const { cifrasDelRango } = await import('./resumenV2')
    const { parsearVentasProductos } = await import('../../shared/api/posNdf')
    lineas.cargarLineasPeriodo.mockImplementation(async (_l: string, r: { desde: string; hasta: string }) =>
      ({ dias: armarDiasMap(fx.tickets, fx.lineas, r, { uploadedAt: 'x', avisar: () => {} }).dias, pm: {} }))
    posNdf.getVentasProductos.mockResolvedValue(parsearVentasProductos({
      productos: [['30', 'CERVEZA', 5, 'salon', 500, 1_000_000_00, 300, 'bebida', 0]], meses: [], catalogo: [], familias: [],
      sin_lineas: { facturas: 0, cts: 0 }, neta_cts: 1_000_000_00,
    }))
    abrir('p=mes&d=2026-10-01')
    await screen.findByRole('table', { name: 'Detalle por día' })
    const det = document.querySelector('details[data-bloque="salon-detalle"]') as HTMLDetailsElement
    det.open = true
    fireEvent(det, new Event('toggle'))
    const v = cifrasDelRango(armarLectura(fx.tickets, fx.lineas, {}), { desde: '2026-10-01', hasta: '2026-10-31' }).vpp
    const personas = v.personasCargadas + v.personasEstimadas
    expect(v.personasEstimadas).toBeGreaterThan(0)   // la fixture trae mesas sin pax: si se usaran solo las cargadas, cae
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe((500 / personas).toFixed(2).replace('.', ',')))
    expect(posNdf.getVentasProductos).toHaveBeenCalledWith('santa-teresa', '2026-10-01', '2026-10-31')
  })
})

describe('«Detalle por día» (ítem 7): «🖨 Reporte» del mes', () => {
  it('con «Mes» aparece; al tocarlo lee el mes, el anterior y el del año pasado, y abre el reporte de ese mes', async () => {
    abrir('p=mes&d=2026-10-01')
    const b = await screen.findByRole('button', { name: '🖨 Reporte' })
    fireEvent.click(b)
    expect((await screen.findByTestId('reporte')).textContent).toBe('reporte 2026-10')
    expect(lineas.cargarLineasDeRangos).toHaveBeenCalledWith('santa-teresa', [
      { desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-09-01', hasta: '2026-09-30' }, { desde: '2025-10-01', hasta: '2025-10-31' },
    ])
  })

  it.each(['p=ayer', 'p=semana', 'p=anioALaFecha'])('con %s no aparece', async q => {
    abrir(q)
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(screen.queryByRole('button', { name: '🖨 Reporte' })).toBeNull()
  })

  it('el contador lo ve (como en la vieja «Ventas»), con el detalle desplegado', async () => {
    role = 'contador'
    abrir('p=mes&d=2026-10-01')
    expect(await screen.findByRole('button', { name: '🖨 Reporte' })).toBeTruthy()
    // El `<details>` del «Detalle por día» (no el primero con la clase: ver R32).
    expect((screen.getByRole('table', { name: 'Detalle por día' }).closest('details') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('Meta del mes: lo que traía «Metas» → seguimiento (3.5.2)', () => {
  it('meta por día en promedio y lo que falta para la meta', async () => {
    abrir('p=ayer')
    const meta = await screen.findByText((_, el) => el?.getAttribute('data-meta') === 'necesario')
    expect(meta.textContent).toMatch(/Faltan ₡[\d.]+ para la meta/)
    expect(document.querySelector('[data-meta="meta"]')!.textContent).toContain(`₡166.667 por día en promedio (30 días)`)
  })
})

describe('sin índice', () => {
  it('ningún texto pintado dice «índice» ni «vs anterior» a secas', async () => {
    abrir('p=mes&d=2026-10-01')
    await screen.findByTestId('explica-frases')
    expect(document.body.textContent).not.toMatch(/índice/i)
    expect(document.body.textContent).not.toMatch(/vs anterior\b/i)
  })
})
