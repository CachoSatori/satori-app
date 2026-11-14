// @vitest-environment happy-dom
// Mig 169 · Retos de temporada baja. Promociones: el owner arma/termina/edita borradores; el manager solo ve; validación de
// pantalla (sin pasado, un mismo año, ≤ 92 días). Caja: el premio del reto ofrecido se ve en «Qué aplicar» con «una sola vez».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { QueAplicar, Reto, RetoDatos } from '../../shared/api/club'
import Retos from './Retos'
import { problemaReto, resumenFranja } from './retosReglas'

const rol = vi.hoisted(() => ({ v: 'owner' }))
const api = vi.hoisted(() => ({
  getRetos: vi.fn(), guardarReto: vi.fn(), armarReto: vi.fn(), terminarReto: vi.fn(), borrarReto: vi.fn(),
  getCortesiasDe: vi.fn(), getLocalesClub: vi.fn(), setRetosExigeFactura: vi.fn(),
  resolverQR: vi.fn(), getPedidosAbiertos: vi.fn(), getFacturasRecientes: vi.fn(), registrarVisitaSocio: vi.fn(), conPremioDeReto: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'

const reto: Reto = {
  id: 'r1', nombre: '3 almuerzos ficticios', nombre_en: '3 fictitious lunches', locales: ['loc-a'], estado: 'borrador',
  desde: '2026-12-01', hasta: '2026-12-31', dias: [1, 2, 3, 4, 5], hora_desde: '11:30', hora_hasta: '15:00', meta: 3,
  vence_dias: 30, control_pct: 15, armado: false, en_curso: false,
  cortesias: { 'loc-a': { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true } }, ganados: 0, usados: 0, disponibles: 0,
}
const datos: RetoDatos = {
  nombre: 'Reto', nombre_en: 'Challenge', locales: ['loc-a'], desde: '2026-12-01', hasta: '2026-12-31', dias: [1], hora_desde: null,
  hora_hasta: null, meta: 3, vence_dias: 30, control_pct: 0, cortesias: {},
}

describe('Promociones · retos (mig 169)', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset()
    api.getLocalesClub.mockResolvedValue([{ id: 'loc-a', nombre: 'Local Ficticio A', activo: true }])
    api.getCortesiasDe.mockResolvedValue([])
    window.confirm = vi.fn(() => true)
  })

  it('owner: borrador con Editar/Armar/Borrar; armar pide confirmación y llama a la base', async () => {
    rol.v = 'owner'
    api.getRetos.mockResolvedValue({ exige_factura: true, retos: [reto] })
    api.armarReto.mockResolvedValue({ exige_factura: true, retos: [{ ...reto, estado: 'vigente', armado: true }] })
    render(<Retos owner />)
    expect(await screen.findByText('3 almuerzos ficticios')).toBeTruthy()
    expect(screen.getByText(/15 % sin reto/)).toBeTruthy()
    expect(screen.getByText(/Lu Ma Mi Ju Vi · 11:30–15:00/)).toBeTruthy()
    fireEvent.click(screen.getByText('Armar'))
    await waitFor(() => expect(api.armarReto).toHaveBeenCalledWith('r1'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('máximo de 3 por año'))
    expect(await screen.findByText('«3 almuerzos ficticios» armado.')).toBeTruthy()
    expect(screen.getByText('Terminar')).toBeTruthy()
    expect(screen.queryByText('Editar')).toBeNull()
  })

  it('armado sin cortesía activa en un local: avisa que ahí la caja no lo ofrece', async () => {
    api.getRetos.mockResolvedValue({ exige_factura: true, retos: [{ ...reto, estado: 'vigente', armado: true,
      cortesias: { 'loc-a': { ...reto.cortesias['loc-a'], activa: false } } }] })
    render(<Retos owner />)
    expect(await screen.findByText(/ahí la caja NO ofrece el premio/)).toBeTruthy()
  })

  it('exigencia de factura: se ve la regla; el owner la apaga con confirmación', async () => {
    api.getRetos.mockResolvedValue({ exige_factura: true, retos: [] })
    api.setRetosExigeFactura.mockResolvedValue(undefined)
    render(<Retos owner />)
    expect(await screen.findByText(/Exige factura: los días anteriores cuentan solo si/)).toBeTruthy()
    fireEvent.click(screen.getByText('Dejar de exigir'))
    await waitFor(() => expect(api.setRetosExigeFactura).toHaveBeenCalledWith(false))
  })

  it('manager: ve la lista sin botones', async () => {
    api.getRetos.mockResolvedValue({ exige_factura: true, retos: [reto] })
    render(<Retos owner={false} />)
    expect(await screen.findByText('3 almuerzos ficticios')).toBeTruthy()
    expect(screen.queryByText('Armar')).toBeNull()
    expect(screen.queryByText('+ Nuevo reto')).toBeNull()
    expect(screen.queryByText('Dejar de exigir')).toBeNull()
  })

  it('error de la base (4.º del año) se muestra tal cual', async () => {
    api.getRetos.mockResolvedValue({ exige_factura: true, retos: [reto] })
    api.armarReto.mockRejectedValue(new Error('Ya hay 3 retos armados en 2026: es el máximo por año'))
    render(<Retos owner />)
    fireEvent.click(await screen.findByText('Armar'))
    expect(await screen.findByText(/Ya hay 3 retos armados en 2026/)).toBeTruthy()
  })

  it('validación de pantalla: pasado, otro año, más de 92 días, franja a medias, meta', () => {
    const hoy = '2026-11-14'
    expect(problemaReto(datos, hoy)).toBeNull()
    expect(problemaReto({ ...datos, desde: '2026-11-13' }, hoy)).toMatch(/pasado/)
    expect(problemaReto({ ...datos, hasta: '2027-01-05' }, hoy)).toMatch(/mismo año/)
    expect(problemaReto({ ...datos, desde: '2026-02-01', hasta: '2026-06-01' }, '2026-01-01')).toMatch(/92 días/)
    expect(problemaReto({ ...datos, hora_desde: '11:00' }, hoy)).toMatch(/dos horas/)
    expect(problemaReto({ ...datos, meta: 1 }, hoy)).toMatch(/meta/)
    expect(problemaReto({ ...datos, nombre_en: '' }, hoy)).toMatch(/inglés/)
    expect(resumenFranja({ dias: [1, 2, 3, 4, 5, 6, 7], hora_desde: null, hora_hasta: null })).toBe('todos los días · todo el día')
  })
})

describe('Caja · premio del reto (mig 169)', () => {
  const base: QueAplicar = {
    visita_id: 'v1', socio: 'Socio Ficticio', estado: 'aplica', porcentaje: 10, cortesias: [],
    texto: '10 % LC', avisos: [], articulo_lc: '856', repetida: false, promo: 'Local Club',
  }
  async function visita(res: QueAplicar) {
    rol.v = 'cajero'
    for (const f of Object.values(api)) f.mockReset()
    api.getFacturasRecientes.mockResolvedValue([])
    api.resolverQR.mockResolvedValue({ tipo: 'socio', datos: { id: 'm1', nombre: 'Socio Ficticio', persona_estado: 'activo', estado: 'activo',
      desde: '2026-11-01T12:00:00Z', alta_por: 'caja', provisional_hasta: null, es_anfitrion: false } })
    api.getPedidosAbiertos.mockResolvedValue([{ pedido: '12', clave: 'pedido:20261114:12', mesa: '5', salonero: 'Salonero Ficticio', total_crc: 1000, pax: 2, actualizado: '2026-11-14T18:00:00Z' }])
    api.registrarVisitaSocio.mockResolvedValue(base)
    api.conPremioDeReto.mockResolvedValue(res)
    render(<Escanear />)
    fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: 'ABCDEFGHJ' } })
    fireEvent.click(screen.getByText('Ver'))
    fireEvent.click(await screen.findByText(/Salonero Ficticio/))
    fireEvent.click(screen.getByText('Registrar visita y ver qué aplicar'))
    await screen.findByText('Qué aplicar', { exact: false })
  }

  it('después de registrar, la caja pasa por el paso del reto y muestra el premio «una sola vez»', async () => {
    await visita({ ...base, texto: '10 % LC + 1 cortesía de premio del reto: Postre Ficticio',
      cortesias: [{ id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', motivo: 'reto' }],
      reto: { estado: 'ofrecida', nombre: '3 almuerzos ficticios', cortesia: 'Postre Ficticio', codigo: 'P1' } } as QueAplicar)
    expect(api.conPremioDeReto).toHaveBeenCalledWith(base)
    expect(screen.getByText(/Premio del reto «3 almuerzos ficticios»: Postre Ficticio · una sola vez/)).toBeTruthy()
  })

  it('sin premio: nada extra', async () => {
    await visita(base)
    expect(screen.queryByText(/Premio del reto/)).toBeNull()
  })
})
