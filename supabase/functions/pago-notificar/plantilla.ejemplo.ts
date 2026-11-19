// Datos FICTICIOS para pruebas y vista previa (repo público: ningún proveedor ni monto real).
import type { MovimientoCorreo, ProveedorCorreo } from './plantilla.ts'

export const proveedorEjemplo: ProveedorCorreo = { name: 'Pescadería de Ejemplo S.A.' }
// 15-nov 21:40 CR = 16-nov 03:40 UTC: la fecha del comprobante tiene que ser la de Costa Rica (15 nov).
export const movimientoEjemplo: MovimientoCorreo = {
  amount_crc: 186_450, amount_usd: null, method: 'Transferencia',
  description: 'Factura 0001 de pescado fresco (ficticia)', created_at: '2026-11-16T03:40:00Z',
}
export const movimientoUsdEjemplo: MovimientoCorreo = { ...movimientoEjemplo, amount_usd: 120.5, method: 'Efectivo' }
