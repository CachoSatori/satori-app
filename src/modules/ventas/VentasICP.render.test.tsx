// @vitest-environment happy-dom
//
// Pestaña ICP (firmado por Ismael, 2026-10-29):
//   · Numerador = propina ELECTRÓNICA declarada (tip_amount_crc + usd×TC), la misma función que
//     Mi Rendimiento. `payout_crc` se muestra aparte («cobrado del reparto») y no entra al ICP.
//   · «ICP restaurante» = Σ propina electrónica del mes / Σ ventas de saloneros.
//   · Barra (barman/barback): «no aplica a barra» en lugar del %.
import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, within } from '@testing-library/react'
import type { DiasMap, SaloneroDay } from '../../shared/types/ventas'

const H = vi.hoisted(() => ({ tips: [] as unknown[], emps: [] as unknown[] }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/tips', () => ({ getAttendanceHistory: vi.fn(async () => H.tips) }))
vi.mock('../../shared/api/admin', () => ({ getAllEmployees: vi.fn(async () => H.emps) }))

import VentasICP from './VentasICP'

const sal = (total: number): SaloneroDay => ({
  pax: 4, total, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: total * 0.1,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [],
})
const emp = (id: string, full_name: string, role: string) =>
  ({ id, full_name, role, is_active: true, profile_id: null, pos_name: full_name, pos_login: null, created_at: '', updated_at: '' })
const fila = (employee_id: string, tip_amount_crc: number, payout_crc: number, tip_amount_usd = 0) =>
  ({ session_date: '2026-10-07', shift_type: 'PM', employee_id, hours_worked: 6, points: 1,
     payout_crc, tip_amount_crc, tip_amount_usd, exchange_rate: 500 })

const DIAS: DiasMap = {
  '2026-10-07': {
    fileName: 'x.xls', uploadedAt: '2026-10-08',
    saloneros: { FRANCISCO: sal(1_000_000), FRANCO: sal(20_000) },
  },
}

describe('VentasICP', () => {
  it('ICP = propina electrónica / ventas; payout aparte; barra no aplica; restaurante = Σ electrónica / Σ ventas saloneros', async () => {
    H.emps = [emp('e-fr', 'FRANCISCO', 'salonero'), emp('e-fo', 'FRANCO', 'barman'), emp('e-aj', 'AMPI', 'cajero')]
    H.tips = [
      fila('e-fr', 150_000, 90_000, 20),   // ₡160.000 electrónica (150k + 20×500), cobró 90k
      fila('e-fo', 0, 85_000),             // barra: cobró del pool, sin propina declarada
      fila('e-aj', 8_000, 10_000),         // caja: entra al numerador del restaurante
    ]
    const { container } = render(<VentasICP dias={DIAS} pm={{}} />)
    await waitFor(() => expect(container.querySelector('tbody tr')).not.toBeNull())

    const filas = [...container.querySelectorAll('tbody tr')]
    const francisco = filas.find(f => f.textContent?.includes('FRANCISCO'))!
    const franco    = filas.find(f => f.textContent?.includes('FRANCO'))!

    // FRANCISCO: 160.000 / 1.000.000 = 16,0 % — no 9,0 % (payout).
    expect(within(francisco as HTMLElement).getByText('16.0%')).toBeTruthy()
    const plano = (t: string | null) => (t ?? '').replace(/\s/g, '')
    expect(plano(francisco.textContent)).toContain('₡90000')     // «cobrado del reparto», aparte
    expect(plano(francisco.textContent)).toContain('₡160000')    // propina electrónica
    // FRANCO (barman): sin %; al final del ranking.
    expect(franco.textContent).toContain('no aplica a barra')
    expect(franco.textContent).not.toMatch(/\d+\.\d%/)
    expect(filas.indexOf(franco)).toBe(filas.length - 1)

    // Restaurante: (160.000 + 0 + 8.000) / (1.000.000 + 20.000) = 16,47 %.
    const pie = container.querySelector('tfoot')!
    expect(pie.textContent).toContain('16.5%')
    // Ningún texto de la pestaña dice que la propina incluya el servicio.
    expect(container.textContent).not.toMatch(/(?<!no )incluye (el )?(10 ?% de )?servicio/i)
    expect(container.textContent).toContain('No incluye el 10 % de servicio')
  })
})
