import { describe, it, expect } from 'vitest'
import { esProveedorPuntual, computeSupplierStatus } from './proveedoresStatus'
import type { Supplier, CashMovement } from '../../shared/types/database'

// Estado por proveedor para su tarjeta: deuda registrada, total pagado, último pago y —solo si
// tiene ciclo— próximo vencimiento. Un proveedor PUNTUAL (one-off) nunca vence: esa era la causa
// raíz del "14 pagos pendientes" falso y la semántica se conserva.
//
// Los contadores de cabecera (contarPendientes/totalPendienteCRC/contarAgenda) se borraron junto
// con los indicadores que alimentaban — decisión del dueño 2026-07-16: Proveedores = lista simple.

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

describe('deuda del proveedor en su tarjeta — los huérfanos (supplier_id NULL) no son de nadie', () => {
  // Los pendientes huérfanos existen en prod (Isleña ₡74.126,92 · GRUPO PAMPA ₡75.916,60) y se
  // gestionan en la pestaña Pendientes. Acá importa que NO se le imputen a ningún proveedor.
  const ms: CashMovement[] = [
    mov({ id: 'a', status: 'pendiente', amount_crc: 43374 }),                                         // del proveedor s1
    mov({ id: 'b', status: 'pendiente', supplier_id: null as unknown as string, amount_crc: 74126 }), // huérfano
    mov({ id: 'c', status: 'pendiente', supplier_id: null as unknown as string, amount_crc: 75916 }), // huérfano
    mov({ id: 'd', status: 'aprobado',  amount_crc: 99999 }),                                         // pagado → no es deuda
    mov({ id: 'e', status: 'rechazado', amount_crc: 55555 }),                                         // rechazado → no es deuda
  ]

  it('pendingCRC del proveedor cuenta SOLO su deuda: ni huérfanos, ni aprobados, ni rechazados', () => {
    const st = computeSupplierStatus(sup({ id: 's1' }), ms, TODAY)
    expect(st.pendingCRC).toBe(43374)
    expect(st.totalPaid).toBe(99999)
  })
})
