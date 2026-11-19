// @vitest-environment happy-dom
//
// «→ Caja» (Ventas → Hoy) escribe un `ingreso` en el turno ABIERTO. Antes, para un día anterior al corte del pozo,
// mandaba la venta de ESE día viejo a la caja de HOY. Ahora solo escribe la venta de la jornada en curso (hora CR),
// antes del corte y con el turno abierto del mismo día. Datos ficticios. Relojes de noche en CR (R10).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u-owner', role: 'owner' } }) }))
const cash = vi.hoisted(() => ({
  sesion: { id: 'ses-1', shift_type: 'Día', session_date: '2026-11-18' },
  getOpenCashSession: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  createCashMovement:  vi.fn<(m: Record<string, unknown>) => Promise<undefined>>(async () => undefined),
}))
vi.mock('../../shared/api/cash', () => cash)

import VentasHoy from './VentasHoy'
import { armarDia } from './ventasEnVivoDatos'
import { bloqueoACaja, bloqueoPorTurno, AVISO_A_CAJA } from './aCaja'
import { POZO_CORTE } from '../cash/cierrePozo'
import type { TicketNdfConId } from '../../shared/api/posNdf'
import type { Meta } from '../../shared/types/ventas'

const ticket = (fecha: string, over: Partial<TicketNdfConId>): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', estado: 'C', fecha_registra: `${fecha}T19:42:07-06:00`,
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 0,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})
const diaDe = (fecha: string) => armarDia(fecha, [
  ticket(fecha, { id: 'a', numero_factura: '1', salonero_login: '026', valor_servido_crc: 5000 }),
], [], fecha, { '026': 'MESERO_A' }).dia
const METAS: Meta = {
  restaurante: {}, margen: {},
  global: { promPax: 15_000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7_500, ventas: 800_000 },
  salMetas: {},
}
const plano = (s: string) => s.replace(/\s/g, ' ')
const texto = () => plano(document.body.textContent ?? '')
/** 23:30 en CR del día `fecha` (= 05:30 UTC del día siguiente). */
const nocheCR = (fecha: string) => {
  const d = new Date(`${fecha}T05:30:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d
}
const boton = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '→ Caja') as HTMLButtonElement

function pantalla(fecha: string, hoy: string, sesionDate: string = hoy) {
  vi.setSystemTime(nocheCR(hoy))
  cash.getOpenCashSession.mockImplementation(async () => ({ ...cash.sesion, session_date: sesionDate }))
  render(<VentasHoy dias={{ [fecha]: diaDe(fecha) }} pm={{}} metas={METAS} />)
}

describe('aCaja · reglas puras', () => {
  it('solo la jornada en curso y antes del corte', () => {
    expect(bloqueoACaja('2026-07-01', '2026-07-01', '2026-07-22')).toBeNull()
    expect(bloqueoACaja('2026-06-30', '2026-07-01', '2026-07-22')).toBe('otro_dia')
    expect(bloqueoACaja('2026-07-02', '2026-07-01', '2026-07-22')).toBe('otro_dia')
    expect(bloqueoACaja('2026-07-22', '2026-07-22', '2026-07-22')).toBe('pozo')
    expect(bloqueoACaja('2026-11-18', '2026-11-18', '2026-07-22')).toBe('pozo')
    expect(bloqueoACaja('', '2026-07-01', '2026-07-22')).toBe('otro_dia')
  })
  it('el turno abierto tiene que ser del mismo día', () => {
    expect(bloqueoPorTurno('2026-07-01', '2026-07-01')).toBeNull()
    expect(bloqueoPorTurno('2026-07-01', '2026-06-30')).toBe('turno_de_otro_dia')
    expect(bloqueoPorTurno('2026-07-01', undefined)).toBe('turno_de_otro_dia')
  })
  it('con el corte real, HOY (o cualquier día desde el corte) nunca puede escribir', () => {
    expect(POZO_CORTE <= '2026-11-18').toBe(true)
    expect(bloqueoACaja('2026-11-18', '2026-11-18')).toBe('pozo')
  })
})

describe('VentasHoy · «→ Caja» solo para la jornada en curso', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    cash.createCashMovement.mockClear(); cash.getOpenCashSession.mockClear()
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('día VIEJO (antes del corte) con el turno de hoy abierto → bloqueado, no escribe', async () => {
    pantalla('2026-07-01', '2026-11-18')
    expect(boton().disabled).toBe(true)
    expect(texto()).toContain(plano(AVISO_A_CAJA.otro_dia))
    fireEvent.click(boton())
    await Promise.resolve()
    expect(cash.getOpenCashSession).not.toHaveBeenCalled()
    expect(cash.createCashMovement).not.toHaveBeenCalled()
  })

  it('día viejo aunque el reloj esté antes del corte (otro día) → bloqueado', () => {
    pantalla('2026-06-30', '2026-07-01')
    expect(boton().disabled).toBe(true)
    expect(texto()).toContain(plano(AVISO_A_CAJA.otro_dia))
  })

  it('HOY, desde el corte → bloqueado con el aviso del pozo (comportamiento de antes)', async () => {
    pantalla('2026-11-18', '2026-11-18')
    expect(boton().disabled).toBe(true)
    expect(texto()).toContain(plano(AVISO_A_CAJA.pozo))
    fireEvent.click(boton())
    await Promise.resolve()
    expect(cash.createCashMovement).not.toHaveBeenCalled()
  })

  it('día pasado desde el corte → aviso del pozo', () => {
    pantalla('2026-08-01', '2026-11-18')
    expect(boton().disabled).toBe(true)
    expect(texto()).toContain(plano(AVISO_A_CAJA.pozo))
  })

  it('jornada en curso antes del corte, pero el turno abierto es de otro día → no escribe', async () => {
    pantalla('2026-07-01', '2026-07-01', '2026-06-30')
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(texto()).toContain(plano(AVISO_A_CAJA.turno_de_otro_dia)))
    expect(cash.createCashMovement).not.toHaveBeenCalled()
  })

  it('control positivo: jornada en curso, antes del corte y turno del mismo día → escribe una vez', async () => {
    pantalla('2026-07-01', '2026-07-01')
    expect(boton().disabled).toBe(false)
    expect(document.querySelector('[data-testid="acaja-aviso"]')).toBeNull()
    fireEvent.click(boton())
    await waitFor(() => expect(cash.createCashMovement).toHaveBeenCalledTimes(1))
    expect(cash.createCashMovement.mock.calls[0][0]).toMatchObject({
      session_id: 'ses-1', movement_type: 'ingreso', amount_crc: 5000, description: 'Ventas del día 2026-07-01',
    })
  })
})
