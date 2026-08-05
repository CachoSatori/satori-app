// Lectura + armado del reporte, compartido por run.ts (staging) y run-prod.ts (prod).
// Solo LECTURA: las 4 tablas por el canal read-only, y el plan/mensual del núcleo puro.

import { poolTotalColumnExists, fetchSessions, fetchEntries, fetchEmployees, fetchRolePoints } from './mgmt.ts'
import { planSessions, monthlyTotals, groupEntries, type SessionPlan, type MonthTotal } from './core.ts'
import { formatReport } from './report.ts'

export interface DryResult {
  plans: SessionPlan[]
  months: MonthTotal[]
  hadColumn: boolean
  text: string
  expectedOk: boolean | null
}

export async function leerYArmar(
  label: string,
  ref: string,
  token: string,
  focusMonth?: string,
  expected?: { month: string; crc: number },
): Promise<DryResult> {
  const hadColumn = await poolTotalColumnExists(ref, token)
  const [sessions, entries, employees, rolePoints] = await Promise.all([
    fetchSessions(ref, token, hadColumn),
    fetchEntries(ref, token),
    fetchEmployees(ref, token),
    fetchRolePoints(ref, token),
  ])
  const plans = planSessions(sessions, groupEntries(entries), employees, rolePoints)
  const months = monthlyTotals(plans)
  const { text, expectedOk } = formatReport({ label, ref, hadColumn, plans, months, focusMonth, expected })
  return { plans, months, hadColumn, text, expectedOk }
}
