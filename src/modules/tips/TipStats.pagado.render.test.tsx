// @vitest-environment happy-dom
// «Estadísticas» → «Recibió» = lo PAGADO (decisión del dueño, 20-nov-2026), y aviso si hubo pagos a personas que
// esta vista no puede leer. Datos ficticios.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'

const ENTRIES = [
  { id: 't1', employee_id: 'e1', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: 80, payout_crc: 25000 },
  { id: 't2', employee_id: 'e2', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: 80, payout_crc: 20000 },
  { id: 't3', employee_id: 'x',  hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: 80, payout_crc: 15000 },
]
vi.mock('../../shared/api/tips', () => ({
  getAttendanceHistory: vi.fn(async () => []),
  getTipEntriesBySession: vi.fn(async () => ENTRIES),
}))

import TipStats from './TipStats'

const employees = [
  { id: 'e1', full_name: 'Ana', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Beto', role: 'salonero', is_active: true },
] as unknown as Employee[]
const session = {
  id: 's1', session_date: '2026-07-05', status: 'closed', shift_type: 'PM', exchange_rate: 520,
  pool_efectivo_crc: 60000, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, pool_total_crc: 60000,
} as unknown as TipSession
const rolePoints = [{ role: 'salonero', points: 10 }] as unknown as RoleTipPoints[]

afterEach(() => { cleanup() })

describe('Estadísticas · lo pagado', () => {
  it('«Recibió» de cada persona es lo pagado (no ₡30.000 recalculado) y el aviso dice lo de la persona inactiva', async () => {
    render(<TipStats sessions={[session]} calcCache={{}} employees={employees} rolePoints={rolePoints} />)
    const aviso = await screen.findByTestId('stats-avisos-pagado')
    expect(aviso.textContent).toContain('₡15.000')
    const fila = (n: string) => screen.getByText(n, { selector: '.admin-emp-name' }).closest('tr')!.textContent!
    expect(fila('Ana')).toContain('₡25.000')
    expect(fila('Beto')).toContain('₡20.000')
    expect(fila('Ana')).not.toContain('₡30.000')
  })
})
