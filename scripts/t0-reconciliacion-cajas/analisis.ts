// T0 · Análisis PURO sobre el snapshot. Sin red, sin I/O — todo lo que entra son
// filas y todo lo que sale son estructuras que reporte.ts imprime.

import type { Fila, Snapshot } from './db.ts'
import { contribucionCajaFuerte, contribucionPozo, esCajaFisica, parseTraspaso, type ClasePozo } from './pozo.ts'

// ── Parámetros del análisis ──────────────────────────────────────────────────
export const TOLERANCIA_CRC = 500
export const VENTANA_PROPINA_DIAS = 3
/** Con más candidatos que esto en la ventana, acertar ±tolerancia por azar deja de ser raro. */
export const UMBRAL_CANDIDATOS_DEBIL = 5
export const SUBCAT_PROPINA_TURNO = 'Propinas por turno'
export const SUBCAT_AJUSTE_CIERRE = 'Ajuste de cierre'

/** Staging tiene turnos de PRUEBA cargados este día — sus números no son reales. */
export const FECHAS_NO_CONFIABLES = ['2026-07-21']

/** Espejo de las constantes de cashUtils (no se importan: el único import de src/ es saldoCajaFuerte). */
export const CAJAS_ORIGEN_CANON = ['Caja Proveedores', 'Caja Fuerte', 'Registradora', 'Banco']
export const METODOS_CANON = ['Efectivo', 'Transferencia', 'SINPE', 'Bitcoin']
export const TIPOS_CANON = ['ingreso', 'egreso_mercaderia', 'egreso_personal', 'egreso_operativo', 'egreso_socios', 'traspaso']
export const STATUS_CANON = ['pendiente', 'aprobado', 'rechazado']

// ── Vistas tipadas sobre las filas crudas ────────────────────────────────────
export type Mov = {
  id: string
  session_id: string | null
  created_at: string
  movement_type: string
  subcategory: string | null
  description: string | null
  method: string | null
  caja_origen: string | null
  status: string | null
  amount_crc: number
  amount_usd: number
  shift: string | null
  updated_at: string
}

export type Sesion = {
  id: string
  session_date: string
  shift_type: string | null
  status: string
  cajero_name: string | null
  opened_by: string
  initial_suppliers_crc: number
  created_at: string
  updated_at: string
  closed_by: string | null
}

export type Cierre = {
  id: string
  session_date: string
  tipo: string
  diferencia_crc: number
  ajuste_tipo: string | null
  ajuste_motivo: string | null
  manager: string | null
  created_at: string | null
}

const s = (v: unknown): string => (v == null ? '' : String(v))
const sn = (v: unknown): string | null => (v == null ? null : String(v))
const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

export const asMov = (f: Fila): Mov => ({
  id: s(f.id),
  session_id: sn(f.session_id),
  created_at: s(f.created_at),
  movement_type: s(f.movement_type),
  subcategory: sn(f.subcategory),
  description: sn(f.description),
  method: sn(f.method),
  caja_origen: sn(f.caja_origen),
  status: sn(f.status),
  amount_crc: n(f.amount_crc),
  amount_usd: n(f.amount_usd),
  shift: sn(f.shift),
  updated_at: s(f.updated_at),
})

export const asSesion = (f: Fila): Sesion => ({
  id: s(f.id),
  session_date: s(f.session_date),
  shift_type: sn(f.shift_type),
  status: s(f.status),
  cajero_name: sn(f.cajero_name),
  opened_by: s(f.opened_by),
  initial_suppliers_crc: n(f.initial_suppliers_crc),
  created_at: s(f.created_at),
  updated_at: s(f.updated_at),
  closed_by: sn(f.closed_by),
})

export const asCierre = (f: Fila): Cierre => ({
  id: s(f.id),
  session_date: s(f.session_date),
  tipo: s(f.tipo),
  diferencia_crc: n(f.diferencia_crc),
  ajuste_tipo: sn(f.ajuste_tipo),
  ajuste_motivo: sn(f.ajuste_motivo),
  manager: sn(f.manager),
  created_at: sn(f.created_at),
})

// ── Fechas (hora de Costa Rica, igual convención que `dateCR` de la app) ─────
const CR_TZ = 'America/Costa_Rica'
const FMT_CR = new Intl.DateTimeFormat('en-CA', { timeZone: CR_TZ })

