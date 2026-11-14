// @vitest-environment happy-dom
// Mig 168 · Primeros 90 días. Caja: la visita del socio muestra la cortesía especial de bienvenida aparte (artículo y
// «una sola vez») solo si la base la ofrece; guardada o sin configurar → aviso de NO ofrecerla. Promociones: el owner la
// enciende con la cortesía del local (no se puede encender sin elegir); el manager solo la ve.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { QueAplicar, Primeros90Config } from '../../shared/api/club'
import { AvisoPrimeros90, ConfigPrimeros90, MSG_P90_GUARDADA, MSG_P90_SIN_CONFIGURAR } from './Primeros90'

const rol = vi.hoisted(() => ({ v: 'cajero' }))
const api = vi.hoisted(() => ({
  resolverQR: vi.fn(), getPedidosAbiertos: vi.fn(), getFacturasRecientes: vi.fn(), registrarVisitaSocio: vi.fn(),
  getPrimeros90Config: vi.fn(), guardarPrimeros90Config: vi.fn(), getCortesias: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'

const base: QueAplicar = {
  visita_id: 'v1', socio: 'Socio Ficticio', estado: 'aplica', porcentaje: 10,
  cortesias: [{ id: 'k1', codigo: 'P1', nombre: 'Bebida Ficticia', motivo: 'promo' }],
  texto: '10 % LC + 1 cortesía: Bebida Ficticia', avisos: [], articulo_lc: '856', repetida: false, promo: 'Local Club',
}

async function visitaDeSocio(res: QueAplicar) {
  api.resolverQR.mockResolvedValue({ tipo: 'socio', datos: { id: 'm1', nombre: 'Socio Ficticio', persona_estado: 'activo', estado: 'activo',
    desde: '2026-11-01T12:00:00Z', alta_por: 'caja', provisional_hasta: null, es_anfitrion: false } })
  api.getPedidosAbiertos.mockResolvedValue([{ pedido: '12', clave: 'pedido:20261114:12', mesa: '5', salonero: 'Salonero Ficticio', total_crc: 1000, pax: 2, actualizado: '2026-11-14T18:00:00Z' }])
  api.registrarVisitaSocio.mockResolvedValue(res)
  render(<Escanear />)
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: 'ABCDEFGHJ' } })
  fireEvent.click(screen.getByText('Ver'))
  fireEvent.click(await screen.findByText(/Salonero Ficticio/))
  fireEvent.click(screen.getByText('Registrar visita y ver qué aplicar'))
  await screen.findByText('Qué aplicar', { exact: false })
}

describe('Caja · cortesía especial de bienvenida (mig 168)', () => {
  beforeEach(() => {
    rol.v = 'cajero'
    for (const f of Object.values(api)) f.mockReset()
    api.getFacturasRecientes.mockResolvedValue([])
  })

  it('ofrecida: recuadro aparte con el artículo y «una sola vez»', async () => {
    await visitaDeSocio({ ...base, texto: base.texto + ' + 1 cortesía especial de bienvenida: Postre Ficticio',
      cortesias: [...base.cortesias, { id: 'k2', codigo: 'P9', nombre: 'Postre Ficticio', motivo: 'primeros_90' }],
      primeros90: { estado: 'ofrecida', nombre: 'Postre Ficticio', codigo: 'P9' } })
    expect(screen.getByText(/Cortesía especial de bienvenida · una sola vez/)).toBeTruthy()
    expect(screen.getByText('Postre Ficticio')).toBeTruthy()
    expect(screen.getByText('P9')).toBeTruthy()
  })

  it('sin primeros90 (base sin la 168 o nada que decir): nada extra', async () => {
    await visitaDeSocio(base)
    expect(screen.queryByText(/bienvenida/)).toBeNull()
  })

  it('guardada y sin configurar: aviso de NO ofrecerla, sin recuadro', () => {
    const { rerender } = render(<AvisoPrimeros90 p={{ estado: 'guardada' }} />)
    expect(screen.getByText(MSG_P90_GUARDADA)).toBeTruthy()
    rerender(<AvisoPrimeros90 p={{ estado: 'sin_configurar' }} />)
    expect(screen.getByText(MSG_P90_SIN_CONFIGURAR)).toBeTruthy()
    expect(screen.queryByText(/una sola vez/)).toBeNull()
  })
})

const cfg = (x: Partial<Primeros90Config> = {}): Primeros90Config => ({
  activo: false, visitas: 4, dias: 90, vence_dias: 60, exige_factura: true, cortesia: null, lista_para_caja: false, disponibles: 0, usadas: 0, ...x,
})
const cortesias = [
  { id: 'k1', codigo_producto: 'P1', nombre: 'Postre Ficticio', familia: null, activa: true, en_seccion: true, visto_en_facturas: true, actualizada_en: '' },
  { id: 'k2', codigo_producto: 'P2', nombre: 'Bebida Apagada', familia: null, activa: false, en_seccion: true, visto_en_facturas: true, actualizada_en: '' },
]

describe('Promociones · config de la cortesía especial (mig 168)', () => {
  beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.getCortesias.mockResolvedValue(cortesias) })

  it('owner: apagada por defecto; «Encender» pide elegir la cortesía; solo ofrece las activas; guarda con la elegida', async () => {
    api.getPrimeros90Config.mockResolvedValue(cfg())
    api.guardarPrimeros90Config.mockResolvedValue(cfg({ activo: true, lista_para_caja: true,
      cortesia: { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true } }))
    render(<ConfigPrimeros90 owner />)
    expect(await screen.findByText('apagada')).toBeTruthy()
    expect(screen.getByText(/no hay una cortesía especial cargada y activa/)).toBeTruthy()
    expect(screen.getByText(/cuenta solo si su factura se cerró con el 856 o el 857/)).toBeTruthy()
    const encender = screen.getByText('Encender').closest('button') as HTMLButtonElement
    expect(encender.disabled).toBe(true)
    expect(screen.queryByText(/Bebida Apagada/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cortesía especial de este local'), { target: { value: 'k1' } })
    expect(encender.disabled).toBe(false)
    fireEvent.click(encender)
    await waitFor(() => expect(api.guardarPrimeros90Config).toHaveBeenCalledWith(true, 'k1'))
    expect(await screen.findByText('encendida')).toBeTruthy()
    expect(screen.queryByText(/no hay una cortesía especial cargada y activa/)).toBeNull()
  })

  it('manager: la ve, sin botones', async () => {
    api.getPrimeros90Config.mockResolvedValue(cfg({ activo: true, lista_para_caja: true, usadas: 2,
      cortesia: { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true } }))
    render(<ConfigPrimeros90 owner={false} />)
    expect(await screen.findByText('encendida')).toBeTruthy()
    expect(screen.getByText(/Usadas: 2/)).toBeTruthy()
    expect(screen.queryByText('Apagar')).toBeNull()
    expect(screen.queryByLabelText('Cortesía especial de este local')).toBeNull()
  })
})
