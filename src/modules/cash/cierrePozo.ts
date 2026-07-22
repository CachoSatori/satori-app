import type { CashMovement, CashSession, CashCierreDia } from '../../shared/types/database'
import { saldoPozoEfectivo, contribucionPozo } from './pozo'
import { dateCR } from '../../shared/utils'

// ── CIERRE SOBRE EL POZO — corte hacia adelante ──────────────────────────────
//
// EL PRINCIPIO (sale del diagnóstico T1-B, ver scripts/t0-reconciliacion-cajas):
// hoy el "debería" se entera de la plata por TRES canales —el ledger de Caja Fuerte,
// los campos sellados `propinas_m/n_crc`, o ninguno— y una misma fila puede restar dos
// veces o ninguna. Eso produjo, con números medidos en prod: el sobrante de ₡58.737,07
// del 2026-07-18 (propinas restadas de una caja que nunca las tuvo) y la no-uniformidad
// del "hueco 2" (₡92.650 que no descuadran un día y ₡45.520 que sí, otro).
//
// EL MODELO NUEVO TIENE UN SOLO CANAL: todo movimiento de efectivo físico pega al pozo
// exactamente una vez, vía ledger. El cierre solo agrega lo que todavía NO es movimiento
// (las ventas del día) y resta lo que va a serlo después (el retiro).
//
// ⚠️ CORTE HACIA ADELANTE. Los días ANTERIORES a `POZO_CORTE` se calculan y se muestran
// exactamente como hoy (`saldoCajaFuerte` sigue vivo para eso): el histórico no se toca,
// ni sus números ni su render. Desde el corte, modelo nuevo. Cero migraciones.

/** Fecha del corte por defecto, si el entorno no dice otra cosa. */
export const POZO_CORTE_FALLBACK = '2026-08-01'

/**
 * Valida una fecha de corte venida del entorno. Devuelve la fecha si es un YYYY-MM-DD real,
 * o el fallback si viene vacía o mal formada (con aviso en consola: una fecha inválida que
 * pasara en silencio movería el corte sin que nadie se entere).
 *
 * Exportada para test — el entorno no se puede pisar dentro de un test de forma limpia.
 */
export function resolverCorte(raw: string | undefined | null, aviso: (m: string) => void = console.warn): string {
  const v = String(raw ?? '').trim()
  if (!v) return POZO_CORTE_FALLBACK
  const formatoOk = /^\d{4}-\d{2}-\d{2}$/.test(v)
  // `Date.parse` acepta '2026-02-31' y lo corre al 3 de marzo, así que además se comprueba
  // que la fecha vuelva a serializarse igual: eso descarta días que no existen.
  const real = formatoOk && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
  if (!real) {
    aviso(`[pozo] VITE_POZO_CORTE inválida (${JSON.stringify(raw)}); se usa el fallback ${POZO_CORTE_FALLBACK}`)
    return POZO_CORTE_FALLBACK
  }
  return v
}

/**
 * Fecha (YYYY-MM-DD) desde la cual el cierre usa el modelo del pozo.
 *
 * Sale de `VITE_POZO_CORTE` si el build la define; si no, del fallback. Se lee UNA vez, al
 * cargar el módulo: el corte no puede cambiar a mitad de una sesión.
 *
 * Los cierres ya sellados NO se recalculan — lo sellado, sellado está.
 */
export const POZO_CORTE = resolverCorte(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_POZO_CORTE,
)

/** ¿Este día se cierra con el modelo nuevo? */
export function esPostCorte(sessionDate: string, corte: string = POZO_CORTE): boolean {
  return !!sessionDate && sessionDate >= corte
}

// ── Filas que genera el propio cierre ────────────────────────────────────────
//
// Tres subcategorías/descripciones las escribe el cierre al sellar. No son insumo del
// "debería": son su consecuencia. Si se contaran, el re-cierre las sumaría dos veces.

export const SUBCAT_VENTAS_CIERRE = 'Ventas cierre'
export const SUBCAT_AJUSTE_CIERRE = 'Ajuste de cierre'
export const SUBCAT_APERTURA_POZO = 'Apertura pozo'
/** `recordCierreRetiro` graba el retiro como traspaso a Banco, con esta descripción. */
export const DESC_RETIRO_CIERRE = 'Retiro dueños a banco'

