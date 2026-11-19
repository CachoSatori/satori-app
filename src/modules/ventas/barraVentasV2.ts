// ── Ventas v2 · la barra global (SPEC-ventas-v2 §5): local, período y comparación ─────────────
//
// PURO. El estado de la barra vive en la URL (`/ventas?tab=resumen&p=mesALaFecha&a=…&b=…`) para
// que se conserve al pasar de una pestaña a otra y sobreviva a un «recargar». Las fechas las arma
// SIEMPRE `periodos.ts` (`calcularPeriodo`): acá solo se lee y se escribe la URL.

import { BASES_POR_DEFECTO, calcularPeriodo, fechasCortas, periodoAnterior, periodoSiguiente,
  type BaseId, type PeriodoV2, type TipoPeriodoV2 } from './periodos'

/** Todos los tipos que entiende la URL (los links viejos no rompen: lo que no se ofrece cae al defecto). */
export const ROTULO_PERIODO: Record<TipoPeriodoV2, string> = {
  hoy: 'Hoy', ayer: 'Ayer', semana: 'Semana', quincena: 'Quincena', mesALaFecha: 'Mes', mes: 'Mes',
  anioALaFecha: 'Año a la fecha', temporada: 'Temporada', rango: 'Rango',
}

/**
 * Las opciones de «Período», las mismas en todas las pestañas (decisión del dueño, 18-nov 17:11: se simplifica la
 * ESTRUCTURA, no las opciones). «Mes» con el mes en curso es el mes a la fecha (hasta ayer): mismo período que el
 * «Mes a la fecha» de antes, que ya no aparece aparte.
 */
export const PERIODOS: readonly TipoPeriodoV2[] = ['hoy', 'ayer', 'semana', 'quincena', 'mes', 'anioALaFecha', 'temporada', 'rango']

/**
 * Contra qué se compara: una sola base o «Los dos» (período anterior equivalente + año pasado, mismo día de
 * semana: el par por defecto de D3). «Año pasado, mismas fechas» (la del contador) se elige sola.
 */
export type Comparar = 'anterior' | 'anio' | 'anioFechas' | 'ambos'
export const BASE_ANTERIOR: BaseId = BASES_POR_DEFECTO[0]
export const BASE_ANIO: BaseId = BASES_POR_DEFECTO[1]
export const BASE_ANIO_FECHAS: BaseId = 'anioMismasFechas'
export const COMPARAR_POR_DEFECTO: Comparar = 'ambos'
export const OPCIONES_COMPARAR: readonly Comparar[] = ['anterior', 'anio', 'anioFechas', 'ambos']

/** Las bases que se muestran, en orden (la anterior primero). */
export function basesDe(c: Comparar): BaseId[] {
  if (c === 'anterior') return [BASE_ANTERIOR]
  if (c === 'anio') return [BASE_ANIO]
  if (c === 'anioFechas') return [BASE_ANIO_FECHAS]
  return [BASE_ANTERIOR, BASE_ANIO]
}

/**
 * Las dos bases que se leen. Con «anterior», «año pasado, mismo día de semana» o «Los dos» se lee siempre el mismo
 * par (cambiar entre esas tres no vuelve a leer); «Año pasado, mismas fechas» se lee sola.
 */
export function basesALeer(c: Comparar): [BaseId, BaseId] {
  return c === 'anioFechas' ? [BASE_ANIO_FECHAS, BASE_ANIO_FECHAS] : [BASE_ANTERIOR, BASE_ANIO]
}

/** Texto de cada opción de «Comparar con»: el nombre concreto de la base (pedido del dueño del 18-nov). */
export function rotuloComparar(p: Pick<PeriodoV2, 'tipo' | 'enCurso' | 'dias'>, c: Comparar): string {
  return c === 'ambos' ? 'Los dos' : rotuloBase(p, basesDe(c)[0])
}

/** Rótulo genérico de cada base (cuando no hay período a mano). En pantalla va `rotuloBase`. */
export const ROTULO_BASE: Record<BaseId, string> = {
  anteriorEquivalente: 'Período anterior',
  anioMismasFechas:    'Año anterior, mismas fechas',
  anioMismoDiaSemana:  'Año anterior, mismo día de semana',
}

/** El nombre concreto de una base para un período, con su artículo para armar la frase. */
export interface NombreBase {
  /** En minúscula: «mes anterior a la misma fecha», «15 días anteriores». */
  texto:    string
  articulo: 'el' | 'la' | 'los'
}

