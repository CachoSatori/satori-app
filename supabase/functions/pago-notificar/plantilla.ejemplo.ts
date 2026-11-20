// Datos FICTICIOS para pruebas y vista previa (repo público: ningún proveedor ni monto real).
import type { EdicionMovimiento, MovimientoPago, AplicacionCredito } from './pago.ts'
import type { ProveedorCorreo } from './plantilla.ts'

export const proveedorEjemplo: ProveedorCorreo = { name: 'Pescadería de Ejemplo S.A.' }

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const ids = { a: ID(1), b: ID(2), c: ID(3) }

// Facturas registradas el 3 y el 10 de noviembre; se pagaron JUNTAS el 19-nov a las 21:40 CR (20-nov 03:40 UTC).
export const facturaA: MovimientoPago = {
  id: ids.a, supplier_id: 'prov-ejemplo', amount_crc: 120_000, amount_usd: null, method: 'Transferencia',
  description: 'Factura 0001 de pescado fresco (ficticia)', created_at: '2026-11-03T15:00:00Z', status: 'aprobado',
}
export const facturaB: MovimientoPago = {
  ...facturaA, id: ids.b, amount_crc: 66_450, description: 'Factura 0002 de mariscos (ficticia)', created_at: '2026-11-10T16:30:00Z',
}
export const facturaUsd: MovimientoPago = {
  ...facturaA, id: ids.c, amount_crc: 0, amount_usd: 120.5, method: 'Efectivo', description: 'Factura 0003 en dólares (ficticia)',
  created_at: '2026-11-12T16:30:00Z',
}

export const PAGO_ISO = '2026-11-20T03:40:00Z'          // 19-nov 21:40 CR
export const ENVIO_ISO = '2026-11-20T03:40:05Z'

/** Lo que deja la auditoría de la 052 al marcar pagado (más una edición previa que no es el pago). */
export const editsEjemplo: EdicionMovimiento[] = [
  { movement_id: ids.a, edited_at: '2026-11-05T15:00:00Z', changed: { amount_crc: { old: 110_000, new: 120_000 } } },
  { movement_id: ids.a, edited_at: PAGO_ISO, changed: { status: { old: 'pendiente', new: 'aprobado' } } },
  { movement_id: ids.b, edited_at: PAGO_ISO, changed: { status: { old: 'pendiente', new: 'aprobado' } } },
]

/** ₡20.000 de crédito a favor aplicados a la factura A (y una aplicación reversada que no cuenta). */
export const aplicacionesEjemplo: AplicacionCredito[] = [
  { applied_to_movement_id: ids.a, amount_applied: 20_000, reversed: false },
  { applied_to_movement_id: ids.a, amount_applied: 5_000, reversed: true },
]
