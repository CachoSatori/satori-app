// ── Propinas: Historial, Quincenal y Estadísticas muestran LO QUE SE PAGÓ (decisión del dueño, 20-nov-2026) ──
//
// Módulo PURO, fuera de sagrados. Antes las tres pantallas recalculaban el reparto con `calcHistory`
// (sagrado, no se toca) a partir de los empleados que el usuario puede leer. Cajero y contador solo leen
// empleados ACTIVOS (políticas de `employees`, mig 085): en un turno con alguien hoy inactivo, el
// recálculo le repartía el pozo al resto y mostraba montos distintos de los pagados (327 de 470 turnos
// cerrados en prod tienen a alguien inactivo, medido el 20-nov).
//
// Acá no se recalcula ningún monto:
//   · cada fila muestra el `payout_crc` GUARDADO al cerrar o editar (lo que se pagó) y sus puntos guardados;
//   · el pozo es el `pool_total_crc` guardado;
//   · las entradas de personas que esta vista no puede leer (`tip_entries` sí se lee con los permisos
//     actuales; el nombre no) se cuentan y se suman en `ocultos`, sin nombre;
//   · si falta lo guardado (payout o pozo en null), la fila queda «sin dato guardado» (monto 0 y marca),
//     nunca el recalculado.
// `calcHistory` se sigue usando solo para nombre, rol efectivo y horas de cada fila visible.

import { BAR_ROLES, calcHistory, type HistoryCalc, type HistoryRow } from '../../shared/utils/tipCalculations'
import type { UserRole } from '../../shared/types/database'
import { calcSinRepartir, sinRepartirHistoria, textoSinRepartir, type SinRepartir } from './sinRepartir'

export interface EntradaGuardada {
  employee_id:    string
  hours_worked:   number
  tip_amount_crc: number
  tip_amount_usd: number
  points:         number | null
  payout_crc:     number | null
  covered_role?:  UserRole | null
}

export interface SesionGuardada {
  pool_efectivo_crc:          number
  pool_efectivo_usd:          number
  pool_barra_crc:             number
  pool_barra_electronico_crc?: number | null
  exchange_rate:              number
  pool_total_crc?:            number | null
}

export interface FilaPagada extends HistoryRow {
  /** true = no hay payout guardado: `payout_crc` vale 0 y la pantalla dice «sin dato guardado». */
  sinDato: boolean
}

export interface Ocultos {
  /** Entradas del turno cuyo empleado esta vista no puede leer (hoy inactivo). */
  entradas: number
  /** Lo que se les pagó (payout guardado), en colones enteros. */
  pagado:   number
  /** De esas, cuántas no tienen payout guardado. */
  sinDato:  number
}

export interface RepartoPagado extends HistoryCalc {
  rows:        FilaPagada[]
  ocultos:     Ocultos
  /** Entradas sin payout guardado (visibles + ocultas). */
  sinDato:     number
  /** true = el turno no tiene `pool_total_crc` guardado: `totalPool` es el reconstruido. */
  pozoSinDato: boolean
  /** true = faltan personas en la vista (no se puede editar desde acá). */
  incompleto:  boolean
  /**
   * true = «₡/pto», «Pts» y el desglose barra/servicio salen de lo GUARDADO y cuadran con lo pagado
   * (generalRate = (pozo guardado − barra) / Σ puntos guardados, y cada fila de sala cobró sus puntos × esa
   * tasa, ±₡1). false = no se pueden reconstruir de forma coherente: la pantalla los oculta y muestra solo
   * lo pagado. Nunca se mezclan los puntos guardados con la tasa recalculada.
   */
  desgloseCoherente: boolean
  /** Plata del pozo que nadie cobró (aviso del #320), medida sobre lo pagado cuando está guardado. */
  sinRepartir: SinRepartir | null
}

const valido = (v: unknown): v is number =>
  v !== null && v !== undefined && (v as unknown) !== '' && Number.isFinite(Number(v))