const enCursoTxt = (p: Pick<PeriodoV2, 'enCurso'>) => (p.enCurso ? ', mismos días' : '')

/**
 * Lo que la base ES para el período elegido (pedido del dueño, 18-nov: «período anterior» no dice
 * nada). Sale de las mismas reglas de `periodos.ts` (§3.3): no inventa una base distinta.
 *   · Hoy / Ayer → el mismo día de la semana pasada (−7 días, no el día anterior).
 *   · Quincena → la MISMA quincena del mes anterior (1–15 nov contra 1–15 oct; SPEC §3.3).
 *   · Rango → los N días de antes, de igual largo.
 */
export function nombreBase(p: Pick<PeriodoV2, 'tipo' | 'enCurso' | 'dias'>, id: BaseId): NombreBase {
  if (id === 'anioMismoDiaSemana') return { texto: 'año pasado, mismo día de semana', articulo: 'el' }
  if (id === 'anioMismasFechas') {
    return p.tipo === 'anioALaFecha'
      ? { texto: 'año anterior a la fecha', articulo: 'el' }
      : { texto: 'año pasado, mismas fechas', articulo: 'el' }
  }
  switch (p.tipo) {
    case 'hoy':
    case 'ayer':         return { texto: 'mismo día de la semana pasada', articulo: 'el' }
    case 'semana':       return { texto: `semana anterior${enCursoTxt(p)}`, articulo: 'la' }
    case 'quincena':     return { texto: `misma quincena del mes anterior${enCursoTxt(p)}`, articulo: 'la' }
    case 'mesALaFecha':  return { texto: 'mes anterior a la misma fecha', articulo: 'el' }
    case 'mes':          return { texto: p.enCurso ? 'mes anterior a la misma fecha' : 'mes anterior', articulo: 'el' }
    case 'anioALaFecha': return { texto: 'año anterior', articulo: 'el' }
    case 'temporada':    return { texto: 'temporada anterior', articulo: 'la' }
    case 'rango':        return p.dias === 1
      ? { texto: 'día anterior', articulo: 'el' }
      : { texto: `${p.dias} días anteriores`, articulo: 'los' }
  }
}

const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** El nombre concreto con mayúscula, para el selector «Comparar con» y las notas. */
export const rotuloBase = (p: Pick<PeriodoV2, 'tipo' | 'enCurso' | 'dias'>, id: BaseId): string => mayus(nombreBase(p, id).texto)

/** Las fechas cortas de la base («16–31 oct»), o `null` si no hay base. */
export function fechasDeBase(p: PeriodoV2, id: BaseId): string | null {
  const b = p.bases[id]
  return b ? fechasCortas(b, Number(p.ancla.slice(0, 4))) : null
}

/** «15 días anteriores (17–31 oct)»: el nombre con las fechas de la base entre paréntesis. */
export function baseConFechas(p: PeriodoV2, id: BaseId): string {
  const f = fechasDeBase(p, id)
  const t = nombreBase(p, id).texto
  return f ? `${t} (${f})` : t
}

/** «del» / «de la» / «de los», «con el» / «con la» / «con los». */
export function conArticulo(n: NombreBase, prep: 'de' | 'con'): string {
  if (prep === 'de' && n.articulo === 'el') return 'del'
  return `${prep} ${n.articulo}`
}

/** El período por defecto del Resumen: el ritmo de cada mañana es «Ayer» (§6). */
export const PERIODO_POR_DEFECTO: TipoPeriodoV2 = 'ayer'

