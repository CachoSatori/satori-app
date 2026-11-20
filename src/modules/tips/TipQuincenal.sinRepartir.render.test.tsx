// @vitest-environment happy-dom
// «Quincenal» (planilla para nómina): si un turno cerrado del mes deja plata sin repartir (p. ej. cerrado antes
// de las guardas del 17-nov), aparece el aviso arriba de «⬇ CSV planilla» / «🖨 Imprimir». Solo avisa. Datos ficticios.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'

type Entry = { id: string; employee_id: string; hours_worked: number; tip_amount_crc: number; tip_amount_usd: number; covered_role: string | null; points: null; payout_crc: null }
const ENTRIES: Record<string, Entry[]> = {}
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async (id: string) => ENTRIES[id] ?? []),
}))

import TipQuincenal from './TipQuincenal'

const employees = [
  { id: 'e1', full_name: 'Sala Uno', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Barra Uno', role: 'barman', is_active: true },
] as unknown as Employee[]
const rolePoints = [{ role: 'salonero', points: 10 }, { role: 'barman', points: 5 }] as unknown as RoleTipPoints[]
const sesion = (id: string, fecha: string, shift: 'AM' | 'PM', pools: Partial<Record<string, number>>) => ({
  id, session_date: fecha, shift_type: shift, status: 'closed', exchange_rate: 500,
  pool_efectivo_crc: 0, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, ...pools,
}) as unknown as TipSession
const entrada = (sid: string, employee_id: string, hours_worked: number): Entry => ({
  id: `${sid}-${employee_id}`, employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: null, payout_crc: null,
})
const montar = (sessions: TipSession[]) =>
  render(<TipQuincenal sessions={sessions} calcCache={{}} employees={employees} rolePoints={rolePoints} />)

afterEach(() => { cleanup() })

describe('TipQuincenal — aviso de plata sin repartir', () => {
  it('mes sin sobrante → no hay aviso', async () => {
    ENTRIES.s1 = [entrada('s1', 'e1', 6), entrada('s1', 'e2', 8)]
    montar([sesion('s1', '2026-11-03', 'PM', { pool_efectivo_crc: 20000, pool_barra_crc: 6000 })])
    await screen.findByRole('button', { name: /CSV planilla/ })
    expect(screen.queryByTestId('aviso-sin-repartir')).toBeNull()
  })

  it('un turno con barra sin horas → aviso con fecha, turno, monto y motivo; la planilla sale igual', async () => {
    ENTRIES.s1 = [entrada('s1', 'e1', 6), entrada('s1', 'e2', 8)]
    ENTRIES.s2 = [entrada('s2', 'e1', 5)]
    montar([
      sesion('s1', '2026-11-03', 'PM', { pool_efectivo_crc: 20000, pool_barra_crc: 6000 }),
      sesion('s2', '2026-11-18', 'AM', { pool_efectivo_crc: 10000, pool_barra_electronico_crc: 2500 }),
    ])
    const aviso = await screen.findByTestId('aviso-sin-repartir')
    expect(aviso.textContent).toBe(
      '⚠ Turno del 2026-11-18 mediodía: quedaron ₡2.500 sin repartir (hay propina de barra y nadie de barra tiene horas).')
    expect(aviso.textContent).not.toContain('guardar')
    expect((screen.getByRole('button', { name: /CSV planilla/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('dos turnos del mismo día con sobrante → Mediodía antes que Noche (aunque lleguen al revés)', async () => {
    ENTRIES.s3 = [entrada('s3', 'e1', 5)]
    ENTRIES.s4 = [entrada('s4', 'e1', 5)]
    montar([
      sesion('s3', '2026-11-20', 'PM', { pool_efectivo_crc: 1000, pool_barra_crc: 3000 }),
      sesion('s4', '2026-11-20', 'AM', { pool_efectivo_crc: 1000, pool_barra_crc: 1500 }),
    ])
    const lineas = [...(await screen.findByTestId('aviso-sin-repartir')).children].map(d => d.textContent)
    expect(lineas).toEqual([
      '⚠ Turno del 2026-11-20 mediodía: quedaron ₡1.500 sin repartir (hay propina de barra y nadie de barra tiene horas).',
      '⚠ Turno del 2026-11-20 noche: quedaron ₡3.000 sin repartir (hay propina de barra y nadie de barra tiene horas).',
    ])
  })
})
