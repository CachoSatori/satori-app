// @vitest-environment happy-dom
//
// T2 — el Cierre del Día sobre el POZO, del corte en adelante.
//
// Los tres cambios de comportamiento que se ven en pantalla:
//   · la venta se pide BRUTA (etiqueta explícita),
//   · si la venta cargada es MENOR que las propinas pagadas del día, avisa y BLOQUEA
//     hasta confirmar (la causa raíz del sobrante de ₡58.737,07 del 2026-07-18 en prod),
//   · el "debería" sale del pozo: un pago de proveedor desde el fondo YA NO produce
//     faltante fantasma, porque `Caja Proveedores` ahora cuenta.
//
// El corte real (`POZO_CORTE`) vive en el futuro, así que acá se lo corre hacia atrás
// mockeando SOLO `esPostCorte`; el resto del módulo es el de verdad.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashMovement, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial:    vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  updateCierreCompleto: vi.fn(async () => ({})),
  getCierresDia:        vi.fn(async () => [] as unknown[]),
  getAllCashMovements:  vi.fn(async () => [] as unknown[]),
  getCashSessions:      vi.fn(async () => [] as unknown[]),
}))

vi.mock('../../shared/api/cash', () => ({
  ...api,
  recordCierreSales:  vi.fn(async () => {}),
  recordCierreRetiro: vi.fn(async () => {}),
  recordCierreAjuste: vi.fn(async () => {}),
  discardCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto: vi.fn(async () => {}),
  createDayMovement:  vi.fn(async () => ({})),
  sendCierreEmail:    vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Dueña' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({
  useManagerOverride: () => vi.fn(async () => ({ ok: true })),
}))
// Corre el corte hacia atrás: todo es post-corte. El resto de cierrePozo es el real.
vi.mock('./cierrePozo', async (orig) => {
  const actual = await orig<typeof import('./cierrePozo')>()
  return { ...actual, esPostCorte: () => true }
})

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
const { getAllCashMovements, getCashSessions, getCierresDia, saveCierreParcial } = api

let n = 0
function mov(p: Partial<CashMovement>): CashMovement {
  n += 1
  return {
    id: `m${n}`, session_id: p.session_id ?? null, created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 0, amount_usd: p.amount_usd ?? 0,
    currency: 'CRC', exchange_rate: 600,
    description: p.description ?? '', subcategory: p.subcategory ?? '',
    supplier_id: null, supplier_name: null, employee_name: null,
    method: p.method ?? 'Efectivo', shift: '',
    caja_origen: p.caja_origen ?? 'Caja Fuerte', status: p.status ?? 'aprobado',
    approved_by: null, approved_at: null, account_id: null,
    created_at: `${HOY}T18:00:00Z`, updated_at: `${HOY}T18:00:00Z`,
  } as CashMovement
}

const sesionHoy: CashSession = {
  id: 'sHoy', session_date: HOY, shift_type: 'Día', opened_by: 'u1', closed_by: 'u1',
  status: 'closed', cajero_name: 'Ana',
} as CashSession

beforeEach(() => {
  vi.clearAllMocks()
  getCierresDia.mockResolvedValue([])
  getAllCashMovements.mockResolvedValue([])
  getCashSessions.mockResolvedValue([sesionHoy])
})

describe('CashCierre post-corte — la venta se pide BRUTA', () => {
  it('la etiqueta lo dice explícitamente', async () => {
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    expect(await screen.findByText(/Ventas en efectivo BRUTAS ₡ \(sin restar propinas\)/)).toBeTruthy()
    // Y ya no se ofrece la etiqueta vieja en la fase que se está cargando.
    expect(screen.queryByText('Ventas PoS ₡')).toBeNull()
  })
})

describe('CashCierre post-corte — aviso de venta tecleada NETA', () => {
  const propina = mov({
    movement_type: 'egreso_personal', caja_origen: 'Registradora',
    subcategory: 'Propinas por turno', amount_crc: 70_000, session_id: 'sHoy',
  })

  it('si la venta es menor que las propinas del día, avisa y deja el botón bloqueado', async () => {
    getAllCashMovements.mockResolvedValue([propina])
    render(<CashCierre onRefresh={() => {}} openSession={null} />)

    await screen.findByText(/Ventas en efectivo BRUTAS/)
    const input = document.querySelectorAll('input[step="100"]')[0]
    fireEvent.change(input, { target: { value: '53' } })

    const aviso = await screen.findByTestId('aviso-venta-neta-m')
    expect(aviso.textContent).toContain('BRUTA')
    const boton = screen.getByText(/sellar Fase 1/).closest('button')!
    expect(boton.disabled).toBe(true)

    // Al confirmar la casilla, se desbloquea y sella.
    fireEvent.click(aviso.querySelector('input[type=checkbox]')!)
    await waitFor(() => expect(boton.disabled).toBe(false))
    fireEvent.click(boton)
    await waitFor(() => expect(saveCierreParcial).toHaveBeenCalled())
  })

  it('con la venta BRUTA (mayor que las propinas) no aparece ningún aviso', async () => {
    getAllCashMovements.mockResolvedValue([propina])
    render(<CashCierre onRefresh={() => {}} openSession={null} />)

    await screen.findByText(/Ventas en efectivo BRUTAS/)
    const input = document.querySelectorAll('input[step="100"]')[0]
    fireEvent.change(input, { target: { value: '300000' } })

    await waitFor(() => expect(screen.queryByTestId('aviso-venta-neta-m')).toBeNull())
    expect(screen.getByText(/sellar Fase 1/).closest('button')!.disabled).toBe(false)
  })

  it('sin propinas pagadas no hay aviso posible', async () => {
    render(<CashCierre onRefresh={() => {}} openSession={null} />)
    await screen.findByText(/Ventas en efectivo BRUTAS/)
    const input = document.querySelectorAll('input[step="100"]')[0]
    fireEvent.change(input, { target: { value: '1' } })
    await waitFor(() => expect(screen.queryByTestId('aviso-venta-neta-m')).toBeNull())
  })
})
