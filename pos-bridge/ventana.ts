// ── pos-bridge · ritmo del agente y ventana de lectura ─────────────────────────
//
// Puro: recibe el instante, no lo consulta. Así el ritmo se prueba sin esperar.

/** Costa Rica es UTC−6 FIJO (sin horario de verano). Es la única zona de este archivo. */
const CR_TZ = 'America/Costa_Rica'

/** Hora del reloj de pared de Costa Rica (0–23) de un instante cualquiera. */
export function horaCR(d: Date): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: CR_TZ, hour: '2-digit', hour12: false,
  }).format(d)
  return Number(hh) % 24
}

/** `'2026-09-01 19:42:07'` — el mismo formato naive con el que el PoS guarda las fechas. */
export function naiveCR(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: CR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  const hora = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')} ${hora}:${g('minute')}:${g('second')}`
}

export interface Ventana {
  /** Hora CR en que abre la operación (inclusive). */
  inicio: number
  /** Hora CR en que cierra (exclusive). Puede ser MENOR que `inicio`: cruza medianoche. */
  fin:    number
}

/** El restaurante abre a las 10 y cierra a las 2 de la mañana: la ventana cruza la medianoche. */
export function enOperacion(hora: number, v: Ventana): boolean {
  return v.inicio <= v.fin
    ? hora >= v.inicio && hora < v.fin
    : hora >= v.inicio || hora < v.fin
}

export interface RitmoConfig {
  ventana:        Ventana
  operacionMs:    number
  madrugadaMs:    number
}

/**
 * Cada cuánto volver a mirar. En operación se pollea seguido (la mesa abierta tiene que
 * verse casi en vivo); de madrugada el PoS no factura y machacarlo no aporta nada.
 */
export function intervaloMs(ahora: Date, cfg: RitmoConfig): number {
  return enOperacion(horaCR(ahora), cfg.ventana) ? cfg.operacionMs : cfg.madrugadaMs
}

export interface RangoLectura { desde: string; hasta: string }

/**
 * La ventana de facturas que se relee en cada ciclo, en hora de pared de Costa Rica.
 *
 * Hacia atrás `horasAtras` (default 36 h): cubre el turno que cruza la medianoche y un
 * reinicio del agente sin releer el histórico entero. Hacia adelante un margen, porque
 * el reloj de la PC del PoS puede ir unos minutos adelantado y una factura con fecha
 * "futura" quedaría afuera para siempre.
 */
export function rangoLectura(ahora: Date, horasAtras: number, horasAdelante = 2): RangoLectura {
  return {
    desde: naiveCR(new Date(ahora.getTime() - horasAtras * 3_600_000)),
    hasta: naiveCR(new Date(ahora.getTime() + horasAdelante * 3_600_000)),
  }
}
