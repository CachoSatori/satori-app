// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Núcleo PURO del backfill de tip_sessions.pool_total_crc.
//
//  El total real del pool de UNA sesión se calcula con el SAGRADO calcHistory()
//  (src/shared/utils/tipCalculations.ts) — NO se reimplementa. Este módulo solo lo envuelve con el
//  MISMO mapeo que usa TipHistory.loadCalc (la ruta canónica de Historial) y agrega el desglose por
//  mes. Sin I/O ni credenciales → 100% testeable (core.test.ts, patrón oracle: exige que el número
//  coincida al peso con calcHistory().totalPool).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { calcHistory } from '../../src/shared/utils/tipCalculations.ts'
import type { UserRole } from '../../src/shared/types/database.ts'

export interface SessionRow {
  id: string
  session_date: string          // YYYY-MM-DD
  shift_type: string
  status: string                // 'open' | 'closed'
  exchange_rate: number
  pool_efectivo_crc: number
  pool_efectivo_usd: number
  pool_barra_crc: number
  pool_barra_electronico_crc: number
  pool_total_crc: number | null // NULL si la columna aún no existe / sin backfill
}

export interface EntryRow {
  session_id: string
  employee_id: string
  hours_worked: number
  tip_amount_crc: number
  tip_amount_usd: number
  points: number | null
  payout_crc: number | null
  covered_role: UserRole | null
}

export interface EmployeeRow { id: string; full_name: string; role: UserRole }
export interface RolePointsRow { role: UserRole; points: number }

/**
 * Total real del pool de UNA sesión = SAGRADO calcHistory().totalPool.
 * Réplica EXACTA del mapeo de TipHistory.loadCalc:
 *   · barra que se le pasa a calcTurno = pool_barra_crc + pool_barra_electronico_crc
 *   · clasificación sala/barra y puntos por el ROL EFECTIVO = covered_role ?? rol natural
 * Devuelve el número CRUDO (sin redondear) para paridad exacta con la app.
 */
export function sessionPoolTotal(
  session: SessionRow,
  entries: EntryRow[],
  employees: EmployeeRow[],
  rolePoints: RolePointsRow[],
): number {
  const calc = calcHistory(
    entries.map((e) => ({
      employee_id: e.employee_id,
      hours_worked: e.hours_worked,
      tip_amount_crc: e.tip_amount_crc,
      tip_amount_usd: e.tip_amount_usd,
      points: e.points,
      payout_crc: e.payout_crc,
      covered_role: e.covered_role,
    })),
    employees.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role })),
    rolePoints,
    {
      pool_efectivo_crc: session.pool_efectivo_crc,
      pool_efectivo_usd: session.pool_efectivo_usd,
      pool_barra_crc: (session.pool_barra_crc || 0) + (session.pool_barra_electronico_crc || 0),
      exchange_rate: session.exchange_rate,
    },
  )
  return calc.totalPool
}

/** Agrupa entries por session_id (una sola pasada). */
export function groupEntries(entries: EntryRow[]): Map<string, EntryRow[]> {
  const by = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const arr = by.get(e.session_id)
    if (arr) arr.push(e)
    else by.set(e.session_id, [e])
  }
  return by
}

export interface SessionPlan {
  id: string
  session_date: string
  shift_type: string
  month: string                 // YYYY-MM
  poolTotal: number             // calcHistory().totalPool (crudo)
  current: number | null        // pool_total_crc actual (idempotencia)
  changed: boolean              // current == null || difiere de poolTotal más que EPS
}

// < medio colón = ya persistido. numeric ↔ float redondea distinto; EPS evita reescrituras
// espurias en corridas repetidas del backfill (idempotencia).
export const EPS = 0.5

/** Plan por sesión CERRADA (las abiertas no tienen total todavía). Ordenado por fecha/turno. */
export function planSessions(
  sessions: SessionRow[],
  entriesBySession: Map<string, EntryRow[]>,
  employees: EmployeeRow[],
  rolePoints: RolePointsRow[],
): SessionPlan[] {
  return sessions
    .filter((s) => s.status === 'closed')
    .map((s) => {
      const poolTotal = sessionPoolTotal(s, entriesBySession.get(s.id) ?? [], employees, rolePoints)
      const current = s.pool_total_crc
      const changed = current == null || Math.abs(current - poolTotal) > EPS
      return {
        id: s.id,
        session_date: s.session_date,
        shift_type: s.shift_type,
        month: s.session_date.slice(0, 7),
        poolTotal,
        current,
        changed,
      }
    })
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.shift_type.localeCompare(b.shift_type))
}

export interface MonthTotal { month: string; sessions: number; total: number; totalRounded: number }

/**
 * Total por mes = Σ poolTotal, redondeado AL FINAL — idéntico al correo mensual
 * (supabase/functions/monthly-report: `pool += p` crudo por sesión, y `fi()` = Math.round al mostrar).
 * Por eso Julio 2026 tiene que dar ₡2.167.131.
 */
export function monthlyTotals(plans: SessionPlan[]): MonthTotal[] {
  const by = new Map<string, { sessions: number; total: number }>()
  for (const p of plans) {
    const acc = by.get(p.month) ?? { sessions: 0, total: 0 }
    acc.sessions += 1
    acc.total += p.poolTotal
    by.set(p.month, acc)
  }
  return [...by.entries()]
    .map(([month, v]) => ({ month, sessions: v.sessions, total: v.total, totalRounded: Math.round(v.total) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}
