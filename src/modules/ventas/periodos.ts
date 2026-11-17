// ── Motor de períodos y bases de comparación de Ventas v2 (SPEC ventas v2 §3) ─────────────────
//
// Módulo PURO: toda vista de Ventas v2 recibe de acá el período y sus bases; ninguna calcula fechas
// por su cuenta. Días `YYYY-MM-DD` (día CR de la factura), las dos puntas incluidas. La aritmética
// es de calendario (`sumarDias`, `largoEnDias`, `diaSemana` de `periodosPromPax.ts`): acá no hay
// instantes ni husos. El único reloj es `todayCR()`, y solo como valor por defecto del ancla.
//
// Decisiones del dueño (17-nov):
//   · D2=A  «a la fecha» llega hasta AYER (`N` = ancla − 1, hora CR). Hoy va aparte («hoy, en curso»).
//   · D3=A  bases por defecto: período anterior equivalente + año anterior mismo día de semana
//           (−364 días). «Año anterior, mismas fechas» queda disponible.
//   · D10=A semana lunes–domingo (ISO).

import { todayCR } from '../../shared/utils'
import { diaSemana, largoEnDias, lunesDe, mismoDiaAnioAnterior, periodoMes, sumarDias, type Rango } from './periodosPromPax'
import { diaLegible, rangoDeTramo, tramoAnterior, tramoDe, tramoDelAnioAnterior, type Tramo } from './temporadas'

export type TipoPeriodoV2 =
  | 'hoy' | 'ayer' | 'semana' | 'quincena' | 'mesALaFecha' | 'mes' | 'anioALaFecha' | 'temporada' | 'rango'

export type BaseId = 'anteriorEquivalente' | 'anioMismasFechas' | 'anioMismoDiaSemana'

export const BASES: readonly BaseId[] = ['anteriorEquivalente', 'anioMismasFechas', 'anioMismoDiaSemana']

/** D3=A: las dos bases que se muestran si no se elige otra cosa (A y B). */
export const BASES_POR_DEFECTO: readonly [BaseId, BaseId] = ['anteriorEquivalente', 'anioMismoDiaSemana']

/** Antes de este día solo hay resumen diario (no facturas): sin comparación. */
export const PRIMER_DIA_CON_DATOS = '2024-01-05'

export interface Base extends Rango {
  id:     BaseId
  dias:   number
  rotulo: string
  /** `dias` de la base − `dias` del período. 0 = mismo largo. */
  diferenciaDias: number
  /** «28 días contra 31» cuando el largo difiere; `null` si es igual. */
  notaLargo: string | null
  /** Para «hoy»: se compara hasta la misma hora (§3.4). */
  aLaMismaHora: boolean
  /** Aviso de lectura (p. ej. otra temporada). */
  nota: string | null
}

export interface PeriodoV2 extends Rango {
  tipo:    TipoPeriodoV2
  /** El «hoy» CR de referencia. */
  ancla:   string
  /** Último día cerrado: ayer respecto del ancla. */
  N:       string
  /** El período entero sin recortar (la semana, la quincena, el mes, el año, el tramo). */
  natural: Rango
  /** Días transcurridos (`k`). */
  dias:    number
  rotulo:  string
  /** Recortado a `N` (o «hoy»): todavía suma días. */
  enCurso: boolean
  /** Solo para `temporada`. */
  tramo?:  Pick<Tramo, 'id' | 'anio'>
  bases:   Record<BaseId, Base | null>
  /** Por qué una base es `null` («sin comparación»). */
  motivos: Partial<Record<BaseId, string>>
}

export interface OpcionesPeriodo {
  tipo: TipoPeriodoV2
  /** El «hoy» CR. Por defecto `todayCR()`. */
  ancla?: string
  /** Un día dentro del período elegido (lo usan las flechas). Por defecto, según el tipo (§3.2). */
  dia?: string
  /** Para `rango`. */
  desde?: string
  hasta?: string
  /** Primer día con facturas del local. Por defecto `PRIMER_DIA_CON_DATOS`. */
  primerDiaConDatos?: string
}

// ── Rótulos ──────────────────────────────────────────────────────────────────────────────────

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'] as const

const partes = (d: string) => {
  const [a, m, dd] = d.split('-').map(Number)
  return { a, m, d: dd }
}

const diasTxt = (n: number) => `(${n} ${n === 1 ? 'día' : 'días'})`

/**
 * El rango en palabras: «1 al 15 de noviembre (15 días)». El año se escribe solo si no es
 * `anioRef` (el del ancla): «2 al 16 de noviembre de 2025 (15 días)».
 */
