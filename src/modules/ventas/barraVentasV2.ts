// ── Ventas v2 · la barra global (SPEC-ventas-v2 §5): local, período y comparación ─────────────
//
// PURO. El estado de la barra vive en la URL (`/ventas?tab=resumen&p=mesALaFecha&a=…&b=…`) para
// que se conserve al pasar de una pestaña a otra y sobreviva a un «recargar». Las fechas las arma
// SIEMPRE `periodos.ts` (`calcularPeriodo`): acá solo se lee y se escribe la URL.

import { BASES, BASES_POR_DEFECTO, calcularPeriodo, fechasCortas, periodoAnterior, periodoSiguiente,
  type BaseId, type PeriodoV2, type TipoPeriodoV2 } from './periodos'

export const OPCIONES_PERIODO: readonly { id: TipoPeriodoV2; label: string }[] = [
  { id: 'hoy',          label: 'Hoy' },
  { id: 'ayer',         label: 'Ayer' },
  { id: 'semana',       label: 'Semana' },
  { id: 'quincena',     label: 'Quincena' },
  { id: 'mesALaFecha',  label: 'Mes a la fecha' },
  { id: 'mes',          label: 'Mes' },
  { id: 'anioALaFecha', label: 'Año a la fecha' },
  { id: 'temporada',    label: 'Temporada' },
  { id: 'rango',        label: 'Rango' },
]

/** Rótulo genérico de cada base (cuando no hay período a mano). En pantalla va `rotuloBase`. */
export const ROTULO_BASE: Record<BaseId, string> = {
  anteriorEquivalente: 'Período anterior',
  anioMismasFechas:    'Año anterior, mismas fechas',
  anioMismoDiaSemana:  'Año anterior, mismo día de semana',
}

/** El nombre concreto de una base para un período, con su artículo para armar la frase. */
export interface NombreBase {
  /** En minúscula: «quincena anterior», «15 días anteriores». */
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

/** «quincena anterior (16–31 oct)»: el nombre con las fechas de la base entre paréntesis. */
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
  baseA:  BaseId
  baseB:  BaseId
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/
const esTipo = (s: string | null): s is TipoPeriodoV2 => !!s && OPCIONES_PERIODO.some(o => o.id === s)
const esBase = (s: string | null): s is BaseId => !!s && (BASES as readonly string[]).includes(s)
const dia = (s: string | null) => (s && RE_DIA.test(s) ? s : undefined)

/** Lee la barra de la URL. Lo que no se entiende cae al valor por defecto (nunca rompe). */
export function leerBarra(sp: URLSearchParams): EstadoBarra {
  const p = sp.get('p')
  let baseA: BaseId = esBase(sp.get('a')) ? (sp.get('a') as BaseId) : BASES_POR_DEFECTO[0]
  let baseB: BaseId = esBase(sp.get('b')) ? (sp.get('b') as BaseId) : BASES_POR_DEFECTO[1]
  if (baseA === baseB) { baseA = BASES_POR_DEFECTO[0]; baseB = BASES_POR_DEFECTO[1] }
  return {
    local: sp.get('local') || null,
    tipo:  esTipo(p) ? p : PERIODO_POR_DEFECTO,
    dia:   dia(sp.get('d')),
    desde: dia(sp.get('desde')),
    hasta: dia(sp.get('hasta')),
    baseA, baseB,
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
  poner('a', e.baseA)
  poner('b', e.baseB)
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

/** Cambiar la base A (o B) a una que ya ocupa la otra: se intercambian, nunca quedan iguales. */
export function elegirBase(e: EstadoBarra, cual: 'A' | 'B', id: BaseId): EstadoBarra {
  if (cual === 'A') return id === e.baseB ? { ...e, baseA: id, baseB: e.baseA } : { ...e, baseA: id }
  return id === e.baseA ? { ...e, baseB: id, baseA: e.baseB } : { ...e, baseB: id }
}

/**
 * «1 al 15 de noviembre (15 días) contra el mes anterior a la misma fecha (1–15 oct) y contra el año
 * pasado, mismo día de semana (2–16 nov 2025). Hoy, en curso, no entra.»
 */
export function periodoEnPalabras(p: PeriodoV2, a: BaseId, b: BaseId): string {
  if (p.tipo === 'hoy') return 'Hoy está en curso: se mira en «En vivo», contra la misma hora.'
  const contra = [a, b].map(id => {
    const n = nombreBase(p, id)
    return p.bases[id] ? `contra ${n.articulo} ${baseConFechas(p, id)}` : `sin comparación ${conArticulo(n, 'con')} ${n.texto}`
  })
  return `${p.rotulo} ${contra[0]} y ${contra[1]}.${p.enCurso || p.hasta === p.N ? ' Hoy, en curso, no entra.' : ''}`
}
