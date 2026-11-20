// ── Ventas v2 · meta y proyección del mes (SPEC-ventas-v2 §4.3, fase 2.2) — PURO ────────────────
//
// Sin I/O ni reloj. Recibe la meta del mes (la de «Metas», `ventas_metas.restaurante['YYYY-MM']`), el
// último día cerrado `N` (ayer, D2=A) y la venta neta por día CR de factura, y devuelve avance, ritmo,
// proyección con rango y necesario por día. Nunca usa el día en curso: todo llega hasta `N`.
//
// La proyección es PONDERADA POR DÍA DE SEMANA (§4.3): un viernes que falta pesa más que un martes.
//   · Historia = las últimas 8 semanas CERRADAS, lunes a domingo (D10=A): la última termina el domingo
//     anterior o igual a `N`. Así cada día de semana entra 8 veces y nunca una semana a medias.
//   · Peso de un día de semana = promedio de su neta en esas 8 semanas. Un día cerrado del local cuenta 0.
//   · Proyección = neta de días cerrados + Σ peso de los días que faltan × (neta cerrada ÷ Σ peso de
//     los días cerrados). Es decir: el mes va al ritmo que lleva, con la mezcla de días que falta.
//   · Ritmo = avance ÷ parte ponderada del mes que ya pasó (Σ peso cerrados ÷ Σ peso del mes).
//     1 = va justo para la meta. (Ojo: ritmo × meta = proyección, son la misma lectura.)
//   · Necesario por día = (meta − neta cerrada) ÷ días que faltan (0 si ya se llegó).
//
// El rango (±) mide el RUIDO DIARIO, no la temporada (revisión de #293). La proyección ya toma el nivel
// del mes en curso (lo vendido ÷ su peso), así que lo que falta por saber es cuánto se aparta un día de
// lo que su día de semana y su semana predicen:
//   · Para cada día de las 8 semanas: e = neta ÷ (peso de su día de semana × nivel de su semana), con
//     nivel = neta de la semana ÷ Σ pesos de la semana. Dividir por el nivel de SU semana saca la subida
//     o bajada de temporada (una semana entera más alta no es ruido). `σ` = desvío de esos `e` (≈ 1).
//   · ± = lo que falta proyectar × σ × √(1/m + 1/k), con m = días que faltan y k = días cerrados del mes:
//     el ruido de los m días que vienen más el error de estimar el nivel con k días. Es ≈ 1 desvío
//     (≈ 2 de cada 3, si no cambia la temporada). Con el mes cerrado, ±0.
//
// Sin 8 semanas completas de historia (contadas desde `primerDiaConDatos`) se cae a la lineal: cada día
// pesa 1. Es la misma cuenta que «Análisis → Proyección» para el mes en curso (`vendido ÷ k × días del
// mes`), la marca `ponderada: false` lo dice en pantalla y el ± queda en 0 (no hay con qué medirlo).

import { diaSemana, largoEnDias, sumarDias, type Rango } from './periodos'

/** Semanas de historia para los pesos (§4.3). */
export const SEMANAS_DE_PESO = 8

export interface EntradaProyeccion {
  /** Meta del mes en colones. 0 o ausente = sin meta. */
  meta: number
  /** El mes natural (1 al último día). */
  mes: Rango
  /** Último día cerrado (ayer). */
  N: string
  /** Neta por día CR de factura. Un día que no está = 0 (cerrado o sin ventas). */
  netaPorDia: ReadonlyMap<string, number>
  /** Primer día con datos del PoS: los días anteriores no entran en los pesos. */
  primerDiaConDatos?: string
}

export type EstadoProyeccion = 'sinMeta' | 'sinDiasCerrados' | 'mesCerrado' | 'enCurso'