export function rotuloRango(r: Rango, anioRef: number): string {
  const a = partes(r.desde)
  const b = partes(r.hasta)
  const anio = (x: number) => (x === anioRef ? '' : ` de ${x}`)
  const n = diasTxt(largoEnDias(r))
  if (r.desde === r.hasta) return `${a.d} de ${MESES[a.m]}${anio(a.a)} ${n}`
  if (a.a === b.a && a.m === b.m) return `${a.d} al ${b.d} de ${MESES[b.m]}${anio(b.a)} ${n}`
  if (a.a === b.a) return `${a.d} de ${MESES[a.m]} al ${b.d} de ${MESES[b.m]}${anio(b.a)} ${n}`
  return `${a.d} de ${MESES[a.m]} de ${a.a} al ${b.d} de ${MESES[b.m]} de ${b.a} ${n}`
}

// ── Contenedores naturales ───────────────────────────────────────────────────────────────────

const anioDe = (d: string) => Number(d.slice(0, 4))
const mesDe = (d: string) => Number(d.slice(5, 7))
const diaDelMes = (d: string) => Number(d.slice(8, 10))

function mesNatural(d: string): Rango {
  const { desde, hasta } = periodoMes(anioDe(d), mesDe(d))
  return { desde, hasta }
}

/** 1.ª quincena = 1 al 15; 2.ª = 16 a fin de mes (13 a 16 días). */
function quincenaNatural(d: string): Rango {
  const m = mesNatural(d)
  const q15 = sumarDias(m.desde, 14)
  return diaDelMes(d) <= 15 ? { desde: m.desde, hasta: q15 } : { desde: sumarDias(q15, 1), hasta: m.hasta }
}

function anioNatural(d: string): Rango {
  const a = anioDe(d)
  return { desde: `${a}-01-01`, hasta: `${a}-12-31` }
}

function semanaNatural(d: string): Rango {
  const desde = lunesDe(d)
  return { desde, hasta: sumarDias(desde, 6) }
}

function tramoNatural(d: string): Tramo {
  return tramoDe(d)
}

/** El contenedor (sin recortar) de un día, según el tipo. */
function natural(tipo: TipoPeriodoV2, d: string): Rango {
  switch (tipo) {
    case 'hoy':
    case 'ayer':         return { desde: d, hasta: d }
    case 'semana':       return semanaNatural(d)
    case 'quincena':     return quincenaNatural(d)
    case 'mesALaFecha':
    case 'mes':          return mesNatural(d)
    case 'anioALaFecha': return anioNatural(d)
    case 'temporada': {
      const t = tramoNatural(d)
      return { desde: t.desde, hasta: t.hasta }
    }
    case 'rango':        throw new Error('El rango no tiene contenedor natural')
  }
}

const min = (a: string, b: string) => (a < b ? a : b)

/** Los primeros `k` días de `r` (o `r` entero si es más corto): «los mismos días transcurridos». */
export const primerosDias = (r: Rango, k: number): Rango => ({ desde: r.desde, hasta: min(r.hasta, sumarDias(r.desde, k - 1)) })
const primeros = primerosDias

const correr = (r: Rango, n: number): Rango => ({ desde: sumarDias(r.desde, n), hasta: sumarDias(r.hasta, n) })

// ── Bases ────────────────────────────────────────────────────────────────────────────────────

type Crudo = { rango: Rango; aLaMismaHora?: boolean; nota?: string } | { motivo: string }

const NO_APLICA_HOY = 'Hoy está en curso: se compara contra el mismo día de semana, a la misma hora'
const NO_APLICA_SEMANA = 'Una semana no tiene «mismas fechas»: se usa el mismo día de semana'
const NO_APLICA_ANIO = 'El año a la fecha se compara contra el año anterior'
const NOTA_TEMPORADA = 'Otra temporada: mirá la dirección, no el nivel'

