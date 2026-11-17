// @vitest-environment happy-dom
// Mig 181 · tope del socio por comida (firma del dueño 16-nov, opción B): una visita con beneficio en el almuerzo y una en
// la cena, en cualquier Satori. La base decide; la caja muestra en ROJO qué comida ya usó y desde cuándo lo vuelve a tener,
// sin el 856 ni la cortesía. Textos con datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { QueAplicar } from '../../shared/api/club'

const api = vi.hoisted(() => ({
  resolverQR: vi.fn(), getPedidosAbiertos: vi.fn(), getFacturasRecientes: vi.fn(), buscarFacturas: vi.fn(), registrarVisitaSocio: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'

const REGLA = 'Una visita con beneficio en el almuerzo y una en la cena, en cualquier Satori. Si viene con otro socio, puede ir como su invitado (857).'
const yaUso = (comida: 'almuerzo' | 'cena'): QueAplicar => ({
  visita_id: null, socio: 'Socio Ficticio', estado: 'ya_uso_hoy', porcentaje: 0, cortesias: [],
  texto: comida === 'almuerzo' ? 'Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio' : 'Ya usó su beneficio de la cena hoy: NO aplicar beneficio',
  avisos: [comida === 'almuerzo' ? 'Vuelve a tenerlo en la cena, desde las 16:00.' : 'Vuelve a tenerlo mañana en el almuerzo.', REGLA],
  articulo_lc: '856', repetida: false, promo: null, comida,
  vuelve: comida === 'almuerzo' ? 'Vuelve a tenerlo en la cena, desde las 16:00.' : 'Vuelve a tenerlo mañana en el almuerzo.',
})

async function visitaDeSocio(res: QueAplicar) {
  api.resolverQR.mockResolvedValue({ tipo: 'socio', datos: { id: 'm1', nombre: 'Socio Ficticio', persona_estado: 'activo', estado: 'activo',
    desde: '2026-11-01T12:00:00Z', alta_por: 'caja', provisional_hasta: null, es_anfitrion: false } })
  api.getPedidosAbiertos.mockResolvedValue([{ pedido: '12', clave: 'pedido:20261201:12', mesa: '5', salonero: 'Salonero Ficticio', total_crc: 1000, pax: 2, actualizado: '2026-12-01T18:00:00Z' }])
  api.registrarVisitaSocio.mockResolvedValue(res)
  const r = render(<Escanear />)
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: 'ABCDEFGHJ' } })
  fireEvent.click(screen.getByText('Ver'))
  fireEvent.click(await screen.findByText(/Salonero Ficticio/))
  fireEvent.click(screen.getByText('Registrar visita y ver qué aplicar'))
  await screen.findByText('Qué aplicar', { exact: false })
  return r
}

/** El recuadro del resultado (el que tiene el borde rojo o verde). */
function recuadro(): string {
  let el: HTMLElement | null = screen.getByText('Qué aplicar', { exact: false })
  while (el && !/border:\s*2px solid/.test(el.getAttribute('style') ?? '')) el = el.parentElement
  if (!el) throw new Error('sin recuadro')
  return el.getAttribute('style') ?? ''
}

describe('Caja · tope del socio por comida (mig 181)', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset()
    api.getFacturasRecientes.mockResolvedValue([])
    api.buscarFacturas.mockResolvedValue([])
  })

  it('ya usó el almuerzo: rojo, dice qué comida y desde qué hora vuelve; sin 856 ni cortesía', async () => {
    await visitaDeSocio(yaUso('almuerzo'))
    expect(screen.getByText('Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio')).toBeTruthy()
    expect(screen.getByText('Vuelve a tenerlo en la cena, desde las 16:00.')).toBeTruthy()
    expect(screen.getByText(REGLA)).toBeTruthy()
    expect(recuadro()).toMatch(/--t-red/)
    expect(screen.queryByText(/Marcá el artículo 856/)).toBeNull()
  })

  it('ya usó la cena: rojo y «Vuelve a tenerlo mañana en el almuerzo.»', async () => {
    await visitaDeSocio(yaUso('cena'))
    expect(screen.getByText('Ya usó su beneficio de la cena hoy: NO aplicar beneficio')).toBeTruthy()
    expect(screen.getByText('Vuelve a tenerlo mañana en el almuerzo.')).toBeTruthy()
  })

  it('ya_uso_hoy va en el mismo rojo que «como invitado» (no en el verde de «aplica»)', async () => {
    const { unmount } = await visitaDeSocio(yaUso('almuerzo'))
    expect(recuadro()).toMatch(/--t-red/)
    unmount()
    await visitaDeSocio({ ...yaUso('almuerzo'), visita_id: 'v1', estado: 'aplica', texto: '10 % LC', avisos: [] })
    expect(recuadro()).toMatch(/--t-teal/)
  })
})
