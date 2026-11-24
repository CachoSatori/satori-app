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

// ── Lo que el cuadro muestra y el navegador no puede leer (validación física del dueño, 23-nov) ──────
// Un <input type="number"> que muestra un texto que no es número (p. ej. «0-450»: el cuadro traía «0» y se
// escribió «-450» detrás) devuelve `value === ""`, igual que vacío; solo `validity.badInput` lo distingue.
// Antes eso se tomaba como vacío (= 0): el cuadro mostraba «-450», la validación veía 0 y el cierre guardaba
// 0 sin avisar. Ahora el estado guarda NaN («ilegible»): `validarTurno` lo frena nombrando a la persona y
// `montoGuardable` no lo autoguarda. Al input se le pasa '' (`valorInput`) para que React no borre lo que se ve.

// `esIlegible`, `alEscribir` y `valorInput` viven en src/shared/cuadrosNumericos.ts (mudados sin cambios, R35).
export { esIlegible, alEscribir, valorInput } from '../../shared/cuadrosNumericos'

/** Lo ilegible (NaN) de una fila que se desmarca o cuyo cuadro se oculta vuelve a vacío: si no, bloquea sin verse. */
export function sinIlegibles<T extends object>(fila: T): T {
  const out = { ...fila } as Record<string, unknown>
  for (const k of Object.keys(out)) if (typeof out[k] === 'number' && Number.isNaN(out[k])) out[k] = ''
  return out as T
}

export const TEXTO_TIPO_CAMBIO = 'El tipo de cambio tiene que ser un número mayor que 0.'

/** Tipo de cambio de un turno nuevo (o con dólares): número finito y mayor que 0. null = válido. */
export function validarTipoCambio(v: unknown): string | null {
  const n = vacio(v) ? Number.NaN : Number(v)
  return Number.isFinite(n) && n > 0 ? null : TEXTO_TIPO_CAMBIO
}

/** Un monto se puede autoguardar: vacío (= 0) o número finito ≥ 0. */
export function montoGuardable(v: unknown): boolean {
  if (vacio(v)) return true
  const n = Number(v)
  return Number.isFinite(n) && n >= 0
}

/**
 * Edición en «Historial»: cada persona marcada tiene que tener horas > 0 (la base lo exige con
 * `tip_entries_hours_worked_check`; sin esto sale el error crudo del CHECK). null = todas con horas.
 */
export function validarHorasEdicion(lineas: readonly LineaTurno[]): string | null {
  for (const l of lineas) {
    if (!l.activa) continue
    const h = num(l.hours)
    if (!(h > 0)) return `${l.nombre} está marcado con 0 horas: cargale las horas que trabajó o desmarcalo.`
  }
  return null
}

/** Primer problema encontrado, en palabras para quien cierra o edita; null = se puede seguir. */
export function validarTurno(d: DatosTurno): string | null {
  const pozo: [string, unknown][] = [
    ['💵 Efectivo ₡', d.efectivoCRC], ['💵 Efectivo $', d.efectivoUSD],
    ['🍸 Barra efectivo', d.barraCRC], ['🍸 Barra electrónico', d.barraElecCRC],
  ]
  for (const [que, v] of pozo) {
    const n = num(v)
    if (!Number.isFinite(n)) return `No se puede leer «${que}» (¿quedó un «-»?): borralo y escribilo de nuevo, solo con números.`
    if (n < 0) return `Los montos no pueden ser negativos: revisá «${que}».`
  }
  let hayDolares = num(d.efectivoUSD) > 0
  for (const l of d.lineas) {
    if (!l.activa) continue
    const h = num(l.hours)
    if (!Number.isFinite(h)) return `No se pueden leer las horas de ${l.nombre} (¿quedó un «-»?): borralas y escribilas de nuevo, solo con números.`
    if (h < 0) return `Las horas no pueden ser negativas: revisá a ${l.nombre}.`
    for (const [que, v] of [['propina ₡', l.propina_crc], ['propina $', l.propina_usd]] as const) {
      const n = num(v)
      if (!Number.isFinite(n)) return `No se puede leer la ${que} de ${l.nombre} (¿quedó un «-»?): borrala y escribila de nuevo, solo con números.`
      if (n < 0) return `Los montos no pueden ser negativos: revisá la ${que} de ${l.nombre}.`
    }
    if (num(l.propina_usd) > 0) hayDolares = true
  }
  // Sin dólares el tipo de cambio no entra al reparto; con dólares, tiene que ser > 0.
  if (hayDolares) return validarTipoCambio(d.exchangeRate)
  return null
}
