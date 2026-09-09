// ── P2 · De dónde salen las ventas del módulo: PoS con el Excel de respaldo ─────────────────
//
// Hasta P1 el módulo Ventas leía SOLO del Excel (`ventas_dias` / `ventas_hist`, cargados a mano
// con la pestaña «Cargar XLS»). Acá se hace el swap: la fuente pasa a ser el PoS
// (`pos_ndf_*`, vía los adaptadores de P1b/P1c) y el Excel queda como piso.
//
// ── LA FUSIÓN NO ES UN REEMPLAZO ───────────────────────────────────────────────────────────
// Se parte del mapa del Excel y se le SUPERPONE el del PoS: `{ ...xls, ...pos }`. El PoS pisa
// donde tiene lote; donde no llega, queda el Excel intacto.
//
// ⚠️ QUÉ CUBRE CADA FUENTE DE VERDAD (medido, no supuesto — no confundir las dos tablas):
//   · `ventas_dias` (DETALLE diario, con saloneros)  → **solo enero 2026 → hoy**.
//   · `ventas_hist` (reporte diario GENERAL, sin salonero) → **2023-2025**.
//   · `pos_ndf_*`                                     → **2024-01-05 → hoy**.
//
// De ahí sale lo que hay que tener claro y es fácil leer al revés:
//   · **2023 NO tiene detalle diario en ninguna fuente.** Sobrevive por el `HistMap`
//     (`ventas_hist`), no por el `DiasMap`. Apagar el Excel (P4) no le quita a 2023 un detalle
//     que nunca tuvo, pero sí le quitaría el reporte general.
//   · **2024-2025 tampoco tenía detalle diario**: el PoS se lo AGREGA. Es ganancia del swap, no
//     algo que había que preservar.
//   · El Excel es piso real del `DiasMap` solo de enero 2026 en adelante — y ahí es donde de
//     verdad tapa una jornada sin lote del PoS.
//
// Pedirle al adaptador un rango que arranque antes de `PRIMERA_JORNADA_POS` no rompe nada, pero
// son viajes al pedo: no hay filas que traer.
//
// ── LAS 15 PESTAÑAS NO SE ENTERAN ──────────────────────────────────────────────────────────
// Lo que sale de acá tiene la MISMA forma que antes (`DiasMap` / `HistMap`), así que ninguna
// pestaña se toca. El swap es un cambio de quién llena el mapa, no de qué hay adentro.
//
// ── SOLO LECTURA ───────────────────────────────────────────────────────────────────────────
// Todo lo que se llama acá son SELECT. Nada de esto escribe, ni en `pos_ndf_*` (que además no
// tiene una sola policy de escritura) ni en `ventas_dias`/`ventas_hist`.

import { getAllVentasDias, getVentasDias, getVentasHist } from '../../shared/api/ventas'
import type { DiasMap, HistMap, ProductMap } from '../../shared/types/ventas'
import {
  aHistMap, getDiasMapDesdePos, LOCAL_POR_DEFECTO, type RangoJornadas,
} from './ventasDiasDesdePos'

/**
 * De dónde se alimenta el módulo Ventas.
 *
 * · `'pos'` (default) → PoS fusionado con el Excel de respaldo.
 * · `'xls'`           → 100 % Excel, el comportamiento anterior EXACTO. Sin fusión, sin una
 *                        sola consulta a `pos_ndf_*`.
 *
 * Es una constante y no un toggle de UI a propósito: es la palanca para volver atrás en un
 * deploy si el swap muestra algo raro, no una preferencia del usuario.
 */
export type FuenteVentas = 'pos' | 'xls'

export const FUENTE_VENTAS: FuenteVentas = 'pos'

/**
 * La primera jornada que el PoS tiene ingestada.
 *
 * ✅ **CONFIRMADO** por `VALIDACION-cuadre-pos-agosto-2026-09-04`: el backfill cubre
 * **5-ene-2024 → 3-sep-2026**. Antes de eso no hay una sola factura en `pos_ndf_tickets`.
 *
 * Lo que **no** hay que hacer es bajarla a 2023: ahí el PoS no existe y serían viajes al pedo.
 * 2023 lo sirve `ventas_hist` (el reporte general), NO el detalle diario — ver arriba.
 */
export const PRIMERA_JORNADA_POS = '2024-01-05'

