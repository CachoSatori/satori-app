// @vitest-environment happy-dom
//
// Historial de propinas (08-nov): las filas muestran lo GUARDADO (payout_crc, lo que se pagó) y, si la
// vista no tiene a alguien (cajero/contador no leen empleados inactivos), se avisa y no se deja editar.
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Employee, RoleTipPoints, TipSession } from '../../shared/types/database'

const H = vi.hoisted(() => ({
  entries: [
    { id: 'e1', session_id: 's1', employee_id: 'a', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, points: 8, payout_crc: 25000, covered_role: null },
    { id: 'e2', session_id: 's1', employee_id: 'b', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, points: 8, payout_crc: 20000, covered_role: null },
    { id: 'e3', session_id: 's1', employee_id: 'c', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, points: 8, payout_crc: 15000, covered_role: null },
  ],
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async () => H.entries),
  upsertTipEntry: vi.fn(), deleteTipEntry: vi.fn(), updateSessionPools: vi.fn(), savePayouts: vi.fn(),
  totalElectronicoCrc: vi.fn(() => 0),
}))
vi.mock('../../shared/api/cash', () => ({ reconcilePropinaEgreso: vi.fn() }))

import TipHistory from './TipHistory'

const ses: TipSession = {
  id: 's1', session_date: '2026-08-20', shift_type: 'PM', opened_by: 'u', closed_by: 'u', status: 'closed',
  exchange_rate: 510, pool_efectivo_crc: 60000, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0,
  pool_total_crc: 60000, notes: null, created_at: '', updated_at: '',
} as TipSession
const emp = (id: string): Employee => ({ id, full_name: `EMPLEADO ${id.toUpperCase()}`, role: 'salonero', is_active: true } as Employee)
const PUNTOS: RoleTipPoints[] = [{ role: 'salonero', points: 1 } as RoleTipPoints]
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const montos = (texto: string) => (texto.match(/₡\s?[\d\s.,]+/g) ?? []).map(m => m.replace(/\D/g, ''))

describe('TipHistory · lo guardado manda', () => {
  it('vista completa (owner): cada fila muestra lo pagado, no lo recalculado', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await flush()
    const filas = [...document.querySelectorAll('.hist-emp-take')].map(n => n.textContent!.replace(/\D/g, ''))
    expect(filas.sort()).toEqual(['15000', '20000', '25000'])   // recalculado serían 3 × 20000
    expect(screen.queryByTestId('hist-faltan')).toBeNull()
  })

  it('vista sin una persona inactiva (cajero/contador): avisa cuántos y cuánto, y muestra lo pagado al resto', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b')]} rolePoints={PUNTOS} />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await flush()
    const filas = [...document.querySelectorAll('.hist-emp-take')].map(n => n.textContent!.replace(/\D/g, ''))
    expect(filas.sort()).toEqual(['20000', '25000'])
    const aviso = screen.getByTestId('hist-faltan').textContent!
    expect(aviso).toMatch(/1 persona que hoy está inactiva no aparece/)
    expect(montos(aviso)).toContain('15000')
    expect(document.querySelector('.hist-pool-row')!.textContent).not.toMatch(/₡\/pto/)   // tasa recalculada oculta
  })
})
