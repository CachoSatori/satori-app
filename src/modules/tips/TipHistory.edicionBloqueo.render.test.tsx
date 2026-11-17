// @vitest-environment happy-dom
// «Historial» → «✏ Editar»: las mismas guardas H1/H2 del cierre. Si la edición deja pozo que nadie
// cobra, «💾 Guardar cambios» se deshabilita con aviso; sin el problema, guarda como siempre. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  savePayouts: vi.fn(async () => {}),
  updateSessionPools: vi.fn(async () => {}),
  upsertTipEntry: vi.fn(async () => {}),
}))
const ENTRIES = [
  { id: 't1', employee_id: 'e1', hours_worked: 6, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: 60, payout_crc: 0 },
  { id: 't2', employee_id: 'e2', hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: 40, payout_crc: 0 },
]
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async () => ENTRIES),
  upsertTipEntry: api.upsertTipEntry,
  deleteTipEntry: vi.fn(async () => {}),
  updateSessionPools: api.updateSessionPools,
  savePayouts: api.savePayouts,
  totalElectronicoCrc: vi.fn(() => 0),
}))
vi.mock('../../shared/api/cash', () => ({ reconcilePropinaEgreso: vi.fn(async () => {}) }))

import TipHistory from './TipHistory'

const employees = [
  { id: 'e1', full_name: 'Sala Uno', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Barra Uno', role: 'barman', is_active: true },
] as unknown as Employee[]
const rolePoints = [{ role: 'salonero', points: 10 }, { role: 'barman', points: 5 }] as unknown as RoleTipPoints[]
const session = {
  id: 's1', session_date: '2026-11-15', shift_type: 'PM', status: 'closed', exchange_rate: 500,
  pool_efectivo_crc: 10000, pool_efectivo_usd: 0, pool_barra_crc: 4000, pool_barra_electronico_crc: 0, pool_total_crc: 14000,
} as unknown as TipSession

async function abrirEdicion() {
  render(<TipHistory sessions={[session]} employees={employees} rolePoints={rolePoints} isManager />)
  fireEvent.click(await screen.findByTitle('Ver detalle y acciones'))
  const editar = await screen.findByRole('button', { name: /Editar/ })
  await waitFor(() => expect((editar as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(editar)
  return screen.findByRole('button', { name: /Guardar cambios/ }) as Promise<HTMLButtonElement>
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

describe('TipHistory — edición con las guardas H1/H2', () => {
  it('sin problema: sin aviso, «Guardar cambios» habilitado y guarda los payouts', async () => {
    const guardar = await abrirEdicion()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    await waitFor(() => expect(api.savePayouts).toHaveBeenCalledTimes(1))
  })

  it('H1: dejar la barra en 0 horas con pozo de barra → aviso y «Guardar cambios» deshabilitado', async () => {
    const guardar = await abrirEdicion()
    const horasBarra = screen.getAllByDisplayValue('8')[0]
    fireEvent.change(horasBarra, { target: { value: '0' } })
    expect((await screen.findByRole('alert')).textContent).toContain('Hay ₡4.000 de propina de barra y nadie de barra tiene horas cargadas.')
    expect(guardar.disabled).toBe(true)
    fireEvent.click(guardar)
    expect(api.savePayouts).not.toHaveBeenCalled()
  })
})
