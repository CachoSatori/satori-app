// @vitest-environment happy-dom
//
// 3.5.2 · «Regalías» (D11 = A) en el DOM: los tres roles la ven completa (D7), con la barra; cada % nombra su base
// y sus fechas; el aviso dice lo que falta (3.4); «Hoy» no se mira acá. Datos ficticios; reloj de noche en CR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
import { armarDiasMap } from './ventasDiasDesdePos'
const fx = datos('2026-09-01', 78)
const lectura = armarLectura(fx.tickets, fx.lineas, {})
const cargarLectura = vi.fn(async () => lectura)
const cargarLineas = vi.fn(async (_l: string, r: { desde: string; hasta: string }) =>
  ({ dias: armarDiasMap(fx.tickets, fx.lineas, r, { uploadedAt: 'x', avisar: () => {} }).dias, pm: {} }))
const locales = vi.hoisted(() => ({ lista: [{ id: 'santa-teresa', nombre: 'Local A' }] as { id: string; nombre: string }[] }))
vi.mock('./resumenV2Datos', () => ({
  cargarLecturaResumen: (...a: unknown[]) => cargarLectura(...(a as [])),
  getLocalesVentas: vi.fn(async () => locales.lista),
}))
vi.mock('./lineasPeriodo', async orig => ({
  ...(await orig<typeof import('./lineasPeriodo')>()),
  cargarLineasPeriodo: (l: string, r: { desde: string; hasta: string }) => cargarLineas(l, r),
}))

import VentasRegalias from './VentasRegalias'
import { cifrasDelRango } from './resumenV2'
import { calcularPeriodo } from './periodos'
import { fi } from './ventasUtils'
import { FALTA_EN_REGALIAS } from './salonDetalle'

const abrir = (q: string) => render(<MemoryRouter initialEntries={[`/ventas?tab=regalias&${q}`]}><VentasRegalias /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  locales.lista = [{ id: 'santa-teresa', nombre: 'Local A' }]
  cargarLectura.mockClear(); cargarLineas.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasRegalias', () => {
  it.each(['owner', 'manager', 'contador'])('%s ve la pantalla completa (D7): tabla por tipo, dueños y regalías totales, y el aviso', async r => {
    role = r
    abrir('p=mes&d=2026-10-01')
    const tabla = await screen.findByRole('table', { name: 'Regalías por tipo' })
    expect([...tabla.querySelectorAll('tbody tr')].map(tr => tr.getAttribute('data-regalia')))
      .toEqual(['cortesias', 'personal', 'duenos', 'regaliasTotales', 'desconocidos'])
    const oct = cifrasDelRango(lectura, { desde: '2026-10-01', hasta: '2026-10-31' })
    // Mesas de dueños y regalías totales: las mismas que el «Resumen» saca de la venta por persona (con su neta).
    expect(tabla.querySelector('[data-regalia="duenos"]')!.textContent).toContain(`${oct.vpp.mesasDuenos} mesas`)
    expect(tabla.querySelector('[data-regalia="duenos"] td:nth-child(2)')!.textContent).toBe(fi(oct.vpp.netaMesasDuenos))
    expect(oct.vpp.mesasDuenos).toBeGreaterThan(0)
    expect(tabla.querySelector('[data-regalia="regaliasTotales"] td:nth-child(2)')!.textContent).toBe(fi(oct.vpp.netaRegaliasTotales))
    const aviso = document.querySelector('[data-bloque="regalias-falta"]')!.textContent!
    for (const falta of FALTA_EN_REGALIAS) expect(aviso).toContain(falta)
    expect(cargarLineas).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ desde: '2026-10-01', hasta: '2026-10-31' }))
  })

  it('cada % nombra su base y sus fechas; ninguna palabra «índice»', async () => {
    abrir('p=mes&d=2026-10-01')
    const tabla = await screen.findByRole('table', { name: 'Regalías por tipo' })
    const neta = cifrasDelRango(lectura, { desde: '2026-10-01', hasta: '2026-10-31' }).totales.ventaNeta
    expect(tabla.querySelector('thead')!.textContent).toContain(`% de la venta neta del período (1–31 oct: ${fi(neta)})`)
    expect(document.body.textContent).not.toMatch(/índice/i)
    expect(document.body.textContent).not.toMatch(/vs anterior/i)
  })

  it('por defecto «Ayer», con la barra en la URL; la bajada dice el período', async () => {
    abrir('')
    await screen.findByRole('table', { name: 'Regalías por tipo' })
    expect(screen.getByTestId('regalias-bajada').textContent).toMatch(/^En 17 nov/)
    const p = calcularPeriodo({ tipo: 'ayer', ancla: '2026-11-18' })
    expect(cargarLineas).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ desde: p.desde, hasta: p.hasta }))
  })

  it('«Hoy» no se mira acá: no lee nada y lo dice', async () => {
    abrir('p=hoy')
    expect(await screen.findByText(/las regalías del día se miran cuando cierra/)).toBeTruthy()
    expect(cargarLineas).not.toHaveBeenCalled()
    expect(cargarLectura).not.toHaveBeenCalled()
  })
  it('D16: con dos locales abre Santa Teresa aunque venga segunda; si la URL trae el otro y lo ve, lo respeta', async () => {
    locales.lista = [{ id: 'local-b', nombre: 'Local B' }, { id: 'santa-teresa', nombre: 'Local A' }]
    abrir('p=ayer')
    await screen.findByRole('table', { name: 'Regalías por tipo' })
    expect(cargarLineas.mock.calls.at(-1)![0]).toBe('santa-teresa')
    cleanup(); cargarLineas.mockClear()
    abrir('p=ayer&local=local-b')
    await screen.findByRole('table', { name: 'Regalías por tipo' })
    expect(cargarLineas.mock.calls.at(-1)![0]).toBe('local-b')
  })
})
