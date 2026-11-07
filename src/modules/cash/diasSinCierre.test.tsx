// @vitest-environment happy-dom
// Alerta de días sin cierre (06/11): solo lectura, reusa diasPendientesDeCierre (sin tocarlo).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'
import { calcularAlertaCierres, desdeVentanaVentas } from './diasSinCierre'
import AlertaDiasSinCierre from './AlertaDiasSinCierre'

const CORTE = '2026-07-22'
let seq = 0
const mov = (p: Partial<CashMovement>): CashMovement => ({
  id: `m${++seq}`, session_id: p.session_id ?? null, created_by: 'u1', movement_type: p.movement_type ?? 'egreso_operativo',
  amount_crc: p.amount_crc ?? 0, amount_usd: 0, currency: 'CRC', exchange_rate: 500, description: p.description ?? '',
  subcategory: '', supplier_id: null, supplier_name: null, employee_name: null, method: 'Efectivo', shift: '',
  caja_origen: p.caja_origen ?? 'Caja Proveedores', status: 'aprobado', approved_by: null, approved_at: null, account_id: null,
  created_at: p.created_at ?? '2026-09-26T18:00:00+00:00', updated_at: '2026-09-26T18:00:00+00:00',
} as CashMovement)
const ses = (id: string, session_date: string, status = 'closed', cajero_name = 'Ana'): CashSession =>
  ({ id, session_date, status, cajero_name }) as CashSession
const cierre = (session_date: string, tipo = 'completo'): CashCierreDia => ({ session_date, tipo }) as CashCierreDia

describe('calcularAlertaCierres', () => {
  const sessions = [ses('s1', '2026-09-26'), ses('s2', '2026-10-18', 'open', 'Luis'), ses('s3', '2026-11-06', 'open')]

  it('junta plata movida, ventas del PoS y Mediodía sin Noche; ignora pre-corte, hoy y días cerrados', () => {
    const a = calcularAlertaCierres({
      hoy: '2026-11-06', corte: CORTE, sessions,
      movements: [mov({ session_id: 's1', amount_crc: 33_000 })],
      cierres: [cierre('2026-10-01'), cierre('2026-10-27', 'parcial_mediodia'), cierre('2026-10-20')],
      jornadasConVentas: ['2026-07-10', '2026-09-26', '2026-10-01', '2026-10-05', '2026-10-20', '2026-11-06'],
    })
    expect(a.dias).toEqual([
      { fecha: '2026-09-26', motivos: ['movimientos', 'ventas'], movimientos: 1, crc: 33_000 },
      { fecha: '2026-10-05', motivos: ['ventas'], movimientos: 0, crc: 0 },
      { fecha: '2026-10-27', motivos: ['cierre_parcial'], movimientos: 0, crc: 0 },
    ])
  })

  it('turnos abiertos de días ANTERIORES (el de hoy no)', () => {
    const a = calcularAlertaCierres({ hoy: '2026-11-06', corte: CORTE, sessions, movements: [], cierres: [] })
    expect(a.turnos).toEqual([{ id: 's2', fecha: '2026-10-18', cajero: 'Luis' }])
  })

  it('todo al día → vacío', () => {
    const a = calcularAlertaCierres({ hoy: '2026-11-06', corte: CORTE, sessions: [ses('s1', '2026-09-26')],
      movements: [mov({ session_id: 's1', amount_crc: 1 })], cierres: [cierre('2026-09-26')], jornadasConVentas: ['2026-09-26'] })
    expect(a).toEqual({ dias: [], turnos: [] })
  })

  it('ventana de ventas: 60 días atrás, o el corte si es más nuevo', () => {
    expect(desdeVentanaVentas('2026-11-06', CORTE)).toBe('2026-09-07')
    expect(desdeVentanaVentas('2026-08-01', CORTE)).toBe(CORTE)
  })
})

describe('AlertaDiasSinCierre', () => {
  it('sin pendientes no muestra nada', () => {
    const { container } = render(<AlertaDiasSinCierre alerta={{ dias: [], turnos: [] }} onIrADia={vi.fn()} onIrATurno={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('lista los días y lleva a cada uno con un clic; turnos → Caja Diaria', () => {
    const onIrADia = vi.fn(), onIrATurno = vi.fn()
    render(<AlertaDiasSinCierre onIrADia={onIrADia} onIrATurno={onIrATurno} alerta={{
      dias: [{ fecha: '2026-09-26', motivos: ['movimientos', 'ventas'], movimientos: 3, crc: 45_000 }, { fecha: '2026-10-05', motivos: ['ventas'], movimientos: 0, crc: 0 }],
      turnos: [{ id: 's2', fecha: '2026-10-18', cajero: 'Luis' }],
    }} />)
    expect(screen.getByText(/Hay 2 días sin cierre completo/)).toBeTruthy()
    expect(screen.getByText(/plata movida · ventas en el PoS \(3 mov/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Ir al cierre del 2026-10-05'))
    expect(onIrADia).toHaveBeenCalledWith('2026-10-05')
    expect(screen.getByText(/18\/10\/2026 \(Luis\)/)).toBeTruthy()
    fireEvent.click(screen.getByText('Ir a Caja Diaria →'))
    expect(onIrATurno).toHaveBeenCalled()
  })

  it('más de 6 días: muestra los 6 más viejos y «Ver los N»', () => {
    const dias = Array.from({ length: 9 }, (_, i) => ({ fecha: `2026-10-0${i + 1}`, motivos: ['ventas' as const], movimientos: 0, crc: 0 }))
    render(<AlertaDiasSinCierre onIrADia={vi.fn()} onIrATurno={vi.fn()} alerta={{ dias, turnos: [] }} />)
    expect(document.querySelectorAll('li')).toHaveLength(6)
    expect(screen.queryByLabelText('Ir al cierre del 2026-10-09')).toBeNull()
    fireEvent.click(screen.getByText('Ver los 9'))
    expect(document.querySelectorAll('li')).toHaveLength(9)
  })
})
