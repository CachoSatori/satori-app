// ── «A la fecha» en las pantallas actuales de Ventas (SPEC ventas v2 §1 regla 1 y §3; fase 1.3) ──
//
// Módulo PURO: Análisis (Año vs Año, Detalle anual, Proyección, Prom/PAX explicado) y Mix → Comparar
// piden acá el rango de cada número. La regla es una sola:
//
//   NUNCA se compara un período en curso contra uno completo. Si el período no terminó, llega hasta
//   AYER (D2=A: hoy no entra, va aparte en «Hoy» y «En vivo») y la base se recorta a los mismos días.
//
// Las fechas salen del motor `periodos.ts` (D2, D3, D10): `ultimoDiaCerrado`, `primerosDias`,
// `calcularPeriodo` y `rotuloRango`. Acá no se calcula ningún «hoy» propio: el único reloj es
// `todayCR()`, y solo como valor por defecto.

import { todayCR } from '../../shared/utils'
import type { ContabilidadDay } from '../../shared/types/ventas'
import {
  calcularPeriodo, largoEnDias, primerosDias, rotuloRango, sumarDias, ultimoDiaCerrado, type Base, type Rango,
} from './periodos'
import { periodoDeComparacion, periodoMes, type ModoComparacion, type Periodo } from './periodosPromPax'
import { ventaPorPersonaDeTotales } from './indicadores'
import { diaLegible } from './temporadas'

// ── El corte: hasta qué día se cuenta ─────────────────────────────────────────────────────────

export interface Corte {
  /** Hoy en Costa Rica. */
  ancla: string
  /** Último día cerrado: ayer (D2=A). */
  N:     string
  /** Año, mes y día de `N`. */
  anio:  number
  mes:   number
  dia:   number
}

export function corteDe(ancla: string = todayCR()): Corte {
  const N = ultimoDiaCerrado(ancla)
  const [anio, mes, dia] = N.split('-').map(Number)
  return { ancla, N, anio, mes, dia }
}

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'] as const

export const nombreMes = (m: number): string => MESES[m]

const pad = (x: number) => String(x).padStart(2, '0')
const min = (a: string, b: string) => (a < b ? a : b)

/** La fecha `d` llevada al año `anio` (el 29-feb pasa al 28 si ese año no es bisiesto). */
export function mismaFechaEnAnio(d: string, anio: number): string {
  const mmdd = d.slice(5)
  if (mmdd === '02-29') {
    const bisiesto = anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0)
    return `${anio}-02-${bisiesto ? '29' : '28'}`
  }
  return `${anio}-${mmdd}`
}

// ── Contenedores de calendario y si están en curso ────────────────────────────────────────────

export const rangoAnioNatural = (anio: number): Rango => ({ desde: `${anio}-01-01`, hasta: `${anio}-12-31` })
export const rangoMesNatural = (anio: number, mes: number): Rango => {
  const p = periodoMes(anio, mes)
  return { desde: p.desde, hasta: p.hasta }
}
export const rangoTrimestreNatural = (anio: number, q: number): Rango => ({
  desde: rangoMesNatural(anio, q * 3 - 2).desde,
  hasta: rangoMesNatural(anio, q * 3).hasta,
})
/** 1.ª quincena = 1 al 15; 2.ª = 16 a fin de mes. */
export const rangoQuincenaNatural = (anio: number, mes: number, mitad: 1 | 2): Rango => {
  const m = rangoMesNatural(anio, mes)
  return mitad === 1 ? { desde: m.desde, hasta: `${anio}-${pad(mes)}-15` } : { desde: `${anio}-${pad(mes)}-16`, hasta: m.hasta }
}

/** ¿El contenedor `r` sigue después de `N` habiendo empezado antes? (tiene días cerrados y no terminó) */
export const enCurso = (r: Rango, c: Corte): boolean => r.desde <= c.N && r.hasta > c.N

/** El contenedor hasta `N` (si sigue después); `null` si todavía no tiene ningún día cerrado. */
export function hastaN(r: Rango, c: Corte): Rango | null {
  if (r.desde > c.N) return null
  return { desde: r.desde, hasta: min(r.hasta, c.N) }
}

/**
 * El mismo contenedor de calendario en otro año, cortado a la MISMA FECHA que `N` si el del año de
 * `N` está en curso («año anterior, mismas fechas», como la base `anioMismasFechas` del motor).
 * `contenedor` = el rango natural en el año pedido. Si el del año de `N` no está en curso, vuelve
 * entero (o hasta `N`, si es del año de `N`).
 */
