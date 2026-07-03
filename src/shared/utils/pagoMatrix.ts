// Matriz de forma-de-pago × rol (RN-3, SPEC §8) — FUENTE ÚNICA.
//
// El corazón de la fusión Bandeja↔Caja: CAJERO/MANAGER están en el local (pueden pagar en efectivo de
// la Caja Diaria); CONTADOR/DUEÑO no — solo Banco/Pendiente, nunca efectivo. Esta matriz se REUSA tal
// cual; ni este helper ni sus consumidores la alteran (RN-3: "se reusa tal cual; este SPEC no la altera").
//
// Extraída desde InboxModule (donde vivía como const local) para que el "➕ Agregar" de Caja (F4.3a) la
// comparta SIN duplicar valores (evita el riesgo de bug de plata por dos copias divergentes). InboxModule
// ahora la importa de acá; el comportamiento es idéntico al previo.

import type { UserRole } from '../types/database'

export type Pago = 'efectivo' | 'pendiente' | 'banco'

export const PAGO_META: Record<Pago, { method: string; status: 'aprobado' | 'pendiente'; caja: string; label: string }> = {
  efectivo:  { method: 'Efectivo',      status: 'aprobado',  caja: 'Caja Proveedores', label: 'Efectivo — descuenta la Caja Diaria (requiere caja abierta)' },
  pendiente: { method: 'Transferencia', status: 'pendiente', caja: 'Banco',            label: 'Transferencia — Pendiente (cuenta por pagar, no descuenta)' },
  banco:     { method: 'Transferencia', status: 'aprobado',  caja: 'Banco',            label: 'Pagado desde Banco (no toca el efectivo)' },
}

// CAJERO/MANAGER están físicamente en la caja → pueden pagar en efectivo. El resto (owner/contador/…) no.
export const isLocalRole = (role: UserRole): boolean => role === 'cajero' || role === 'manager'

// Formas de pago válidas para un rol, en orden de oferta. Local: las tres; oficina: sin efectivo.
export const formasPago = (role: UserRole): Pago[] =>
  isLocalRole(role) ? ['efectivo', 'pendiente', 'banco'] : ['pendiente', 'banco']