/**
 * Cuántos días trae el EAGER — el que bloquea el primer render.
 *
 * Bajó de 400 a 90 (P2-perf). Leer del PoS no es leer una fila por día: son los tickets y las
 * líneas CRUDAS, que la app agrega en el navegador. A la escala medida en staging (39.470
 * tickets y 221.639 líneas en 973 días ≈ 41 tickets y 228 líneas por día), 400 días son ~16.000
 * tickets y ~91.000 líneas antes de pintar nada.
 *
 * 90 alcanza para lo único que el primer render necesita: «Hoy» compara contra las **4 últimas
 * ocurrencias del mismo día de semana** (28 días), y lo reciente cabe de sobra. La historia
 * completa sigue llegando por `cargarDeFondo`, en segundo plano.
 */
export const DIAS_EAGER = 90

/** Hoy en Costa Rica (`YYYY-MM-DD`). CR es UTC−6 fijo. */
export function hoyCR(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 6 * 3_600_000).toISOString().slice(0, 10)
}

/** `hasta` menos `dias`, en `YYYY-MM-DD`. */
export function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
}

/**
 * El rango de JORNADAS que hay que pedirle al PoS.
 *
 * En jornadas, no en días civiles: la jornada de un ticket es la fecha de apertura de su LOTE
 * de cierre (`jornada.ts`), así que el turno que cierra a la 01:00 sigue contando en el día que
 * abrió. El adaptador ya lee un superset y descarta lo que sobra.
 *
 * Nunca arranca antes de `PRIMERA_JORNADA_POS`.
 */
export function rangoPos(dias: number | 'todo', ahora: Date = new Date()): RangoJornadas {
  const hasta = hoyCR(ahora)
  const desde = dias === 'todo' ? PRIMERA_JORNADA_POS : restarDias(hasta, dias)
  return { desde: desde < PRIMERA_JORNADA_POS ? PRIMERA_JORNADA_POS : desde, hasta }
}

// ── La fusión ──────────────────────────────────────────────────────────────────────────────

/**
 * Excel + PoS → el mapa que ven las pestañas. **Una sola función, para las dos cargas.**
 *
 * Que el eager (`dias`) y el full (`diasFull`) usen ESTA misma función es lo que evita que
 * «Hoy» y «Análisis» muestren números distintos de la misma fecha, y que algo salte en pantalla
 * cuando el full termina de cargar en segundo plano. Si hubiera dos fusiones, cualquier
 * diferencia entre ellas se vería como un parpadeo de la plata.
 *
 * ⚠️ **El PoS pisa donde tiene jornada, aunque su jornada esté incompleta.** Es la regla
 * firmada, y tiene un filo: si una jornada se ingestó a medias (el agente se cayó a mitad del
 * servicio), esa jornada corta pisa un día del Excel que estaba completo y el día muestra de
 * menos. No se "arregla" acá con un umbral, porque un umbral inventado escondería el problema
 * en vez de mostrarlo: la pestaña **Paridad (validación)** compara EXACTAMENTE estos dos mapas,
 * día por día, y marca las jornadas donde no coinciden. Ése es el control.
 */
export function fusionarDias(xls: DiasMap, pos: DiasMap): DiasMap {
  return { ...xls, ...pos }
}

/** Lo mismo para el histórico (`HistMap`). Misma regla, mismo motivo. */
export function fusionarHist(xls: HistMap, pos: HistMap): HistMap {
  return { ...xls, ...pos }
}

// ── Las cargas ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ CAMBIO ESPERADO, NO ES UN BUG: el **delivery baja ~4-5 %** contra el Excel.
// El xls marcaba como delivery todo lo que no tenía cargo de servicio, y ahí adentro caían
// también «para llevar» y la barra. El PoS usa el canal real (`canal = 'delivery'`), que es lo
// que de verdad salió en moto. **El número del PoS es el correcto**; el del Excel venía
// inflado. La neta, el salón y el servicio no se mueven (paridad de agosto 2026: neta −0,4 %,
// salón −0,0 %, pax +1,5 %).

