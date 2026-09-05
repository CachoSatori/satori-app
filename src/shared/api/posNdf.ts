import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase } from './supabase'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Lectura de las ventas del PoS "Nube de Fuego" (`pos_ndf_*`) — SOLO SELECT              ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Las escribe el puente del PoS (Edge `ingest-ndf`, service-role). Desde la app son de SOLO
// LECTURA: la RLS de la mig 062 no tiene una sola policy de escritura, así que ni siquiera
// habría cómo. Acá no se calcula plata — los montos vienen ya resueltos de la ingesta.
//
// ⚠️ ESTA RAMA SOLO SIRVE CONTRA STAGING. Las tablas `pos_ndf_*` las crea la migración 062, que
// está APLICADA A STAGING (2026-09-04) pero cuyo archivo vive en `feat/analitica`, no en
// `staging`. A propósito: traer el .sql a esta rama pondría la DDL a un merge de distancia de
// producción, donde `pos_ndf` no existe y no tiene por qué existir todavía. Si esto se lleva a
// prod alguna vez, la 062 va PRIMERO y firmada.
//
// ── LA JORNADA NO ES EL DÍA CIVIL ──────────────────────────────────────────────────────────
// El corte es 07:00 → 07:00 hora de Costa Rica: lo que se factura a la 1 de la mañana pertenece
// al servicio de la noche anterior. En SQL la jornada de un ticket sería
//   ((fecha_registra at time zone 'America/Costa_Rica') - interval '7 hours')::date
// y acá se expresa como el rango equivalente sobre `fecha_registra` (timestamptz), que además
// usa el índice `pos_ndf_tickets (local, fecha_registra)` en vez de escanear la tabla.
//
// Costa Rica es UTC−6 FIJO (sin horario de verano): por eso el offset se escribe a mano y no
// se delega en la zona del navegador, que sería la del que mira la pantalla.

/** Offset de Costa Rica. Fijo, sin horario de verano. */
export const CR_OFFSET = '-06:00'

/** Hora a la que arranca y termina la jornada de servicio. */
export const HORA_CORTE_JORNADA = 7

/** `'2026-09-01'` → el rango `[inicio, fin)` de esa jornada, en instantes con zona. */
export function ventanaJornada(businessDate: string): { desde: string; hasta: string } {
  const [y, m, d] = businessDate.split('-').map(Number)
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const hh = String(HORA_CORTE_JORNADA).padStart(2, '0')
  return {
    desde: `${businessDate}T${hh}:00:00${CR_OFFSET}`,
    hasta: `${siguiente}T${hh}:00:00${CR_OFFSET}`,
  }
}

/** El instante de un ticket → a qué jornada pertenece. Inversa de `ventanaJornada`. */
export function businessDateDe(fechaRegistra: string): string {
  const t = Date.parse(fechaRegistra)
  if (Number.isNaN(t)) return ''
  // A hora de pared CR y después se le restan las 7 h del corte.
  const cr = new Date(t - 6 * 3_600_000 - HORA_CORTE_JORNADA * 3_600_000)
  return cr.toISOString().slice(0, 10)
}

/**
 * El cliente tipado con `Database` todavía no conoce `pos_ndf_*` (la mig 062 es posterior a
 * `supabase.gen.ts`), así que acá se lo toma con su tipo genérico. Es el ÚNICO punto sin el
 * esquema generado, está en el borde de I/O, y lo que sale de estas funciones vuelve a estar
 * tipado con las interfaces de este archivo.
 */
const sb = supabase as unknown as SupabaseClient

// ── Ventas por turno de caja, para PRE-CARGAR el cierre ─────────────────────────────────────

/** Lo que un turno de caja vendió, en las dos monedas que el cajero cuenta. */
export interface TurnoVentas {
  /** Colones. `SUM(total_crc)` — medios de pago menos vuelto. */
  crc: number
  /** Dólares FÍSICOS del turno: `SUM(dolares_efectivo + dolares_tarjeta)`. */
  usd: number
}

export interface VentasPorTurnoPoS {
  mediodia: TurnoVentas
  noche:    TurnoVentas
}

