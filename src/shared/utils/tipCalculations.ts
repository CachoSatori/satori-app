import type { UserRole } from '../types/database'

// Roles que van al pool de barra (propina extra por horas)
export const BAR_ROLES: UserRole[] = ['barman', 'barback']

// Roles que NO tienen campo de propina individual (bar + cocina)
export const NO_PROPINA_ROLES: UserRole[] = ['barman', 'barback', 'cocina']

// Roles que SÍ tienen campo de propina individual
export const PROPINA_ROLES: UserRole[] = ['salonero', 'runner', 'cajero', 'manager']

// Orden de secciones
export const ROL_ORDER: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

export const ROL_NAMES: Record<UserRole, string> = {
  owner:    'Owner',
  contador: 'Contador',
  salonero: 'Saloneros',
  barman:   'Barman',
  barback:  'Barback',
  runner:   'Runners',
  cocina:   'Cocina',
  cajero:   'Cajeros',
  manager:  'Manager',
  proveedor: 'Bandeja proveedores',   // sin propinas — solo etiqueta (Record exhaustivo)
}

export const ROL_LABELS: Record<UserRole, string> = {
  owner:    'Propietario',
  contador: 'Contador',
  salonero: 'Salonero',
  barman:   'Barman',
  barback:  'Barback',
  runner:   'Runner',
  cocina:   'Cocina',
  cajero:   'Cajero',
  manager:  'Encargado',
  proveedor: 'Bandeja proveedores',   // sin propinas — solo etiqueta (Record exhaustivo)
}

// ── Línea del draft ────────────────────────────────────────────

export interface DraftLine {
  employeeId: string
  employeeName: string
  role: UserRole
  active: boolean
  hours: number | ''
  // solo para PROPINA_ROLES:
  propina_crc: number | ''
  propina_usd: number | ''
  // computed:
  pts_rol: number
  pts_val: number
  take_home: number
}

export interface PoolTotals {
  generalPool: number
  barraPool: number
  totalPool: number
  totalPoints: number
  generalRate: number
}

// ── Cálculo principal — misma lógica que calcTurno() del original ──

// Returns updated lines (non-mutating) + pool totals
export function calcTurno(
  lines: DraftLine[],
  pool_efectivo_crc: number,
  pool_efectivo_usd: number,
  pool_barra_crc: number,
  exchange_rate: number,
): { totals: PoolTotals; updatedLines: DraftLine[] } {
  // Work on copies — never mutate caller's array
  const copies = lines.map(l => ({ ...l }))
  const worked    = copies.filter(l => l.active)
  const barWorked = worked.filter(l => BAR_ROLES.includes(l.role))
  const salaWorked = worked.filter(l => !BAR_ROLES.includes(l.role))

  // Efectivo total en CRC
  const efectivoCRC = (pool_efectivo_crc || 0) + (pool_efectivo_usd || 0) * exchange_rate

  // Pool general = efectivo + propinas individuales de sala (ya recolectadas por el salonero)
  // NOTA: el efectivo del pool NO debe incluir las propinas individuales — son streams separados
  const propinaSala = salaWorked.reduce((s, l) => {
    const crc = Number(l.propina_crc) || 0
    const usd = (Number(l.propina_usd) || 0) * exchange_rate
    return s + crc + usd
  }, 0)
  const generalPool = efectivoCRC + propinaSala

  // Calcular pts_val para todos (sigue necesario para la tasa)
  worked.forEach(l => {
    l.pts_val = (Number(l.hours) || 0) * l.pts_rol
  })

  const totalPoints = worked.reduce((s, l) => s + l.pts_val, 0)
  const generalRate = totalPoints > 0 ? generalPool / totalPoints : 0

  // Take home base: puntos × tasa general
  worked.forEach(l => {
    l.take_home = l.pts_val * generalRate
  })

  // Pool barra (adicional): distribuido entre bar workers por horas
  // Bar workers participan del pool general Y del pool de barra separado
  const totalBarHours = barWorked.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  if (pool_barra_crc > 0 && totalBarHours > 0) {
    barWorked.forEach(l => {
      l.take_home += ((Number(l.hours) || 0) / totalBarHours) * pool_barra_crc
    })
  }

  return {
    totals: {
      generalPool,
      barraPool: pool_barra_crc,
      totalPool: generalPool + pool_barra_crc,
      totalPoints,
      generalRate,
    },
    updatedLines: copies,
  }
}

