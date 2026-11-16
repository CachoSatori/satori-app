// @vitest-environment happy-dom
// D7 A (firma del dueño, 14-nov; mig 157) · Caja: al escanear a alguien del EQUIPO no se ofrece canje (ni «Canje sin
// celular»): la ficha muestra las personas registradas del mes. Un referente sigue igual (control).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ResolverReferente } from '../../shared/api/club'
import { esCuentaSinCreditos, MSG_EQUIPO_SIN_CANJE } from './equipo'

const rol = vi.hoisted(() => ({ v: 'manager' }))
const api = vi.hoisted(() => ({ resolverQR: vi.fn(), getPedidosAbiertos: vi.fn(), getFacturasRecientes: vi.fn(), buscarFacturas: vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import Escanear from './Escanear'

const ficha = (extra: Partial<ResolverReferente['datos']>): ResolverReferente => ({
  tipo: 'referente',
  datos: {
    id: 'm1', nombre: 'Persona Prueba', tipo_miembro: 'referente', negocio: null, estado: 'activo',
    personas: 18, creditos: 3, personas_proximo: 3, personas_por_credito: 6, valor_credito_crc: 1000,
    canjeado_hoy: 0, canje_min: 1, canje_paso: 0.5, max_creditos_por_visita: 2, tarjeta_manual_activa: false,
    sin_creditos: false, personas_mes: 4, ...extra,
  },
})

async function escanear(codigo: string) {
  render(<Escanear />)
  fireEvent.change(screen.getByPlaceholderText('Cupón, canje, socio o pase'), { target: { value: codigo } })
  fireEvent.click(screen.getByText('Ver'))
  await screen.findByText('Persona Prueba')
}

describe('esCuentaSinCreditos', () => {
  it('la base lo dice, o (base vieja) el tipo es equipo', () => {
    expect(esCuentaSinCreditos({ sin_creditos: true, tipo_miembro: 'referente' })).toBe(true)
    expect(esCuentaSinCreditos({ tipo_miembro: 'equipo' })).toBe(true)
    expect(esCuentaSinCreditos({ sin_creditos: false, tipo_miembro: 'referente' })).toBe(false)
    expect(esCuentaSinCreditos({ tipo_miembro: 'concierge_pm' })).toBe(false)
  })
})

describe('Escanear · cuenta del equipo (D7 A)', () => {
  beforeEach(() => {
    rol.v = 'manager'
    api.resolverQR.mockReset()
    api.getPedidosAbiertos.mockReset().mockResolvedValue([])
    api.getFacturasRecientes.mockReset().mockResolvedValue([])
    api.buscarFacturas.mockReset().mockResolvedValue([])
  })

  it('equipo: personas del mes, sin créditos, sin «Canje sin celular» ni instrucciones de canje', async () => {
    api.resolverQR.mockResolvedValue(ficha({ tipo_miembro: 'equipo', sin_creditos: true, personas: 0, creditos: 0 }))
    await escanear('ABCDEFGH')
    expect(screen.getByText('personas registradas este mes')).toBeTruthy()
    expect(screen.getByText(MSG_EQUIPO_SIN_CANJE)).toBeTruthy()
    expect(screen.queryByText('Canje sin celular')).toBeNull()
    expect(screen.queryByText(/pedile al referente su/)).toBeNull()
    expect(screen.queryByText('Créditos a canjear')).toBeNull()
  })

  it('equipo con un código de canje viejo: error y «Escanear otro», sin botones de créditos', async () => {
    api.resolverQR.mockResolvedValue({
      tipo: 'canje',
      datos: { ...ficha({ tipo_miembro: 'equipo', sin_creditos: true }).datos, codigo_canje: 'ABCDEF', codigo_estado: 'vigente', codigo_vence_en: new Date(Date.now() + 600_000).toISOString() },
    })
    await escanear('ABCDEF')
    expect(screen.getByText(MSG_EQUIPO_SIN_CANJE)).toBeTruthy()
    expect(screen.getByText('Escanear otro')).toBeTruthy()
    expect(screen.queryByText('Créditos a canjear')).toBeNull()
  })

  it('referente (control): saldo en créditos y «Canje sin celular» para el manager', async () => {
    api.resolverQR.mockResolvedValue(ficha({}))
    await escanear('ABCDEFGH')
    expect(screen.getByText('Canje sin celular')).toBeTruthy()
    expect(screen.queryByText('personas registradas este mes')).toBeNull()
    expect(screen.queryByText(MSG_EQUIPO_SIN_CANJE)).toBeNull()
  })
})
