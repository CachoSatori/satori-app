/**
 * miRendimientoUtils — lógica PURA y testeable para la "casa del empleado"
 * (Mi Rendimiento). NO toca esquema ni sagrados; solo agrega/filtra datos que
 * ya existen (ventas por salonero desde los XLS + propinas cobradas del pool).
 *
 * Todo null-safe (lección del hotfix del buscador): cualquier fecha, campo o
 * mapa puede venir vacío/NULL sin reventar.
 */
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { aggSalonero, aggGeneral, dayOfWeek } from './ventasUtils'

// ── Date helpers (TZ-safe, mismo patrón T12:00:00 que el resto del módulo) ──
export function addDays(dateStr: string, n: number): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  if (isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Lunes (ISO) de la semana que contiene `dateStr`. */
export function mondayOf(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  if (isNaN(d.getTime())) return ''
  const dow = d.getDay()                 // 0=Dom … 6=Sáb
  return addDays(dateStr, -(dow === 0 ? 6 : dow - 1))
}

// ── Período global ───────────────────────────────────────────
export type PeriodKind = 'hoy' | 'semana' | 'mes' | 'rango'

export interface Period {
  kind:  PeriodKind
  from:  string   // YYYY-MM-DD inclusive
  to:    string   // YYYY-MM-DD inclusive
  label: string
}

const MONTHS_LONG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

/**
 * Resuelve el período global a un rango [from,to] concreto.
 * Reemplaza el fijo-60-días: gobierna TODAS las sub-vistas.
 * `today` se inyecta (todayCR) para que sea pura/testeable.
 */
export function resolvePeriod(
  kind: PeriodKind,
  today: string,
  custom?: { from?: string | null; to?: string | null },
): Period {
  const t = today || ''
  switch (kind) {
    case 'hoy':
      return { kind, from: t, to: t, label: 'Hoy' }
    case 'semana': {
      const from = mondayOf(t)
      return { kind, from, to: t, label: 'Esta semana' }
    }
    case 'mes': {
      const from = t ? t.slice(0, 7) + '-01' : ''
      return { kind, from, to: t, label: 'Este mes' }
    }
    case 'rango': {
      // Null-safe: si falta un extremo, se usa el otro (o hoy). Se ordena.
      let from = custom?.from || custom?.to || t
      let to   = custom?.to   || custom?.from || t
      if (from && to && from > to) { const tmp = from; from = to; to = tmp }
      return { kind, from, to, label: `${from} → ${to}` }
    }
    default:
      return { kind: 'hoy', from: t, to: t, label: 'Hoy' }
  }
}

/** Fechas activas dentro del período (inclusive). Null-safe ante fechas vacías. */
export function datesInPeriod(allDates: string[] | null | undefined, p: Period): string[] {
  if (!allDates || !p) return []
  const { from, to } = p
  return allDates.filter(d => !!d && (!from || d >= from) && (!to || d <= to))
}

// ── Agregación por día de la semana (yo vs resto del restaurante) ──
export interface DowStat {
  days:    number
  total:   number
  pax:     number
  promPax: number
  bebPax:  number
  ratioCB: number
}

export interface DowRow {
  dow:  number   // 0=Dom … 6=Sáb
  days: number   // días TRABAJADOS por el empleado en ese día de semana
  mine: DowStat  // el empleado
  rest: DowStat  // el restaurante (general) en esos mismos días
}

function emptyStat(): DowStat {
  return { days: 0, total: 0, pax: 0, promPax: 0, bebPax: 0, ratioCB: 0 }
}

/**
 * Desglosa las ventas del empleado por día de la semana sobre `dates`.
 * Devuelve SIEMPRE 7 filas (dow 0..6) — la UI decide cuáles mostrar.
 * `mine` = el empleado; `rest` = el general del restaurante en esos días
 * (mismo benchmark que usa el resto de Mi Rendimiento: "vs general").
 */
export function dowBreakdown(
  name: string,
  dates: string[] | null | undefined,
  dias: DiasMap,
  pm: ProductMap,
): DowRow[] {
  // Agrupar fechas por día de semana (null-safe)
  const byDow: Record<number, string[]> = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }
  for (const d of (dates ?? [])) {
    if (!d) continue
    const dow = dayOfWeek(d)
    if (dow >= 0 && dow <= 6) byDow[dow].push(d)
  }

  const rows: DowRow[] = []
  for (let dow = 0; dow <= 6; dow++) {
    const ds = byDow[dow]
    if (!name || ds.length === 0) {
      rows.push({ dow, days: 0, mine: emptyStat(), rest: emptyStat() })
      continue
    }
    const s = aggSalonero(name, ds, dias, pm)
    const g = aggGeneral(ds, dias, pm)
    rows.push({
      dow,
      days: s.days,
      mine: {
        days:    s.days,
        total:   s.total,
        pax:     s.pax,
        promPax: s.promPax,
        bebPax:  s.bebPax,
        ratioCB: s.ratioCB,
      },
      rest: {
        days:    ds.length,
        total:   g.total,
        pax:     g.pax,
        promPax: g.promPax,
        bebPax:  g.bebPax,
        ratioCB: g.ratioCB,
      },
    })
  }
  return rows
}

