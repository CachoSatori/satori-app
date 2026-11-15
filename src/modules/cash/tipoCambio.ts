// Tipo de cambio (TC) del cierre del día — lectura y validación de la ENTRADA (decisión del dueño, 14-nov).
//
// · Acepta punto o coma como separador decimal («503.45» y «503,45» → 503.45) sin depender del idioma
//   del navegador: el campo es de texto (inputMode="decimal"). Con type="number", el separador que el
//   navegador no espera daba "" y React se comía el punto: «503.45» terminaba en 50345.
// · Rango 300–900 (el de siempre del campo): frena un 50345 o un 5034 antes de sellar.
// · Hasta 2 decimales, sin redondear: cash_movements.exchange_rate es numeric(10,2) y redondearía en
//   silencio un 503.456, mientras el cálculo del cierre y cash_cierres_dia.tipo_cambio usarían 503.456.
//
// Solo valida el número que entra; la matemática del cierre (efectivo real, debería, diferencia) no
// cambia y sigue en CashCierre/cierrePozo.

export const TC_MIN = 300
export const TC_MAX = 900

/** Texto del campo → número. Un solo separador decimal (punto o coma). Vacío o raro → NaN. */
export function parseTipoCambio(txt: string): number {
  const t = txt.trim()
  if (!/^\d+([.,]\d+)?$/.test(t)) return Number.NaN
  return Number(t.replace(',', '.'))
}

/** Mensaje si el TC no se puede usar en el cierre; null si está bien. */
export function errorTipoCambio(tc: number): string | null {
  if (!Number.isFinite(tc) || tc <= 0) return 'Ingresá el tipo de cambio (por ejemplo 503,45).'
  if (tc < TC_MIN || tc > TC_MAX) return `Revisá el tipo de cambio: ¿es ~500? Tiene que estar entre ${TC_MIN} y ${TC_MAX}.`
  if (Number(tc.toFixed(2)) !== tc) return 'El tipo de cambio admite hasta 2 decimales (por ejemplo 503,45).'
  return null
}

/** Aviso (no bloquea) si el TC se aleja más de ±10 % del TC de referencia (el último de Admin). */
export function avisoTipoCambio(tc: number, referencia: number | null): string | null {
  if (!referencia || referencia <= 0 || !Number.isFinite(tc)) return null
  if (Math.abs(tc - referencia) / referencia <= 0.10) return null
  return `Ojo: se aleja más de 10 % del tipo de cambio de Admin (₡${referencia.toLocaleString('es-CR')}). Revisalo antes de confirmar.`
}
