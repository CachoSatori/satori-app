// @vitest-environment happy-dom
//
// Fase 1 con la Caja Diaria ABIERTA (decisión de la dueña): al mediodía la caja sigue operando,
// así que sellar el Mediodía NO puede depender de cerrar el turno. La Fase 2 (noche) sí: ahí se
// cuenta el físico y se cierra la bóveda, y un turno abierto seguiría moviendo plata.
//
// Este test fija las DOS mitades del contrato:
//   · Fase 1 con openSession != null → sella (llama saveCierreParcial).
//   · Fase 2 con openSession != null → sigue bloqueada, y se desbloquea al cerrar el turno.
//     (El botón está deshabilitado, así que el mensaje del guard no es alcanzable por UI: el
//      guard sigue en handleConfirmCompleto como segunda barrera.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

// vi.hoisted: las factories de vi.mock se izan, así que los dobles tienen que existir antes.
// Tipados con sus parámetros — si no, `tsc -b` (el typecheck REAL, dentro de npm run build)
// rechaza leer mock.calls[0][0] aunque vitest corra verde.
const api = vi.hoisted(() => ({
  // saveCierreParcial declara su payload porque el test lee mock.calls[0][0].
  saveCierreParcial:    vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  updateCierreCompleto: vi.fn(async () => ({})),
  getCierresDia:        vi.fn(async () => [] as unknown[]),
}))

vi.mock('../../shared/api/cash', () => ({
  ...api,
  getAllCashMovements:  vi.fn(async () => []),
  getCashSessions:      vi.fn(async () => []),
  recordCierreSales:    vi.fn(async () => {}),
  recordCierreRetiro:   vi.fn(async () => {}),
  recordCierreAjuste:   vi.fn(async () => {}),
  discardCierreDia:     vi.fn(async () => {}),
  discardDiaCompleto:   vi.fn(async () => {}),
  createDayMovement:    vi.fn(async () => ({})),
  sendCierreEmail:      vi.fn(async () => {}),
}))
const { saveCierreParcial, updateCierreCompleto, getCierresDia } = api
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Dueña' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({
  useManagerOverride: () => vi.fn(async () => ({ ok: true })),
}))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const turnoAbierto: CashSession = {
  id: 'ses1', session_date: '2026-07-20', shift_type: 'Día', opened_by: 'u1', closed_by: null,
  status: 'open', cajero_name: 'Ana', initial_cash_crc: 0, initial_cash_usd: 0,
  initial_service_crc: 0, initial_suppliers_crc: 0, final_cash_crc: null, final_cash_usd: null,
  final_service_crc: null, final_suppliers_crc: null, final_safe_crc: null, final_bank_crc: null,
  notes: null, created_at: '2026-07-20T12:00:00Z', updated_at: '2026-07-20T12:00:00Z',
} as CashSession

// Fase 1 ya sellada, en ceros: deja netoM = 0 para que el cuadre de la Fase 2 sea exacto
// (deberia = ventas de noche) y no se dispare el gate de ajuste obligatorio.
const parcialSellado: CashCierreDia = {
  id: 'c1', session_date: '2026-07-20', manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: '2026-07-20T14:00:00Z', updated_at: '2026-07-20T14:00:00Z',
}

const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })

beforeEach(() => { vi.clearAllMocks(); getCierresDia.mockResolvedValue([]) })

describe('CashCierre · Fase 1 se sella con la Caja Diaria abierta', () => {
  it('con turno abierto, confirmar el Mediodía llama a saveCierreParcial', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={turnoAbierto} />)

    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    // Ventas PoS ₡ del mediodía (primer monto de la Fase 1)
    setMonto(montos()[0], 120000)

    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)

    await waitFor(() => expect(saveCierreParcial).toHaveBeenCalledTimes(1))
    // El cierre se sella con la fecha ELEGIDA en el selector, que arranca en el hoy de CR —
    // no con la del turno abierto. Se compara contra todayStr() (el mismo helper que usa el
    // componente) y no contra una fecha hardcodeada, que caducaba al cambiar el día.
    expect(saveCierreParcial.mock.calls[0][0]).toMatchObject({
      tipo: 'parcial_mediodia', vm_crc: 120000, session_date: todayStr(),
    })
  })

  it('el banner aclara que el turno abierto solo frena la Noche', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={turnoAbierto} />)
    const banner = await screen.findByText(/turno de caja abierto/)
    expect(banner.textContent).toMatch(/Mediodía/)
    expect(banner.textContent).toMatch(/Noche/)
  })
})

describe('CashCierre · Fase 2 sigue bloqueada con la Caja Diaria abierta', () => {
  // Fase 2 lista para cerrar salvo por el turno: ventas de noche + conteo físico que cuadra.
  const prepararFase2 = () => {
    const m = montos()
    // [0]=Ventas noche ₡ · [1]=Dólares $ · [2]=Retiro dueños ₡ · [3..8]=separaciones, ₡ y $ por
    // fila (Caja Diaria 3/4 · Registradora 5/6 · Remanente CF 7/8).
    setMonto(m[0], 100000)   // ventas noche
    setMonto(m[7], 100000)   // Remanente CF ₡ → total contado = deberia → sin diferencia
  }

  it('con turno abierto el botón de cerrar el día queda deshabilitado', async () => {
    getCierresDia.mockResolvedValue([parcialSellado])
    render(<CashCierre onRefresh={vi.fn()} openSession={turnoAbierto} />)

    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    prepararFase2()

    expect((btn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn)
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(updateCierreCompleto).not.toHaveBeenCalled()
  })

  it('sin turno abierto, el MISMO estado sí habilita el cierre → el turno es lo que bloquea', async () => {
    getCierresDia.mockResolvedValue([parcialSellado])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)

    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    prepararFase2()

    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })
})
