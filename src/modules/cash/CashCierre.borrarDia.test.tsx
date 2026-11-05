// @vitest-environment happy-dom
//
// Fix 05/11 — «Borrar TODO el día» y «Deshacer cierre» en PANTALLA:
//   · Deshacer: si un delete falla, la pantalla muestra el error (antes discardCierreDia se lo
//     tragaba y decía «✓ Cierre deshecho»).
//   · Borrar TODO: la confirmación muestra la vista previa (cantidad, ₡/US$ por día operativo,
//     manuales con hora, filas de OTRO día operativo que NO se borran) y borra solo los ids vistos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession } from '../../shared/types/database'
import type { PlanBorradoDia } from './borrarDia'

const api = vi.hoisted(() => ({
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
  discardCierreDia:    vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] }) as PlanBorradoDia),
}))

vi.mock('../../shared/api/cash', () => ({
  ...api,
  saveCierreParcial:    vi.fn(async () => ({})),
  updateCierreCompleto: vi.fn(async () => ({})),
  recordCierreSales:    vi.fn(async () => {}),
  recordCierreRetiro:   vi.fn(async () => {}),
  recordCierreAjuste:   vi.fn(async () => {}),
  createDayMovement:    vi.fn(async () => ({})),
  sendCierreEmail:      vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Dueño' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({
  useManagerOverride: () => vi.fn(async () => ({ ok: true })),
}))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
const sesionHoy = { id: 'sHoy', session_date: HOY, shift_type: 'Día', status: 'closed', cajero_name: 'Ana' } as CashSession
const cierreCompleto = { id: 'c1', session_date: HOY, tipo: 'completo', manager: 'Dueño', diferencia_crc: 0 }

let confirmSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([cierreCompleto])
  api.getAllCashMovements.mockResolvedValue([])
  api.getCashSessions.mockResolvedValue([sesionHoy])
  // happy-dom no trae window.confirm: se define como mock (true = la persona confirma)
  confirmSpy = vi.fn(() => true)
  Object.defineProperty(window, 'confirm', { value: confirmSpy, configurable: true, writable: true })
})
afterEach(() => { Reflect.deleteProperty(window, 'confirm') })

describe('Deshacer cierre — un error forzado se ve en pantalla', () => {
  it('muestra el error de discardCierreDia y no el mensaje de éxito', async () => {
    api.discardCierreDia.mockRejectedValueOnce(new Error(`No se pudo deshacer el cierre del ${HOY} (ventas del cierre): JWT expired`))
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    fireEvent.click(await screen.findByText(/Deshacer cierre/))
    expect(await screen.findByText(new RegExp(`No se pudo deshacer el cierre del ${HOY} \\(ventas del cierre\\): JWT expired`))).toBeTruthy()
    expect(screen.queryByText(/Cierre deshecho/)).toBeNull()
  })
})

describe('Borrar TODO el día — vista previa y confirmación', () => {
  const plan: PlanBorradoDia = {
    fecha: HOY,
    borrar: [
      { id: 'man', session_id: null, created_at: `${HOY}T15:00:00Z`, subcategory: '', description: 'DUEÑO TOMI', amount_crc: 5000, amount_usd: 0, movement_type: 'egreso_operativo', diaOperativo: HOY, origen: 'dia', manual: true },
      { id: 'tur', session_id: 'sHoy', created_at: `${HOY}T16:00:00Z`, subcategory: 'Proveedor mercadería', description: 'pago', amount_crc: 1000, amount_usd: 0, movement_type: 'egreso_mercaderia', diaOperativo: HOY, origen: 'turno', manual: false },
    ],
    ajenas: [
      { id: 'v-ayer', session_id: null, created_at: `${HOY}T06:31:00Z`, subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-10-19', amount_crc: 15600, amount_usd: 100, movement_type: 'ingreso', diaOperativo: '2026-10-19', origen: 'dia', manual: false },
    ],
  }

  it('la confirmación lista lo que se borra y avisa de lo que NO; borra solo los ids vistos', async () => {
    api.previewDiaCompleto.mockResolvedValueOnce(plan)
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    fireEvent.click(await screen.findByText(/Borrar TODO el día/))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    const txt = String(confirmSpy.mock.calls[0][0])
    expect(txt).toContain(`Se van a borrar 2 movimiento(s) del día operativo ${HOY} (1 de turnos de caja, 1 sin turno)`)
    expect(txt).toContain('09:00 · ')                                   // manual con su hora de carga (CR)
    expect(txt).toContain('1 movimiento(s) se cargaron')
    expect(txt).toContain('día 2026-10-19')
    expect(txt).toContain('Se borran los PAGOS de propinas del día')
    await waitFor(() => expect(api.discardDiaCompleto).toHaveBeenCalledWith(HOY, undefined, undefined, ['man', 'tur']))
    expect(await screen.findByText(/1 de otro día operativo quedaron intactos/)).toBeTruthy()
  })

  it('si la persona cancela, no borra nada', async () => {
    api.previewDiaCompleto.mockResolvedValueOnce(plan)
    confirmSpy.mockReturnValue(false)
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    fireEvent.click(await screen.findByText(/Borrar TODO el día/))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(api.discardDiaCompleto).not.toHaveBeenCalled()
  })

  it('si la vista previa falla, lo dice y no pregunta ni borra', async () => {
    api.previewDiaCompleto.mockRejectedValueOnce(new Error('network down'))
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    fireEvent.click(await screen.findByText(/Borrar TODO el día/))
    expect(await screen.findByText(/No se pudo armar la vista previa del borrado: network down/)).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.discardDiaCompleto).not.toHaveBeenCalled()
  })
})