/** ¿La fila la generó el cierre de `fecha`? (anti-doble-conteo al re-cerrar). */
export function esFilaDelCierre(m: CashMovement, fecha: string): boolean {
  const desc = m.description || ''
  if ((m.subcategory === SUBCAT_VENTAS_CIERRE || m.subcategory === SUBCAT_AJUSTE_CIERRE) && desc.includes(fecha)) {
    return true
  }
  // El retiro no tiene subcategoría propia (va como traspaso 'Caja Fuerte → Banco'):
  // se lo reconoce por la descripción que le pone recordCierreRetiro.
  return m.movement_type === 'traspaso' && desc.startsWith(`${DESC_RETIRO_CIERRE} ${fecha}`)
}

/**
 * Día operativo al que pertenece un movimiento.
 *
 * Las filas que genera el cierre llevan su fecha EN LA DESCRIPCIÓN, y ésa es la que vale:
 * un cierre sellado tarde (o re-sellado días después) no debe cambiar de día por eso. Ésta
 * es la pieza que vuelve el "debería" independiente del ORDEN DE SELLADO — la fragilidad
 * que el T1 midió en staging (₡367.000) y confirmó en prod.
 */
export function fechaOperativa(m: CashMovement, sesionFecha: Map<string, string>): string {
  const desc = m.description || ''
  const marca =
    m.subcategory === SUBCAT_VENTAS_CIERRE ||
    m.subcategory === SUBCAT_AJUSTE_CIERRE ||
    m.subcategory === SUBCAT_APERTURA_POZO ||
    desc.startsWith(DESC_RETIRO_CIERRE)
  if (marca) {
    const hit = /(\d{4}-\d{2}-\d{2})/.exec(desc)
    if (hit) return hit[1]
  }
  return sesionFecha.get(m.session_id ?? '') ?? dateCR(m.created_at)
}

/**
 * Fecha del asiento de APERTURA del pozo más reciente (o `null` si no hay ninguno).
 *
 * El pozo arranca ahí: el asiento de apertura ES el conteo físico del día del corte, así que
 * todo lo anterior ya está adentro de esa cifra. Sin este corte, el saldo sumaría la apertura
 * MÁS toda la historia previa y quedaría inservible — el histórico ni siquiera tiene ancla
 * (medido en T0: el pozo acumulado da negativo).
 */
export function fechaAperturaPozo(movements: CashMovement[], sesionFecha: Map<string, string>): string | null {
  let ultima: string | null = null
  for (const m of movements) {
    if (m.subcategory !== SUBCAT_APERTURA_POZO) continue
    const f = fechaOperativa(m, sesionFecha)
    if (f && (!ultima || f > ultima)) ultima = f
  }
  return ultima
}

/**
 * Movimientos que alimentan el pozo del cierre de `fecha`: los que pertenecen a ese día o a
 * uno anterior **pero no antes de la apertura**, menos lo que el propio cierre generó.
 *
 * Dos cortes, cada uno con su motivo:
 *   · por ARRIBA, `<= fecha` con la FECHA OPERATIVA (no `created_at`): sellar días en otro
 *     orden no mueve el número.
 *   · por ABAJO, `>= fecha de apertura`: la apertura ya contiene todo lo anterior.
 */
export function basePozoParaCierre(
  movements: CashMovement[],
  sessions: CashSession[],
  fecha: string,
): CashMovement[] {
  const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
  const apertura = fechaAperturaPozo(movements, sesionFecha)
  return movements.filter(m => {
    if (esFilaDelCierre(m, fecha)) return false
    const f = fechaOperativa(m, sesionFecha)
    if (f > fecha) return false
    return apertura === null || f >= apertura
  })
}

// ── El "debería" del modelo nuevo ────────────────────────────────────────────

export interface DeberiaPozo {
  crc: number
  usd: number
  /** Traspasos sin dirección legible dentro de la base: neutros, pero la UI puede avisar. */
  indeterminados: { cantidad: number; crc: number; usd: number }
}