/**
 * Postgres devuelve `2026-01-01 12:00:00+00`; `new Date()` no acepta ni el espacio ni
 * un offset de dos dígitos, así que hay que normalizar a ISO antes de parsear.
 * (PostgREST ya devuelve `+00:00`, pero la Management API no.)
 */
export function aISO(ts: string): string {
  return String(ts)
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/([+-]\d{2})$/, '$1:00')
}

export function dateCR(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(aISO(String(iso)))
  return isNaN(d.getTime()) ? '' : FMT_CR.format(d)
}

/** Días calendario entre dos YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// ── (1) Reconciliación por cierre ────────────────────────────────────────────

export type Clase = 'CUADRÓ' | 'EXPLICADO-HUECO-2' | 'CANDIDATO-HUECO-1' | 'NO-EXPLICADO'

export type MatchPropina = {
  id: string
  fecha: string
  monto: number
  method: string | null
  deltaDias: number
  residuo: number
  /** Cuántos pagos de propina había en la ventana de fechas (el universo del sorteo). */
  candidatosEnVentana: number
  /** Cuántos de ellos caían dentro de la tolerancia (si es >1, la coincidencia no identifica a nadie). */
  coincidencias: number
  /** true = la coincidencia puede ser azar; NO tratar como causa probada. */
  debil: boolean
}

export type CierreClasificado = {
  cierre: Cierre
  clase: Clase
  egresosProv: { n: number; total: number; movs: Mov[] }
  /** dif + egresos: lo que quedaría sin explicar si el hueco 2 fuera la causa. */
  residuoHueco2: number
  matchPropina: MatchPropina | null
  /**
   * TODOS los asientos 'Ajuste de cierre' que nombran esta fecha (Opción B). Es una lista
   * y no uno solo: hay cierres con más de un ajuste, y quedarse con el primero los oculta.
   */
  ajustesLedger: Mov[]
  /** Movimientos del día que NO entran al join por tener session_id NULL. */
  huerfanosDelDia: Mov[]
  fechaNoConfiable: boolean
}

/** Fecha operativa de un movimiento: session_date del turno; si no tiene turno, día CR de created_at. */
export function fechaDeMov(m: Mov, porSesion: Map<string, Sesion>): string {
  if (m.session_id) {
    const ses = porSesion.get(m.session_id)
    if (ses) return ses.session_date
  }
  return dateCR(m.created_at)
}

export function esEgresoProvEfectivo(m: Mov): boolean {
  return (
    m.caja_origen === 'Caja Proveedores' &&
    m.method === 'Efectivo' &&
    m.movement_type.startsWith('egreso') &&
    m.status !== 'rechazado'
  )
}

