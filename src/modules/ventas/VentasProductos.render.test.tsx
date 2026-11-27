// @vitest-environment happy-dom
//
// Ventas v2 · 3.2 — «Productos» definitiva en el DOM: lee `pos_ventas_productos` (período + bases, ≤ 3 pedidos), con la
// barra global; cada cambio nombra su base y sus fechas; la ingeniería de menú solo para owner y manager (SPEC §6);
// estados de carga, error, vacío y «Hoy». Datos ficticios; reloj de noche en CR (23:30 CR = 05:30 UTC).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useEffect } from 'react'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

const locales = vi.hoisted(() => ({ lista: [{ id: 'santa-teresa', nombre: 'Local A' }] as { id: string; nombre: string }[] }))
vi.mock('./resumenV2Datos', () => ({ getLocalesVentas: vi.fn(async () => locales.lista) }))

const api = vi.hoisted(() => ({ getVentasProductos: vi.fn() }))
vi.mock('../../shared/api/posNdf', async orig => ({ ...(await orig<typeof import('../../shared/api/posNdf')>()), getVentasProductos: api.getVentasProductos }))

import { parsearVentasProductos } from '../../shared/api/posNdf'
import VentasProductos from './VentasProductos'
import { fi } from './ventasUtils'

const FAMILIAS = [[2, 'ENTRADAS', 'comida', 1], [5, 'BEBIDAS', 'bebida', 1], [17, 'X CORTESIAS', 'cortesia', 1]]
const delPeriodo = (k: number) => parsearVentasProductos({
  productos: [
    ['10', 'GYOZA', 2, 'salon', 10, 50_000_00 * k, 8, 'comida', 0],
    ['30', 'CERVEZA', 5, 'salon', 30, 30_000_00, 20, 'bebida', 0],
    ['31', 'SAKE', 5, 'delivery', 2, 10_000_00, 2, 'bebida', 0],
    ['99', 'REGALO', 17, 'salon', 1, 5_000_00, 1, 'cortesia', 0],
  ],
  meses: [], catalogo: [['10', 'GYOZA', 2, 1, '2025-01-01', '2026-11-18', 'comida'], ['77', 'TEMPURA', 2, 1, '2025-01-01', '2026-09-01', 'comida']],
  familias: FAMILIAS, sin_lineas: { facturas: 0, cts: 0 }, neta_cts: 50_000_00 * k + 40_000_00,
})

