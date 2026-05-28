import type { TipEntry, Employee, RoleTipPoints, UserRole } from '../types/database'

export interface TipCalculationRow {
  employee: Employee
  hours_worked: number
  tip_amount_crc: number
  tip_amount_usd: number
  points: number
  payout_crc: number
}

export interface TipCalculationResult {
  rows: TipCalculationRow[]
  total_pool_crc: number
  total_points: number
  value_per_point: number
}

// Fórmula Satori:
// puntos = horas × puntos_rol
// valor_por_punto = pool_total / suma_puntos
// take_home = puntos × valor_por_punto

export function calculateTips(
  entries: TipEntry[],
  employees: Employee[],
  rolePoints: RoleTipPoints[],
  exchangeRate: number
): TipCalculationResult {
  const pointsMap = new Map(rolePoints.map(r => [r.role, r.points]))
  const employeeMap = new Map(employees.map(e => [e.id, e]))

  // Calcular pool total en CRC
  const total_pool_crc = entries.reduce((sum, e) => {
    const usdInCrc = e.tip_amount_usd * exchangeRate
    return sum + e.tip_amount_crc + usdInCrc
  }, 0)

  // Calcular puntos por empleado
  const rows: Array<Omit<TipCalculationRow, 'payout_crc'> & { payout_crc: number }> = entries
    .map(entry => {
      const employee = employeeMap.get(entry.employee_id)
      if (!employee) return null

      const rolePointValue = pointsMap.get(employee.role as UserRole) ?? 0
      const points = entry.hours_worked * rolePointValue

      return {
        employee,
        hours_worked: entry.hours_worked,
        tip_amount_crc: entry.tip_amount_crc,
        tip_amount_usd: entry.tip_amount_usd,
        points,
        payout_crc: 0, // se calcula abajo
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const total_points = rows.reduce((sum, r) => sum + r.points, 0)
  const value_per_point = total_points > 0 ? total_pool_crc / total_points : 0

  // Asignar payout final
  const finalRows: TipCalculationRow[] = rows.map(r => ({
    ...r,
    payout_crc: Math.round(r.points * value_per_point),
  }))

  return {
    rows: finalRows,
    total_pool_crc,
    total_points,
    value_per_point,
  }
}

// Formatear colones CRC
export function formatCRC(amount: number): string {
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'CRC',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Formatear USD
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}
