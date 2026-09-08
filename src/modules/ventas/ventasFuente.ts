// ── P2 · De dónde salen las ventas del módulo: PoS con el Excel de respaldo ─────────────────
//
// Hasta P1 el módulo Ventas leía SOLO del Excel (`ventas_dias` / `ventas_hist`, cargados a mano
// con la pestaña «Cargar XLS»). Acá se hace el swap: la fuente pasa a ser el PoS
// (`pos_ndf_*`, vía los adaptadores de P1b/P1c) y el Excel queda como piso.
//
// ── LA FUSIÓN NO ES UN REEMPLAZO ───────────────────────────────────────────────────────────
// Se parte del mapa del Excel y se le SUPERPONE el del PoS: `{ ...xls, ...pos }`. El PoS pisa
// donde tiene lote; donde no llega, queda el Excel intacto. Es lo que permite hacer el swap sin
// perder historia, porque **el PoS no cubre 2023**.
//
// ⚠️ El PoS arranca en 2024. La primera jornada con lote es del 2024-01-05 (ver
// `PRIMERA_JORNADA_POS`). Todo 2023 —y cualquier jornada de 2024/2025 sin lote— se sirve del
// Excel. Pedirle al adaptador un rango que arranque antes no rompe nada, pero son viajes al
// pedo: no hay filas que traer.
//
// ── LAS 15 PESTAÑAS NO SE ENTERAN ──────────────────────────────────────────────────────────
// Lo que sale de acá tiene la MISMA forma que antes (`DiasMap` / `HistMap`), así que ninguna
// pestaña se toca. El swap es un cambio de quién llena el mapa, no de qué hay adentro.
//
// ── SOLO LECTURA ───────────────────────────────────────────────────────────────────────────
// Todo lo que se llama acá son SELECT. Nada de esto escribe, ni en `pos_ndf_*` (que además no
// tiene una sola policy de escritura) ni en `ventas_dias`/`ventas_hist`.

import { getAllVentasDias, getVentasDias, getVentasHist } from '../../shared/api/ventas'
import type { DiasMap, HistMap } from '../../shared/types/ventas'
import {
  getDiasMapDesdePos, getHistDesdePos, LOCAL_POR_DEFECTO, type RangoJornadas,
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
 * 2023 lo sirve el Excel, entero, por la fusión.
 */
export const PRIMERA_JORNADA_POS = '2024-01-05'

/** Cuántos días trae el eager. Es el mismo default de `getVentasDias()`. */
export const DIAS_EAGER = 400

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

/**
 * Los días del eager (los últimos `DIAS_EAGER`), fusionados.
 *
 * Con `FUENTE_VENTAS = 'xls'` devuelve exactamente lo que devolvía antes y **no consulta el
 * PoS**: el camino viejo queda intacto, no emulado.
 */
export async function cargarDiasEager(
  fuente: FuenteVentas = FUENTE_VENTAS,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<DiasMap> {
  const xls = await getVentasDias(DIAS_EAGER)
  if (fuente === 'xls') return xls
  return fusionarDias(xls, await getDiasMapDesdePos(rangoPos(DIAS_EAGER, ahora), local))
}

/** El histórico completo de días, fusionado. Lo mismo, con el rango entero del PoS. */
export async function cargarDiasFull(
  fuente: FuenteVentas = FUENTE_VENTAS,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<DiasMap> {
  const xls = await getAllVentasDias()
  if (fuente === 'xls') return xls
  return fusionarDias(xls, await getDiasMapDesdePos(rangoPos('todo', ahora), local))
}

/**
 * El `HistMap`, fusionado.
 *
 * `ventas_hist` tiene 2023-2025 y el PoS arranca en 2024: la fusión deja 2023 tal cual y pisa
 * de 2024 en adelante.
 */
export async function cargarHist(
  fuente: FuenteVentas = FUENTE_VENTAS,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<HistMap> {
  const xls = await getVentasHist()
  if (fuente === 'xls') return xls
  return fusionarHist(xls, await getHistDesdePos(rangoPos('todo', ahora), local))
}