const ultima = { url: '' }
function Url() { const l = useLocation(); useEffect(() => { ultima.url = l.search }, [l]); return null }
const abrir = (q: string) => render(<MemoryRouter initialEntries={[`/ventas?tab=productos&${q}`]}><VentasProductos /><Url /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))   // 18-nov 23:30 CR
  role = 'owner'
  locales.lista = [{ id: 'santa-teresa', nombre: 'Local A' }]
  api.getVentasProductos.mockReset()
  api.getVentasProductos.mockImplementation(async (_l: string, desde: string) => delPeriodo(desde === '2026-10-01' ? 2 : 1))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasProductos', () => {
  it.each(['owner', 'manager', 'contador'])('%s ve el mix por categoría con la neta de «Resumen» y lo que no es venta aparte', async r => {
    role = r
    abrir('p=mes&d=2026-10-01')
    const tabla = await screen.findByRole('table', { name: 'Mix por categoría' })
    expect([...tabla.querySelectorAll('tbody tr[data-categoria]')].map(x => x.getAttribute('data-categoria'))).toEqual(['comida', 'bebida', 'total'])
    expect(screen.getByTestId('productos-neta').textContent).toBe(fi(140_000))
    expect(document.querySelector('[data-bloque="fuera-de-venta"]')!.textContent).toContain('Regalías')
  })

  it('lee período + 2 bases (3 pedidos como máximo), por día CR, del local por defecto (Santa Teresa)', async () => {
    abrir('p=mes&d=2026-10-01')
    await screen.findByRole('table', { name: 'Mix por categoría' })
    expect(api.getVentasProductos).toHaveBeenCalledTimes(3)
    expect(api.getVentasProductos).toHaveBeenCalledWith('santa-teresa', '2026-10-01', '2026-10-31')
    for (const c of api.getVentasProductos.mock.calls) expect(c[1] <= c[2] && /^\d{4}-\d{2}-\d{2}$/.test(c[1])).toBe(true)
  })

  it('cada cambio en puntos nombra su base y sus fechas (criterio 5)', async () => {
    abrir('p=mes&d=2026-10-01')
    const tabla = await screen.findByRole('table', { name: 'Mix por categoría' })
    const cab = [...tabla.querySelectorAll('thead th[data-base]')].map(th => th.textContent)
    expect(cab).toHaveLength(2)
    for (const c of cab) expect(c).toMatch(/^vs .+\(.+\)$/)
    expect(screen.getByTestId('productos-bajada').textContent).toMatch(/pts contra .+\(/)
  })

  it('la ingeniería de menú (popularidad) la ven owner y manager; el contador no (§6)', async () => {
    for (const [r, ve] of [['owner', true], ['manager', true], ['contador', false]] as const) {
      cleanup(); role = r
      abrir('p=mes&d=2026-10-01')
      await screen.findByRole('table', { name: 'Mix por categoría' })
      expect(!!document.querySelector('[data-bloque="popularidad"]'), r).toBe(ve)
    }
  })

  it('el canal queda en la URL y cambia la neta (delivery: solo lo suyo)', async () => {
    abrir('p=mes&d=2026-10-01')
    await screen.findByRole('table', { name: 'Mix por categoría' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Canal' })).getByRole('button', { name: 'Delivery' }))
    await vi.waitFor(() => expect(ultima.url).toContain('canal=delivery'))
    expect(screen.getByTestId('productos-neta').textContent).toBe(fi(10_000))
  })

  it('«Sin ventas en el período» lista los activos que no vendieron', async () => {
    abrir('p=mes&d=2026-10-01')
    await screen.findByRole('table', { name: 'Mix por categoría' })
    expect(within(screen.getByRole('table', { name: 'Sin ventas en el período' })).getByText('TEMPURA')).toBeTruthy()
  })

  it('error: lo avisa y no pinta números', async () => {
    api.getVentasProductos.mockRejectedValue(new Error('No autorizado para este local'))
    abrir('p=mes&d=2026-10-01')
    expect((await screen.findByRole('alert')).textContent).toContain('No autorizado para este local')
    expect(screen.queryByRole('table', { name: 'Mix por categoría' })).toBeNull()
  })

  it('carga y vacío', async () => {
    const soltar: ((v: unknown) => void)[] = []
    api.getVentasProductos.mockImplementation(() => new Promise(r => { soltar.push(r) }))
    abrir('p=ayer')
    expect(screen.getByRole('status').textContent).toContain('Leyendo los productos del PoS')
    const vacio = (parsearVentasProductos({ productos: [], meses: [], catalogo: [], familias: [], sin_lineas: { facturas: 0, cts: 0 }, neta_cts: 0 }))
    await vi.waitFor(() => expect(soltar.length).toBeGreaterThan(0))
    soltar.forEach(f => f(vacio))
    await vi.waitFor(() => expect(screen.queryByTestId('productos-vacio')).toBeTruthy())
  })

  it('«Hoy» no se lee (está en curso)', async () => {
    abrir('p=hoy')
    expect(document.querySelector('.vt2-hoy')!.textContent).toMatch(/Hoy está en curso/)
    expect(api.getVentasProductos).not.toHaveBeenCalled()
  })

  it('multi-local: con dos locales aparece el selector y se lee el de la URL', async () => {
    locales.lista = [{ id: 'santa-teresa', nombre: 'Local A' }, { id: 'nosara', nombre: 'Local B' }]
    abrir('p=mes&d=2026-10-01&local=nosara')
    await screen.findByRole('table', { name: 'Mix por categoría' })
    expect(screen.getByLabelText('Local')).toBeTruthy()
    expect(api.getVentasProductos).toHaveBeenCalledWith('nosara', '2026-10-01', '2026-10-31')
  })
})
