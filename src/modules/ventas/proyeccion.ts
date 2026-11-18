// ── Ventas v2 · meta y proyección del mes (SPEC-ventas-v2 §4.3, fase 2.2) — PURO ────────────────
//
// Sin I/O ni reloj. Recibe la meta del mes (la de «Metas», `ventas_metas.restaurante['YYYY-MM']`), el
// último día cerrado `N` (ayer, D2=A) y la venta neta por día CR de factura, y devuelve avance, ritmo,
// proyección con rango y necesario por día. Nunca usa el día en curso: todo llega hasta `N`.
//
// La proyección es PONDERADA POR DÍA DE SEMANA (§4.3): un viernes que falta pesa más que un martes.
//   · Peso de un día de semana = promedio de la neta de ese día en las últimas 8 semanas cerradas
//     (los 56 días que terminan en `N`: ocho lunes, ocho martes…). Un día cerrado del local cuenta 0.
//   · Proyección = neta de días cerrados + Σ peso de los días que faltan × (neta cerrada ÷ Σ peso de
//     los días cerrados). Es decir: el mes va al ritmo que lleva, con la mezcla de días que falta.
//   · Ritmo = avance ÷ parte ponderada del mes que ya pasó (Σ peso cerrados ÷ Σ peso del mes).
//     1 = va justo para la meta.
//   · Rango (±) = lo que falta proyectar × el desvío relativo de las 8 semanas (desvío ÷ promedio de
//     las ventas semanales). Con el mes cerrado, ±0.
//   · Necesario por día = (meta − neta cerrada) ÷ días que faltan (0 si ya se llegó).
//
// Sin historia suficiente (ningún peso > 0) se cae a la lineal: cada día pesa 1. Es la misma cuenta
// que «Análisis → Proyección» para el mes en curso (`vendido ÷ k × días del mes`) y la marca
// `ponderada: false` lo dice en pantalla.

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
  /** ± en colones alrededor de la proyección. */
  rango:           number
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

/** Los pesos por día de semana: promedio de la neta de las últimas 8 semanas que terminan en `N`. */
export function pesosPorDiaSemana(
  netaPorDia: ReadonlyMap<string, number>,
  N: string,
  primerDiaConDatos?: string,
): { pesos: number[]; semanales: number[] } {
  const suma = [0, 0, 0, 0, 0, 0, 0]
  const cuenta = [0, 0, 0, 0, 0, 0, 0]
  const semanales: number[] = []
  for (let s = 0; s < SEMANAS_DE_PESO; s++) {
    const hasta = sumarDias(N, -7 * s)
    const desde = sumarDias(hasta, -6)
    if (primerDiaConDatos && desde < primerDiaConDatos) continue // semana incompleta: no entra
    let semana = 0
    for (const d of dias({ desde, hasta })) {
      const v = netaPorDia.get(d) ?? 0
      suma[diaSemana(d)] += v
      cuenta[diaSemana(d)] += 1
      semana += v
    }
    semanales.push(semana)
  }
  return { pesos: suma.map((s, i) => (cuenta[i] > 0 ? s / cuenta[i] : 0)), semanales }
}

/** Desvío relativo (desvío estándar ÷ promedio) de las ventas semanales. 0 con menos de 2 semanas. */
export function desvioRelativo(semanales: readonly number[]): number {
  if (semanales.length < 2) return 0
  const prom = semanales.reduce((a, b) => a + b, 0) / semanales.length
  if (prom <= 0) return 0
  const varianza = semanales.reduce((a, b) => a + (b - prom) ** 2, 0) / (semanales.length - 1)
  return Math.sqrt(varianza) / prom
}

export function proyectarMes(e: EntradaProyeccion): Proyeccion {
  const meta = e.meta > 0 ? e.meta : 0
  const diasMes = largoEnDias(e.mes)
  const cerrados: Rango | null = e.N < e.mes.desde ? null
    : { desde: e.mes.desde, hasta: e.N < e.mes.hasta ? e.N : e.mes.hasta }
  const diasCerrados = cerrados ? largoEnDias(cerrados) : 0
  const diasQueFaltan = diasMes - diasCerrados
  const vendido = cerrados ? dias(cerrados).reduce((s, d) => s + (e.netaPorDia.get(d) ?? 0), 0) : 0

  const { pesos: pesosHist, semanales } = pesosPorDiaSemana(e.netaPorDia, e.N, e.primerDiaConDatos)
  const ponderada = pesosHist.some(p => p > 0)
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
  const rango = diasQueFaltan > 0 ? (proyeccion - vendido) * desvioRelativo(semanales) : 0

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
    necesarioPorDia: diasQueFaltan > 0 ? Math.max(0, meta - vendido) / diasQueFaltan : null,
    pesos,
    ponderada,
  }
}

/** Lo que hay que leer del PoS para proyectar: el mes hasta `N` y las 8 semanas que terminan en `N`. */
export function rangoDeLecturaProyeccion(mes: Rango, N: string): Rango {
  const desdePesos = sumarDias(N, -(7 * SEMANAS_DE_PESO - 1))
  return { desde: desdePesos < mes.desde ? desdePesos : mes.desde, hasta: N }
}

/** El mes natural de un día: 1 al último día. */
export function mesDe(d: string): Rango {
  const desde = `${d.slice(0, 7)}-01`
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))]
  const sig = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`
  return { desde, hasta: sumarDias(sig, -1) }
}