export function clasificarCierres(
  movs: Mov[],
  sesiones: Sesion[],
  cierres: Cierre[],
  fechasNoConfiables: string[] = FECHAS_NO_CONFIABLES,
): CierreClasificado[] {
  const porSesion = new Map(sesiones.map((x) => [x.id, x]))

  // Egresos de Caja Proveedores en efectivo, agrupados por session_date VÍA EL JOIN
  // (tal cual pide el criterio: cash_movements.session_id → cash_sessions.session_date).
  const egresosPorFecha = new Map<string, Mov[]>()
  const sinSesionPorFecha = new Map<string, Mov[]>()
  for (const m of movs) {
    const ses = m.session_id ? porSesion.get(m.session_id) : undefined
    if (ses) {
      if (!esEgresoProvEfectivo(m)) continue
      const lista = egresosPorFecha.get(ses.session_date) ?? []
      lista.push(m)
      egresosPorFecha.set(ses.session_date, lista)
    } else {
      const f = dateCR(m.created_at)
      const lista = sinSesionPorFecha.get(f) ?? []
      lista.push(m)
      sinSesionPorFecha.set(f, lista)
    }
  }

  // Candidatos del hueco 1: los pagos de 'Propinas por turno'.
  const propinas = movs
    .filter((m) => m.subcategory === SUBCAT_PROPINA_TURNO && m.status !== 'rechazado')
    .map((m) => ({ mov: m, fecha: fechaDeMov(m, porSesion) }))

  // Ajustes al ledger emitidos por el cierre (Opción B) — se cruzan por la fecha
  // que el propio movimiento nombra en su description.
  const ajustes = movs.filter((m) => m.subcategory === SUBCAT_AJUSTE_CIERRE)

  return cierres
    .filter((c) => c.tipo === 'completo')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .map((c) => {
      const dif = c.diferencia_crc
      const eg = egresosPorFecha.get(c.session_date) ?? []
      const total = eg.reduce((acc, m) => acc + m.amount_crc, 0)
      const residuoHueco2 = dif + total

      let matchPropina: MatchPropina | null = null
      let candidatosEnVentana = 0
      let coincidencias = 0
      for (const p of propinas) {
        if (!p.fecha) continue
        const delta = diasEntre(c.session_date, p.fecha)
        if (Math.abs(delta) > VENTANA_PROPINA_DIAS) continue
        candidatosEnVentana += 1
        const residuo = dif + p.mov.amount_crc
        if (Math.abs(residuo) > TOLERANCIA_CRC) continue
        coincidencias += 1
        const cand: MatchPropina = {
          id: p.mov.id,
          fecha: p.fecha,
          monto: p.mov.amount_crc,
          method: p.mov.method,
          deltaDias: delta,
          residuo,
          candidatosEnVentana: 0,
          coincidencias: 0,
          debil: false,
        }
        // Ante empate, el más cercano en fecha y luego el de menor residuo.
        if (
          !matchPropina ||
          Math.abs(cand.deltaDias) < Math.abs(matchPropina.deltaDias) ||
          (Math.abs(cand.deltaDias) === Math.abs(matchPropina.deltaDias) &&
            Math.abs(cand.residuo) < Math.abs(matchPropina.residuo))
        ) {
          matchPropina = cand
        }
      }
      if (matchPropina) {
        matchPropina.candidatosEnVentana = candidatosEnVentana
        matchPropina.coincidencias = coincidencias
        // Un match es DÉBIL cuando no es único: si varios pagos de propina caen dentro
        // de la tolerancia, o si hay tantos candidatos en la ventana que acertar ±₡500
        // por azar deja de ser improbable, la coincidencia no prueba causalidad.
        matchPropina.debil = coincidencias > 1 || candidatosEnVentana > UMBRAL_CANDIDATOS_DEBIL
      }

      let clase: Clase
      if (Math.abs(dif) < TOLERANCIA_CRC) clase = 'CUADRÓ'
      else if (total > 0 && Math.abs(residuoHueco2) <= TOLERANCIA_CRC) clase = 'EXPLICADO-HUECO-2'
      else if (matchPropina) clase = 'CANDIDATO-HUECO-1'
      else clase = 'NO-EXPLICADO'

      const ajustesLedger = ajustes.filter((m) => s(m.description).includes(c.session_date))

      return {
        cierre: c,
        clase,
        egresosProv: { n: eg.length, total, movs: eg },
        residuoHueco2,
        matchPropina,
        ajustesLedger,
        huerfanosDelDia: sinSesionPorFecha.get(c.session_date) ?? [],
        fechaNoConfiable: fechasNoConfiables.includes(c.session_date),
      }
    })
}

// ── (2) Pozo vs Caja Fuerte ──────────────────────────────────────────────────

export type FilaDesglose = {
  caja_origen: string
  movement_type: string
  n: number
  pozo: number
  cf: number
  delta: number
  pozoUsd: number
  cfUsd: number
  deltaUsd: number
}

export type ComparativoPozo = {
  pozo: { crc: number; usd: number }
  cfReal: { crc: number; usd: number }
  cfEspejo: { crc: number; usd: number }
  espejoOk: boolean
  deltaCrc: number
  deltaUsd: number
  desglose: FilaDesglose[]
  sumaDesglose: number
  sumaDesgloseUsd: number
  cuadra: boolean
  porClase: { clase: ClasePozo; n: number; crc: number }[]
  /** Aporte neto de cada caja al pozo, separando lo que entra de lo que sale. */
  porCaja: { caja: string; entra: number; sale: number; neto: number }[]
}

