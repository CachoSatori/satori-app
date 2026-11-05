/**
 * «Borrar TODO el día» — qué movimientos pertenecen al DÍA OPERATIVO que se borra.
 *
 * Bug que corrige (diagnóstico 05/11): `discardDiaCompleto` elegía los movimientos sin turno por
 * `created_at` dentro del día calendario de CR. Un cierre sellado después de medianoche crea sus
 * filas («Ventas cierre», «Ajuste de cierre») con `created_at` del día SIGUIENTE, y el «Borrar
 * TODO» de ese día siguiente se las llevaba. Pasó el 20/07 (ventas del 19/07 + propinas del
 * 17/07) y el 20/10 (ventas y ajuste del 19/10, ₡69.707 + US$100).
 *
 * Criterio (aprobado por el asesor, Paso 0 del 05/11):
 *   · con turno           → `session_date` del turno;
 *   · sin turno, patrón   → la fecha que el propio sistema escribe en la descripción
 *                            (las de `fechaOperativa` + «Propinas turno YYYY-MM-DD …»);
 *   · sin turno, manual   → día CR de `created_at` (no hay otra fuente).
 *
 * `fechaOperativa` (cierrePozo.ts) NO se modifica: entra en el «debería» del cierre. El agregado
 * de «Propinas turno» vive SOLO acá.
 *
 * Funciones puras (sin red): las usa `cash.ts` y las fijan los tests con los casos reales.
 */
import type { CashMovement } from '../../shared/types/database'
import { dateCR } from '../../shared/utils'
import { fechaOperativa, SUBCAT_VENTAS_CIERRE, SUBCAT_AJUSTE_CIERRE, SUBCAT_APERTURA_POZO, DESC_RETIRO_CIERRE } from './cierrePozo'

/** Columnas que necesita la clasificación y la vista previa. */
export type MovimientoBorrable = Pick<CashMovement,
  'id' | 'session_id' | 'created_at' | 'subcategory' | 'description' | 'amount_crc' | 'amount_usd' | 'movement_type'>

export interface FilaPlan extends MovimientoBorrable {
  /** Día operativo según el criterio de arriba. */
  diaOperativo: string
  /** 'turno' = ligado a un turno de caja · 'dia' = movimiento sin turno. */
  origen: 'turno' | 'dia'
  /** Sin turno y sin fecha escrita por el sistema: su único dato de fecha es `created_at`. */
  manual: boolean
}

export interface PlanBorradoDia {
  fecha: string
  /** Lo que SÍ se borra: día operativo = fecha. */
  borrar: FilaPlan[]
  /** Creadas ese día calendario pero de OTRO día operativo: el criterio viejo las borraba.
   *  NO se borran; la confirmación las lista como aviso. */
  ajenas: FilaPlan[]
}

const RE_PROPINAS_TURNO = /^Propinas turno (\d{4}-\d{2}-\d{2})\b/

function tieneFechaDelSistema(m: MovimientoBorrable): boolean {
  const desc = m.description || ''
  return m.subcategory === SUBCAT_VENTAS_CIERRE
      || m.subcategory === SUBCAT_AJUSTE_CIERRE
      || m.subcategory === SUBCAT_APERTURA_POZO
      || desc.startsWith(DESC_RETIRO_CIERRE)
      || RE_PROPINAS_TURNO.test(desc)
}

/** Día operativo de un movimiento a efectos del borrado del día. */
export function diaOperativoBorrado(m: MovimientoBorrable, sesionFecha: Map<string, string>): string {
  if (!m.session_id) {
    const p = RE_PROPINAS_TURNO.exec(m.description || '')
    if (p) return p[1]
  }
  return fechaOperativa(m as CashMovement, sesionFecha)
}

/**
 * Arma el plan del borrado.
 * @param filasTurno      movimientos ligados a los turnos con `session_date = fecha`
 * @param candidatasDia   movimientos SIN turno candidatos: creados ese día calendario CR, o con
 *                        la fecha en la descripción (cierres sellados después de medianoche)
 * @param sesionFecha     id de turno → session_date
 */
