import type { CashMovement, CashSession } from '../../shared/types/database'
import { saldoCajaFuerte } from './cashUtils'
import { saldoPozoEfectivo } from './pozo'
import { esPostCorte, fechaAperturaPozo, fechaOperativa } from './cierrePozo'

// ── La tarjeta de efectivo de Movimientos ────────────────────────────────────
//
// LA REGLA ORIGINAL, que la app había perdido. En el repo viejo (satori-caja, `buildSaldos`,
// commit 49d9fd1 "restar todos los egresos en efectivo de CF") el saldo se armaba así:
// **TODOS los egresos en EFECTIVO restan, venga de la caja que venga**; las ventas entran
// brutas; las propinas son un egreso visible; traspasos y transferencias son neutros.
//
// Al portar la app, `saldoCajaFuerte` se achicó a `caja_origen = 'Caja Fuerte'` y esa regla se
// perdió: un pago a proveedor en efectivo desde `Caja Proveedores` dejó de restar. Es
// exactamente la misma enfermedad que T2 ya curó en el CIERRE; acá se cura la tarjeta.
//
// El equivalente moderno de aquel `buildSaldos` es `saldoPozoEfectivo`: las tres cajas físicas
// suman al mismo saldo y cada salida resta una sola vez.
//
// ⚠️ `saldoCajaFuerte` (cashUtils.ts) NO se toca — es sagrado y lo sigue usando el pre-corte.

export interface SaldoTarjeta {
  crc: number
  usd: number
  /** true = está mostrando el pozo (post-corte); false = el saldo viejo de Caja Fuerte. */
  esPozo: boolean
  /** Fecha del asiento de apertura desde el que se cuenta (null si no hay). */
  desdeApertura: string | null
  /** Traspasos sin dirección legible: neutros, pero la UI los puede avisar. */
  indeterminados: { cantidad: number; crc: number; usd: number }
}

const SIN_INDETERMINADOS = { cantidad: 0, crc: 0, usd: 0 }

/**
 * Saldo que muestra la tarjeta.
 *
 * **Post-corte** (hay movimientos con fecha operativa >= `POZO_CORTE`): el POZO, contado desde
 * el asiento de apertura más reciente — el mismo número que usa el "debería" del cierre, así
 * que la tarjeta y el cierre no pueden discrepar.
 *
 * **Pre-corte**: `saldoCajaFuerte`, byte por byte lo de siempre.
 *
 * El corte se decide por los DATOS, no por el reloj: si ya hay movimientos post-corte, la
 * tarjeta muestra el pozo. Así no cambia de significado a medianoche.
 */
export function saldoTarjetaEfectivo(
  movements: CashMovement[],
  sessions: CashSession[],
): SaldoTarjeta {
  const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))

  // BASE VACÍA = arranque de cero. El modo pre-corte existe para NO tocar el histórico; sin
  // una sola fila no hay histórico que preservar, así que caer al modelo viejo no protege nada
  // y confunde: la tarjeta arrancaría rotulada "Caja Fuerte" y se renombraría sola a "Efectivo
  // en caja" al registrar el primer movimiento. El NÚMERO es ₡0 por las dos vías (el pozo de
  // una lista vacía es cero); lo que se fija acá es el rótulo y el modo, para que el primer día
  // no cambie de significado solo. Sin apertura sembrada: `desdeApertura` queda en null y el
  // subtítulo no promete una fecha que no existe.
  if (movements.length === 0) {
    return { crc: 0, usd: 0, esPozo: true, desdeApertura: null, indeterminados: SIN_INDETERMINADOS }
  }

  const apertura = fechaAperturaPozo(movements, sesionFecha)

  // Post-corte si hay apertura sembrada o si ya se registró algo del corte en adelante.
  const hayPostCorte =
    (apertura !== null && esPostCorte(apertura)) ||
    movements.some(m => esPostCorte(fechaOperativa(m, sesionFecha)))

  if (!hayPostCorte) {
    const v = saldoCajaFuerte(movements)
    return { crc: v.crc, usd: v.usd, esPozo: false, desdeApertura: null, indeterminados: SIN_INDETERMINADOS }
  }

  // Desde la apertura: esa cifra ya contiene todo lo anterior (misma regla que el cierre).
  const base = apertura === null
    ? movements
    : movements.filter(m => fechaOperativa(m, sesionFecha) >= apertura)

  const v = saldoPozoEfectivo(base)
  return { crc: v.crc, usd: v.usd, esPozo: true, desdeApertura: apertura, indeterminados: v.indeterminados }
}