export interface Proyeccion {
  estado:          EstadoProyeccion
  meta:            number
  mes:             Rango
  /** Días del mes ya cerrados (1 → `N`), o `null` si el mes todavía no empezó. */
  cerrados:        Rango | null
  diasCerrados:    number
  diasMes:         number
  diasQueFaltan:   number
  vendido:         number
  /** vendido ÷ meta, en %. `null` sin meta. */
  avancePct:       number | null
  /** Σ peso cerrados ÷ Σ peso del mes (0 a 1). */
  parteDelMes:     number
  /** La meta que «tocaba» a la fecha: meta × parte ponderada del mes. */
  metaALaFecha:    number | null
  /** avance ÷ parte del mes (1 = va justo). `null` sin meta o sin días cerrados. */
  ritmo:           number | null
  proyeccion:      number
  /** ± en colones alrededor de la proyección (≈ 1 desvío). */
  rango:           number
  /** El ruido diario `σ` con que se midió el ±. */
  sigma:           number
  /** `null` con el mes cerrado. */
  necesarioPorDia: number | null
  /** Peso de cada día de semana (0 = lunes … 6 = domingo, como `diaSemana`). */
  pesos:           readonly number[]
  /** `false` = sin historia: se proyectó lineal (cada día pesa 1). */
  ponderada:       boolean
}

const dias = (r: Rango): string[] => {
  const out: string[] = []
  for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) out.push(d)
  return out
}

/** El domingo de la última semana lunes–domingo ya cerrada en `N` (si `N` es domingo, `N`). */
export function ultimoDomingoCerrado(N: string): string {
  return sumarDias(N, -((diaSemana(N) + 1) % 7))
}

/** Las 8 semanas lunes–domingo que terminan en `ultimoDomingoCerrado(N)`, de la más vieja a la más nueva. */
export function semanasDeHistoria(N: string, primerDiaConDatos?: string): Rango[] {
  const dom = ultimoDomingoCerrado(N)
  const out: Rango[] = []
  for (let s = SEMANAS_DE_PESO - 1; s >= 0; s--) {
    const hasta = sumarDias(dom, -7 * s)
    const desde = sumarDias(hasta, -6)
    if (primerDiaConDatos && desde < primerDiaConDatos) continue // semana sin datos completos: no entra
    out.push({ desde, hasta })
  }
  return out
}

/** Los pesos por día de semana (0 = lunes): promedio de la neta de las semanas de historia. */
export function pesosPorDiaSemana(
  netaPorDia: ReadonlyMap<string, number>,
  semanas: readonly Rango[],
): number[] {
  const suma = [0, 0, 0, 0, 0, 0, 0]
  for (const w of semanas) for (const d of dias(w)) suma[diaSemana(d)] += netaPorDia.get(d) ?? 0
  return suma.map(x => (semanas.length > 0 ? x / semanas.length : 0))
}

/**
 * El ruido diario `σ`: desvío de neta ÷ (peso del día de semana × nivel de su semana) en las semanas
 * de historia. Saca el patrón semanal y el nivel de cada semana (la temporada): queda lo que un día se
 * aparta de lo esperado. 0 con menos de 2 días útiles.
 */
export function ruidoDiario(
  netaPorDia: ReadonlyMap<string, number>,
  semanas: readonly Rango[],
  pesos: readonly number[],
): number {
  const e: number[] = []
  for (const w of semanas) {
    const ds = dias(w)
    const pesoSemana = ds.reduce((a, d) => a + pesos[diaSemana(d)], 0)
    const netaSemana = ds.reduce((a, d) => a + (netaPorDia.get(d) ?? 0), 0)
    if (pesoSemana <= 0 || netaSemana <= 0) continue
    const nivel = netaSemana / pesoSemana
    for (const d of ds) {
      const esperado = pesos[diaSemana(d)] * nivel
      if (esperado > 0) e.push((netaPorDia.get(d) ?? 0) / esperado)
    }
  }
  if (e.length < 2) return 0
  const prom = e.reduce((a, b) => a + b, 0) / e.length
  return Math.sqrt(e.reduce((a, b) => a + (b - prom) ** 2, 0) / (e.length - 1))
}