// ── Formatters ─────────────────────────────────────────────────
export { fi as formatCRC } from '../utils/index'

export function formatNum(n: number): string {
  return Number(n).toLocaleString('es-CR', { maximumFractionDigits: 1 })
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(n)
}

// ── Para historial (sesiones cerradas) ─────────────────────────

export interface HistoryRow {
  employeeId: string
  employeeName: string
  role: UserRole          // rol efectivo del turno (cubierto si hubo cobertura, si no el natural)
  coveredRole: UserRole | null  // rol cubierto (null = trabajó en su propio rol)
  hours: number
  propina_crc: number
  propina_usd: number
  pts_rol: number
  pts_val: number
  payout_crc: number
}

export interface HistoryCalc {
  rows: HistoryRow[]
  generalPool: number
  barraPool: number
  totalPool: number
  totalPoints: number
  generalRate: number
}

export function calcHistory(
  entries: Array<{
    employee_id: string
    hours_worked: number
    tip_amount_crc: number
    tip_amount_usd: number
    points: number | null
    payout_crc: number | null
    covered_role?: UserRole | null
  }>,
  employees: Array<{ id: string; full_name: string; role: UserRole }>,
  rolePoints: Array<{ role: UserRole; points: number }>,
  session: {
    pool_efectivo_crc: number
    pool_efectivo_usd: number
    pool_barra_crc: number
    exchange_rate: number
  },
): HistoryCalc {
  const pointsMap = new Map(rolePoints.map(r => [r.role, r.points]))
  const empMap    = new Map(employees.map(e => [e.id, e]))

  // Reconstruir DraftLines con los datos de entradas.
  // Si hubo cobertura, el rol EFECTIVO (puntos + pool barra) es el cubierto.
  const coveredOf = new Map<string, UserRole | null>()
  const lines: DraftLine[] = entries.map(e => {
    const emp = empMap.get(e.employee_id)
    if (!emp) return null
    // Cobertura = trabajó ese puesto: el rol EFECTIVO (cubierto) define puntos
    // Y la membresía del pool de barra (igual que el cierre del formulario).
    const effectiveRole = (e.covered_role ?? emp.role) as UserRole
    coveredOf.set(e.employee_id, e.covered_role ?? null)
    const pts_rol = pointsMap.get(effectiveRole) ?? 0
    return {
      employeeId:   e.employee_id,
      employeeName: emp.full_name,
      role:         effectiveRole,
      active:       true,
      hours:        e.hours_worked,
      propina_crc:  e.tip_amount_crc,
      propina_usd:  e.tip_amount_usd,
      pts_rol,
      pts_val:      0,
      take_home:    0,
    } as DraftLine
  }).filter((l): l is DraftLine => l !== null)

  const { totals, updatedLines } = calcTurno(
    lines,
    session.pool_efectivo_crc,
    session.pool_efectivo_usd,
    session.pool_barra_crc,
    session.exchange_rate,
  )

  const rows: HistoryRow[] = updatedLines.map(l => ({
    employeeId:   l.employeeId,
    employeeName: l.employeeName,
    role:         l.role,
    coveredRole:  coveredOf.get(l.employeeId) ?? null,
    hours:        Number(l.hours),
    propina_crc:  Number(l.propina_crc),
    propina_usd:  Number(l.propina_usd),
    pts_rol:      l.pts_rol,
    pts_val:      l.pts_val,
    payout_crc:   Math.round(l.take_home),
  }))

  return { rows, ...totals }
}

// Re-export shared formatters so existing imports don't break
export { fi, fd, todayCR as todayStr } from '../utils/index'