export interface EstadoBarra {
  local:  string | null
  tipo:   TipoPeriodoV2
  /** Un día dentro del período (lo mueven las flechas). */
  dia?:   string
  desde?: string
  hasta?: string
  comparar: Comparar
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/
const esTipo = (s: string | null): s is TipoPeriodoV2 => !!s && Object.prototype.hasOwnProperty.call(ROTULO_PERIODO, s)
const esComparar = (s: string | null): s is Comparar => !!s && (OPCIONES_COMPARAR as readonly string[]).includes(s)
const dia = (s: string | null) => (s && RE_DIA.test(s) ? s : undefined)

/**
 * Lee la barra de la URL. Lo que no se entiende cae al valor por defecto (nunca rompe). «Mes a la fecha» (links
 * viejos) se sigue leyendo: es el «Mes» en curso. Los `a`/`b` viejos se ignoran.
 */
export function leerBarra(sp: URLSearchParams, porDefecto: TipoPeriodoV2 = PERIODO_POR_DEFECTO): EstadoBarra {
  const p = sp.get('p')
  const c = sp.get('c')
  return {
    local: sp.get('local') || null,
    tipo:  esTipo(p) ? p : porDefecto,
    dia:   dia(sp.get('d')),
    desde: dia(sp.get('desde')),
    hasta: dia(sp.get('hasta')),
    comparar: esComparar(c) ? c : COMPARAR_POR_DEFECTO,
  }
}

/** Escribe la barra sobre los parámetros que ya hay (no toca `tab` ni otros). */
export function escribirBarra(sp: URLSearchParams, e: EstadoBarra): URLSearchParams {
  const out = new URLSearchParams(sp)
  const poner = (k: string, v: string | undefined | null) => { if (v) out.set(k, v); else out.delete(k) }
  poner('local', e.local)
  poner('p', e.tipo)
  poner('d', e.tipo === 'rango' ? undefined : e.dia)
  poner('desde', e.tipo === 'rango' ? e.desde : undefined)
  poner('hasta', e.tipo === 'rango' ? e.hasta : undefined)
  poner('c', e.comparar === COMPARAR_POR_DEFECTO ? undefined : e.comparar)
  out.delete('a')
  out.delete('b')
  return out
}

/**
 * El período de la barra. Un rango incompleto o inválido (al revés, después de ayer) cae a «Ayer»
 * con el motivo, en vez de tirar error en pantalla.
 */
export function periodoDeBarra(e: Pick<EstadoBarra, 'tipo' | 'dia' | 'desde' | 'hasta'>, ancla?: string): { periodo: PeriodoV2; aviso: string | null } {
  try {
    if (e.tipo === 'rango') {
      if (!e.desde || !e.hasta) throw new Error('Elegí las dos fechas del rango')
      return { periodo: calcularPeriodo({ tipo: 'rango', desde: e.desde, hasta: e.hasta, ancla }), aviso: null }
    }
    return { periodo: calcularPeriodo({ tipo: e.tipo, dia: e.dia, ancla }), aviso: null }
  } catch (err) {
    const aviso = err instanceof Error ? err.message : 'Período inválido'
    return { periodo: calcularPeriodo({ tipo: 'ayer', ancla }), aviso }
  }
}

/** Lo que hace una flecha: el estado nuevo de la barra (o `null` si no hay a dónde ir). */
export function moverPeriodo(e: EstadoBarra, p: PeriodoV2, hacia: -1 | 1): EstadoBarra | null {
  const nuevo = hacia < 0 ? periodoAnterior(p) : periodoSiguiente(p)
  if (!nuevo) return null
  if (nuevo.tipo === 'rango') return { ...e, tipo: 'rango', desde: nuevo.desde, hasta: nuevo.hasta, dia: undefined }
  return { ...e, tipo: nuevo.tipo, dia: nuevo.tipo === 'hoy' ? undefined : nuevo.desde, desde: undefined, hasta: undefined }
}

/**
 * Elegir otro tipo en «Período»: el nuevo período contiene el último día del que se estaba mirando (de «Semana
 * del 5-oct» a «Mes» = octubre; desde «Ayer» = el mes en curso, a la fecha). «Rango» arranca con las fechas de hoy.
 */
export function cambiarTipo(e: EstadoBarra, p: PeriodoV2, tipo: TipoPeriodoV2): EstadoBarra {
  if (tipo === 'rango') return { ...e, tipo, dia: undefined, desde: e.desde ?? p.desde, hasta: e.hasta ?? p.hasta }
  if (tipo === 'hoy') return { ...e, tipo, dia: undefined, desde: undefined, hasta: undefined }
  return { ...e, tipo, dia: p.hasta, desde: undefined, hasta: undefined }
}

/**
 * «1 al 15 de noviembre (15 días) contra el mes anterior a la misma fecha (1–15 oct) y contra el año
 * pasado, mismo día de semana (2–16 nov 2025). Hoy, en curso, no entra.»
 */
export function periodoEnPalabras(p: PeriodoV2, bases: readonly BaseId[]): string {
  if (p.tipo === 'hoy') return 'Hoy está en curso: se mira en «En vivo», contra la misma hora.'
  const contra = bases.map(id => {
    const n = nombreBase(p, id)
    return p.bases[id] ? `contra ${n.articulo} ${baseConFechas(p, id)}` : `sin comparación ${conArticulo(n, 'con')} ${n.texto}`
  })
  return `${p.rotulo} ${contra.join(' y ')}.${p.enCurso || p.hasta === p.N ? ' Hoy, en curso, no entra.' : ''}`
}
