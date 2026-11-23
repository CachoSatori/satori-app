// ── Lectura de los cuadros de monto de la apertura, el cierre de turno y el Cierre del día (23-nov, R31) ──
//
// Módulo PURO (no lee la base ni la pantalla). Fuera de sagrados: no calcula nada del cierre, solo decide si lo que
// se escribió en un cuadro se puede usar. Lo usan CashTurno (apertura y cierre de la Caja Diaria) y CashCierre.
//
// Un cuadro `<input type="number">` con texto que no es número («120000-», «0-450», «-», «12abc») entrega
// `value === ''` y marca `validity.badInput`. La pantalla guarda el estado '' y `Number('') || 0` lo volvía 0 sin
// aviso: la caja abría con ₡0, el cierre de turno quedaba «contado ₡0» o el retiro del día no se registraba. Por eso
// cada cuadro lleva una marca de ilegible (onChange Y onInput: con React 19, un cuadro VACÍO al que se le escribe
// algo ilegible no dispara onChange, porque el valor leído sigue siendo '') y acá se convierte en un aviso que
// nombra el cuadro. Vacío sigue siendo 0.
import { leerMonto } from './validarMovimiento'

export interface CuadroMonto {
  /** Cómo lo ve el cajero en pantalla (va en el aviso). */
  nombre: string
  /** Lo que tiene el estado de la pantalla ('' = vacío). */
  valor: unknown
  /** `validity.badInput` del cuadro (texto que no es número). */
  ilegible: boolean
  /** true solo donde un negativo ya se aceptaba antes (no se cambia lo que se guarda con montos válidos). */
  admiteNegativo?: boolean
}

export const msgCuadroIlegible = (nombre: string) =>
  `«${nombre}»: el monto no es un número. Escribí solo números, con punto para los decimales (por ejemplo 12500 o 12500.50), o borralo para dejarlo en 0.`
export const msgCuadroNegativo = (nombre: string) => `«${nombre}»: el monto no puede ser negativo.`

/**
 * El primer cuadro que no se puede usar, con su aviso; null si todos sirven.
 * Ilegible (badInput) o no numérico → aviso de «no es un número». Negativo → aviso, salvo `admiteNegativo`.
 */
export function errorDeCuadros(cuadros: CuadroMonto[]): string | null {
  for (const c of cuadros) {
    const n = c.ilegible ? Number.NaN : leerMonto(c.valor)
    if (!Number.isFinite(n)) return msgCuadroIlegible(c.nombre)
    if (n < 0 && !c.admiteNegativo) return msgCuadroNegativo(c.nombre)
  }
  return null
}

/** La marca de ilegible que deja un evento del cuadro (onChange u onInput). */
export function marcaIlegible(input: { validity?: { badInput?: boolean } | null }): boolean {
  return !!input.validity?.badInput
}
