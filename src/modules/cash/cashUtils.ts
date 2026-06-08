import type { MovementType } from '../../shared/types/database'

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  ingreso:           'Ingreso',
  egreso_mercaderia: 'Egreso - Mercadería',
  egreso_personal:   'Egreso - Personal',
  egreso_operativo:  'Egreso - Operativo',
  egreso_socios:     'Egreso - Socios',
  traspaso:          'Traspaso',
}

export const MOVEMENT_TYPES: MovementType[] = [
  'ingreso',
  'egreso_mercaderia',
  'egreso_personal',
  'egreso_operativo',
  'egreso_socios',
  'traspaso',
]

export const EGRESO_TYPES: MovementType[] = [
  'egreso_mercaderia',
  'egreso_personal',
  'egreso_operativo',
  'egreso_socios',
]

export const CAJAS_ORIGEN = [
  'Caja Proveedores',
  'Caja Fuerte',
  'Registradora',
  'Banco',
]

export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'SINPE', 'Bitcoin']

// Taxonomía de categorías por tipo (decisiones de negocio 2026-06-05).
// PASS-THROUGH = el cliente ya pagó por medio electrónico (SINPE/Lafise/Bitcoin);
// la caja sólo RETIRA efectivo para entregarlo al staff/repartidor → reduce el
// efectivo PERO no es gasto del P&L. En finance.ts, las subcategorías con "propina"
// ya mapean a null. ⚠️ Las de "Delivery por <electrónico>" deben mapear a null también
// (pendiente: corregir el mapeo QuickBooks en un pase aparte — ver ROADMAP).
// NOTA: "Faltante/Sobrante de caja" (ajuste) requeriría un movement_type 'ajuste'
// (cambio de enum en DB) → fuera de alcance ahora; se registran como egreso/ingreso.
export const CATEGORIAS_DEFAULT: Record<MovementType, string[]> = {
  ingreso: [
    'Ventas efectivo mediodía','Ventas efectivo noche','Cambio en caja','Otros ingresos (Varios)',
  ],
  egreso_mercaderia: ['Proveedor'],
  egreso_personal:   [
    'Adelanto de salario','Salario / pago a empleado','Pruebas de empleados','Propinas por tarjeta',
    // pass-through (retiro de efectivo, no P&L):
    'Propinas por SINPE','Propinas por Lafise','Propinas por Bitcoin',
  ],
  egreso_operativo:  [
    'Mantenimiento','Gas','Seguridad','Gráfica','Comisión concierge (10% cash)','Promotoras',
    'Alquiler','Servicios públicos','Impuestos / Patentes','Lavandería','Comisiones apps delivery','Equipo',
    // pass-through (retiro de efectivo, no P&L — ver nota de mapeo arriba):
    'Delivery por SINPE','Delivery por Lafise','Delivery por Bitcoin',
  ],
  egreso_socios:     ['Retiro de socios','Delivery dueños'],
  traspaso:          ['Registradora → Caja Fuerte','Caja Fuerte → Banco','Caja Fuerte → Caja Proveedores','Banco → Caja Fuerte','Otro traspaso'],
}
// Las 9 categorías de proveedor ya viven en CashProveedores.tsx (CATEGORIAS_PROV) —
// no se duplican acá.

export function isEgreso(t: MovementType): boolean {
  return EGRESO_TYPES.includes(t)
}

export function tipoColor(t: MovementType | string): string {
  if (t === 'ingreso')    return '#7ec8a0'
  if (String(t).startsWith('egreso')) return '#c23b22'
  if (t === 'traspaso')  return '#c8a96e'
  return '#888'
}

// Re-export from shared utils (single source of truth)
export { todayCR as todayStr, fi, fd } from '../../shared/utils'

export function formatDate(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