export function compararPozo(
  movs: Mov[],
  saldoCajaFuerteReal: (movs: Mov[]) => { crc: number; usd: number },
): ComparativoPozo {
  const pozo = { crc: 0, usd: 0 }
  const cfEspejo = { crc: 0, usd: 0 }
  const grupos = new Map<string, FilaDesglose>()
  const clases = new Map<ClasePozo, { n: number; crc: number }>()
  const cajas = new Map<string, { entra: number; sale: number }>()

  for (const m of movs) {
    const cp = contribucionPozo(m)
    const cc = contribucionCajaFuerte(m)
    pozo.crc += cp.crc
    pozo.usd += cp.usd
    cfEspejo.crc += cc.crc
    cfEspejo.usd += cc.usd

    const k = `${m.caja_origen ?? '(null)'} ${m.movement_type}`
    const g = grupos.get(k) ?? {
      caja_origen: m.caja_origen ?? '(null)',
      movement_type: m.movement_type,
      n: 0,
      pozo: 0,
      cf: 0,
      delta: 0,
      pozoUsd: 0,
      cfUsd: 0,
      deltaUsd: 0,
    }
    g.n += 1
    g.pozo += cp.crc
    g.cf += cc.crc
    g.delta += cp.crc - cc.crc
    g.pozoUsd += cp.usd
    g.cfUsd += cc.usd
    g.deltaUsd += cp.usd - cc.usd
    grupos.set(k, g)

    const cl = clases.get(cp.clase) ?? { n: 0, crc: 0 }
    cl.n += 1
    cl.crc += cp.crc
    clases.set(cp.clase, cl)

    if (cp.crc !== 0) {
      const kc = m.caja_origen ?? '(null)'
      const gc = cajas.get(kc) ?? { entra: 0, sale: 0 }
      if (cp.crc > 0) gc.entra += cp.crc
      else gc.sale += -cp.crc
      cajas.set(kc, gc)
    }
  }

  const cfReal = saldoCajaFuerteReal(movs)
  const espejoOk =
    Math.abs(cfEspejo.crc - cfReal.crc) < 1e-6 && Math.abs(cfEspejo.usd - cfReal.usd) < 1e-6

  const desglose = [...grupos.values()]
    .filter((g) => g.n > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.caja_origen.localeCompare(b.caja_origen))
  const sumaDesglose = desglose.reduce((acc, g) => acc + g.delta, 0)
  const sumaDesgloseUsd = desglose.reduce((acc, g) => acc + g.deltaUsd, 0)
  const deltaCrc = pozo.crc - cfReal.crc
  const deltaUsd = pozo.usd - cfReal.usd

  return {
    pozo,
    cfReal,
    cfEspejo,
    espejoOk,
    deltaCrc,
    deltaUsd,
    desglose,
    sumaDesglose,
    sumaDesgloseUsd,
    cuadra: Math.abs(sumaDesglose - deltaCrc) < 1e-6 && Math.abs(sumaDesgloseUsd - deltaUsd) < 1e-6,
    porClase: [...clases.entries()]
      .map(([clase, v]) => ({ clase, n: v.n, crc: v.crc }))
      .sort((a, b) => b.n - a.n),
    porCaja: [...cajas.entries()]
      .map(([caja, v]) => ({ caja, entra: v.entra, sale: v.sale, neto: v.entra - v.sale }))
      .sort((a, b) => a.neto - b.neto),
  }
}

// ── (3) Inventarios ──────────────────────────────────────────────────────────

export type FilaDistribucion = {
  caja_origen: string
  method: string
  movement_type: string
  status: string
  n: number
  crc: number
  usd: number
  banderas: string[]
}

export type FilaTraspaso = {
  subcategory: string
  caja_origen: string
  method: string
  direccion: string
  clase: ClasePozo
  n: number
  crc: number
}

export type Inventarios = {
  sesionesAbiertas: Sesion[]
  distribucion: FilaDistribucion[]
  filasFueraDeConvencion: number
  traspasosEntreFisicas: FilaTraspaso[]
  traspasosBanco: FilaTraspaso[]
  traspasosIndeterminados: FilaTraspaso[]
  ajustesDeCierre: { mov: Mov; signo: string }[]
  movsSinSesion: { movement_type: string; caja_origen: string; method: string; subcategory: string; status: string; n: number; crc: number }[]
  movsSinSesionTotal: { n: number; crc: number }
  fechasAnomalas: { id: string; created_at: string; fechaCR: string; caja_origen: string; crc: number }[]
  movsEnFechasNoConfiables: { fecha: string; n: number; crc: number }[]
  /** Movimientos con amount_crc < 0 — un monto negativo invierte el signo del asiento. */
  negativos: { movement_type: string; caja_origen: string; subcategory: string; n: number; crc: number }[]
  negativosTotal: { n: number; crc: number }
}