export function alineadoAlCorte(contenedor: Rango, enCursoEnAnioN: boolean, c: Corte): Rango | null {
  const anio = Number(contenedor.desde.slice(0, 4))
  // Nada después de N (ni hoy ni días futuros), sea del año que sea.
  if (anio >= c.anio || contenedor.hasta > c.N) return hastaN(contenedor, c)
  if (!enCursoEnAnioN) return contenedor
  const tope = mismaFechaEnAnio(c.N, anio)
  if (tope < contenedor.desde) return null
  return { desde: contenedor.desde, hasta: min(contenedor.hasta, tope) }
}

// ── Totales del resumen por día en un rango ───────────────────────────────────────────────────

export interface Totales {
  ventaNeta:  number
  ventaBruta: number
  iva:        number
  serv:       number
  salon:      number
  delivery:   number
  pax:        number
  /** Días con datos dentro del rango. */
  dias:       number
  /** D4: neta de salón ÷ personas de salón (`indicadores.ts`). `null` sin personas. */
  ventaPorPersona: number | null
}

export const TOTALES_CERO: Totales = {
  ventaNeta: 0, ventaBruta: 0, iva: 0, serv: 0, salon: 0, delivery: 0, pax: 0, dias: 0, ventaPorPersona: null,
}

/** Suma los días (ya armados por `getContabilidadDays`) cuyo día cae en `r`. `r = null` → ceros. */
export function totalesEnRango(dias: readonly ContabilidadDay[], r: Rango | null): Totales {
  if (!r) return { ...TOTALES_CERO }
  const t = { ...TOTALES_CERO }
  for (const d of dias) {
    if (d.fecha < r.desde || d.fecha > r.hasta) continue
    t.ventaNeta += d.ventaNeta; t.ventaBruta += d.ventaBruta; t.iva += d.iva; t.serv += d.serv
    t.salon += d.salon; t.delivery += d.delivery; t.pax += d.pax; t.dias += 1
  }
  t.ventaPorPersona = ventaPorPersonaDeTotales(t.salon, t.pax)
  return t
}

/** Variación en %; `null` si no hay base o no hay dato (nunca −100 % por falta de datos). */
export function variacion(actual: Totales | number, base: Totales | number): number | null {
  const a = typeof actual === 'number' ? actual : actual.ventaNeta
  const b = typeof base === 'number' ? base : base.ventaNeta
  const sinDato = typeof actual === 'number' ? false : actual.dias === 0
  if (!b || sinDato) return null
  return ((a - b) / b) * 100
}

/** «1 al 16 de noviembre (16 días)», con el año si no es el de `N`. */
export const rotulo = (r: Rango, c: Corte): string => rotuloRango(r, c.anio)

// ── Mix → Comparar ────────────────────────────────────────────────────────────────────────────

export interface PeriodoComparado {
  /** La clave del selector del Mix: `YYYY-MM` o `todo-YYYY`. */
  key:       string
  tipo:      'mes' | 'anio'
  natural:   Rango
  /** Lo que se suma. `null` = todavía sin días cerrados. */
  rango:     Rango | null
  enCurso:   boolean
  /** Cortado a los mismos días que el período en curso. */
  recortado: boolean
  /** Las fechas en palabras: «1 al 16 de noviembre (16 días)». */
  rotulo:    string
  /** «28 días contra 30» si el largo no coincide con el del período en curso. */
  notaLargo: string | null
}

function naturalDeClave(key: string): { tipo: 'mes' | 'anio'; natural: Rango } {
  if (key.startsWith('todo-')) return { tipo: 'anio', natural: rangoAnioNatural(Number(key.slice(5))) }
  const [a, m] = key.split('-').map(Number)
  return { tipo: 'mes', natural: rangoMesNatural(a, m) }
}

/**
 * Los períodos elegidos en Mix → Comparar, alineados: si uno está en curso (el mes o el año de hoy),
 * llega hasta ayer y los demás del mismo tipo se cortan a los mismos días — los meses, días 1 a `k`
 * (base «período anterior equivalente» / «mismas fechas» del motor); los años, 1-ene a la misma
 * fecha. Los de otro tipo no se tocan.
 */
