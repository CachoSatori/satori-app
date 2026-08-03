// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, UserRole } from '../../shared/types/database'

// Endurecimiento del "Ingreso adicional" (Caja Diaria — SOLO la clase 'ingreso' del asistente ➕ Agregar):
//   1) Categoría obligatoria (dropdown).
//   2) Motivo/nota obligatorio (no vacío) — se elimina el default mudo.
//   3) Umbral: si el equivalente en colones (amount_crc + amount_usd·tc) supera ₡100.000, exige
//      autorización de gerencia (requireManager) ANTES de crear.
// La persistencia NO cambia de esquema: subcategory se mantiene 'Ingreso adicional' (compat pozo/reportes)
// y la categoría + el motivo se guardan en description → `${categoría} · ${motivo}`.
//
// Test light: sin DB ni red. Mockeamos createCashMovement (afirmamos su payload) y useManagerOverride
// (controlamos el resultado de la autorización). getFinanceAccounts/supabase leaf igual que el test hermano.

const { createSpy, requireManagerSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
  requireManagerSpy: vi.fn(async () => ({ ok: true }) as { ok: boolean }),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => requireManagerSpy }))

import AgregarAsistente from './AgregarAsistente'

const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession

// Entra al form por "Carga manual" y elige la clase Ingreso → aparecen Categoría + Motivo.
function renderIngreso(role: UserRole = 'cajero', tc = 600) {
  const onCreated = vi.fn(); const onClose = vi.fn(); const onError = vi.fn()
  render(
    <AgregarAsistente openSession={session} suppliers={[]} role={role} createdBy="u1" tc={tc}
      onCreated={onCreated} onClose={onClose} onError={onError} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ingreso' }))
  return { onCreated, onClose, onError }
}

const setCRC       = (v: string) => fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: v } })
const setUSD       = (v: string) => fireEvent.change(screen.getByLabelText('Monto dólares'), { target: { value: v } })
const setCategoria = (v: string) => fireEvent.change(screen.getByLabelText('Categoría del ingreso'), { target: { value: v } })
const setMotivo    = (v: string) => fireEvent.change(screen.getByLabelText('Motivo del ingreso'), { target: { value: v } })
const btnConfirmar = () => screen.getByRole('button', { name: /Confirmar y registrar/ }) as HTMLButtonElement
const confirmar    = async () => { await act(async () => { fireEvent.click(btnConfirmar()) }) }

beforeEach(() => {
  createSpy.mockClear()
  requireManagerSpy.mockReset()
  requireManagerSpy.mockResolvedValue({ ok: true })
})

describe('Ingreso adicional — categoría + motivo obligatorios', () => {
  it('sin categoría ni motivo: Confirmar deshabilitado y no crea', async () => {
    renderIngreso()
    setCRC('10000')
    expect(btnConfirmar().disabled).toBe(true)
    await confirmar()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('categoría pero SIN motivo: sigue bloqueado', async () => {
    renderIngreso()
    setCRC('10000'); setCategoria('Reintegro')
    expect(btnConfirmar().disabled).toBe(true)
    await confirmar()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('motivo pero SIN categoría: sigue bloqueado', async () => {
    renderIngreso()
    setCRC('10000'); setMotivo('algo')
    expect(btnConfirmar().disabled).toBe(true)
    await confirmar()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('motivo solo espacios: no cuenta (trim) → bloqueado', async () => {
    renderIngreso()
    setCRC('10000'); setCategoria('Otro'); setMotivo('    ')
    expect(btnConfirmar().disabled).toBe(true)
    await confirmar()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('categoría + motivo (≤ ₡100.000): crea sin autorización; description = categoría · motivo; subcategory intacta', async () => {
    renderIngreso()
    setCategoria('Aceite/reciclaje'); setMotivo('venta de aceite usado'); setCRC('50000')
    expect(btnConfirmar().disabled).toBe(false)
    await confirmar()
    expect(requireManagerSpy).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      movement_type: 'ingreso',
      caja_origen:   'Registradora',
      method:        'Efectivo',
      subcategory:   'Ingreso adicional',
      description:   'Aceite/reciclaje · venta de aceite usado',
      amount_crc:    50000,
    })
  })

  it('el motivo se recorta (trim) al persistir en description', async () => {
    renderIngreso()
    setCategoria('Otro'); setMotivo('   caja chica   '); setCRC('1000')
    await confirmar()
    expect(createSpy.mock.calls[0][0].description).toBe('Otro · caja chica')
  })
})

describe('Ingreso adicional — umbral > ₡100.000 exige autorización de gerencia', () => {
  it('borde exacto ₡100.000: NO supera → pasa sin autorización', async () => {
    renderIngreso()
    setCategoria('Reintegro'); setMotivo('reintegro'); setCRC('100000')
    await confirmar()
    expect(requireManagerSpy).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it('> ₡100.000 en colones: pide autorización; si autoriza (ok) → crea', async () => {
    renderIngreso()
    setCategoria('Reintegro'); setMotivo('reintegro grande'); setCRC('150000')
    await confirmar()
    expect(requireManagerSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 150000, subcategory: 'Ingreso adicional' })
  })

  it('> ₡100.000 pero autorización DENEGADA/cancelada (!ok): NO crea', async () => {
    requireManagerSpy.mockResolvedValueOnce({ ok: false })
    renderIngreso()
    setCategoria('Otro'); setMotivo('sin permiso'); setCRC('150000')
    await confirmar()
    expect(requireManagerSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('umbral por EQUIVALENTE en colones: USD·tc que supera ₡100.000 también pide autorización', async () => {
    renderIngreso('cajero', 600)              // tc = 600
    setCategoria('Otro'); setMotivo('pago en dólares'); setUSD('200')   // 200·600 = 120.000 > 100.000
    await confirmar()
    expect(requireManagerSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_usd: 200, exchange_rate: 600 })
  })

  it('USD·tc por DEBAJO del umbral: no pide autorización', async () => {
    renderIngreso('cajero', 600)
    setCategoria('Otro'); setMotivo('poco en dólares'); setUSD('100')   // 100·600 = 60.000 ≤ 100.000
    await confirmar()
    expect(requireManagerSpy).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledTimes(1)
  })
})
