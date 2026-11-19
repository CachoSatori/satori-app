// ── «→ Caja» de Ventas → Hoy: cuándo puede escribir ──────────────────────────────────────
//
// El botón crea un `ingreso` en `cash_movements` dentro del turno de caja ABIERTO. Ese turno es
// siempre el de la jornada en curso, así que solo tiene sentido mandar la venta del MISMO día:
// la venta de un día viejo caería en la caja de hoy (regla 11 de ESTADO: la fecha del movimiento
// es la del turno). Además, desde el corte del pozo la venta entra por el Cierre del Día y este
// atajo la duplicaría.
//
// Puro (sin React ni red) para probarlo solo. No toca `cierrePozo.ts`: solo usa `esPostCorte`.
import { esPostCorte, POZO_CORTE } from '../cash/cierrePozo'

export type BloqueoACaja = 'pozo' | 'otro_dia' | 'turno_de_otro_dia' | null

export const AVISO_A_CAJA: Record<Exclude<BloqueoACaja, null>, string> = {
  pozo:
    'Desde el pozo, las ventas entran por el Cierre del Día (ventas brutas). «→ Caja» duplicaría el ingreso.',
  otro_dia:
    '«→ Caja» solo registra la venta de la jornada en curso. La venta de otro día no se manda a la caja de hoy.',
  turno_de_otro_dia:
    'El turno de caja abierto no es de este día. «→ Caja» no registra la venta en un turno de otra fecha.',
}

/**
 * Por qué «→ Caja» NO puede escribir la venta de `fecha` (o `null` si puede).
 * `hoy` es la jornada en curso en hora CR (`todayCR()`). El orden importa solo para el texto:
 * un día desde el corte siempre dice «pozo» (el comportamiento de antes).
 */
export function bloqueoACaja(fecha: string, hoy: string, corte: string = POZO_CORTE): BloqueoACaja {
  if (esPostCorte(fecha, corte)) return 'pozo'
  if (!fecha || fecha !== hoy) return 'otro_dia'
  return null
}

/** Segunda llave, con el turno ya leído: el turno abierto tiene que ser del mismo día. */
export function bloqueoPorTurno(fecha: string, sessionDate: string | null | undefined): BloqueoACaja {
  return sessionDate === fecha ? null : 'turno_de_otro_dia'
}
