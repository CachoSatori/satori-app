// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Capa de datos del backfill — Management API (`POST /v1/projects/<ref>/database/query`).
//
//  LECTURA: siempre `read_only: true` (transacción read-only de Postgres) y cada SQL pasa por
//  `assertSoloSelect()` (reusado del harness T0, no reimplementado). Token del Keychain / entorno
//  (reusado de T0). Es el MISMO canal firmado que usa T0 para leer prod.
//
//  ESCRITURA: SOLO en --apply (fase de PASE, no en BUILD) y SOLO contra STAGING. Toca UNA columna:
//  pool_total_crc. Doble candado: (1) el ref se compara contra REF_STAGING y aborta si no es;
//  (2) cada UPDATE pasa por `assertOnlyPoolTotalUpdate()`. run-prod.ts NO importa nada de escritura.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { mgmtToken, projectRefFromUrl, REF_STAGING, type Env } from '../t0-reconciliacion-cajas/env.ts'
import { assertSoloSelect, verificarRechazoDeEscritura } from '../t0-reconciliacion-cajas/db.ts'
import type { SessionRow, EntryRow, EmployeeRow, RolePointsRow } from './core.ts'

export { mgmtToken, projectRefFromUrl, verificarRechazoDeEscritura, REF_STAGING }

const API = (ref: string): string => `https://api.supabase.com/v1/projects/${ref}/database/query`
const PAGE = 1000

type Fila = Record<string, unknown>

