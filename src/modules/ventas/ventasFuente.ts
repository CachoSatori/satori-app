// ── De dónde salen las ventas: SOLO del PoS (decisión del dueño, 16-nov-2026 22:20 CR) ──────
//
// «Todo lo que lee ventas lee del PoS. Nunca más Excel ni Paridad.» Las ventas entran solas por
// el puente (`pos_ndf_*`, vía las funciones de la 067) y la app las arma con `getDiasMapDesdePos`.
// La carga a mano del xls (`ventas_dias`) y la pestaña Paridad se retiraron de la interfaz; las
// TABLAS quedan (histórico, sin borrar nada).
//
// ── LA FECHA DE CORTE (leída de prod, solo lectura, 16-nov) ────────────────────────────────
//   · `pos_ndf_tickets` (santa-teresa): primer día CR de factura = **2024-01-05**.
//   · `ventas_hist` (reporte general, sin salonero): 2023-01-01 → 2025-12-31.
//   · `ventas_dias` (detalle diario del xls): 2026-01-01 → 2026-10-20. Ninguno de sus días le
//     falta al PoS (0 de 292) y ninguno es anterior al corte: el detalle diario sale 100 % del PoS.
//   · Días de `ventas_hist` desde el corte sin factura en el PoS: 0.
//
// Regla de combinación (solo para el RESUMEN diario, `HistMap`): `ventas_hist` hasta el día
// ANTERIOR a `CORTE_POS` y el PoS desde `CORTE_POS`. Nunca los dos el mismo día (`combinarHist`).
// Así 2023 —que el PoS no tiene— sigue visible en Histórico, Análisis y Calendario.
//
// ── SOLO LECTURA ───────────────────────────────────────────────────────────────────────────
// Todo lo que se llama acá son SELECT. Nada escribe en `pos_ndf_*`, `ventas_dias` ni `ventas_hist`.

import { getVentasHist } from '../../shared/api/ventas'
import { getLatidoVentas } from '../../shared/api/posNdf'
import type { DiasMap, HistMap, ProductMap } from '../../shared/types/ventas'
import {
  aHistMap, getDiasMapDesdePos, LOCAL_POR_DEFECTO, type RangoJornadas,
} from './ventasDiasDesdePos'

/**
 * La primera jornada que el PoS tiene ingestada = la FECHA DE CORTE entre el histórico viejo
 * (`ventas_hist`) y el PoS.
 *
 * ✅ Leída de prod el 16-nov-2026 (solo lectura): `min((fecha_registra at time zone
 * 'America/Costa_Rica')::date)` de `pos_ndf_tickets` = 2024-01-05. Coincide con el backfill
 * validado en `VALIDACION-cuadre-pos-agosto-2026-09-04`.
 */
export const PRIMERA_JORNADA_POS = '2024-01-05'
export const CORTE_POS = PRIMERA_JORNADA_POS

/**
 * Cuántos días trae el EAGER — el que bloquea el primer render.
 *
 * 90 alcanza para lo único que el primer render necesita: «Hoy» compara contra las **4 últimas
 * ocurrencias del mismo día de semana** (28 días). La historia completa llega por
 * `cargarDeFondo`, en segundo plano.
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
 * El rango de días que hay que pedirle al PoS: días CR de FACTURA (`fecha_registra`), el mismo
 * corte que el reporte del PoS (ver `ventasDiasDesdePos.ts`). Hoy incluido.
 *
 * Nunca arranca antes de `PRIMERA_JORNADA_POS`.
 */
export function rangoPos(dias: number | 'todo', ahora: Date = new Date()): RangoJornadas {
  const hasta = hoyCR(ahora)
  const desde = dias === 'todo' ? PRIMERA_JORNADA_POS : restarDias(hasta, dias)
  return { desde: desde < PRIMERA_JORNADA_POS ? PRIMERA_JORNADA_POS : desde, hasta }
}

// ── La combinación con el histórico viejo ──────────────────────────────────────────────────

/**
 * `ventas_hist` hasta el día ANTERIOR a `corte`, el PoS desde `corte`. **Un día viene de una sola
 * fuente**: lo del histórico viejo en o después del corte se descarta (aunque el PoS no tenga ese
 * día), y lo del PoS antes del corte también. Sin superposición posible.
 */
export function combinarHist(viejo: HistMap, pos: HistMap, corte: string = CORTE_POS): HistMap {
  const out: HistMap = {}
  for (const [f, d] of Object.entries(viejo)) if (f < corte) out[f] = d
  for (const [f, d] of Object.entries(pos)) if (f >= corte) out[f] = d
  return out
}

// ── Las cargas ─────────────────────────────────────────────────────────────────────────────
//
// Bloquea el primer render: `cargarDiasEager` (90 días del PoS) + `cargarHistEager` (una
// consulta a `ventas_hist`, solo lo anterior al corte).
// No bloquea: `cargarDeFondo`, que trae la historia completa del PoS en segundo plano (un solo
// pase: de ahí salen el `DiasMap` full y el `HistMap` desde el corte, vía `aHistMap`).
//
// ⚠️ Efecto visible: hasta que el fondo termina, las pestañas que leen `hist` (Histórico, Mix,
// Análisis, Calendario, Metas) muestran 2023 y los 90 días; 2024 en adelante llega con el fondo.

