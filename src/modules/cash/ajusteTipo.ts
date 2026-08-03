// Ítem 3 — la etiqueta del ajuste de cierre se DERIVA del signo de la diferencia (no de un select
// manual que pueda contradecir la plata). Regla de moneda: si hay diferencia en ₡ (≥ tolerancia ₡500),
// manda el signo de ₡; si solo hay en $ (≥ $1), manda el de $. Faltante si < 0 (falta plata), Sobrante
// si > 0. La PLATA ya se deriva del mismo signo en recordCierreAjuste — esto solo alinea la ETIQUETA.
// Vive en su propio archivo (no en CashCierre.tsx) para no exportar una función desde un módulo de
// componentes (react-refresh). Mismas tolerancias que cierreNecesitaAjuste.
export function ajusteTipoPorSigno(difCrc: number | null, difUsd: number | null): 'Faltante' | 'Sobrante' {
  if (difCrc !== null && Math.abs(difCrc) >= 500) return difCrc < 0 ? 'Faltante' : 'Sobrante'
  if (difUsd !== null && Math.abs(difUsd) >= 1)   return difUsd < 0 ? 'Faltante' : 'Sobrante'
  return 'Faltante'
}
