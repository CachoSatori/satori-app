/**
 * Rangos de fecha por defecto de las pantallas de Ventas, contados desde «hoy» de Costa Rica.
 *
 * «Hoy» sale SIEMPRE de `todayCR()` (`src/shared/utils`); acá solo hay aritmética de días sobre
 * `YYYY-MM-DD`. Antes estas pantallas usaban `new Date().toISOString()` (la fecha UTC): desde las
 * 18:00 CR ya era «mañana», así que de noche el rango se corría un día y una competencia que
 * terminaba hoy figuraba «Finalizada» en pleno servicio.
 */
import type { Comp } from '../../shared/types/ventas'
import { todayCR } from '../../shared/utils'

const DIA_MS = 86_400_000
const aMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

/** `fecha` corrida `n` días (negativo = hacia atrás), en `YYYY-MM-DD`. */
function correrDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** `n` días antes de «hoy» CR. */
export function diasAtrasCR(n: number, hoy: string = todayCR()): string {
  return correrDias(hoy, -n)
}

/** El 1.º del mes de «hoy» CR (no el del reloj del aparato). */
export function inicioDeMesCR(hoy: string = todayCR()): string {
  return `${hoy.slice(0, 7)}-01`
}

/** `2026-09-05` → `2026-08-05` (un mes atrás). */
export function haceUnMes(hoy: string = todayCR()): string {
  const [y, m, d] = hoy.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10)
}

/** `2026-09-05` → `2026-08-30` (los últimos 7 días, con hoy). */
export function haceUnaSemana(hoy: string = todayCR()): string {
  return correrDias(hoy, -6)
}

/** En curso / próxima / finalizada, según «hoy» CR. */
export function estadoCompetencia(
  c: Pick<Comp, 'inicio' | 'fin'>, hoy: string = todayCR(),
): 'active' | 'upcoming' | 'ended' {
  if (hoy < c.inicio) return 'upcoming'
  if (hoy > c.fin)    return 'ended'
  return 'active'
}

/**
 * «elapsed / total días» de la barra de una competencia. `total` no cambia. `elapsed` cuenta días
 * de calendario CR con el día de inicio = 1: lo mismo que se veía de día; de noche sumaba uno de más.
 */
export function progresoCompetencia(
  c: Pick<Comp, 'inicio' | 'fin'>, hoy: string = todayCR(),
): { total: number; elapsed: number } {
  const total   = Math.max(1, Math.ceil((aMs(c.fin) - aMs(c.inicio)) / DIA_MS))
  const elapsed = Math.min(total, Math.max(0, Math.round((aMs(hoy) - aMs(c.inicio)) / DIA_MS) + 1))
  return { total, elapsed }
}