export function planBorradoDia(
  fecha: string,
  filasTurno: MovimientoBorrable[],
  candidatasDia: MovimientoBorrable[],
  sesionFecha: Map<string, string>,
): PlanBorradoDia {
  const borrar: FilaPlan[] = []
  const ajenas: FilaPlan[] = []
  const vistos = new Set<string>()

  for (const m of filasTurno) {
    if (vistos.has(m.id)) continue
    vistos.add(m.id)
    borrar.push({ ...m, origen: 'turno', manual: false, diaOperativo: sesionFecha.get(m.session_id ?? '') ?? fecha })
  }
  for (const m of candidatasDia) {
    if (m.session_id || vistos.has(m.id)) continue
    vistos.add(m.id)
    const fila: FilaPlan = { ...m, origen: 'dia', manual: !tieneFechaDelSistema(m), diaOperativo: diaOperativoBorrado(m, sesionFecha) }
    if (fila.diaOperativo === fecha) borrar.push(fila)
    else if (dateCR(m.created_at) === fecha) ajenas.push(fila)
    // si no: la trajo el filtro por descripción pero es de otro día (p. ej. «fact 2026-10-19»
    // de un proveedor) y tampoco la tocaba el criterio viejo → se ignora.
  }
  return { fecha, borrar, ajenas }
}

export interface ResumenDia { dia: string; filas: number; crc: number; usd: number }

/** Totales (₡ y US$) por día operativo, para la confirmación. */
export function resumenPorDia(filas: FilaPlan[]): ResumenDia[] {
  const m = new Map<string, ResumenDia>()
  for (const f of filas) {
    const r = m.get(f.diaOperativo) ?? { dia: f.diaOperativo, filas: 0, crc: 0, usd: 0 }
    r.filas += 1
    r.crc += Number(f.amount_crc) || 0
    r.usd += Number(f.amount_usd) || 0
    m.set(f.diaOperativo, r)
  }
  return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

/** Hora de creación en CR (HH:MM) — la confirmación la muestra en los manuales. */
export function horaCR(ts: string): string {
  return new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

/** Texto de la confirmación (window.confirm). */
export function textoConfirmacionBorrado(plan: PlanBorradoDia, fmtCrc: (n: number) => string): string {
  const L: string[] = []
  const tot = resumenPorDia(plan.borrar)
  const turno = plan.borrar.filter(f => f.origen === 'turno').length
  const dia = plan.borrar.length - turno
  L.push(`¿BORRAR TODO el día ${plan.fecha}?`, '')
  L.push(`Se van a borrar ${plan.borrar.length} movimiento(s) del día operativo ${plan.fecha} (${turno} de turnos de caja, ${dia} sin turno):`)
  if (tot.length === 0) L.push('  (ninguno)')
  for (const r of tot) L.push(`  · ${r.dia}: ${r.filas} mov. · ${fmtCrc(r.crc)} · US$ ${r.usd.toFixed(2)}`)
  const manuales = plan.borrar.filter(f => f.manual)
  if (manuales.length) {
    L.push('', 'Movimientos manuales sin turno (fecha = hora de carga):')
    for (const f of manuales.slice(0, 8)) L.push(`  · ${horaCR(f.created_at)} · ${fmtCrc(Number(f.amount_crc) || 0)}${Number(f.amount_usd) ? ` + US$ ${Number(f.amount_usd)}` : ''} · ${(f.description || '').slice(0, 40)}`)
    if (manuales.length > 8) L.push(`  … y ${manuales.length - 8} más`)
  }
  if (plan.ajenas.length) {
    L.push('', `⚠ ${plan.ajenas.length} movimiento(s) se cargaron el ${plan.fecha} pero son de OTRO día operativo. NO se borran:`)
    for (const f of plan.ajenas.slice(0, 8)) L.push(`  · día ${f.diaOperativo} · ${fmtCrc(Number(f.amount_crc) || 0)}${Number(f.amount_usd) ? ` + US$ ${Number(f.amount_usd)}` : ''} · ${(f.description || '').slice(0, 40)}`)
    if (plan.ajenas.length > 8) L.push(`  … y ${plan.ajenas.length - 8} más`)
  }
  L.push('', `También se borran el cierre y los turnos de caja del ${plan.fecha}.`)
  L.push('Se borran los PAGOS de propinas del día (sus movimientos de caja); las propinas asignadas a cada persona no se tocan.')
  L.push('NO se puede deshacer.')
  return L.join('\n')
}