/** Índice del día de semana con mejor Prom/PAX del empleado (días>0). -1 si ninguno. */
export function bestDowIndex(rows: DowRow[] | null | undefined): number {
  if (!rows || rows.length === 0) return -1
  let best = -1, bestVal = -Infinity
  for (const r of rows) {
    if (r.days > 0 && r.mine.promPax > bestVal) { bestVal = r.mine.promPax; best = r.dow }
  }
  return best
}

// ── ICP electrónico (Índice de Conversión de Propina) ────────
// El numerador es la propina ELECTRÓNICA GENERADA por el empleado (tip_amount_crc +
// tip_amount_usd×TC) — lo que registra al lado de sus horas —, NO el reparto del pool
// (payout_crc). En un sistema pooled el payout mide take-home, no eficiencia de propina;
// lo generado sí. Read-only/agregación (no toca la matemática del pool, sagrado intacto).

// Propina electrónica generada por UNA fila, en CRC. USD×TC con el TC de la sesión.
// Null-safe: tip_amount_* y exchange_rate pueden venir 0/NULL.
export function electronicTipCrc(row: { tip_amount_crc?: number | null; tip_amount_usd?: number | null; exchange_rate?: number | null } | null | undefined): number {
  if (!row) return 0
  const crc  = row.tip_amount_crc ?? 0
  const usd  = row.tip_amount_usd ?? 0
  const rate = row.exchange_rate ?? 0
  const v = crc + usd * rate
  return isFinite(v) ? v : 0
}

// Σ propina electrónica generada sobre un conjunto de filas. Null-safe.
export function sumElectronicTips(
  rows: Array<{ tip_amount_crc?: number | null; tip_amount_usd?: number | null; exchange_rate?: number | null }> | null | undefined,
): number {
  if (!rows) return 0
  return rows.reduce((s, r) => s + electronicTipCrc(r), 0)
}

// ICP = numerador / ventas × 100. El numerador es propina electrónica GENERADA.
export function computeICP(propinaGenerada: number | null | undefined, ventas: number | null | undefined): number {
  const p = propinaGenerada ?? 0
  const v = ventas ?? 0
  if (!v || v <= 0 || isNaN(p) || isNaN(v)) return 0
  return (p / v) * 100
}

export interface IcpResult {
  mine: number   // ICP del empleado (%)
  team: number   // ICP del equipo/restaurante (%)
  diff: number   // mine - team (puntos porcentuales)
}

/**
 * ICP electrónico del empleado vs benchmark del equipo. Ambos numeradores son
 * propina electrónica GENERADA: Σ generado equipo / Σ ventas del restaurante.
 */
export function icpVsTeam(
  myGen: number | null | undefined,
  myVentas: number | null | undefined,
  teamGen: number | null | undefined,
  teamVentas: number | null | undefined,
): IcpResult {
  const mine = computeICP(myGen, myVentas)
  const team = computeICP(teamGen, teamVentas)
  return { mine, team, diff: mine - team }
}

// ── Navegación de meses (selector de Mis Propinas) ───────────
/** Suma `delta` meses a un 'YYYY-MM'. Null-safe. */
export function shiftMonth(ym: string, delta: number): string {
  if (!ym || ym.length < 7) return ym || ''
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  if (isNaN(y) || isNaN(m)) return ym
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

export function monthLabelLong(ym: string): string {
  if (!ym || ym.length < 7) return ym || ''
  const [y, m] = ym.split('-')
  const idx = Number(m) - 1
  return `${MONTHS_LONG[idx] ?? m} ${y}`
}