// ── QUÉ BLOQUEA EL PRIMER RENDER Y QUÉ NO (P2-perf) ────────────────────────────────────────
//
// Bloquea: `cargarDiasEager` (90 días) + `cargarHistEager` (una consulta al Excel).
// No bloquea: `cargarDeFondo`, que trae la historia completa del PoS en segundo plano.
//
// La primera versión de P2 metía el histórico ENTERO del PoS en el `Promise.all` bloqueante
// (`getHistDesdePos` con el rango `'todo'`), y eso solo ya era ~2,4× el eager de 400 días: el
// histórico del PoS no es una tabla de resúmenes, se DERIVA agregando los mismos tickets y
// líneas crudas. Estaba pagando el rango completo dos veces —una para el `HistMap` y otra para
// el `DiasMap` full— antes de pintar un pixel.
//
// Ahora el PoS del rango completo se lee UNA sola vez, en `cargarDeFondo`, y de ese único pase
// salen las dos cosas: el `DiasMap` full y el `HistMap` (que es una proyección del mismo día,
// vía `aHistMap`). Mitad de trabajo, y nada de eso bloquea.

/**
 * Los días del eager (los últimos `DIAS_EAGER`), fusionados. **Bloquea el primer render.**
 *
 * Con `FUENTE_VENTAS = 'xls'` devuelve exactamente lo que devolvía antes y **no consulta el
 * PoS**: el camino viejo queda intacto, no emulado.
 */
export async function cargarDiasEager(
  fuente: FuenteVentas = FUENTE_VENTAS,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CargaDias> {
  const xls = await getVentasDias(DIAS_EAGER)
  if (fuente === 'xls') return { dias: xls, pm: {} }
  const pos = await getDiasMapDesdePos(rangoPos(DIAS_EAGER, ahora), local)
  return { dias: fusionarDias(xls, pos.dias), pm: pos.pm }
}

/**
 * El `HistMap` del EXCEL, y nada más. **Bloquea el primer render, y por eso no toca el PoS.**
 *
 * `ventas_hist` son 1.096 filas ya resumidas: una sola consulta. El overlay del PoS —que
 * cuesta agregar el rango completo— llega después, por `cargarDeFondo`.
 *
 * Efecto visible, y es el mismo patrón que ya tenía el `DiasMap` full: por un momento las
 * pestañas que leen `hist` (Histórico, Mix, Análisis, Contabilidad, Calendario, Metas) muestran
 * los números del Excel, y cuando el fondo termina pasan a los del PoS. No quedan vacías: acá
 * sí, `ventas_hist` cubre 2023-2025 completo (a diferencia de `ventas_dias`, que arranca en
 * enero 2026).
 */
export async function cargarHistEager(): Promise<HistMap> {
  return getVentasHist()
}

/**
 * Los días fusionados + el `ProductMap` por FAMILIA que viene del PoS.
 *
 * `pm` va vacío con `FUENTE_VENTAS = 'xls'`: sin PoS no hay familias que leer, y el camino
 * viejo tiene que quedar EXACTAMENTE como estaba.
 */
export interface CargaDias {
  dias: DiasMap
  pm:   ProductMap
}

/** Lo que llega en segundo plano: la historia completa, ya fusionada. */
export interface CargaDeFondo extends CargaDias {
  hist: HistMap
}

/**
 * La historia completa, en segundo plano y con **un solo pase por el PoS**.
 *
 * `histXls` es el que ya trajo `cargarHistEager`: se pasa en vez de volver a pedirlo, porque el
 * `HistMap` del Excel no cambia entre las dos cargas.
 *
 * Las dos salidas usan las MISMAS funciones de fusión que el eager, que es lo que garantiza que
 * una fecha que está en los dos dé exactamente lo mismo y nada salte cuando esto termina.
 */
export async function cargarDeFondo(
  histXls: HistMap,
  fuente: FuenteVentas = FUENTE_VENTAS,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CargaDeFondo> {
  const diasXls = await getAllVentasDias()
  if (fuente === 'xls') return { dias: diasXls, hist: histXls, pm: {} }

  // UNA lectura del PoS para las dos salidas. `aHistMap` es un re-shape puro del mismo día:
  // pedir `getHistDesdePos` aparte volvería a agregar los mismos tickets y líneas.
  const pos = await getDiasMapDesdePos(rangoPos('todo', ahora), local)
  return {
    dias: fusionarDias(diasXls, pos.dias),
    hist: fusionarHist(histXls, aHistMap(pos.dias)),
    pm:   pos.pm,
  }
}
