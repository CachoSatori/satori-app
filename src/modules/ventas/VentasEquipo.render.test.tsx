// @vitest-environment happy-dom
//
// Ventas v2 · 3.5.4 · «Equipo» en el DOM, por rol (SPEC-ventas-v2 §5.3, §6 y §12.5). Datos FICTICIOS (la fixture
// del Resumen). Lo que se prueba:
//   · Los tres roles ven TODO «Equipo»: ranking, columnas de evaluación, ICP y ficha (D18, DECISIÓN DEL DUEÑO 23-nov
//     22:35 CR: el contador igual que gerencia; corrige la de las 21:40, que le dejaba solo el ranking).
//   · Cualquier otro rol que llegue a montar la vista ve solo el ranking, sin propinas ni ficha (§6).
//   · La barra global: Santa Teresa por defecto (D16), cada % nombra su base y sus fechas (criterio 5), sin
//     «índice» (criterio 6), «Hoy» no entra. Reloj fijo DE NOCHE en CR (23:30 del 18-nov = 05:30 UTC del 19).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Meta } from '../../shared/types/ventas'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
const empleados = vi.fn(async () => [] as unknown[])
vi.mock('../../shared/api/admin', () => ({ getAllEmployees: () => empleados() }))
const propinas = vi.fn(async (...a: unknown[]) => { void a; return [] as unknown[] })
vi.mock('./equipoPropinas', () => ({ getPropinasRango: (...a: unknown[]) => propinas(...a) }))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
import { armarDiasMap } from './ventasDiasDesdePos'

const base = datos('2026-08-20', 90)
const lectura = armarLectura(base.tickets, base.lineas, {})
const pedidos: { fn: string; local: string; desde: string; hasta: string }[] = []
vi.mock('./resumenV2Datos', async orig => ({
  ...(await orig<typeof import('./resumenV2Datos')>()),
  cargarLecturaResumen: vi.fn(async (local: string, p: { desde: string; hasta: string }) => { pedidos.push({ fn: 'resumen', local, desde: p.desde, hasta: p.hasta }); return lectura }),
  cargarLecturaRango: vi.fn(async (local: string, r: { desde: string; hasta: string }) => { pedidos.push({ fn: 'rango', local, desde: r.desde, hasta: r.hasta }); return lectura }),
  getLocalesVentas: vi.fn(async () => [{ id: 'nosara', nombre: 'Local B' }, { id: 'santa-teresa', nombre: 'Local A' }]),
}))
vi.mock('./lineasPeriodo', async orig => ({
  ...(await orig<typeof import('./lineasPeriodo')>()),
  cargarLineasPeriodo: vi.fn(async (local: string, r: { desde: string; hasta: string }) => {
    pedidos.push({ fn: 'lineas', local, desde: r.desde, hasta: r.hasta })
    return armarDiasMap(base.tickets, base.lineas, r, { uploadedAt: 'x', avisar: () => {} })
  }),
}))

import VentasEquipo from './VentasEquipo'
import { cargarLecturaRango } from './resumenV2Datos'

const METAS = { restaurante: {}, margen: {}, global: { promPax: 9_000, bebPax: 0, ratioCB: 0, ticketItem: 0, ventas: 0 }, salMetas: {} } as unknown as Meta

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  pedidos.length = 0
  propinas.mockClear()
  empleados.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const abrir = async (q = '') => {
  const r = render(<MemoryRouter initialEntries={[`/ventas?tab=equipo${q ? `&${q}` : ''}`]}><VentasEquipo metas={METAS} /></MemoryRouter>)
  await screen.findByRole('table', { name: 'Equipo' })
  return r
}
const encabezados = () => [...document.querySelectorAll('table[aria-label="Equipo"] thead th')].map(th => th.textContent)
const RANKING = ['#', 'Salonero', 'Venta', 'Personas (PAX)', 'Venta por persona', 'vs equipo de su turno', 'Prom/PAX cargado',
  'Beb/PAX', 'Comida/bebida', 'Prom/plato', 'Ticket/ítem']
const DETALLE = ['ICP', '% meta', 'Días', 'Consistencia', 'Tendencia', 'Racha']

