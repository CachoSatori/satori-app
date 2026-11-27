// @vitest-environment happy-dom
//
// Ventas v2 · 3.2b — «Resumen» → «Salón en detalle» → «Bebidas por persona» desde el catálogo por código
// (`pos_ventas_productos`, mig 198): bebidas VENDIDAS de salón × rinde ÷ personas de salón de la venta por persona.
// Estados: leyendo, listo, error (el resto del desplegable sigue). La cifra de antes queda al lado. Datos ficticios;
// reloj de noche en CR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
const api = vi.hoisted(() => ({ getVentasProductos: vi.fn() }))
vi.mock('../../shared/api/posNdf', async orig => ({ ...(await orig<typeof import('../../shared/api/posNdf')>()), getVentasProductos: api.getVentasProductos }))

import { parsearVentasProductos } from '../../shared/api/posNdf'
import { datos } from './resumenV2.fixture'
import { armarDiasMap } from './ventasDiasDesdePos'
const fx = datos('2026-10-01', 31)
vi.mock('./lineasPeriodo', async orig => ({
  ...(await orig<typeof import('./lineasPeriodo')>()),
  cargarLineasPeriodo: vi.fn(async (_l: string, r: { desde: string; hasta: string }) =>
    ({ dias: armarDiasMap(fx.tickets, fx.lineas, r, { uploadedAt: 'x', avisar: () => {} }).dias, pm: {} })),
}))

import SalonEnDetalle from './SalonEnDetalle'
import { cargarLineasPeriodo } from './lineasPeriodo'

const RPC = parsearVentasProductos({
  productos: [
    ['30', 'CERVEZA', 5, 'salon', 50, 100_000_00, 30, 'bebida', 0],
    ['31', 'BOTELLA', 5, 'salon', 5, 50_000_00, 5, 'bebida', 0],
    ['700', 'COPA MENU', 11, 'salon', 6, 0, 3, 'bebida', 6],
    ['32', 'SODA', 5, 'delivery', 20, 20_000_00, 20, 'bebida', 0],
  ],
  meses: [], catalogo: [['31', 'BOTELLA', 5, 2, '2026-01-01', '2026-10-31', 'bebida']], familias: [],
  sin_lineas: { facturas: 0, cts: 0 }, neta_cts: 170_000_00,
})
const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31' }
const abrir = (personas: { total: number; pctEstimado: number } | null) =>
  render(<SalonEnDetalle local="santa-teresa" nombreLocal="Local A" periodo={PERIODO} rotulo="Octubre" abierto personas={personas} />)

let copiado = ''
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  api.getVentasProductos.mockReset()
  api.getVentasProductos.mockResolvedValue(RPC)
  copiado = ''
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { copiado = t } }, configurable: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('«Salón en detalle» · bebidas por persona (3.2b)', () => {
  it('vendidas de salón × rinde ÷ personas de salón; las incluidas en ₡0 y el delivery, afuera; la de antes al lado', async () => {
    abrir({ total: 40, pctEstimado: 12.5 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe('1,50'))   // (50 + 5×2) ÷ 40
    const sub = screen.getByTestId('beb-pax-sub').textContent!
    expect(sub).toContain('60 vendidas en salón')
    expect(sub).toContain('incluye 12,5 % estimado')
    expect(sub).toContain('+ 6 incluidas en menú')
    expect(screen.getByTestId('beb-pax-antes').textContent).toMatch(/^antes: \d+,\d\d/)
    expect(api.getVentasProductos).toHaveBeenCalledWith('santa-teresa', '2026-10-01', '2026-10-31')
  })

  it('el 📤 manda la cifra nueva', async () => {
    abrir({ total: 40, pctEstimado: 0 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe('1,50'))
    fireEvent.click(screen.getByRole('button', { name: 'Compartir el resumen' }))
    await waitFor(() => expect(copiado).toContain('🍺 Beb/PAX: 1.50'))
  })

  it('sin personas: «—», nunca 0', async () => {
    abrir({ total: 0, pctEstimado: 0 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-sub').textContent).toContain('vendidas en salón'))
    expect(screen.getByTestId('beb-pax-valor').textContent).toBe('—')
  })

  it('si el catálogo no se puede leer: «—» y el aviso en la tarjeta; el resto del desplegable sigue', async () => {
    api.getVentasProductos.mockRejectedValue(new Error('No autorizado para este local'))
    abrir({ total: 40, pctEstimado: 0 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-sub').textContent).toContain('no se pudo leer el catálogo del PoS'))
    expect(screen.getByTestId('beb-pax-valor').textContent).toBe('—')
    expect(document.querySelector('[data-salon="promPlato"]')).toBeTruthy()
  })

  it('mientras lee dice «…» y el 📤 espera (no manda la cifra de antes con el rótulo nuevo)', async () => {
    api.getVentasProductos.mockImplementation(() => new Promise(() => {}))
    abrir({ total: 40, pctEstimado: 0 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe('…'))
    expect((screen.getByRole('button', { name: 'Compartir el resumen' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('error del catálogo: el 📤 queda deshabilitado y «Reintentar» vuelve a leer', async () => {
    api.getVentasProductos.mockRejectedValueOnce(new Error('caída'))
    abrir({ total: 40, pctEstimado: 0 })
    await waitFor(() => expect(screen.getByTestId('beb-pax-sub').textContent).toContain('no se pudo leer el catálogo del PoS'))
    expect((screen.getByRole('button', { name: 'Compartir el resumen' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe('1,50'))
    expect(api.getVentasProductos).toHaveBeenCalledTimes(2)
    expect((screen.getByRole('button', { name: 'Compartir el resumen' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('error de las líneas: «Reintentar» vuelve a leerlas', async () => {
    vi.mocked(cargarLineasPeriodo).mockRejectedValueOnce(new Error('sin red'))
    abrir({ total: 40, pctEstimado: 0 })
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('sin red')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByTestId('beb-pax-valor').textContent).toBe('1,50'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
