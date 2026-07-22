// T0/T1 · Puente al núcleo del pozo.
//
// El prototipo del modelo vivía acá durante el T0. En el T1 se PROMOVIÓ a
// `src/modules/cash/pozo.ts`, así que este archivo ya no reimplementa nada: reexporta.
// Mantener dos copias de lógica de plata es la forma más barata de que se separen sin que
// nadie se entere — y el reporte seguiría diciendo que todo cuadra.
//
// Lo único que queda propio acá es `contribucionCajaFuerte`, que NO pertenece a la app: es
// el espejo del modelo VIEJO, fila por fila, para poder desglosar la diferencia pozo−CF. La
// función real (`saldoCajaFuerte`) solo devuelve el total, y no se toca.

import type { CashMovement } from '../../src/shared/types/database.ts'
import {
  contribucionPozo as contribucionPozoApp,
  saldoPozoEfectivo as saldoPozoEfectivoApp,
  type Contribucion,
  type SaldoPozo,
} from '../../src/modules/cash/pozo.ts'

export {
  CAJAS_FISICAS,
  CAJA_BANCO,
  cuentaEnPozo,
  esCajaFisica,
  esEfectivo,
  parseTraspaso,
  type ClasePozo,
  type Contribucion,
  type Indeterminados,
  type SaldoPozo,
} from '../../src/modules/cash/pozo.ts'

/** Forma mínima que necesitan los espejos del harness. Compatible con `CashMovement`. */
export type MovPozo = {
  caja_origen?: string | null
  method?: string | null
  movement_type?: string | null
  subcategory?: string | null
  status?: string | null
  amount_crc?: number | null
  amount_usd?: number | null
}

// El harness lee filas crudas de la base y las modela con tipos laxos (`MovPozo`/`Mov`),
// mientras que la app tipa `CashMovement` completo. En runtime son la misma fila; el cast
// vive acá, UNA vez y explicado, en vez de repartido como `as never` por cada llamada.
const comoFila = (m: MovPozo): CashMovement => m as CashMovement

/** `contribucionPozo` del núcleo promovido, aceptando la fila laxa del harness. */
export function contribucionPozo(m: MovPozo): Contribucion {
  return contribucionPozoApp(comoFila(m))
}

/** `saldoPozoEfectivo` del núcleo promovido, aceptando las filas laxas del harness. */
export function saldoPozoEfectivo(movs: MovPozo[]): SaldoPozo {
  return saldoPozoEfectivoApp(movs.map(comoFila))
}

/** Espejo de EGRESO_TYPES de cashUtils — literal a propósito, para que el espejo no derive. */
const TIPOS_EGRESO = ['egreso_mercaderia', 'egreso_personal', 'egreso_operativo', 'egreso_socios']

function esEgresoLiteral(tipo: string | null | undefined): boolean {
  return TIPOS_EGRESO.includes(String(tipo ?? ''))
}

// ── Espejo de saldoCajaFuerte, fila por fila ─────────────────────────────────
//
// `saldoCajaFuerte` (src/modules/cash/cashUtils.ts) devuelve un total, no el aporte de
// cada fila, y NO se puede tocar. Para desglosar la diferencia pozo−CF por
// (caja_origen × movement_type) hace falta el aporte por fila, así que se replica acá.
// run.ts VERIFICA que la suma de este espejo sea idéntica a la función real: si el espejo
// se desviara, el reporte aborta en vez de mentir.

/** Aporte de UNA fila a `saldoCajaFuerte`. Réplica literal de la lógica de cashUtils. */
export function contribucionCajaFuerte(m: MovPozo): { crc: number; usd: number } {
  if (String(m.caja_origen ?? '') !== 'Caja Fuerte' || m.status === 'pendiente') return { crc: 0, usd: 0 }
  const c = m.amount_crc || 0
  const u = m.amount_usd || 0
  const tipo = String(m.movement_type ?? '')
  if (tipo === 'ingreso') return { crc: c, usd: u }
  if (esEgresoLiteral(tipo)) return { crc: -c, usd: -u }
  if (tipo === 'traspaso') {
    const entra = /→\s*caja fuerte/i.test(m.subcategory || '')
    return entra ? { crc: c, usd: u } : { crc: -c, usd: -u }
  }
  return { crc: 0, usd: 0 }
}