/**
 * Cuánto efectivo físico DEBERÍA haber al cerrar el día.
 *
 *   deberia = pozo(movimientos hasta hoy, sin las filas de este cierre)
 *           + ventas en efectivo BRUTAS de las dos fases
 *           − retiro de dueños
 *
 * **Sin piernas de propinas.** Las propinas pagadas ya restaron solas, como movimientos:
 * volver a restarlas acá es exactamente el doble conteo que el T1-B midió. Los campos
 * `propinas_m/n_crc` se siguen sellando para los KPIs, pero NO entran a esta cuenta.
 *
 * El retiro sí se resta a mano porque su movimiento se crea DESPUÉS de calcular esto.
 */
export function deberiaPozo(params: {
  base: CashMovement[]
  efRealM: number
  efRealN: number
  vmUsd: number
  vnUsd: number
  retiroCrc: number
}): DeberiaPozo {
  const pozo = saldoPozoEfectivo(params.base)
  return {
    crc: pozo.crc + params.efRealM + params.efRealN - params.retiroCrc,
    usd: pozo.usd + params.vmUsd + params.vnUsd,
    indeterminados: pozo.indeterminados,
  }
}

// ── Guardas de captura ───────────────────────────────────────────────────────

/**
 * ¿La venta cargada de una fase es MENOR que las propinas pagadas ese día?
 *
 * Es el síntoma de haber tecleado la venta YA NETA de propinas — la causa raíz del sobrante
 * de ₡58.737,07 del 2026-07-18 en prod (venta de noche cargada: ₡53,00; propinas pagadas
 * ese día: ₡70.106,07). Post-corte la venta va BRUTA, así que esto se avisa y se confirma.
 */
export function ventaSospechosaDeSerNeta(ventaCrcFase: number, propinasPagadasDia: number): boolean {
  return propinasPagadasDia > 0 && ventaCrcFase < propinasPagadasDia
}

/** Los campos del cierre no admiten negativos: un monto negativo invierte el asiento en silencio. */
export function hayMontosNegativos(valores: (number | '')[]): boolean {
  return valores.some(v => (Number(v) || 0) < 0)
}

export interface DiaPendiente {
  fecha: string
  movimientos: number
  crc: number
}

/**
 * Días >= corte, anteriores a `fecha`, SIN cierre completo y CON movimientos de efectivo de
 * cajas físicas. Post-corte no se puede sellar con uno de estos abierto: su plata se movió y
 * ningún campo sellado la registra, así que el ancla del día siguiente ya no valdría.
 *
 * Un día sin operación NO traba: si no se movió efectivo, no hay nada que reconstruir.
 */
export function diasPendientesDeCierre(params: {
  fecha: string
  corte?: string
  cierres: CashCierreDia[]
  movements: CashMovement[]
  sessions: CashSession[]
}): DiaPendiente[] {
  const corte = params.corte ?? POZO_CORTE
  const sesionFecha = new Map(params.sessions.map(s => [s.id, s.session_date]))
  const completos = new Set(
    params.cierres.filter(c => c.tipo === 'completo').map(c => c.session_date),
  )

  const porDia = new Map<string, DiaPendiente>()
  for (const m of params.movements) {
    // Solo cuenta el efectivo que realmente mueve el pozo (ingresos/egresos de cajas físicas).
    const clase = contribucionPozo(m).clase
    if (clase !== 'ingreso' && clase !== 'egreso') continue
    const f = fechaOperativa(m, sesionFecha)
    if (f < corte || f >= params.fecha) continue
    if (completos.has(f)) continue
    const g = porDia.get(f) ?? { fecha: f, movimientos: 0, crc: 0 }
    g.movimientos += 1
    g.crc += Math.abs(m.amount_crc || 0)
    porDia.set(f, g)
  }
  return [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Mensaje para la UI: qué día falta cerrar y cuánta plata se movió ese día. */
export function mensajeDiasPendientes(pendientes: DiaPendiente[], fmt: (n: number) => string): string {
  if (!pendientes.length) return ''
  const detalle = pendientes
    .map(d => `${d.fecha} (${d.movimientos} mov · ${fmt(d.crc)})`)
    .join(' · ')
  return (
    `No se puede cerrar: hay ${pendientes.length} día(s) anterior(es) sin cierre completo con plata movida — ` +
    `${detalle}. Cerrá esos días primero: si no, su efectivo queda sin registrar y el conteo de hoy no cuadra.`
  )
}
