import { describe, it, expect } from 'vitest'
import {
  esProveedorPuntual, computeSupplierStatus, contarAgenda, contarPendientes, totalPendienteCRC,
  type SupplierStatus,
} from './proveedoresStatus'
import type { Supplier, CashMovement } from '../../shared/types/database'

// FIRMADO 2026-07-09: el rojo cuenta DEUDA REAL (pendientes) — no la agenda de ciclo; y un
// proveedor PUNTUAL nunca entra a la agenda (causa raíz del "14 pagos pendientes" falso).

const TODAY = '2026-07-20'

const sup = (over: Partial<Supplier> = {}): Supplier => ({
  id: 's1', name: 'Test', is_active: true, ciclo_pago: 'Semanal',
  ...over,
} as Supplier)

const mov = (over: Partial<CashMovement> = {}): CashMovement => ({
  id: 'm1', supplier_id: 's1', status: 'aprobado', movement_type: 'egreso_mercaderia',
  amount_crc: 10000, amount_usd: 0, created_at: '2026-07-05T12:00:00Z',
  ...over,
} as CashMovement)

describe('esProveedorPuntual — one-off = sin agenda', () => {
  it('Puntual / null / vacío → puntual (true)', () => {
    expect(esProveedorPuntual('Puntual')).toBe(true)
    expect(esProveedorPuntual(null)).toBe(true)
    expect(esProveedorPuntual(undefined)).toBe(true)
    expect(esProveedorPuntual('')).toBe(true)
  })
  it('ciclo real → NO puntual (false)', () => {
    expect(esProveedorPuntual('Semanal')).toBe(false)
    expect(esProveedorPuntual('Mensual')).toBe(false)
  })
})

describe('computeSupplierStatus — agenda de ciclo', () => {
  it('recurrente con recompra vencida → isOverdue', () => {
    const st = computeSupplierStatus(sup({ ciclo_pago: 'Semanal' }), [mov({ created_at: '2026-07-05T12:00:00Z' })], TODAY)
    expect(st.esPuntual).toBe(false)
    expect(st.nextDue).toBe('2026-07-12')      // último pago + 7
    expect(st.isOverdue).toBe(true)
    expect(st.isDueSoon).toBe(false)
  })

  it('PUNTUAL nunca entra a la agenda, por más viejo que sea el último pago (fix del "14")', () => {
    const st = computeSupplierStatus(sup({ ciclo_pago: 'Puntual' }), [mov({ created_at: '2026-04-01T12:00:00Z' })], TODAY)
    expect(st.esPuntual).toBe(true)
    expect(st.nextDue).toBeNull()
    expect(st.isOverdue).toBe(false)
    expect(st.isDueSoon).toBe(false)
  })

  it('sin ciclo (null) se trata como puntual → fuera de la agenda', () => {
    const st = computeSupplierStatus(sup({ ciclo_pago: null as unknown as string }), [mov({ created_at: '2026-01-01T12:00:00Z' })], TODAY)
    expect(st.isOverdue).toBe(false)
    expect(st.nextDue).toBeNull()
  })

  it('sin pagos → sin próximo vencimiento, fuera de la agenda', () => {
    const st = computeSupplierStatus(sup({ ciclo_pago: 'Semanal' }), [], TODAY)
    expect(st.lastPay).toBeNull()
    expect(st.nextDue).toBeNull()
    expect(st.isOverdue).toBe(false)
  })

  it('recompra próxima (≤2 días) → isDueSoon, no isOverdue', () => {
    const st = computeSupplierStatus(sup({ ciclo_pago: 'Semanal' }), [mov({ created_at: '2026-07-14T12:00:00Z' })], TODAY)
    expect(st.nextDue).toBe('2026-07-21')       // vence mañana
    expect(st.isDueSoon).toBe(true)
    expect(st.isOverdue).toBe(false)
  })

  it('deuda y total del proveedor se suman aparte de la agenda', () => {
    const ms = [
      mov({ id: 'p1', status: 'aprobado', amount_crc: 30000, created_at: '2026-07-05T12:00:00Z' }),
      mov({ id: 'p2', status: 'pendiente', amount_crc: 12000 }),
    ]
    const st = computeSupplierStatus(sup({ ciclo_pago: 'Puntual' }), ms, TODAY)
    expect(st.totalPaid).toBe(30000)
    expect(st.pendingCRC).toBe(12000)
    expect(st.isOverdue).toBe(false)            // puntual → agenda fuera aunque tenga deuda
  })
})

describe('contarAgenda — proveedores en agenda de ciclo (informativo, no deuda)', () => {
  it('cuenta vencidos + próximos', () => {
    const statuses: SupplierStatus[] = [
      computeSupplierStatus(sup({ id: 'a', ciclo_pago: 'Semanal' }), [mov({ id: 'x', supplier_id: 'a', created_at: '2026-07-05T12:00:00Z' })], TODAY), // overdue
      computeSupplierStatus(sup({ id: 'b', ciclo_pago: 'Semanal' }), [mov({ id: 'y', supplier_id: 'b', created_at: '2026-07-14T12:00:00Z' })], TODAY), // due soon
      computeSupplierStatus(sup({ id: 'c', ciclo_pago: 'Puntual' }), [mov({ id: 'z', supplier_id: 'c', created_at: '2026-01-01T12:00:00Z' })], TODAY), // puntual → fuera
    ]
    expect(contarAgenda(statuses)).toBe(2)
  })
})

describe('contarPendientes / totalPendienteCRC — DEUDA REAL (incluye huérfanos supplier_id NULL)', () => {
  const ms: CashMovement[] = [
    mov({ id: 'a', status: 'pendiente', amount_crc: 43374 }),                         // proveedor legítimo
    mov({ id: 'b', status: 'pendiente', supplier_id: null as unknown as string, amount_crc: 74126 }), // huérfano (Isleña 2020)
    mov({ id: 'c', status: 'pendiente', supplier_id: null as unknown as string, amount_crc: 75916 }), // huérfano (GRUPO PAMPA)
    mov({ id: 'd', status: 'aprobado', amount_crc: 99999 }),                          // pagado → no cuenta
    mov({ id: 'e', status: 'rechazado', amount_crc: 55555 }),                         // rechazado → no cuenta
  ]

  it('cuenta TODOS los pendientes, huérfanos incluidos (el "5" real del prod), no aprobados/rechazados', () => {
    expect(contarPendientes(ms)).toBe(3)
  })

  it('suma el CRC de los pendientes, huérfanos incluidos', () => {
    expect(totalPendienteCRC(ms)).toBe(43374 + 74126 + 75916)
  })
})
