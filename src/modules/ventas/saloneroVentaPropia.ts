// ── El bloque «venta propia por línea» de UNA persona ───────────────────────────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Recibe la lente A ya calculada
// (`saloneroLentes.calcularLentes`) y la recorta a la persona que el usuario abrió en la
// pestaña Saloneros, partida por turno.
//
// ── LO QUE ESTE MÓDULO NO HACE, Y ES EL PUNTO ──────────────────────────────────────────────
// NO desglosa el total de la tarjeta. Son DOS EJES distintos sobre la misma neta:
//
//   · La TARJETA de Saloneros reparte por el salonero DEL PEDIDO (`claveSalonero` →
//     `salonero_login` de la factura). Una factura entera va a una sola persona.
//   · La LENTE A reparte por el `usuario_registra` de CADA LÍNEA. Una factura partida entre
//     dos meseros se reparte entre los dos.
//
// Por eso el subtotal de acá NO tiene por qué dar el total de arriba, y sumarlos contaría dos
// veces toda mesa compartida. La pantalla lo presenta como una segunda lectura COMPLETA —con
// su propio total— y nunca como el detalle de la primera. Es la misma regla que ya fija
// `saloneroLentes.ts`: «las dos lentes NUNCA se suman».
//
// ── EL PUENTE ENTRE LOS DOS EJES ES EL NOMBRE ──────────────────────────────────────────────
// La tarjeta se llama con `nombreSalonero(login, nombres)` y la lente con
// `nombreDePersona(persona, nombres)`. Los dos resuelven contra el MISMO mapa —
// `employees.pos_login → full_name`, que trae `getSaloneroNombres()` —, así que el nombre es
// la clave de unión natural, y además es la que unifica los códigos de una misma persona
// (`026`/`226` = MAXO) sin que esta pantalla tenga que saber de códigos.
//
// Cuando no hay match NO se inventa nada ni se esconde: `hayDatos` sale `false` y la pantalla
// dice que esa persona no aparece en la lente, en vez de mostrar un cero que se lee como
// «no vendió».

import { nombreDePersona, type PersonaNdf } from '../../shared/ndf/personasNdf'
import {
  etiquetaTurnoSalonero, turnosSalonero,
  type FilaVentaPropia, type LentesSaloneros,
} from './saloneroLentes'

/** Un turno de la persona abierta, con lo que comandó en él. */
export interface TurnoVentaPropia {
  turno:      string
  etiqueta:   string
  netaCrc:    number
  paxPropio:  number
  /** Neta propia ÷ pax propio. `null` si no registró ningún pax en ese turno. */
  promPorPax: number | null
  lineas:     number
}

/** El bloque entero: los turnos con movimiento + el total de la persona. */
export interface VentaPropiaDePersona {
  /** `false` = esa persona no aparece en la lente del período. NO es lo mismo que vender ₡0. */
  hayDatos:   boolean
  turnos:     TurnoVentaPropia[]
  netaCrc:    number
  paxPropio:  number
  promPorPax: number | null
  lineas:     number
}

const VACIO: VentaPropiaDePersona = {
  hayDatos: false, turnos: [], netaCrc: 0, paxPropio: 0, promPorPax: null, lineas: 0,
}

/** El nombre con el que una fila de la lente se muestra, normalizado para comparar. */
function claveDeFila(persona: PersonaNdf, nombres: Record<string, string>): string {
  return nombreDePersona(persona, nombres).trim().toUpperCase()
}

/**
 * La venta propia (lente A) de la persona que se llama `nombreTarjeta`, partida por turno.
 *
 * `nombreTarjeta` es la clave de `DiaData.saloneros` — el nombre que la tarjeta ya muestra.
 * Se compara contra el nombre que la lente le da a cada persona: los dos salen del mismo
 * mapa de `employees`, así que una persona con varios códigos cae en una sola fila.
 *
 * Solo se cuentan filas de rol `mesero`: la caja, el login compartido y los códigos sin
 * clasificar tienen su propio lugar en la pestaña «Saloneros x línea» y no son esta persona.
 */
export function ventaPropiaDe(
  nombreTarjeta: string,
  lentes: LentesSaloneros | null,
  nombres: Record<string, string>,
): VentaPropiaDePersona {
  if (!lentes) return VACIO
  const buscada = nombreTarjeta.trim().toUpperCase()
  const suyas: FilaVentaPropia[] = lentes.ventaPropia.filter(
    f => f.rol === 'mesero' && claveDeFila(f.persona, nombres) === buscada)
  if (suyas.length === 0) return VACIO

  // El orden lo da el mapa de cajas (`turnosSalonero`), no el orden de llegada de las filas:
  // mañana antes que tarde, y el balde `dia` último. Los turnos sin movimiento no se pintan.
  const turnos: TurnoVentaPropia[] = []
  for (const t of turnosSalonero()) {
    const delTurno = suyas.filter(f => f.turno === t.turno)
    if (delTurno.length === 0) continue
    const netaCrc   = delTurno.reduce((s, f) => s + f.netaCrc, 0)
    const paxPropio = delTurno.reduce((s, f) => s + f.paxPropio, 0)
    turnos.push({
      turno:      t.turno,
      etiqueta:   etiquetaTurnoSalonero(t.turno),
      netaCrc,
      paxPropio,
      promPorPax: paxPropio > 0 ? netaCrc / paxPropio : null,
      lineas:     delTurno.reduce((s, f) => s + f.lineas, 0),
    })
  }

  const netaCrc   = turnos.reduce((s, t) => s + t.netaCrc, 0)
  const paxPropio = turnos.reduce((s, t) => s + t.paxPropio, 0)
  return {
    hayDatos:   true,
    turnos,
    netaCrc,
    paxPropio,
    promPorPax: paxPropio > 0 ? netaCrc / paxPropio : null,
    lineas:     turnos.reduce((s, t) => s + t.lineas, 0),
  }
}
