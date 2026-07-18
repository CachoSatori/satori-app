// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'

// TipStats dispara getAttendanceHistory en un effect (para la vista por-empleado);
// en la vista general no hace falta → lo mockeamos vacío. getTipEntriesBySession no
// se llama porque el calcCache ya trae la sesión del mes.
vi.mock('../../shared/api/tips', () => ({
  getAttendanceHistory: vi.fn(async () => []),
  getTipEntriesBySession: vi.fn(async () => []),
}))

import TipStats from './TipStats'

const employees = [
  { id: 'e1', full_name: 'Ana',  role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Beto', role: 'cocina',   is_active: true },  // COCINA
  { id: 'e3', full_name: 'Caro', role: 'barman',   is_active: true },
] as unknown as Employee[]

const session = {
  id: 's1', session_date: '2026-07-05', status: 'closed', shift_type: 'PM', exchange_rate: 520,
  pool_efectivo_crc: 0, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0,
} as unknown as TipSession

// take-home: salonero 100k · cocina 50k · barman 30k → total 180k
const calc = {
  totalPool: 180000, generalPool: 180000, barraPool: 0, totalPoints: 100, generalRate: 1,
  rows: [
    { employeeId: 'e1', employeeName: 'Ana',  role: 'salonero', coveredRole: null, hours: 8, propina_crc: 0, propina_usd: 0, pts_rol: 10, pts_val: 0, payout_crc: 100000 },
    { employeeId: 'e2', employeeName: 'Beto', role: 'cocina',   coveredRole: null, hours: 8, propina_crc: 0, propina_usd: 0, pts_rol: 5,  pts_val: 0, payout_crc: 50000 },
    { employeeId: 'e3', employeeName: 'Caro', role: 'barman',   coveredRole: null, hours: 8, propina_crc: 0, propina_usd: 0, pts_rol: 5,  pts_val: 0, payout_crc: 30000 },
  ],
} as unknown as HistoryCalc

const rolePoints = [
  { role: 'salonero', points: 10 }, { role: 'cocina', points: 5 }, { role: 'barman', points: 5 },
] as unknown as RoleTipPoints[]

function renderStats() {
  return render(<TipStats sessions={[session]} calcCache={{ s1: calc }} employees={employees} rolePoints={rolePoints} />)
}

describe('TipStats · Distribución por puesto (vista general)', () => {
  it('muestra la sección con una barra por rol', () => {
    const { getByText } = renderStats()
    expect(getByText('Distribución por puesto')).toBeTruthy()
    expect(getByText('Salonero')).toBeTruthy()
    expect(getByText('Barman')).toBeTruthy()
  })

  it('COCINA aparece con su % real (~27.8%)', () => {
    const { getByText } = renderStats()
    expect(getByText('Cocina')).toBeTruthy()             // ROLE_LABELS['cocina']
    expect(getByText('27.8%')).toBeTruthy()              // 50000/180000
    expect(getByText('55.6%')).toBeTruthy()              // salonero 100000/180000
    expect(getByText('16.7%')).toBeTruthy()              // barman 30000/180000
  })
})
