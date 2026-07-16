/**
 * proveedoresStatus — lógica PURA del estado de UN proveedor para su tarjeta.
 *
 * Da, por proveedor: su deuda registrada (`pendingCRC`), su total pagado, su último pago y —si
 * tiene ciclo de recompra— su próximo vencimiento. Todo es información DEL PROVEEDOR, para
 * mostrarse dentro de su tarjeta.
 *
 * Decisión del dueño (2026-07-16): la pestaña Proveedores es SOLO la lista de proveedores. Los
 * contadores de cabecera que vivían acá (`contarPendientes`/`totalPendienteCRC` → badge rojo;
 * `contarAgenda` → chip ámbar) se retiraron por duplicados —los pendientes los notifica la
 * pestaña Pendientes, con su propio badge— y se borraron al quedar sin uso.
 *
 * Un proveedor **'Puntual'** (o sin ciclo) es una compra one-off: no tiene recompra, así que
 * nunca tiene `nextDue` y jamás figura como vencido. Esa semántica se conserva.
 *
 * NO toca matemática de caja ni sagrados. Puro y testeable (`today` se inyecta, sin Date.now()).
 */
import type { Supplier, CashMovement } from '../../shared/types/database'

// Días por ciclo de compra. Lo que no esté acá (p.ej. 'Puntual') no tiene agenda de recompra.
export const CICLO_DIAS: Record<string, number> = {
  'Diario': 1, 'Semanal': 7, 'Quincenal': 14, 'Mensual': 30,
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

// Proveedor PUNTUAL: compra one-off, sin ciclo de recompra → NUNCA entra a la agenda de ciclo.
// Causa raíz del "14 pagos pendientes" falso: los one-off (MUSICOS, Coca…) se trataban como
// recurrentes (nextDue = último pago + ciclo) y "vencían para siempre".
export function esProveedorPuntual(ciclo_pago: string | null | undefined): boolean {
  return !ciclo_pago || ciclo_pago === 'Puntual'
}

export interface SupplierStatus {
  s: Supplier
  lastPay: string | null
  nextDue: string | null
  daysUntil: number | null
  isOverdue: boolean
  isDueSoon: boolean
  esPuntual: boolean
  pendingCRC: number
  totalPaid: number
}

// Estado de agenda + deuda de UN proveedor (misma lógica que la del componente, ahora testeable).
export function computeSupplierStatus(s: Supplier, movements: CashMovement[], today: string): SupplierStatus {
  const paid = movements
    .filter(m => m.supplier_id === s.id && m.status === 'aprobado' && m.movement_type === 'egreso_mercaderia')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const pending = movements.filter(m => m.supplier_id === s.id && m.status === 'pendiente')
  const lastPay   = paid[0]?.created_at?.slice(0, 10) ?? null
  const esPuntual = esProveedorPuntual(s.ciclo_pago)
  const ciclo     = CICLO_DIAS[s.ciclo_pago ?? 'Semanal'] ?? 7
  // Puntual (o sin ciclo) → sin próximo vencimiento → fuera de la agenda.
  const nextDue    = (!esPuntual && lastPay) ? addDays(lastPay, ciclo) : null
  const daysUntil  = nextDue ? daysBetween(today, nextDue) : null
  const isOverdue  = daysUntil !== null && daysUntil < 0
  const isDueSoon  = daysUntil !== null && daysUntil >= 0 && daysUntil <= 2
  const pendingCRC = pending.reduce((sum, m) => sum + m.amount_crc, 0)
  const totalPaid  = paid.reduce((sum, m) => sum + m.amount_crc, 0)
  return { s, lastPay, nextDue, daysUntil, isOverdue, isDueSoon, esPuntual, pendingCRC, totalPaid }
}

