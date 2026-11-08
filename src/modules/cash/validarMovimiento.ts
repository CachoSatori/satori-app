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

export function errorMontos(m: { tipo: string; crc: unknown; usd: unknown }): string | null {
  const crc = m.crc === '' || m.crc == null ? 0 : Number(m.crc)
  const usd = m.usd === '' || m.usd == null ? 0 : Number(m.usd)
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
