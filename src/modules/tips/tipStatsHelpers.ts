/**
 * tipStatsHelpers — lógica PURA para las Estadísticas de propinas.
 * Solo display/lectura sobre datos ya calculados (el take-home `total` = payout_crc
 * por empleado, valor de sistema). NO toca la matemática del pool ni la base.
 */

export interface RoleShare {
  role:  string
  total: number   // ₡ take-home acumulado del rol
  pct:   number   // % del take-home total (0–100)
}

export interface Distribucion {
  total: number       // take-home total (denominador)
  rows:  RoleShare[]   // por rol, desc por total, solo roles con take-home > 0
}

/**
 * Distribución del take-home por PUESTO (rol) a partir del memo `earners`.
 * Agrupa por `role`, suma `total` (payout_crc), y calcula % = total_rol / total_general.
 * **Incluye cocina** — es un rol más (el `total` de cocina en `earners` ya es su tajada
 * real del pool, points-based; el reparto igualitario interno de TipCocina no lo cambia,
 * así que acá NO se reconcilia ni se doble-cuenta). Null-safe.
 */
export function distribucionPorPuesto(
  earners: Array<{ role: string; total: number }> | null | undefined,
): Distribucion {
  const acc: Record<string, number> = {}
  for (const e of earners ?? []) {
    if (!e || !e.role) continue
    acc[e.role] = (acc[e.role] ?? 0) + (e.total ?? 0)
  }
  const total = Object.values(acc).reduce((s, v) => s + v, 0)
  const rows = Object.entries(acc)
    .map(([role, sum]) => ({ role, total: sum, pct: total > 0 ? (sum / total) * 100 : 0 }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
  return { total, rows }
}
