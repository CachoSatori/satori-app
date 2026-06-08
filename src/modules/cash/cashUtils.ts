import type { MovementType, CashMovement } from '../../shared/types/database'

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

// Categorías de proveedor (las 9). Fuente única — la usan CashProveedores y CashTurno.
export const CATEGORIAS_PROV = [
  'Pescados y Mariscos', 'Bebidas y Licores', 'Verduras y Frutas',
  'Lácteos y Huevos', 'Carnes', 'Abarrotes', 'Limpieza y Suministros', 'Servicios', 'Otros',
]

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

// Fecha de corte de "Propinas por pagar": las sesiones de propinas con fecha ANTERIOR
// a ésta ya se pagaron por el flujo viejo (antes de que existiera este módulo), así que
// NO se muestran como pendientes. No se tocan datos históricos — es sólo un límite de
// visualización. Las del 2026-06-06 en adelante entran al flujo nuevo (pagar/pendiente).
export const PROPINAS_POR_PAGAR_DESDE = '2026-06-06'

// ── Saldo de Caja Fuerte derivado del LEDGER (lógica del canónico satori-caja) ──
// Caja Fuerte = el efectivo físico del restaurante, arrastrado día a día. Validado en
// el módulo Prueba con datos reales y usado por el cierre del día (CashCierre).
//   + ingresos en efectivo que ENTRAN a Caja Fuerte → caja_origen 'Caja Fuerte'
//     (las ventas de cierre; NO los "ingresos adicionales" que entran por Registradora).
//   − egresos NO pendientes con caja_origen 'Caja Fuerte' OR method 'Efectivo'
//     (salen del efectivo físico).
//   Excluye: pendientes, rechazados, traspasos internos y transferencias (no afectan el efectivo).
export function saldoCajaFuerte(movements: CashMovement[]): { crc: number; usd: number } {
  let crc = 0, usd = 0
  for (const m of movements) {
    if (m.status === 'pendiente' || m.status === 'rechazado') continue
    if (m.movement_type === 'traspaso') continue
    if (m.movement_type === 'ingreso') {
      if (m.caja_origen === 'Caja Fuerte') { crc += m.amount_crc || 0; usd += m.amount_usd || 0 }
    } else if (isEgreso(m.movement_type)) {
      if (m.caja_origen === 'Caja Fuerte' || m.method === 'Efectivo') { crc -= m.amount_crc || 0; usd -= m.amount_usd || 0 }
    }
  }
  return { crc, usd }
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