/** Período anterior equivalente (§3.3, columna 1). */
function crudoAnterior(p: Omit<PeriodoV2, 'bases' | 'motivos' | 'rotulo'>): Crudo {
  const k = p.dias
  switch (p.tipo) {
    case 'hoy':    return { rango: correr(p, -7), aLaMismaHora: true }
    case 'ayer':   return { rango: correr(p, -7) }
    case 'semana': return { rango: primeros({ desde: sumarDias(p.desde, -7), hasta: sumarDias(p.desde, -1) }, k) }
    case 'quincena': {
      // Misma quincena del mes anterior (no la otra quincena del mismo mes: la 2.ª tiene 13–16 días).
      const mesAnt = mesNatural(sumarDias(mesNatural(p.desde).desde, -1))
      const q = quincenaNatural(diaDelMes(p.desde) <= 15 ? mesAnt.desde : mesAnt.hasta)
      return { rango: p.enCurso ? primeros(q, k) : q }
    }
    case 'mesALaFecha':
    case 'mes': {
      const mesAnt = mesNatural(sumarDias(p.natural.desde, -1))
      return { rango: p.enCurso ? primeros(mesAnt, k) : mesAnt }
    }
    case 'anioALaFecha': return { motivo: NO_APLICA_ANIO }
    case 'temporada': {
      const t = tramoAnterior(p.tramo!)
      return { rango: { desde: t.desde, hasta: t.hasta }, nota: NOTA_TEMPORADA }
    }
    case 'rango': {
      const hasta = sumarDias(p.desde, -1)
      return { rango: { desde: sumarDias(hasta, -(k - 1)), hasta } }
    }
  }
}

/** Año anterior, mismas fechas (§3.3, columna 2). */
function crudoMismasFechas(p: Omit<PeriodoV2, 'bases' | 'motivos' | 'rotulo'>): Crudo {
  const k = p.dias
  switch (p.tipo) {
    case 'hoy':    return { motivo: NO_APLICA_HOY }
    case 'semana': return { motivo: NO_APLICA_SEMANA }
    case 'ayer':
    case 'rango':  return { rango: { desde: mismoDiaAnioAnterior(p.desde), hasta: mismoDiaAnioAnterior(p.hasta) } }
    case 'temporada': {
      const t = tramoDelAnioAnterior(p.tramo!)
      const r = { desde: t.desde, hasta: t.hasta }
      return { rango: p.enCurso ? primeros(r, k) : r }
    }
    case 'quincena':
    case 'mesALaFecha':
    case 'mes':
    case 'anioALaFecha': {
      // El mismo contenedor un año antes: entero si el período está cerrado; si no, sus primeros k días.
      const c = natural(p.tipo, mismoDiaAnioAnterior(p.natural.desde))
      return { rango: p.enCurso ? primeros(c, k) : c }
    }
  }
}

/** Año anterior, mismo día de semana: el período corrido 364 días (52 semanas) (§3.3, columna 3). */
function crudoMismoDiaSemana(p: Omit<PeriodoV2, 'bases' | 'motivos' | 'rotulo'>): Crudo {
  return { rango: correr(p, -364), aLaMismaHora: p.tipo === 'hoy' }
}

function armarBase(id: BaseId, c: Crudo, p: Omit<PeriodoV2, 'bases' | 'motivos' | 'rotulo'>, primerDia: string):
  Base | { motivo: string } {
  if ('motivo' in c) return c
  let r = c.rango
  // Un rango de más de un año: la base se corta el día antes del período para no pisarlo.
  if (r.hasta >= p.desde) r = { desde: r.desde, hasta: sumarDias(p.desde, -1) }
  if (r.desde < primerDia) {
    return { motivo: `Sin comparación: no hay facturas antes del ${diaLegible(primerDia)}` }
  }
  const dias = largoEnDias(r)
  const diferenciaDias = dias - p.dias
  return {
    id, desde: r.desde, hasta: r.hasta, dias,
    rotulo: rotuloRango(r, anioDe(p.ancla)),
    diferenciaDias,
    notaLargo: diferenciaDias === 0 ? null : `${dias} días contra ${p.dias}`,
    aLaMismaHora: c.aLaMismaHora ?? false,
    nota: c.nota ?? null,
  }
}

// ── API ──────────────────────────────────────────────────────────────────────────────────────

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

function validarDia(d: string, que: string): void {
  if (!RE_DIA.test(d)) throw new Error(`${que} inválido: ${d}`)
}

/** Ayer respecto del ancla: el último día cerrado (D2=A). */
export function ultimoDiaCerrado(ancla: string): string {
  return sumarDias(ancla, -1)
}

/** El día por defecto de cada tipo (§3.2). «Mes» = el último mes cerrado. */
function diaPorDefecto(tipo: TipoPeriodoV2, ancla: string, N: string): string {
  if (tipo === 'hoy') return ancla
  if (tipo === 'mes') return mesNatural(N).hasta === N ? N : sumarDias(mesNatural(N).desde, -1)
  return N
}

/**
 * El período y sus tres bases. `ancla` = hoy CR; `N` = ayer. Todo período (salvo «hoy») termina a
 * más tardar en `N`; si su contenedor sigue después, se recorta y queda `enCurso`.
 */
