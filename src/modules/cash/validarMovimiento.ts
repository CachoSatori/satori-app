// ── Validación de montos de un movimiento de caja (fuera de sagrados; rehace lo útil del #73, 20-nov) ──
//
// Módulo PURO: no lee la base ni la pantalla. Lo usan las tres puertas de carga manual (Nuevo movimiento,
// la edición de la tabla de Movimientos y Agregar) y el borde de escritura de la API (src/shared/api/cash.ts),
// que valida ANTES de escribir y ANTES de encolar sin conexión.
//
// Reglas (las que ya tenía la app, juntas en un solo lugar):
//   · cada monto es un número finito; vacío cuenta como 0 (la tabla muestra vacío cuando el monto es 0);
//   · el movimiento entero no puede quedar en cero en las dos monedas;
//   · dólares nunca negativos;
//   · colones negativos SOLO en un ingreso. Los guarda así el Cierre del Día en «Ventas cierre»
//     (recordCierreSales): con dólares suele ser el vuelto en colones de cobros en dólares; con $0, las ventas
//     en efectivo menos las propinas pagadas. El saldo los cuenta bien. Una ALTA manual no los admite (Ítem 2).
//     Al EDITAR, se aceptan solo en un ingreso que también tiene dólares (lo de siempre: la tabla no dejaba
//     poner ₡ negativos); uno con $0 se puede editar en sus otros campos, no en el ₡. Si un ingreso con ₡
//     negativos se pasa a egreso o a traspaso, quedaría negativo y el saldo daría mal: se rechaza.

export const MSG_MONTO_INVALIDO = 'El monto no es un número. Escribí solo números (por ejemplo 12500 o 12500,50).'
export const MSG_MONTO_CERO = 'Ingresá un monto mayor a cero.'
export const MSG_MONTO_NEGATIVO = 'El monto no puede ser negativo.'
export const MSG_DOLARES_NEGATIVOS = 'El monto en dólares no puede ser negativo.'
export const MSG_NEGATIVO_SOLO_INGRESO =
  'Solo un ingreso puede tener colones negativos (así los guarda el Cierre del Día). Dejalo como ingreso o corregí el monto.'
export const MSG_NEGATIVO_SIN_DOLARES =
  'Al editar, los colones negativos solo se aceptan en un ingreso que también tiene dólares. Cargá los dólares o ingresá un monto mayor a cero.'

/** `alta`: movimiento nuevo cargado a mano. `edicion`: cambio de tipo o de monto de uno que ya existe. */
export type ContextoValidacion = 'alta' | 'edicion'

export interface MovimientoAValidar {
  tipo: string | null | undefined
  crc: unknown
  usd: unknown
}

export type ResultadoValidacion =
  | { ok: true; crc: number; usd: number }
  | { ok: false; error: string }

/**
 * Monto tal como llega de un input, del estado de la pantalla o de la API → número.
 * Vacío (''/null/undefined) → 0. Número finito → él mismo. Texto: «12500», «12500.50», «12500,50» y «-5000».
 * Cualquier otra cosa (letras, dos separadores, NaN, Infinity, objetos) → NaN: nunca se convierte en 0.
 */
export function leerMonto(v: unknown): number {
  if (v === '' || v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN
  if (typeof v !== 'string') return Number.NaN
  const t = v.replace(/[\s\u00a0\u202f]/g, '')
  if (t === '') return 0
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return Number.NaN
  return Number(t.replace(',', '.'))
}

/**
 * Lo que trae un cuadro de monto `type="number"`. Si el texto no se puede leer como número («12abc», «12e»), el
 * navegador entrega `value === ''` y marca `validity.badInput`: sin mirarlo, eso contaría como vacío (= 0).
 * Con badInput devuelve NaN, que validarMovimiento rechaza con MSG_MONTO_INVALIDO.
 */
export function valorDelCuadro(input: { value: string; validity?: { badInput?: boolean } | null }): string | number {
  return input.validity?.badInput ? Number.NaN : input.value
}

export function validarMovimiento(m: MovimientoAValidar, contexto: ContextoValidacion = 'alta'): ResultadoValidacion {
  const crc = leerMonto(m.crc)
  const usd = leerMonto(m.usd)
  if (!Number.isFinite(crc) || !Number.isFinite(usd)) return { ok: false, error: MSG_MONTO_INVALIDO }
  if (usd < 0) return { ok: false, error: contexto === 'alta' ? MSG_MONTO_NEGATIVO : MSG_DOLARES_NEGATIVOS }
  if (crc < 0) {
    if (contexto === 'alta') return { ok: false, error: MSG_MONTO_NEGATIVO }
    if (m.tipo !== 'ingreso') return { ok: false, error: MSG_NEGATIVO_SOLO_INGRESO }
    if (usd === 0) return { ok: false, error: MSG_NEGATIVO_SIN_DOLARES }
    return { ok: true, crc, usd }   // ingreso con dólares y colones negativos (p. ej. el vuelto): válido
  }
  if (crc === 0 && usd === 0) return { ok: false, error: MSG_MONTO_CERO }
  // `+ 0` normaliza -0 (un «-0» escrito a mano) a 0.
  return { ok: true, crc: crc + 0, usd: usd + 0 }
}