describe('«Equipo» · qué ve cada rol', () => {
  it.each(['owner', 'manager', 'contador'])('%s: el ranking más evaluación e ICP; tocar un salonero abre su ficha (D18: el contador igual)', async r => {
    role = r
    await abrir('p=mes&d=2026-11-17')
    expect(encabezados()).toEqual([...RANKING, ...DETALLE])
    expect(propinas).toHaveBeenCalledWith('2026-11-01', '2026-11-17', 'santa-teresa')
    expect(empleados).toHaveBeenCalled()
    const fila = document.querySelector('table[aria-label="Equipo"] tbody tr')!
    expect(fila.getAttribute('role')).toBe('button')
    fireEvent.click(fila)
    const ficha = await screen.findByTestId('ficha-salonero')
    expect(ficha.textContent).toContain(fila.getAttribute('data-salonero')!)
    await screen.findByTestId('doce-semanas')
    expect(document.querySelectorAll('[data-testid="doce-semanas"] tbody tr')).toHaveLength(12)
    expect(pedidos).toContainEqual({ fn: 'rango', local: 'santa-teresa', desde: '2026-08-26', hasta: '2026-11-17' })
  })

  it('un rol sin detalle (no debería llegar: la ruta es OMC) ve solo el ranking, sin propinas, empleados ni ficha', async () => {
    role = 'salonero'
    await abrir('p=ayer')
    expect(encabezados()).toEqual(RANKING)
    expect(propinas).not.toHaveBeenCalled()
    expect(empleados).not.toHaveBeenCalled()
    const fila = document.querySelector('table[aria-label="Equipo"] tbody tr')!
    expect(fila.getAttribute('role')).toBeNull()
    fireEvent.click(fila)
    expect(screen.queryByTestId('ficha-salonero')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Consistencia|Racha|ficha/)
  })
})

describe('«Equipo» · la barra global', () => {
  it('abre en «Ayer» (el «Ranking del día») y en Santa Teresa aunque otro local venga primero en la lista (D16)', async () => {
    await abrir()
    await waitFor(() => expect(pedidos.some(p => p.fn === 'lineas')).toBe(true))
    expect(pedidos.filter(p => p.fn === 'lineas')).toEqual([{ fn: 'lineas', local: 'santa-teresa', desde: '2026-11-17', hasta: '2026-11-17' }])
    expect((screen.getByLabelText('Local') as HTMLSelectElement).value).toBe('santa-teresa')
  })

  it('criterio 5: cada % de arriba nombra su base y sus fechas', async () => {
    await abrir('p=mes&d=2026-11-17')
    const deltas = [...document.querySelectorAll('.vt2-cifras .vt2-delta')]
    expect(deltas.length).toBeGreaterThan(0)
    for (const d of deltas) expect(d.textContent).toMatch(/vs .+\(.+\)/)
    expect(document.querySelector('.vt2-cifras')!.textContent).not.toMatch(/vs anterior\b/)
  })

  it('criterio 6: ninguna medida «índice»', async () => {
    await abrir('p=mes&d=2026-11-17')
    expect(document.body.textContent!.toLowerCase()).not.toContain('índice')
  })

  it('«Hoy» no entra: lo manda a «En vivo» y no lee nada', async () => {
    render(<MemoryRouter initialEntries={['/ventas?tab=equipo&p=hoy']}><VentasEquipo metas={METAS} /></MemoryRouter>)
    expect((await screen.findAllByText(/el ranking de hoy, mientras se vende, se mira en «En vivo»/)).length).toBeGreaterThan(0)
    expect(pedidos.filter(p => p.fn !== 'rango')).toEqual([])
  })

  it('el local de la URL manda si el usuario lo ve', async () => {
    await abrir('p=ayer&local=nosara')
    await waitFor(() => expect(pedidos.some(p => p.fn === 'lineas' && p.local === 'nosara')).toBe(true))
  })
})

describe('«Equipo» · la ficha no deja a la vista un error viejo (menor 2 del verificador del #340)', () => {
  const alerta = () => document.querySelector('[data-testid="ficha-salonero"] [role="alert"]')
  const filasEquipo = () => [...document.querySelectorAll('table[aria-label="Equipo"] tbody tr')]

  it('falla la lectura de las 12 semanas con un salonero; al tocar otro, el error se va y se ven sus 12 semanas', async () => {
    vi.mocked(cargarLecturaRango).mockRejectedValueOnce(new Error('caída de prueba'))
    await abrir('p=mes&d=2026-11-17')
    const [a, b] = filasEquipo()
    expect(b).toBeDefined()
    fireEvent.click(a)
    await waitFor(() => expect(alerta()?.textContent).toContain('caída de prueba'))
    fireEvent.click(b)
    const ficha = await screen.findByTestId('ficha-salonero')
    expect(ficha.textContent).toContain(b.getAttribute('data-salonero')!)
    await screen.findByTestId('doce-semanas')
    expect(alerta()).toBeNull()
  })

  it('cambiar de período cierra la ficha (se vuelve a leer el equipo): ni el error ni una respuesta tardía quedan a la vista', async () => {
    let rechazar: (e: Error) => void = () => {}
    vi.mocked(cargarLecturaRango).mockImplementationOnce(() => new Promise((_, rej) => { rechazar = rej }))
    await abrir('p=mes&d=2026-11-17')
    fireEvent.click(filasEquipo()[0])
    await screen.findByText('Leyendo las 12 semanas…')
    fireEvent.click(screen.getByRole('button', { name: 'Período anterior' }))
    await waitFor(() => expect(pedidos).toContainEqual({ fn: 'lineas', local: 'santa-teresa', desde: '2026-10-01', hasta: '2026-10-31' }))
    await screen.findByRole('table', { name: 'Equipo' })
    rechazar(new Error('tardía de prueba'))
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByTestId('ficha-salonero')).toBeNull()
    expect(document.body.textContent).not.toContain('tardía de prueba')
  })
})