export function alinearPeriodosMix(keys: readonly string[], c: Corte): { periodos: PeriodoComparado[]; aviso: string | null } {
  const base = keys.map(key => ({ key, ...naturalDeClave(key) }))
  const enCursoDe = (tipo: 'mes' | 'anio') => base.find(p => p.tipo === tipo && enCurso(p.natural, c)) ?? null
  const mesVivo = enCursoDe('mes')
  const anioVivo = enCursoDe('anio')
  // k del mes en curso (sale del motor: «mes a la fecha» = 1 → N).
  const kMes = mesVivo ? calcularPeriodo({ tipo: 'mes', dia: mesVivo.natural.desde, ancla: c.ancla }).dias : 0

  const periodos = base.map((p): PeriodoComparado => {
    const vivo = enCurso(p.natural, c)
    let rango: Rango | null
    let largoRef: number | null = null
    if (p.natural.desde > c.N) rango = null
    else if (vivo) rango = hastaN(p.natural, c)
    else if (p.tipo === 'mes' && mesVivo) { rango = primerosDias(p.natural, kMes); largoRef = kMes }
    else if (p.tipo === 'anio' && anioVivo) {
      rango = alineadoAlCorte(p.natural, true, c)
      largoRef = largoEnDias(hastaN(anioVivo.natural, c)!)
    } else rango = p.natural
    const dias = rango ? largoEnDias(rango) : 0
    return {
      key: p.key, tipo: p.tipo, natural: p.natural, rango, enCurso: vivo,
      recortado: !!rango && rango.hasta < p.natural.hasta && !vivo,
      rotulo: rango ? rotulo(rango, c) : 'sin días cerrados todavía',
      notaLargo: largoRef !== null && rango && dias !== largoRef ? `${dias} días contra ${largoRef}` : null,
    }
  })

  const vivos = periodos.filter(p => p.enCurso && p.rango)
  const aviso = vivos.length === 0 ? null
    : `${vivos.map(p => p.tipo === 'mes' ? `${nombreMes(Number(p.key.slice(5)))} ${p.key.slice(0, 4)}` : p.key.slice(5)).join(' y ')}`
      + ` va a la fecha: hasta ayer, ${diaLegible(c.N)} (hoy no entra). `
      + 'Los otros períodos del mismo tipo se cortan a los mismos días, para comparar parejo.'
  return { periodos, aviso }
}

// ── Prom/PAX explicado ────────────────────────────────────────────────────────────────────────

const deBase = (b: Base | null): Periodo | null => (b ? { tipo: 'rango', desde: b.desde, hasta: b.hasta } : null)

/**
 * El período y su comparación para «Prom/PAX explicado». Si el período elegido sigue después de
 * ayer, se corta en ayer y la comparación se corta a los mismos días:
 *   · mes:       días 1 a `k` del mes anterior, o del mismo mes del año anterior (motor, D3);
 *   · semana:    lunes → mismo día de la semana anterior, o la misma semana −364 días (motor);
 *   · temporada y rango: el de igual largo que termina el día antes, o el mismo tramo / las mismas
 *     fechas del año anterior, primeros `k` días.
 */
export function alinearPromPax(
  actual: Periodo, modo: ModoComparacion, c: Corte,
): { actual: Periodo; comp: Periodo; enCurso: boolean } | { error: string } {
  if (actual.desde > c.N) {
    return { error: `Este período todavía no tiene días cerrados: empieza el ${diaLegible(actual.desde)} y hoy no entra hasta mañana.` }
  }
  if (actual.hasta <= c.N) return { actual, comp: periodoDeComparacion(actual, modo), enCurso: false }

  const cortado: Periodo = { ...actual, hasta: c.N }
  const k = largoEnDias(cortado)
  if (actual.tipo === 'mes' || actual.tipo === 'semana') {
    const p = calcularPeriodo({ tipo: actual.tipo, dia: actual.desde, ancla: c.ancla })
    const id = modo === 'anterior' ? 'anteriorEquivalente' : actual.tipo === 'mes' ? 'anioMismasFechas' : 'anioMismoDiaSemana'
    const comp = deBase(p.bases[id])
    if (!comp) return { error: p.motivos[id] ?? 'Sin comparación para este período.' }
    return { actual: cortado, comp, enCurso: true }
  }
  const c0 = periodoDeComparacion(cortado, modo)
  const r = primerosDias(c0, k)
  return { actual: cortado, comp: { ...c0, desde: r.desde, hasta: r.hasta }, enCurso: true }
}

// ── Proyección ────────────────────────────────────────────────────────────────────────────────

/** Días de un año (365 o 366). */
export const diasDelAnio = (anio: number): number => largoEnDias(rangoAnioNatural(anio))

/** Días cerrados del año de `N`, del 1-ene a `N` (incluidos). */
export const diasCerradosDelAnio = (c: Corte): number => largoEnDias({ desde: `${c.anio}-01-01`, hasta: c.N })

/** Meta de un mes prorrateada a los días cerrados (`k` de `diasMes`). Lineal: la ponderada por día de semana llega con `proyeccion.ts` (fase 2.2). */
export const metaALaFecha = (metaMes: number, k: number, diasMes: number): number => (diasMes > 0 ? (metaMes * k) / diasMes : 0)

export { largoEnDias, primerosDias, sumarDias }
export type { Rango }