export function calcularPeriodo(o: OpcionesPeriodo): PeriodoV2 {
  const ancla = o.ancla ?? todayCR()
  validarDia(ancla, 'Ancla')
  const N = ultimoDiaCerrado(ancla)
  const primerDia = o.primerDiaConDatos ?? PRIMER_DIA_CON_DATOS

  let nat: Rango
  let rango: Rango
  let enCurso: boolean
  let tramo: PeriodoV2['tramo']

  if (o.tipo === 'hoy') {
    nat = rango = { desde: ancla, hasta: ancla }
    enCurso = true
  } else if (o.tipo === 'rango') {
    if (!o.desde || !o.hasta) throw new Error('El rango necesita «desde» y «hasta»')
    validarDia(o.desde, 'Desde'); validarDia(o.hasta, 'Hasta')
    if (o.desde > o.hasta) throw new Error(`Rango al revés: ${o.desde} > ${o.hasta}`)
    if (o.desde > N) throw new Error(`El rango empieza después del último día cerrado (${N})`)
    nat = { desde: o.desde, hasta: o.hasta }
    rango = { desde: o.desde, hasta: min(o.hasta, N) }
    enCurso = o.hasta > N
  } else {
    const dia = min(o.dia ?? diaPorDefecto(o.tipo, ancla, N), N)
    validarDia(dia, 'Día')
    nat = natural(o.tipo, dia)
    rango = { desde: nat.desde, hasta: min(nat.hasta, N) }
    enCurso = nat.hasta > N
    if (o.tipo === 'temporada') {
      const t = tramoDe(dia)
      tramo = { id: t.id, anio: t.anio }
    }
  }

  const p = {
    tipo: o.tipo, ancla, N, natural: nat, desde: rango.desde, hasta: rango.hasta,
    dias: largoEnDias(rango), enCurso, ...(tramo ? { tramo } : {}),
  }

  const crudos: Record<BaseId, Crudo> = {
    anteriorEquivalente: crudoAnterior(p),
    anioMismasFechas:    crudoMismasFechas(p),
    anioMismoDiaSemana:  crudoMismoDiaSemana(p),
  }
  const bases = {} as Record<BaseId, Base | null>
  const motivos: Partial<Record<BaseId, string>> = {}
  for (const id of BASES) {
    const b = armarBase(id, crudos[id], p, primerDia)
    if ('motivo' in b) { bases[id] = null; motivos[id] = b.motivo } else bases[id] = b
  }

  return { ...p, rotulo: rotuloRango(rango, anioDe(ancla)), bases, motivos }
}

/** Flecha ‹: el período entero anterior del mismo tipo (ya cerrado). «Hoy» ‹ = ayer. */
export function periodoAnterior(p: PeriodoV2, primerDiaConDatos?: string): PeriodoV2 {
  const base = { ancla: p.ancla, primerDiaConDatos }
  switch (p.tipo) {
    case 'hoy':   return calcularPeriodo({ ...base, tipo: 'ayer', dia: p.N })
    case 'ayer':  return calcularPeriodo({ ...base, tipo: 'ayer', dia: sumarDias(p.desde, -1) })
    case 'rango': {
      const hasta = sumarDias(p.desde, -1)
      return calcularPeriodo({ ...base, tipo: 'rango', desde: sumarDias(hasta, -(p.dias - 1)), hasta })
    }
    default:      return calcularPeriodo({ ...base, tipo: p.tipo, dia: sumarDias(p.natural.desde, -1) })
  }
}

/** Flecha ›: el período siguiente; `null` si no hay (ya es el actual). Ayer de `N` › = hoy. */
export function periodoSiguiente(p: PeriodoV2, primerDiaConDatos?: string): PeriodoV2 | null {
  const base = { ancla: p.ancla, primerDiaConDatos }
  switch (p.tipo) {
    case 'hoy':  return null
    case 'ayer': return p.desde >= p.N
      ? calcularPeriodo({ ...base, tipo: 'hoy' })
      : calcularPeriodo({ ...base, tipo: 'ayer', dia: sumarDias(p.desde, 1) })
    case 'rango': {
      if (p.enCurso || p.hasta >= p.N) return null
      const desde = sumarDias(p.hasta, 1)
      return calcularPeriodo({ ...base, tipo: 'rango', desde, hasta: sumarDias(desde, p.dias - 1) })
    }
    default: {
      const dia = sumarDias(p.natural.hasta, 1)
      return dia > p.N ? null : calcularPeriodo({ ...base, tipo: p.tipo, dia })
    }
  }
}

// Reexportados para que las vistas tengan una sola puerta.
export { diaSemana, largoEnDias, mismoDiaAnioAnterior, sumarDias, rangoDeTramo }
export type { Rango }
