// ── Shared utilities — single source of truth ─────────────────

// ── Timezone-safe date helpers (Costa Rica = UTC-6, no DST) ───
const CR_TZ = 'America/Costa_Rica'

export function todayCR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CR_TZ }).format(new Date())
  // returns YYYY-MM-DD in Costa Rica time
}

// Fecha local de Costa Rica (YYYY-MM-DD) de un instante cualquiera — misma
// convención que todayCR(). Para comparar el día de REGISTRO de un movimiento
// (created_at, en UTC) contra un session_date sin desfasarse de noche (UTC-6).
export function dateCR(d: Date | string | number | null | undefined): string {
  if (d == null || d === '') return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: CR_TZ }).format(dt)
}

// ── Currency formatters ────────────────────────────────────────
export function fi(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}

export function fd(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return '$ ' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fip(n: number): string {
  return (n >= 0 ? '+' : '') + fi(n)
}

// ── Employee constants ─────────────────────────────────────────
export const CAJEROS_IDS = [
  'cajero turno mañana',
  'cajero turno manana',
  'cajero turno tarde',
  'cajero turno mediodia',
  'cajero turno mediodía',
]

export function isCajeroName(name: string): boolean {
  return CAJEROS_IDS.includes(name.toLowerCase().trim())
}

// ── Date utilities ────────────────────────────────────────────
export function fmtDate(d: string): string {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${Number(dd)} ${months[Number(m)-1]} ${y}`
}

export function dayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00').getDay()
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// ── Shift type normalization ──────────────────────────────────
// tip_sessions uses 'AM'/'PM'; cash_sessions uses 'Mediodía'/'Noche'
// Always display as the Spanish label for consistency.
export function shiftLabel(shift: string): string {
  if (shift === 'AM' || shift === 'Mediodía' || shift === 'Mañana') return 'Mediodía'
  if (shift === 'PM' || shift === 'Noche')    return 'Noche'
  return shift
}

// Convert tip session shift_type to Caja shift_type for cross-module matching
export function tipShiftToCaja(shift: string): string {
  return shiftLabel(shift)  // 'AM'→'Mediodía', 'PM'→'Noche'
}