/** Los días del eager (los últimos `DIAS_EAGER`), del PoS. **Bloquea el primer render.** */
export async function cargarDiasEager(
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CargaDias> {
  return cargarDias(DIAS_EAGER, local, ahora)
}

/**
 * Los últimos `dias` días, del PoS. La usan el eager de Ventas y Mi Rendimiento (365 días).
 *
 * Si el PoS no se pudo leer devuelve un mapa VACÍO (no hay respaldo: el Excel se retiró) con
 * `estadoPos` distinto de `'ok'` y un `console.warn`, para que la pantalla lo diga
 * (`AvisoFuentePos`). Nunca muestra un número viejo como si fuera el actual.
 */
export async function cargarDias(
  dias: number,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CargaDias> {
  let estado: EstadoPos
  try {
    const pos = await getDiasMapDesdePos(rangoPos(dias, ahora), local)
    if (Object.keys(pos.dias).length > 0) return { dias: pos.dias, pm: pos.pm, estadoPos: 'ok' }
    // Sin una sola factura: o este usuario no puede leer el PoS (las funciones de la mig 067
    // devuelven 0 filas, igual que el RLS), o el PoS de verdad no tiene nada. El latido decide.
    estado = (await getLatidoVentas(local)).acceso ? 'vacio' : 'sin_acceso'
  } catch {
    estado = 'error'
  }
  console.warn(`[ventas] PoS ${estado}: sin ventas que mostrar`)
  return { dias: {}, pm: {}, estadoPos: estado }
}

/**
 * Las ventas de un rango de días (inclusivo, días CR de factura), del PoS y del local pedido.
 * Es la lectura de las pantallas que miran un día, una semana o un mes (Resumen, Inicio,
 * Inventario, Finanzas, Reporte mensual). Antes del corte no hay PoS: se recorta.
 */
export async function ventasDelRango(
  desde: string,
  hasta: string,
  local: string = LOCAL_POR_DEFECTO,
): Promise<{ dias: DiasMap; pm: ProductMap }> {
  const d = desde < CORTE_POS ? CORTE_POS : desde
  if (hasta < d) return { dias: {}, pm: {} }
  return getDiasMapDesdePos({ desde: d, hasta }, local)
}

/**
 * Cómo salió la lectura del PoS.
 *   · `'ok'`         → el PoS respondió con días.
 *   · `'sin_acceso'` → el usuario no puede leer las ventas del PoS (latido sin fila).
 *   · `'vacio'`      → tiene acceso, pero el PoS no devolvió ninguna factura del rango.
 *   · `'error'`      → la lectura falló.
 */
export type EstadoPos = 'ok' | 'sin_acceso' | 'vacio' | 'error'

/** La fecha más nueva del mapa (`YYYY-MM-DD`), o `null` si está vacío. */
export function ultimoDia(dias: DiasMap): string | null {
  let max: string | null = null
  for (const f of Object.keys(dias)) if (max === null || f > max) max = f
  return max
}

/** `'2026-10-20'` → `'20/10'`. Sin fecha, `'—'`. */
export function fmtDiaMes(fecha: string | null): string {
  if (!fecha || fecha.length < 10) return '—'
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
}

/**
 * El histórico viejo (`ventas_hist`), SOLO lo anterior a `CORTE_POS`. **Bloquea el primer
 * render, y por eso no toca el PoS.** Una consulta chica (2023 + 4 días de 2024).
 */
export async function cargarHistEager(): Promise<HistMap> {
  return combinarHist(await getVentasHist(), {})
}

/** Los días del PoS + el `ProductMap` por FAMILIA que viene del PoS. */
export interface CargaDias {
  dias: DiasMap
  pm:   ProductMap
  /** Cómo salió la lectura del PoS. */
  estadoPos?: EstadoPos | null
}

/** Lo que llega en segundo plano: la historia completa. */
export interface CargaDeFondo extends CargaDias {
  hist: HistMap
}

/**
 * La historia completa, en segundo plano y con **un solo pase por el PoS**.
 *
 * `histViejo` es el que ya trajo `cargarHistEager` (anterior al corte): se pasa en vez de volver
 * a pedirlo. El `HistMap` sale de `combinarHist`: viejo antes del corte, PoS desde el corte.
 */
export async function cargarDeFondo(
  histViejo: HistMap,
  local: string = LOCAL_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CargaDeFondo> {
  const pos = await getDiasMapDesdePos(rangoPos('todo', ahora), local)
  return {
    dias: pos.dias,
    hist: combinarHist(histViejo, aHistMap(pos.dias)),
    pm:   pos.pm,
  }
}