/** Los dos cajeros de turno del PoS. Son los que parten el día en dos cierres. */
export const CAJERO_MEDIODIA = '111'
export const CAJERO_NOCHE    = '222'

/** La fila cruda que hace falta para sumar un turno. */
export interface FilaTurnoRow {
  cajero_login:     string | null
  total_crc:        number | null
  dolares_efectivo: number | null
  dolares_tarjeta:  number | null
}

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * PURO: filas → el total de cada turno. Se prueba sin Supabase.
 *
 * **Solo entran los cajeros de turno 111 y 222.** Una factura registrada por el sistema
 * (002/01/02), por un cajero distinto, o sin cajero, queda FUERA del pre-llenado: el cierre de
 * caja lo firma una persona por su turno, y meterle plata que no pasó por su caja le haría
 * cuadrar contra un número que no es el suyo. Que quede afuera del PRE-LLENADO no la saca del
 * día: si esa venta existe, el cajero la agrega a mano — el campo sigue siendo editable.
 */
export function sumarVentasPorTurno(filas: FilaTurnoRow[]): VentasPorTurnoPoS {
  const vacio = (): TurnoVentas => ({ crc: 0, usd: 0 })
  const out: VentasPorTurnoPoS = { mediodia: vacio(), noche: vacio() }
  for (const f of filas) {
    const destino =
      f.cajero_login === CAJERO_MEDIODIA ? out.mediodia
      : f.cajero_login === CAJERO_NOCHE  ? out.noche
      : null
    if (destino === null) continue
    destino.crc += n(f.total_crc)
    destino.usd += n(f.dolares_efectivo) + n(f.dolares_tarjeta)
  }
  // Los colones se redondean (son colones, no hay centavos); los dólares NO — el cajero cuenta
  // billetes y monedas, y ahí el centavo existe.
  out.mediodia.crc = Math.round(out.mediodia.crc)
  out.noche.crc    = Math.round(out.noche.crc)
  return out
}

/**
 * Lo que el PoS dice que vendió cada turno de caja en una jornada — para PRE-CARGAR el cierre.
 *
 * ⚠️⚠️ **QUÉ CAMPO SE USA ES PUNTO DE VALIDACIÓN PENDIENTE (B3).** Acá `crc` sale de
 * `SUM(total_crc)`, que es la suma de los medios de pago MENOS el vuelto — el criterio es que
 * eso es contra lo que el cajero cuadra el efectivo de su caja. Es una ELECCIÓN, no un hecho
 * verificado: hay que cotejarla contra un **ticket físico de corte real** antes de confiar en
 * ella. Los otros candidatos serían el valor servido (neto) o el bruto con impuestos, y dan
 * números distintos.
 *
 * Hasta que ese cotejo esté hecho, esto **pre-llena, no decide**: el campo del cierre sigue
 * editable y el cajero manda. Nada de lo que sale de acá entra en `deberia`, ni en los gates,
 * ni en el sellado.
 *
 * **NO se deriva IVA ni neto.** El PoS informa `iva_crc` en 0 en todo el histórico y calcular
 * un impuesto que nadie cobró sería inventar plata; acá directamente no hace falta, porque lo
 * que el cajero cuenta es plata, no base imponible.
 *
 * `local` va como parámetro con default: hoy solo ingesta Santa Teresa, pero el día que entre
 * Nosara, sumar los dos locales en un mismo cierre le haría cuadrar al cajero contra la venta
 * de otro restaurante.
 */
export async function getVentasPorTurno(
  jornada: string,
  local = 'santa-teresa',
): Promise<VentasPorTurnoPoS> {
  const { desde, hasta } = ventanaJornada(jornada)
  const { data, error } = await sb
    .from('pos_ndf_tickets')
    .select('cajero_login, total_crc, dolares_efectivo, dolares_tarjeta')
    .eq('local', local)
    // Solo facturas CERRADAS: una anulada ('X') o rara ('R') no es plata en la caja.
    .eq('estado', 'C')
    .gte('fecha_registra', desde)
    .lt('fecha_registra', hasta)
  if (error) throw new Error(error.message)
  return sumarVentasPorTurno((data ?? []) as unknown as FilaTurnoRow[])
}
