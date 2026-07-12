/**
 * proveedoresStatus — lógica PURA de agenda de ciclo y deuda de proveedores (FIRMADO 2026-07-09).
 *
 * Separa dos conceptos que antes se confundían en el badge rojo "N pagos pendientes":
 *   · DEUDA REAL registrada  = movimientos con status 'pendiente' (lo que se debe de verdad;
 *     mismo criterio que la pestaña Pendientes; incluye huérfanos con supplier_id NULL). → el ROJO.
 *   · AGENDA de ciclo        = proveedores activos cuya recompra habitual (último pago + ciclo)
 *     ya venció o vence pronto. Es una agenda de compra, NO una deuda. → indicador aparte, no rojo.
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

// AGENDA de ciclo (recompra vencida o próxima) — informativo, NO deuda.
export function contarAgenda(statuses: SupplierStatus[]): number {
  return statuses.filter(x => x.isOverdue || x.isDueSoon).length
}

// DEUDA REAL registrada = movimientos 'pendiente' (incluye huérfanos supplier_id NULL). El ROJO.
export function contarPendientes(movements: CashMovement[]): number {
  return movements.filter(m => m.status === 'pendiente').length
}
export function totalPendienteCRC(movements: CashMovement[]): number {
  return movements.filter(m => m.status === 'pendiente').reduce((sum, m) => sum + (m.amount_crc || 0), 0)
}
