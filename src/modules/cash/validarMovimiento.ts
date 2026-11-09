// ── Validación de montos y de la dirección del traspaso (fuera de sagrados, 08-nov) ──────────────
//
// Módulo PURO. Reglas para TODA carga o edición manual de un movimiento de caja:
//   · egresos (y traspasos) siempre ≥ 0, en colones y en dólares;
//   · un INGRESO puede tener colones negativos si tiene dólares: es el vuelto en colones de un cobro en
//     dólares (así se guardan las «Ventas cierre» desde junio; el saldo los cuenta bien);
//   · dólares nunca negativos;
//   · un traspaso lleva una dirección de la lista (nunca texto libre): el saldo de Caja Fuerte decide si
//     suma o resta mirando «→ Caja Fuerte» en la subcategoría (cashUtils, sagrado, no se toca).

/** Las únicas direcciones de traspaso que se cargan desde la app. */
export const TRASPASOS = ['Banco → Caja Fuerte', 'Caja Fuerte → Banco'] as const
export type DireccionTraspaso = (typeof TRASPASOS)[number]

export function esDireccionValida(sub: string | null | undefined): sub is DireccionTraspaso {
  return (TRASPASOS as readonly string[]).includes(sub ?? '')
}

/**
 * Monto tal como llega de un input o de la cola (número o texto) → número, SIN convertir lo inválido en 0:
 *   · vacío / null / undefined → 0 (campo sin cargar);
 *   · número finito → él mismo; NaN o ±Infinity → NaN;
 *   · texto con coma decimal («1500,50») o con miles y coma («1.234,5») → se lee en formato de Costa Rica;
 *     con punto decimal («1500.50») también; cualquier otra cosa («1,2,3», «12abc», «1.5,5») → NaN.
 * El que llama decide qué hacer con NaN (errorMontos lo rechaza): nunca `Number(x) || 0` antes del control.
 */
export function parsearMonto(v: unknown): number {
  if (v === '' || v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN
  if (typeof v !== 'string') return Number.NaN
  const t = v.replace(/[\s\u00a0]/g, '')
  if (t === '') return 0
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)                                   // 1500 · 1500.50
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'))                       // 1500,50
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))  // 1.234,5
  return Number.NaN
}

export function errorMontos(m: { tipo: string; crc: unknown; usd: unknown }): string | null {
  const crc = parsearMonto(m.crc)
  const usd = parsearMonto(m.usd)
  if (!Number.isFinite(crc) || !Number.isFinite(usd)) return 'El monto no es un número válido.'
  if (usd < 0) return 'El monto en dólares no puede ser negativo.'
  if (crc < 0) {
    if (m.tipo === 'ingreso' && usd > 0) return null   // vuelto en colones de un cobro en dólares
    return m.tipo === 'ingreso'
      ? 'Colones negativos solo en un ingreso con dólares (el vuelto). Sin dólares, el monto no puede ser negativo.'
      : 'El monto no puede ser negativo.'
  }
  return null
}

export function errorTraspaso(m: { tipo: string; subcategory: string | null | undefined }): string | null {
  if (m.tipo !== 'traspaso') return null
  return esDireccionValida(m.subcategory) ? null : `El traspaso tiene que tener una dirección de la lista: ${TRASPASOS.join(' / ')}.`
}

/**
 * El movimiento COMPLETO, como quedaría después de un cambio (tipo o importe): montos (errorMontos), traspaso con
 * dirección de la lista (si se pasa la subcategoría) y, si `exigirMonto`, que no quede en cero en las dos monedas.
 */
export function errorMovimiento(m: {
  tipo: string; crc: unknown; usd: unknown; subcategory?: string | null; exigirMonto?: boolean
}): string | null {
  const e = errorMontos(m)
  if (e) return e
  if (m.exigirMonto && parsearMonto(m.crc) === 0 && parsearMonto(m.usd) === 0) {
    return 'El movimiento no puede quedar en cero: cargá colones o dólares.'
  }
  if (m.subcategory !== undefined) return errorTraspaso({ tipo: m.tipo, subcategory: m.subcategory })
  return null
}
