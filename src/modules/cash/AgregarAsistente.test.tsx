// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import type { CashSession, Supplier, UserRole } from '../../shared/types/database'

// F4.3a — el asistente crea el cash_movement con la clase CONFIRMADA por el humano + el snapshot de lo
// que sugirió el sistema. Test light: SIN DB ni red. Mockeamos createCashMovement (afirmamos su payload),
// getFinanceAccounts (cuentas para el asiento operativo) y el leaf supabase (que arrastra norm). Usamos
// el classifyMovement y la matriz RN-3 REALES (el cableado advisory es justamente lo que se prueba).

const { createSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy }))
vi.mock('../../shared/api/finance', () => ({
  getFinanceAccounts: vi.fn(async () => [
    { id: 'a7120', code: '7120', name: 'Insumos operativos', parent_id: null, section: 'expenses', sort: 1, is_leaf: true },
    { id: 'inc1', code: '4000', name: 'Ventas', parent_id: null, section: 'income', sort: 2, is_leaf: true },
  ]),
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const mkSupplier = (name: string, aliases: string[] | null = null): Supplier => ({
  id: name, name, category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases, is_active: true,
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z',
})

const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const suppliers: Supplier[] = [mkSupplier('Pescadería del Pacífico', ['Pesca Pacífico'])]

function renderAsistente(role: UserRole = 'cajero') {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  const onError = vi.fn()
  render(
    <AgregarAsistente
      openSession={session}
      suppliers={suppliers}
      role={role}
      createdBy="u1"
      tc={600}
      onCreated={onCreated}
      onClose={onClose}
      onError={onError}
    />,
  )
  return { onCreated, onClose, onError }
}

const setMonto = (v: string) => fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: v } })
const confirmar = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ })) })
}

beforeEach(() => createSpy.mockClear())

describe('AgregarAsistente — clase confirmada + snapshot advisory', () => {
  it('keyword operativa: crea egreso_operativo con classification=operativa + snapshot', async () => {
    renderAsistente('cajero')
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'pago de electricidad del mes' } })
    setMonto('25000')
    await confirmar()

    expect(createSpy).toHaveBeenCalledTimes(1)
    const arg = createSpy.mock.calls[0][0]
    expect(arg).toMatchObject({
      movement_type: 'egreso_operativo',
      classification: 'operativa',
      suggested_classification: 'operativa',
      suggested_confidence: 0.7,
      method: 'Efectivo',
      caja_origen: 'Caja Proveedores',
      status: 'aprobado',
    })
  })

  it('operativa: la cuenta elegida viaja como account_id (dispara el asiento del trigger)', async () => {
    renderAsistente('cajero')
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'mantenimiento del aire' } })
    setMonto('40000')
    // La cuenta carga async (getFinanceAccounts) → esperamos a que aparezca la opción de gasto.
    await waitFor(() => expect(within(screen.getByLabelText('Cuenta de gasto')).queryByRole('option', { name: 'Insumos operativos' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Cuenta de gasto'), { target: { value: 'a7120' } })
    await confirmar()

    expect(createSpy.mock.calls[0][0]).toMatchObject({ classification: 'operativa', account_id: 'a7120', status: 'aprobado' })
  })

  it('proveedor reconocido: crea egreso_mercaderia con classification=mercaderia + supplier_id', async () => {
    renderAsistente('cajero')
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Pescadería del Pacífico' } })
    setMonto('50000')
    await confirmar()

    const arg = createSpy.mock.calls[0][0]
    expect(arg).toMatchObject({
      movement_type: 'egreso_mercaderia',
      classification: 'mercaderia',
      suggested_classification: 'mercaderia',
      supplier_id: 'Pescadería del Pacífico',
    })
    expect(arg.account_id).toBeNull()   // mercadería no postea asiento operativo
  })

  it('RN-2 advisory: el humano cambia la sugerencia → classification = la elegida, suggested_* = la sugerida', async () => {
    renderAsistente('cajero')
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'pago de electricidad' } })   // sugiere operativa
    setMonto('25000')
    // El humano la cambia a Mercadería (un tap) — nunca se decide sola.
    fireEvent.click(screen.getByRole('button', { name: /Mercadería/ }))
    await confirmar()

    expect(createSpy.mock.calls[0][0]).toMatchObject({
      classification: 'mercaderia',              // lo que eligió el humano
      suggested_classification: 'operativa',     // lo que propuso el sistema (snapshot de auditoría)
      suggested_confidence: 0.7,
    })
  })

  it('Ingreso es elección explícita: crea movement_type=ingreso sin classification', async () => {
    renderAsistente('cajero')
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'devolución de proveedor' } })
    setMonto('10000')
    fireEvent.click(screen.getByRole('button', { name: 'Ingreso' }))
    await confirmar()

    const arg = createSpy.mock.calls[0][0]
    expect(arg).toMatchObject({ movement_type: 'ingreso', caja_origen: 'Registradora', method: 'Efectivo' })
    expect(arg.classification).toBeUndefined()
    expect(arg.suggested_classification).toBeUndefined()
  })
})

describe('AgregarAsistente — matriz de pago por rol (RN-3, sin alterarla)', () => {
  it('cajero (local) puede pagar en Efectivo', () => {
    renderAsistente('cajero')
    const formas = within(screen.getByLabelText('Forma de pago')).getAllByRole('option').map(o => o.textContent)
    expect(formas).toContain('Efectivo (caja del local)')
  })

  it('owner (oficina) NO puede pagar en Efectivo — solo Pendiente / Banco', () => {
    renderAsistente('owner')
    const formas = within(screen.getByLabelText('Forma de pago')).getAllByRole('option').map(o => o.textContent)
    expect(formas).not.toContain('Efectivo (caja del local)')
    expect(formas).toEqual(['Transferencia — Pendiente', 'Transferencia — Pagado desde Banco'])
  })
})

describe('AgregarAsistente — orden del form (T3-B, decidido por la dueña)', () => {
  it('Foto → Clasificación → Proveedor → Montos → Descripción → Fecha (los bloques en ese orden)', () => {
    renderAsistente('cajero')
    // Posición relativa en el DOM (compareDocumentPosition): cada elemento precede al siguiente.
    const seq = [
      screen.getByLabelText('Foto de la factura'),
      screen.getByRole('group', { name: 'Clasificación' }),
      screen.getByLabelText('Proveedor'),
      screen.getByLabelText('Monto colones'),
      screen.getByLabelText('Descripción'),
      screen.getByLabelText('Fecha de factura'),
    ]
    for (let i = 0; i < seq.length - 1; i++) {
      // DOCUMENT_POSITION_FOLLOWING = 4 → seq[i+1] viene DESPUÉS de seq[i].
      expect(seq[i].compareDocumentPosition(seq[i + 1]) & 4, `bloque ${i} debe preceder al ${i + 1}`).toBeTruthy()
    }
  })
})