function banderasDe(m: Mov): string[] {
  const b: string[] = []
  if (!CAJAS_ORIGEN_CANON.includes(s(m.caja_origen))) b.push('caja_origen fuera de catálogo')
  if (!METODOS_CANON.includes(s(m.method))) b.push('method fuera de catálogo')
  if (!TIPOS_CANON.includes(m.movement_type)) b.push('movement_type fuera de catálogo')
  if (!STATUS_CANON.includes(s(m.status))) b.push('status fuera de catálogo')
  if (m.movement_type === 'traspaso' && !parseTraspaso(m.subcategory)) b.push('traspaso sin dirección legible')
  return b
}

export function construirInventarios(
  movs: Mov[],
  sesiones: Sesion[],
  fechasNoConfiables: string[] = FECHAS_NO_CONFIABLES,
): Inventarios {
  // (a) cajas huérfanas
  const sesionesAbiertas = sesiones
    .filter((x) => x.status === 'open')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  // (b) distribución caja_origen × method × movement_type (× status)
  const dist = new Map<string, FilaDistribucion>()
  for (const m of movs) {
    const k = [m.caja_origen, m.method, m.movement_type, m.status].map(s).join(' ')
    const g = dist.get(k) ?? {
      caja_origen: s(m.caja_origen) || '(null)',
      method: s(m.method) || '(null)',
      movement_type: m.movement_type,
      status: s(m.status) || '(null)',
      n: 0,
      crc: 0,
      usd: 0,
      banderas: [],
    }
    g.n += 1
    g.crc += m.amount_crc
    g.usd += m.amount_usd
    for (const b of banderasDe(m)) if (!g.banderas.includes(b)) g.banderas.push(b)
    dist.set(k, g)
  }
  const distribucion = [...dist.values()].sort(
    (a, b) =>
      a.caja_origen.localeCompare(b.caja_origen) ||
      a.method.localeCompare(b.method) ||
      a.movement_type.localeCompare(b.movement_type) ||
      a.status.localeCompare(b.status),
  )
  const filasFueraDeConvencion = distribucion.filter((g) => g.banderas.length > 0).reduce((a, g) => a + g.n, 0)

  // (c) traspasos
  const tras = new Map<string, FilaTraspaso>()
  for (const m of movs) {
    if (m.movement_type !== 'traspaso') continue
    const t = parseTraspaso(m.subcategory)
    const clase = contribucionPozo(m).clase
    const direccion = t ? `${t.origen} → ${t.destino}` : '(sin dirección)'
    const k = [s(m.subcategory), s(m.caja_origen), s(m.method), s(m.status)].join(' ')
    const g = tras.get(k) ?? {
      subcategory: s(m.subcategory) || '(null)',
      caja_origen: s(m.caja_origen) || '(null)',
      method: s(m.method) || '(null)',
      direccion,
      clase,
      n: 0,
      crc: 0,
    }
    g.n += 1
    g.crc += m.amount_crc
    tras.set(k, g)
  }
  const traspasos = [...tras.values()].sort((a, b) => b.n - a.n)

  // (d) ajustes de cierre
  const ajustesDeCierre = movs
    .filter((m) => m.subcategory === SUBCAT_AJUSTE_CIERRE)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ mov: m, signo: m.movement_type.startsWith('egreso') ? '−' : m.movement_type === 'ingreso' ? '+' : '?' }))

  // extra · movimientos sin turno (se escapan del join por fecha)
  const sinSes = new Map<string, { movement_type: string; caja_origen: string; method: string; subcategory: string; status: string; n: number; crc: number }>()
  let sinSesN = 0
  let sinSesCrc = 0
  for (const m of movs) {
    if (m.session_id) continue
    sinSesN += 1
    sinSesCrc += m.amount_crc
    const k = [m.movement_type, s(m.caja_origen), s(m.method), s(m.subcategory), s(m.status)].join(' ')
    const g = sinSes.get(k) ?? {
      movement_type: m.movement_type,
      caja_origen: s(m.caja_origen) || '(null)',
      method: s(m.method) || '(null)',
      subcategory: s(m.subcategory) || '(null)',
      status: s(m.status) || '(null)',
      n: 0,
      crc: 0,
    }
    g.n += 1
    g.crc += m.amount_crc
    sinSes.set(k, g)
  }

  // extra · fechas imposibles (ilegibles, o año fuera del rango operativo del negocio)
  const fechasAnomalas = movs
    .filter((m) => {
      const f = dateCR(m.created_at)
      if (!f) return true
      const y = Number(f.slice(0, 4))
      return y < 2025 || y > 2027
    })
    .map((m) => ({
      id: m.id,
      created_at: m.created_at,
      fechaCR: dateCR(m.created_at),
      caja_origen: s(m.caja_origen),
      crc: m.amount_crc,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  // extra · huella de las fechas marcadas como no confiables
  const movsEnFechasNoConfiables = fechasNoConfiables.map((f) => {
    const del = movs.filter((m) => dateCR(m.created_at) === f)
    return { fecha: f, n: del.length, crc: del.reduce((a, m) => a + m.amount_crc, 0) }
  })

  const neg = new Map<string, { movement_type: string; caja_origen: string; subcategory: string; n: number; crc: number }>()
  let negN = 0
  let negCrc = 0
  for (const m of movs) {
    if (m.amount_crc >= 0) continue
    negN += 1
    negCrc += m.amount_crc
    const k = [m.movement_type, s(m.caja_origen), s(m.subcategory)].join(' ')
    const g = neg.get(k) ?? {
      movement_type: m.movement_type,
      caja_origen: s(m.caja_origen) || '(null)',
      subcategory: s(m.subcategory) || '(null)',
      n: 0,
      crc: 0,
    }
    g.n += 1
    g.crc += m.amount_crc
    neg.set(k, g)
  }

  return {
    sesionesAbiertas,
    distribucion,
    filasFueraDeConvencion,
    traspasosEntreFisicas: traspasos.filter((t) => t.clase === 'traspaso-interno'),
    traspasosBanco: traspasos.filter((t) => t.clase === 'traspaso-sale-a-banco' || t.clase === 'traspaso-entra-de-banco'),
    traspasosIndeterminados: traspasos.filter((t) => t.clase === 'traspaso-indeterminado' || t.clase === 'fuera'),
    ajustesDeCierre,
    movsSinSesion: [...sinSes.values()].sort((a, b) => b.n - a.n),
    movsSinSesionTotal: { n: sinSesN, crc: sinSesCrc },
    fechasAnomalas,
    movsEnFechasNoConfiables,
    negativos: [...neg.values()].sort((a, b) => a.crc - b.crc),
    negativosTotal: { n: negN, crc: negCrc },
  }
}

// ── Focos: días puntuales que hay que mirar con lupa ────────────────────────
// Se usa para auditar remediaciones manuales (SOP interino) contra los datos.

export type Foco = {
  fecha: string
  nota: string
  sesiones: Sesion[]
  movs: Mov[]
  /** Movimientos cuyo updated_at es posterior al created_at: huella de una edición a mano. */
  editados: { mov: Mov; segundos: number }[]
}

export function construirFocos(
  movs: Mov[],
  sesiones: Sesion[],
  pedidos: { fecha: string; nota: string }[],
): Foco[] {
  const porSesion = new Map(sesiones.map((x) => [x.id, x]))
  return pedidos.map(({ fecha, nota }) => {
    const delDia = movs
      .filter((m) => fechaDeMov(m, porSesion) === fecha)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const editados = delDia
      .map((mov) => {
        const t0 = Date.parse(aISO(mov.created_at))
        const t1 = Date.parse(aISO(mov.updated_at || mov.created_at))
        return { mov, segundos: isNaN(t0) || isNaN(t1) ? 0 : Math.round((t1 - t0) / 1000) }
      })
      .filter((x) => x.segundos > 1)
      .sort((a, b) => b.segundos - a.segundos)
    return {
      fecha,
      nota,
      sesiones: sesiones.filter((x) => x.session_date === fecha),
      movs: delDia,
      editados,
    }
  })
}

// ── Watermark del snapshot (hace el reporte determinista y fechable) ─────────
export type Watermark = {
  movimientos: number
  sesiones: number
  cierres: number
  ultimoMovimiento: string
  ultimaSesion: string
  ultimoCierre: string
}

export function watermark(snap: Snapshot, movs: Mov[], sesiones: Sesion[], cierres: Cierre[]): Watermark {
  const max = (xs: string[]): string => xs.filter(Boolean).sort().at(-1) ?? '—'
  return {
    movimientos: snap.movements.length,
    sesiones: snap.sessions.length,
    cierres: snap.cierres.length,
    ultimoMovimiento: max(movs.map((m) => m.created_at)),
    ultimaSesion: max(sesiones.map((x) => x.created_at)),
    ultimoCierre: max(cierres.map((c) => c.created_at ?? '')),
  }
}

export { esCajaFisica }
