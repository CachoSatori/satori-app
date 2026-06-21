// ── Límites de rango por mes — robustos contra el largo del mes ───────────────
// Bug que arregla (ver _handoff/RCA-FECHAS-BORDE.md): varias consultas armaban el
// límite superior como `${ym}-31`, que es una fecha INEXISTENTE en meses de 30 días
// (abr/jun/sep/nov) y en febrero → Postgres/PostgREST devuelve 400 y la pantalla
// queda sin datos. La cura: usar el PRIMER DÍA DEL MES SIGUIENTE como límite superior
// EXCLUSIVO (`.lt(...)`), que no depende de cuántos días tiene el mes.

export interface MonthRangeBounds {
  /** Primer día del mes — `YYYY-MM-01`. Límite INFERIOR inclusivo para columnas DATE (session_date). */
  start: string
  /** Primer día del mes — `YYYY-MM-01T00:00:00Z`. Límite INFERIOR inclusivo para timestamptz (created_at). */
  startTs: string
  /** Primer día del MES SIGUIENTE — `YYYY-MM-01`. Límite SUPERIOR EXCLUSIVO para DATE. Usar con `.lt()`. */
  endExclusive: string
  /** Primer día del MES SIGUIENTE — `YYYY-MM-01T00:00:00Z`. Límite SUPERIOR EXCLUSIVO para timestamptz. Usar con `.lt()`. */
  endExclusiveTs: string
}

/**
 * Dado un mes `ym` en formato 'YYYY-MM', devuelve los límites de su rango.
 * El límite superior es EXCLUSIVO = primer día del mes siguiente (usar con `.lt(...)`).
 *
 * Truco del mes 1-based: en el string `ym`, el mes viene 1-based ('2026-06' → m=6).
 * `Date.UTC` espera el mes 0-based, así que `Date.UTC(y, m, 1)` interpreta `m` como el
 * ÍNDICE del mes SIGUIENTE (junio = índice 5; pasar m=6 = índice de julio) → da el 1° del
 * mes siguiente. Y maneja el cruce de año solo: diciembre m=12 → índice 12 = enero del año y+1.
 */
export function monthRangeBounds(ym: string): MonthRangeBounds {
  const [y, m] = ym.split('-').map(Number)
  const nextFirst = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) // 'YYYY-MM-01' del mes siguiente
  const start = `${ym}-01`
  return {
    start,
    startTs: `${start}T00:00:00Z`,
    endExclusive: nextFirst,
    endExclusiveTs: `${nextFirst}T00:00:00Z`,
  }
}
