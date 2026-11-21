// ── Validación del turno de propinas: nada negativo (decisión del dueño, 20-nov-2026) ──────────────
//
// Módulo PURO, fuera de sagrados. `calcTurno` (src/shared/utils/tipCalculations.ts) no valida su
// entrada: con horas o montos negativos reparte números sin sentido. Esto frena ANTES de cerrar el turno
// o de guardar una edición en «Historial», con un mensaje que dice qué corregir. Si pasa, nada cambia:
// el reparto es el mismo de siempre. El pozo que nadie cobra (H1/H2) lo cuida `guardasCierre.ts`.

export interface LineaTurno {
  nombre:       string
  activa:       boolean
  hours:        number | string | '' | null | undefined
  propina_crc?: number | string | '' | null
  propina_usd?: number | string | '' | null
}

export interface DatosTurno {
  lineas:       readonly LineaTurno[]
  efectivoCRC:  number | string | '' | null | undefined
  efectivoUSD:  number | string | '' | null | undefined
  barraCRC:     number | string | '' | null | undefined
  barraElecCRC: number | string | '' | null | undefined
  exchangeRate: number | string | '' | null | undefined
}

const vacio = (v: unknown) => v === '' || v === null || v === undefined
const num = (v: unknown): number => (vacio(v) ? 0 : Number(v))

export const TEXTO_TIPO_CAMBIO = 'El tipo de cambio tiene que ser un número mayor que 0.'

/** Tipo de cambio de un turno nuevo (o con dólares): número finito y mayor que 0. null = válido. */
export function validarTipoCambio(v: unknown): string | null {
  const n = vacio(v) ? Number.NaN : Number(v)
  return Number.isFinite(n) && n > 0 ? null : TEXTO_TIPO_CAMBIO
}

/** Primer problema encontrado, en palabras para quien cierra o edita; null = se puede seguir. */
export function validarTurno(d: DatosTurno): string | null {
  const pozo: [string, unknown][] = [
    ['💵 Efectivo ₡', d.efectivoCRC], ['💵 Efectivo $', d.efectivoUSD],
    ['🍸 Barra efectivo', d.barraCRC], ['🍸 Barra electrónico', d.barraElecCRC],
  ]
  for (const [que, v] of pozo) {
    const n = num(v)
    if (!Number.isFinite(n)) return `«${que}» no es un número válido.`
    if (n < 0) return `Los montos no pueden ser negativos: revisá «${que}».`
  }
  let hayDolares = num(d.efectivoUSD) > 0
  for (const l of d.lineas) {
    if (!l.activa) continue
    const h = num(l.hours)
    if (!Number.isFinite(h)) return `Las horas de ${l.nombre} no son un número válido.`
    if (h < 0) return `Las horas no pueden ser negativas: revisá a ${l.nombre}.`
    for (const [que, v] of [['propina ₡', l.propina_crc], ['propina $', l.propina_usd]] as const) {
      const n = num(v)
      if (!Number.isFinite(n)) return `La ${que} de ${l.nombre} no es un número válido.`
      if (n < 0) return `Los montos no pueden ser negativos: revisá la ${que} de ${l.nombre}.`
    }
    if (num(l.propina_usd) > 0) hayDolares = true
  }
  // Sin dólares el tipo de cambio no entra al reparto; con dólares, tiene que ser > 0.
  if (hayDolares) return validarTipoCambio(d.exchangeRate)
  return null
}
