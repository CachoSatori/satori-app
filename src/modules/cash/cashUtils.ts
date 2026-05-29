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

export const CATEGORIAS_DEFAULT: Record<MovementType, string[]> = {
  ingreso: [
    'Ventas efectivo mediodía','Ventas efectivo noche','SINPE delivery',
    'Bitcoin','Ingreso de cambio','Otros ingresos',
  ],
  egreso_mercaderia: ['Proveedor mercadería'],
  egreso_personal:   ['Adelanto de salario','Salario pendiente','Propinas por tarjeta','Otros pagos personal'],
  egreso_operativo:  ['Mantenimiento','Servicios','Gas','Seguridad','Librería','Decoración','Herramientas','Otros operativos'],
  egreso_socios:     ['Retiro de socios','Gastos de socios'],
  traspaso:          ['Registradora → Caja Fuerte','Caja Fuerte → Banco','Caja Fuerte → Caja Proveedores','Banco → Caja Fuerte','Otro traspaso'],
}

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