export function repartoPagado(
  sesion: SesionGuardada,
  entradas: readonly EntradaGuardada[],
  empleados: ReadonlyArray<{ id: string; full_name: string; role: UserRole }>,
  puntosRol: ReadonlyArray<{ role: UserRole; points: number }>,
): RepartoPagado {
  // Solo para nombre, rol efectivo y horas (y el respaldo del aviso de #320 si falta lo guardado).
  const calc = calcHistory(
    entradas.map(e => ({
      employee_id: e.employee_id, hours_worked: e.hours_worked,
      tip_amount_crc: e.tip_amount_crc, tip_amount_usd: e.tip_amount_usd,
      points: e.points, payout_crc: e.payout_crc, covered_role: e.covered_role ?? null,
    })),
    empleados.map(e => ({ id: e.id, full_name: e.full_name, role: e.role })),
    puntosRol.map(r => ({ role: r.role, points: r.points })),
    // Barra = efectivo + electrónico (igual que el cierre).
    {
      pool_efectivo_crc: sesion.pool_efectivo_crc, pool_efectivo_usd: sesion.pool_efectivo_usd,
      pool_barra_crc: (sesion.pool_barra_crc || 0) + (sesion.pool_barra_electronico_crc || 0),
      exchange_rate: sesion.exchange_rate,
    },
  )

  const porEmpleado = new Map(entradas.map(e => [e.employee_id, e]))
  const visibles = new Set(empleados.map(e => e.id))

  const rows: FilaPagada[] = calc.rows.map(r => {
    const e = porEmpleado.get(r.employeeId)
    const pagado = e && valido(e.payout_crc)
    return {
      ...r,
      payout_crc: pagado ? Math.round(Number(e.payout_crc)) : 0,
      pts_val:    e && valido(e.points) ? Number(e.points) : r.pts_val,
      sinDato:    !pagado,
    }
  })

  const ocultasEntradas = entradas.filter(e => !visibles.has(e.employee_id))
  const ocultos: Ocultos = { entradas: 0, pagado: 0, sinDato: 0 }
  for (const e of ocultasEntradas) {
    ocultos.entradas += 1
    if (valido(e.payout_crc)) ocultos.pagado += Math.round(Number(e.payout_crc))
    else ocultos.sinDato += 1
  }

  const sinDato = rows.filter(r => r.sinDato).length + ocultos.sinDato
  const pozoSinDato = !valido(sesion.pool_total_crc)
  const totalPool = pozoSinDato ? calc.totalPool : Number(sesion.pool_total_crc)
  const incompleto = ocultos.entradas > 0
  // Puntos guardados de TODAS las entradas (también las ocultas) si están todos; si no, los del cálculo.
  const puntosGuardados = entradas.length > 0 && entradas.every(e => valido(e.points))
  const totalPoints = puntosGuardados ? entradas.reduce((s, e) => s + Number(e.points), 0) : calc.totalPoints

  // Desglose desde lo guardado; si no cuadra con lo pagado, no se muestra (ver `desgloseCoherente`).
  let desglose: { generalPool: number; generalRate: number } | null = null
  if (sinDato === 0 && !pozoSinDato && !incompleto && puntosGuardados && totalPoints > 0) {
    const generalPool = totalPool - calc.barraPool
    const generalRate = generalPool / totalPoints
    const cuadra = rows.every(r => {
      const serv = r.pts_val * generalRate
      return BAR_ROLES.includes(r.role) ? r.payout_crc - serv >= -1 : Math.abs(r.payout_crc - serv) <= 1
    })
    if (cuadra) desglose = { generalPool, generalRate }
  }

  let sinRepartir: SinRepartir | null
  if (sinDato === 0 && !pozoSinDato) {
    // Sobre lo PAGADO: pozo guardado − Σ lo que se pagó a cada uno (incluidas las personas ocultas).
    const personas = [
      ...rows.map(r => ({ role: r.role, hours: r.hours, cobra: r.payout_crc })),
      // Rol de una persona oculta: solo se sabe si cubrió otro puesto.
      ...ocultasEntradas.map(e => ({ role: (e.covered_role ?? '') as UserRole, hours: Number(e.hours_worked) || 0, cobra: Math.round(Number(e.payout_crc)) })),
    ]
    sinRepartir = calcSinRepartir({ totalPool, barraPool: calc.barraPool, generalPool: calc.generalPool, totalPoints }, personas)
    // Sobre lo pagado, un resto de más de ₡1 por persona sin H1/H2 no es redondeo: lo pagado no cubre el pozo.
    if (sinRepartir && sinRepartir.motivos.length === 1 && sinRepartir.motivos[0] === 'redondeo') {
      sinRepartir = { ...sinRepartir, motivos: ['pagado_menor'], texto: textoSinRepartir(sinRepartir.monto, ['pagado_menor']) }
    }
  } else if (!incompleto) {
    // Turno sin lo guardado y con todos a la vista: el aviso de #320 sale del reparto reconstruido
    // (solo como aviso; los montos por persona siguen «sin dato guardado»).
    sinRepartir = sinRepartirHistoria(calc)
  } else {
    sinRepartir = null   // sin lo guardado y con personas ocultas no se puede saber sin inventar
  }

  return {
    ...calc, rows, totalPool, totalPoints,
    generalPool: desglose?.generalPool ?? calc.generalPool,
    generalRate: desglose?.generalRate ?? calc.generalRate,
    ocultos, sinDato, pozoSinDato, incompleto, desgloseCoherente: desglose !== null, sinRepartir,
  }
}

