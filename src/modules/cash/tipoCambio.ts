// Tipo de cambio (TC) del cierre del día — validación de la ENTRADA (decisión del dueño, 14-nov).
//
// El TC acepta hasta 2 decimales (p. ej. 503.45). No se redondea: si alguien carga más de 2 decimales,
// el cierre se frena con un mensaje en vez de guardar un valor distinto del que se ve. Motivo:
// cash_movements.exchange_rate es numeric(10,2) y redondearía en silencio un 503.456 a 503.46, mientras
// el cálculo del cierre y cash_cierres_dia.tipo_cambio (numeric) usarían 503.456.
//
// Solo valida el número que entra; la matemática del cierre (efectivo real, debería, diferencia) no
// cambia y sigue en CashCierre/cierrePozo.

/** Mensaje si el TC no se puede usar en el cierre; null si está bien. */
export function errorTipoCambio(tc: number): string | null {
  if (!Number.isFinite(tc) || tc <= 0) return 'El tipo de cambio tiene que ser mayor que 0.'
  if (Number(tc.toFixed(2)) !== tc) return 'El tipo de cambio admite hasta 2 decimales (por ejemplo 503.45).'
  return null
}
