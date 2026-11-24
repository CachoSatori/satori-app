// @vitest-environment happy-dom
//
// Hallazgo 251 — modal de pago a proveedor (CashTurno). Antes, un $ ilegible («-», «12abc») llegaba como '' y se
// guardaba $0 sin aviso; al editar un pago guardado, además, confirmPago borraba el movimiento viejo ANTES de mirar
// el monto. Ahora los cuadros se leen con valorDelCuadro y se valida el pago completo ANTES de pedir autorización y
// de borrar: si no vale, se avisa (MSG_MONTO_INVALIDO) y no se toca nada. Los cuadros se escriben con teclearNumero
// (un solo evento `input`, como el navegador: con el cuadro vacío React no dispara onChange, R30).
// Harness espejo de CashTurno.negativos.test.tsx. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'
import { teclearNumero } from './teclearNumero.testutil'
import { MSG_MONTO_INVALIDO } from './validarMovimiento'

const { createCashMovementSpy, deleteCashMovementSpy, requireManagerSpy } = vi.hoisted(() => ({
  createCashMovementSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-nuevo' })),
  deleteCashMovementSpy: vi.fn(async () => undefined),
  requireManagerSpy: vi.fn(async () => ({ ok: true as boolean })),
}))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: createCashMovementSpy,
  createCashSession: vi.fn(), closeCashSession: vi.fn(),
  deleteCashMovement: deleteCashMovementSpy,
  getPreviousCierre: vi.fn(async () => null), discardCashSession: vi.fn(),
  upsertSupplier: vi.fn(), updateMiddayCheck: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Caja Test' } }) }))
vi.mock('../../shared/api/tips', () => ({ getActiveEmployees: vi.fn(async () => []), getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({ uploadFacturaPhoto: vi.fn(async () => 'f.jpg'), movementAttachments: vi.fn(() => []) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => requireManagerSpy }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-01',
  initial_suppliers_crc: 0, initial_cash_usd: 0,
} as unknown as CashSession
const supplier = { id: 'sup-1', name: 'Proveedor de prueba 1', is_active: true } as unknown as Supplier
const pagoGuardado = {
  id: 'mov-existing', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo', supplier_id: 'sup-1', supplier_name: 'Proveedor de prueba 1',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo', created_at: '2026-07-01T10:00:00Z',
} as unknown as CashMovement

const renderTurno = () => {
  const onError = vi.fn()
  render(<CashTurno openSession={session} suppliers={[supplier]} sessions={[]} sessionMovements={[pagoGuardado]}
    allMovements={[]} onSessionOpen={vi.fn()} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()} />)
  return { onError }
}
const usd = () => screen.getByLabelText('Monto $ del pago') as HTMLInputElement
const crc = () => screen.getByLabelText('Monto ₡ del pago') as HTMLInputElement
const guardar = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Guardar cambios' })) }) }

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
  createCashMovementSpy.mockReset(); createCashMovementSpy.mockImplementation(async m => ({ ...m, id: 'mov-nuevo' }))
  deleteCashMovementSpy.mockClear()
  requireManagerSpy.mockReset(); requireManagerSpy.mockResolvedValue({ ok: true })
})

describe('CashTurno · editar un pago GUARDADO — $ ilegible (251)', () => {
  it('$ vaciado y después «-» (onChange no corre): avisa y NO pide autorización, NO borra, NO re-crea', async () => {
    const { onError } = renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    teclearNumero(usd(), '')    // el cajero borra el 0
    teclearNumero(usd(), '-')   // y escribe algo ilegible en el cuadro vacío
    await guardar()
    expect(onError).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(requireManagerSpy).not.toHaveBeenCalled()
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(createCashMovementSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '✓ Guardar cambios' })).toBeTruthy()   // el modal queda abierto
  })
  it('$ «0abc» (badInput): avisa, NO pide autorización y no toca nada', async () => {
    const { onError } = renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    teclearNumero(usd(), '0abc')
    await guardar()
    expect(onError).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(requireManagerSpy).not.toHaveBeenCalled()   // el monto se mira ANTES de pedir la autorización del encargado
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(createCashMovementSpy).not.toHaveBeenCalled()
  })
  it('«-» borrado después (cuadro vacío de nuevo): no queda trabado y guarda con $0', async () => {
    const { onError } = renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    teclearNumero(usd(), '')
    teclearNumero(usd(), '-')
    teclearNumero(usd(), '')
    await guardar()
    expect(onError).not.toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(deleteCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(createCashMovementSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 15000, amount_usd: 0 })
  })
  it('$ vacío sigue siendo 0: guarda ₡ y $0', async () => {
    renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    teclearNumero(usd(), '')
    teclearNumero(crc(), '18000')
    await guardar()
    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(createCashMovementSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 18000, amount_usd: 0 })
  })
  it('$ válido: guarda el número leído', async () => {
    renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    teclearNumero(usd(), '20')
    await guardar()
    expect(createCashMovementSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 15000, amount_usd: 20 })
  })
})

// (hallazgo 252) Antes, una edición cuyo alta fallaba dejaba el pago como borrador «sin guardar» (y el viejo ya
// borrado). Ahora el viejo queda intacto y el modal sigue abierto para reintentar: el reintento también mira el $.
describe('CashTurno · reintento tras un alta fallida — $ ilegible (251)', () => {
  it('$ «-» en el reintento: avisa y NO llama a crear el movimiento', async () => {
    const { onError } = renderTurno()
    // 1) Una edición cuyo alta falla deja el modal abierto (el pago viejo no se borró).
    createCashMovementSpy.mockRejectedValueOnce(new Error('sin conexión'))
    fireEvent.click(screen.getByTitle('Editar'))
    await guardar()
    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
    // 2) Al reintentar con un $ ilegible no se crea nada.
    teclearNumero(usd(), '')
    teclearNumero(usd(), '-')
    await guardar()
    expect(onError).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)   // solo el intento del paso 1
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
  })
})
