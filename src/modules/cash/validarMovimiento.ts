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
//   · colones negativos SOLO en un ingreso con dólares: es el vuelto en colones de un cobro en dólares
//     (así guarda el Cierre del Día las «Ventas cierre», recordCierreSales; el saldo lo cuenta bien).
//     Una ALTA manual no los admite (Ítem 2); al EDITAR un vuelto que ya existe, sí, para que se pueda
//     corregir sin romperlo. Si un vuelto se pasa a egreso, el egreso quedaría negativo: se rechaza.

export const MSG_MONTO_INVALIDO = 'El monto no es un número. Escribí solo números (por ejemplo 12500 o 12500,50).'
export const MSG_MONTO_CERO = 'Ingresá un monto mayor a cero.'
export const MSG_MONTO_NEGATIVO = 'El monto no puede ser negativo.'
export const MSG_DOLARES_NEGATIVOS = 'El monto en dólares no puede ser negativo.'
export const MSG_VUELTO_SOLO_INGRESO =
  'Este movimiento tiene colones negativos (el vuelto de un cobro en dólares): solo puede ser un ingreso. Corregí el monto antes de cambiar el tipo.'
export const MSG_VUELTO_SIN_DOLARES =
  'Los colones negativos solo van en un ingreso con dólares (el vuelto). Cargá los dólares o ingresá un monto mayor a cero.'

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

export function validarMovimiento(m: MovimientoAValidar, contexto: ContextoValidacion = 'alta'): ResultadoValidacion {
  const crc = leerMonto(m.crc)
  const usd = leerMonto(m.usd)
  if (!Number.isFinite(crc) || !Number.isFinite(usd)) return { ok: false, error: MSG_MONTO_INVALIDO }
  if (usd < 0) return { ok: false, error: contexto === 'alta' ? MSG_MONTO_NEGATIVO : MSG_DOLARES_NEGATIVOS }
  if (crc < 0) {
    if (contexto === 'alta') return { ok: false, error: MSG_MONTO_NEGATIVO }
    if (m.tipo !== 'ingreso') return { ok: false, error: MSG_VUELTO_SOLO_INGRESO }
    if (usd === 0) return { ok: false, error: MSG_VUELTO_SIN_DOLARES }
    return { ok: true, crc, usd }   // vuelto válido: ingreso con dólares y colones negativos
  }
  if (crc === 0 && usd === 0) return { ok: false, error: MSG_MONTO_CERO }
  // `+ 0` normaliza -0 (un «-0» escrito a mano) a 0.
  return { ok: true, crc: crc + 0, usd: usd + 0 }
}