export function proyectarMes(e: EntradaProyeccion): Proyeccion {
  const meta = e.meta > 0 ? e.meta : 0
  const diasMes = largoEnDias(e.mes)
  const cerrados: Rango | null = e.N < e.mes.desde ? null
    : { desde: e.mes.desde, hasta: e.N < e.mes.hasta ? e.N : e.mes.hasta }
  const diasCerrados = cerrados ? largoEnDias(cerrados) : 0
  const diasQueFaltan = diasMes - diasCerrados
  const vendido = cerrados ? dias(cerrados).reduce((s, d) => s + (e.netaPorDia.get(d) ?? 0), 0) : 0

  const semanas = semanasDeHistoria(e.N, e.primerDiaConDatos)
  const pesosHist = pesosPorDiaSemana(e.netaPorDia, semanas)
  const ponderada = semanas.length === SEMANAS_DE_PESO && pesosHist.some(p => p > 0)
  const pesos = ponderada ? pesosHist : [1, 1, 1, 1, 1, 1, 1]
  const peso = (d: string) => pesos[diaSemana(d)]

  const todos = dias(e.mes)
  const pesoMes = todos.reduce((s, d) => s + peso(d), 0)
  const pesoCerrados = cerrados ? dias(cerrados).reduce((s, d) => s + peso(d), 0) : 0
  const pesoFaltan = pesoMes - pesoCerrados
  const parteDelMes = pesoMes > 0 ? pesoCerrados / pesoMes : 0

  // Ritmo de lo que va (neta por unidad de peso). Si los días cerrados no pesan nada (p. ej. solo
  // cayeron días que el local cierra), la proyección es lo vendido.
  const porPeso = pesoCerrados > 0 ? vendido / pesoCerrados : 0
  const proyeccion = vendido + pesoFaltan * porPeso
  const sigma = ponderada ? ruidoDiario(e.netaPorDia, semanas, pesos) : 0
  const rango = diasQueFaltan > 0 && diasCerrados > 0
    ? (proyeccion - vendido) * sigma * Math.sqrt(1 / diasQueFaltan + 1 / diasCerrados) : 0

  const estado: EstadoProyeccion = meta === 0 ? 'sinMeta'
    : diasCerrados === 0 ? 'sinDiasCerrados'
    : diasQueFaltan === 0 ? 'mesCerrado' : 'enCurso'

  const metaALaFecha = meta > 0 ? meta * parteDelMes : null
  return {
    estado, meta, mes: e.mes, cerrados, diasCerrados, diasMes, diasQueFaltan, vendido,
    avancePct:       meta > 0 ? (vendido / meta) * 100 : null,
    parteDelMes,
    metaALaFecha,
    ritmo:           metaALaFecha && metaALaFecha > 0 && diasCerrados > 0 ? vendido / metaALaFecha : null,
    proyeccion,
    rango,
    sigma,
    necesarioPorDia: diasQueFaltan > 0 ? Math.max(0, meta - vendido) / diasQueFaltan : null,
    pesos,
    ponderada,
  }
}

/** Lo que hay que leer del PoS para proyectar: el mes hasta `N` y las 8 semanas lunes–domingo de la historia. */
export function rangoDeLecturaProyeccion(mes: Rango, N: string): Rango {
  const desdePesos = sumarDias(ultimoDomingoCerrado(N), -(7 * SEMANAS_DE_PESO - 1))
  return { desde: desdePesos < mes.desde ? desdePesos : mes.desde, hasta: N }
}

/** El mes natural de un día: 1 al último día. */
export function mesDe(d: string): Rango {
  const desde = `${d.slice(0, 7)}-01`
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))]
  const sig = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`
  return { desde, hasta: sumarDias(sig, -1) }
}