async function post(ref: string, token: string, sql: string, readOnly: boolean): Promise<Fila[]> {
  const res = await fetch(API(ref), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  })
  if (!res.ok) throw new Error(`[mgmt] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as Fila[]
  return Array.isArray(body) ? body : []
}

/** SELECT read-only (última línea de defensa: assertSoloSelect antes de la red). */
async function queryRO(ref: string, token: string, sql: string): Promise<Fila[]> {
  assertSoloSelect(sql)
  return post(ref, token, sql, true)
}

// ── Coerción (la Management API devuelve numeric/int como string) ──────────────────────────────
const num = (v: unknown): number => {
  if (v == null) return 0
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string => (v == null ? '' : String(v))
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v))

/** Lee TODAS las filas de una tabla, paginando por id (estable). */
async function fetchAllPaged(ref: string, token: string, table: string, columns: string): Promise<Fila[]> {
  const out: Fila[] = []
  for (let offset = 0; ; offset += PAGE) {
    const rows = await queryRO(ref, token, `select ${columns} from public.${table} order by id limit ${PAGE} offset ${offset}`)
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** ¿existe la columna? (la mig 051 puede NO estar aplicada — entonces no la seleccionamos). */
export async function poolTotalColumnExists(ref: string, token: string): Promise<boolean> {
  const rows = await queryRO(
    ref, token,
    "select 1 as ok from information_schema.columns where table_schema = 'public' " +
      "and table_name = 'tip_sessions' and column_name = 'pool_total_crc' limit 1",
  )
  return rows.length > 0
}

export async function fetchSessions(ref: string, token: string, hasPoolTotal: boolean): Promise<SessionRow[]> {
  const cols =
    'id, session_date, shift_type, status, exchange_rate, pool_efectivo_crc, pool_efectivo_usd, ' +
    'pool_barra_crc, pool_barra_electronico_crc' + (hasPoolTotal ? ', pool_total_crc' : '')
  const rows = await fetchAllPaged(ref, token, 'tip_sessions', cols)
  return rows.map((r) => ({
    id: str(r.id),
    session_date: str(r.session_date),
    shift_type: str(r.shift_type),
    status: str(r.status),
    exchange_rate: num(r.exchange_rate),
    pool_efectivo_crc: num(r.pool_efectivo_crc),
    pool_efectivo_usd: num(r.pool_efectivo_usd),
    pool_barra_crc: num(r.pool_barra_crc),
    pool_barra_electronico_crc: num(r.pool_barra_electronico_crc),
    pool_total_crc: hasPoolTotal ? numOrNull(r.pool_total_crc) : null,
  }))
}

export async function fetchEntries(ref: string, token: string): Promise<EntryRow[]> {
  const rows = await fetchAllPaged(
    ref, token, 'tip_entries',
    'id, session_id, employee_id, hours_worked, tip_amount_crc, tip_amount_usd, points, payout_crc, covered_role',
  )
  return rows.map((r) => ({
    session_id: str(r.session_id),
    employee_id: str(r.employee_id),
    hours_worked: num(r.hours_worked),
    tip_amount_crc: num(r.tip_amount_crc),
    tip_amount_usd: num(r.tip_amount_usd),
    points: numOrNull(r.points),
    payout_crc: numOrNull(r.payout_crc),
    covered_role: strOrNull(r.covered_role) as EntryRow['covered_role'],
  }))
}

export async function fetchEmployees(ref: string, token: string): Promise<EmployeeRow[]> {
  const rows = await fetchAllPaged(ref, token, 'employees', 'id, full_name, role')
  return rows.map((r) => ({ id: str(r.id), full_name: str(r.full_name), role: str(r.role) as EmployeeRow['role'] }))
}

export async function fetchRolePoints(ref: string, token: string): Promise<RolePointsRow[]> {
  const rows = await queryRO(ref, token, 'select role, points from public.role_tip_points')
  return rows.map((r) => ({ role: str(r.role) as RolePointsRow['role'], points: num(r.points) }))
}

// ── Evidencia read-only: count(*) de las tablas del backfill antes y después ─────────────────────
export type Conteos = { tip_sessions: number; tip_entries: number; employees: number; role_tip_points: number }

export async function contarTablas(ref: string, token: string): Promise<Conteos> {
  const sql =
    'select (select count(*)::int from public.tip_sessions) as tip_sessions, ' +
    '(select count(*)::int from public.tip_entries) as tip_entries, ' +
    '(select count(*)::int from public.employees) as employees, ' +
    '(select count(*)::int from public.role_tip_points) as role_tip_points'
  const [fila] = await queryRO(ref, token, sql)
  return {
    tip_sessions: num(fila?.tip_sessions),
    tip_entries: num(fila?.tip_entries),
    employees: num(fila?.employees),
    role_tip_points: num(fila?.role_tip_points),
  }
}

// ── ESCRITURA (solo --apply, solo STAGING, solo pool_total_crc) ──────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Última línea de defensa: la sentencia toca SOLO pool_total_crc de tip_sessions, por id. */
export function assertOnlyPoolTotalUpdate(sql: string): void {
  const s = sql.trim().toLowerCase()
  if (!/^update\s+public\.tip_sessions\s+set\s+pool_total_crc\s*=/.test(s)) {
    throw new Error(`UPDATE rechazado (no es un set de pool_total_crc): ${sql.slice(0, 90)}`)
  }
  if (!/\bwhere\s+id\s*=\s*'[0-9a-f-]{36}'/.test(s)) throw new Error('UPDATE rechazado (sin WHERE id = uuid)')
  if (s.replace(/;\s*$/, '').includes(';')) throw new Error('UPDATE rechazado (más de una sentencia)')
  // ninguna otra columna ni verbo peligroso
  if (/\b(pool_efectivo|pool_barra|payout|points|status|closed_by|opened_by|delete|drop|truncate|alter)\b/.test(s)) {
    throw new Error(`UPDATE rechazado (toca algo que no es pool_total_crc): ${sql.slice(0, 90)}`)
  }
}

/** Escribe pool_total_crc en STAGING. Aborta si el ref no es staging. NO se usa en la fase BUILD. */
export async function applyPoolTotalStaging(
  ref: string,
  token: string,
  updates: Array<{ id: string; poolTotal: number }>,
): Promise<number> {
  if (ref !== REF_STAGING) {
    throw new Error(`ABORTADO: --apply solo escribe en STAGING (${REF_STAGING}); ref recibido "${ref}".`)
  }
  let n = 0
  for (const u of updates) {
    if (!UUID.test(u.id)) throw new Error(`id no-UUID, abortado antes de escribir: ${u.id}`)
    if (!Number.isFinite(u.poolTotal)) throw new Error(`poolTotal no finito para ${u.id}`)
    const sql = `update public.tip_sessions set pool_total_crc = ${u.poolTotal} where id = '${u.id}'`
    assertOnlyPoolTotalUpdate(sql)
    await post(ref, token, sql, false)
    n += 1
  }
  return n
}

/** ref del proyecto STAGING sacado de VITE_SUPABASE_URL del .env (con candado en el llamador). */
export function refFromEnv(env: Env): string {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
  if (!url) throw new Error('Falta VITE_SUPABASE_URL (revisá .env.local).')
  return projectRefFromUrl(url)
}