/** Personas con pago en el turno: las de la vista más las ocultas (inactivas sin nombre). */
export function personasDelTurno(c: HistoryCalc): number {
  return c.rows.length + (esRepartoPagado(c) ? c.ocultos.entradas : 0)
}

export function esRepartoPagado(c: HistoryCalc | null | undefined): c is RepartoPagado {
  return !!c && 'ocultos' in c && 'sinDato' in c
}

/** Suma de lo que falta en varios turnos (Quincenal, Estadísticas). */
export interface ResumenFaltantes { ocultos: Ocultos; sinDato: number; turnosPozoSinDato: number }

export function sumarFaltantes(calcs: ReadonlyArray<HistoryCalc | null | undefined>): ResumenFaltantes {
  const r: ResumenFaltantes = { ocultos: { entradas: 0, pagado: 0, sinDato: 0 }, sinDato: 0, turnosPozoSinDato: 0 }
  for (const c of calcs) {
    if (!esRepartoPagado(c)) continue
    r.ocultos.entradas += c.ocultos.entradas
    r.ocultos.pagado   += c.ocultos.pagado
    r.ocultos.sinDato  += c.ocultos.sinDato
    r.sinDato          += c.sinDato
    if (c.pozoSinDato) r.turnosPozoSinDato += 1
  }
  return r
}

export const TEXTO_SIN_DATO = 'sin dato guardado'

/** Avisos para la pantalla (vacío = nada que avisar). `fmt` = formatCRC. */
export function avisosPagado(f: ResumenFaltantes, fmt: (n: number) => string): string[] {
  const out: string[] = []
  if (f.ocultos.entradas > 0) {
    const n = f.ocultos.entradas
    const quien = n === 1
      ? '1 pago a una persona que hoy está inactiva no muestra el nombre'
      : `${n} pagos a personas que hoy están inactivas no muestran el nombre`
    out.push(`${quien} (tu rol no puede ver empleados inactivos). Se les pagó ${fmt(f.ocultos.pagado)}` +
      ' y está incluido en el pozo. Los montos de cada fila son los que se pagaron.')
  }
  if (f.sinDato > 0) {
    out.push(`${f.sinDato === 1 ? '1 monto no tiene' : `${f.sinDato} montos no tienen`} dato guardado de lo que se pagó: ` +
      `aparece${f.sinDato === 1 ? '' : 'n'} como «${TEXTO_SIN_DATO}» y no se recalcula${f.sinDato === 1 ? '' : 'n'}.`)
  }
  if (f.turnosPozoSinDato > 0) {
    out.push(`${f.turnosPozoSinDato === 1 ? '1 turno no tiene' : `${f.turnosPozoSinDato} turnos no tienen`} guardado el total del pozo: ` +
      'se muestra el que sale de los montos cargados en el turno.')
  }
  return out
}
