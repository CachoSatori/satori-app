// @vitest-environment happy-dom
//
// Hallazgo 252, ronda 2 (Menor 1 del verificador del PR #355): con un cambio de pago sin terminar (el pago nuevo y el
// anterior en la base, el par anotado en el aparato), el Cierre del día contaba el egreso DOS veces: el «debería» del
// pozo bajaba y aparecía un falso sobrante. Ahora usa la misma regla que la Caja Diaria (aplicarReemplazos): cuenta
// una vez, avisa, deja sellar el Mediodía (no depende de pagos a proveedores) y frena la Noche hasta terminar el cambio.
// Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial:   vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  cerrarDiaCompleto:   vi.fn(async () => ({})),
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  deshacerCierreDia:  vi.fn(async () => {}),
  discardDiaCompleto: vi.fn(async () => {}),
  previewDiaCompleto: vi.fn(async () => ({})),
  createDayMovement:  vi.fn(async () => ({})),
  sendCierreEmail:    vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Encargada de prueba' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
// Todo post-corte (el pozo cuenta Caja Proveedores); el resto de cierrePozo es el real.
vi.mock('./cierrePozo', async (orig) => {
  const actual = await orig<typeof import('./cierrePozo')>()
  return { ...actual, esPostCorte: () => true }
})

import CashCierre from './CashCierre'
import { fi, todayStr } from './cashUtils'
import { claveReemplazos, guardarReemplazos, MSG_FASE2_CON_REEMPLAZO } from './reemplazoPago'

const HOY = todayStr()
const mov = (id: string, p: Partial<CashMovement>): CashMovement => ({
  id, session_id: 'sHoy', created_by: 'u1', movement_type: 'ingreso', amount_crc: 0, amount_usd: 0,
  currency: 'CRC', exchange_rate: 600, description: '', subcategory: '', supplier_id: null, supplier_name: null,
  employee_name: null, method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado',
  approved_by: null, approved_at: null, account_id: null,
  created_at: `${HOY}T18:00:00Z`, updated_at: `${HOY}T18:00:00Z`, ...p,
} as CashMovement)

const fondo  = mov('mov-fondo', { movement_type: 'ingreso', amount_crc: 100000, description: 'fondo de prueba' })
const pago   = (id: string, crc: number) => mov(id, {
  movement_type: 'egreso_mercaderia', amount_crc: crc, caja_origen: 'Caja Proveedores', supplier_name: 'Proveedor de prueba 1',
})
const viejo  = pago('mov-viejo', 15000)
const nuevo  = pago('mov-nuevo', 20000)
const sesionHoy = { id: 'sHoy', session_date: HOY, shift_type: 'Día', status: 'closed', cajero_name: 'Caja Test' } as CashSession
const parcialSellado = {
  id: 'c1', session_date: HOY, manager: 'Encargada de prueba', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia

const anotar = () => localStorage.setItem(claveReemplazos('sHoy'), JSON.stringify([{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]))
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
// Fase 2: ventas de noche y un conteo cualquiera para que aparezca la verificación con el pozo.
const llenarNoche = () => {
  const m = montos()
  setMonto(m[0], 1000)     // ventas noche ₡
  setMonto(m[7], 81000)    // Remanente CF ₡
  fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.getCierresDia.mockResolvedValue([parcialSellado])
  api.getAllCashMovements.mockResolvedValue([fondo, viejo, nuevo])
  api.getCashSessions.mockResolvedValue([sesionHoy])
})

describe('CashCierre · cambio de pago sin terminar (hallazgo 252, ronda 2)', () => {
  it('control: sin anotación los dos pagos cuentan (pozo 100.000 − 15.000 − 20.000) y no hay aviso', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(65000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
  })

  it('con el par anotado el pozo cuenta el pago UNA vez (100.000 − 20.000) y avisa', async () => {
    anotar()
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(80000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })

  it('la Noche (Fase 2) se frena con aviso claro: no abre el resumen ni cierra', async () => {
    anotar()
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    fireEvent.click(btn)
    expect(await screen.findByText(MSG_FASE2_CON_REEMPLAZO)).toBeTruthy()
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('si el nuevo no está a la vista (rechazado por la cola), el viejo cuenta y la Noche no se frena', async () => {
    anotar()
    api.getAllCashMovements.mockResolvedValue([fondo, viejo])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(85000))
    expect(screen.queryByText('Cambio de pago sin terminar.')).toBeNull()
  })

  it('el Mediodía (Fase 1) se sella igual: sella ventas y propinas, que el pago a proveedor no toca', async () => {
    anotar()
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/sellar Fase 1/)
    setMonto(montos()[0], 120000)
    fireEvent.click(btn)
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
    expect(api.saveCierreParcial.mock.calls[0][0]).toMatchObject({ vm_crc: 120000, propinas_m_crc: 0 })
  })

  it('una anotación nueva (otra pestaña de Caja) se ve sin recargar', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    llenarNoche()
    expect((await screen.findByTestId('resumen-pozo')).textContent).toBe(fi(65000))
    act(() => { guardarReemplazos('sHoy', [{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]) })
    expect(screen.getByTestId('resumen-pozo').textContent).toBe(fi(80000))
    expect(screen.getByText('Cambio de pago sin terminar.')).toBeTruthy()
  })
})
