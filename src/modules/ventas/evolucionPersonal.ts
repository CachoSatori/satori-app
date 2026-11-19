// ── Mi evolución: cada uno contra SÍ MISMO (pedido del dueño, 18-nov-2026 12:55) ─────────────
//
// Módulo PURO: sin I/O ni reloj (el «hoy» CR entra como argumento). Sale SOLO de las facturas propias del salonero,
// que la 191 ya le deja leer: no hace falta ninguna función nueva de la base.
//
// Las reglas son las de Ventas, no unas propias:
//   · Días (aLaFecha / periodos.ts, D2=A): un período en curso llega hasta AYER y la base se recorta a los MISMOS
//     días. «Esta semana» (lunes → ayer) contra los mismos días de la semana pasada; «este mes» (1 → ayer) contra los
//     mismos días del mes anterior (`calcularPeriodo`, base «anterior equivalente»). El lunes, «esta semana» es la
//     semana pasada completa (el motor elige el último período con días cerrados).
//   · Redondeo (#288, opción A del 18-nov): la venta se suma CRUDA (céntimos de `crudoCts`) y se redondea una sola
//     vez al mostrar; no es la suma de los días redondeados.
//   · Venta por persona D4 (indicadores.ts): neta de SALÓN (sin su delivery) ÷ sus personas.
//   · Ticket/ítem, bebidas/PAX: los de `aggSalonero` (con el multiplicador de las bebidas clasificadas a mano).
//   · ICP electrónico: propina electrónica GENERADA (tarjeta/SINPE, `electronicTipCrc`) ÷ venta × 100.
// Una variación sin base (0 días en la base) es `null`, nunca −100 %.

import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { aggSalonero } from './ventasUtils'
import { ventaPorPersonaDeTotales } from './indicadores'
import { calcularPeriodo, rotuloRango, type Rango } from './periodos'
import { lunesDe, sumarDias } from './periodosPromPax'
import { computeICP, sumElectronicTips } from './miRendimientoUtils'

type FilaPropina = { session_date: string; tip_amount_crc?: number | null; tip_amount_usd?: number | null; exchange_rate?: number | null }

/** Mis indicadores en un rango. `null` = no hay con qué calcularlo (sin días, sin personas o sin ítems). */
export interface MisIndicadores {
  dias:          number
  ventas:        number
  pax:           number
  ventaPersona:  number | null
  ticketItem:    number | null
  bebidasPax:    number | null
  icp:           number | null
}

export const INDICADORES_VACIOS: MisIndicadores = {
  dias: 0, ventas: 0, pax: 0, ventaPersona: null, ticketItem: null, bebidasPax: null, icp: null,
}

/** Las fechas del mapa dentro de `[r.desde, r.hasta]`. */
function fechasEn(fechas: readonly string[], r: Rango): string[] {
  return fechas.filter(f => f >= r.desde && f <= r.hasta)
}

/**
 * Mis indicadores en un rango, con la regla de días y redondeo de Ventas. `propinas` = MIS filas de propinas
 * (las de otros no se miran).
 */
export function misIndicadores(
  nombre: string, fechas: readonly string[], r: Rango, dias: DiasMap, pm: ProductMap,
  propinas: readonly FilaPropina[] = [],
): MisIndicadores {
  if (!nombre) return { ...INDICADORES_VACIOS }
  const ds = fechasEn(fechas, r)
  const a = aggSalonero(nombre, ds, dias, pm)
  if (a.days === 0) return { ...INDICADORES_VACIOS }
  // #288: la venta cruda (céntimos) y un solo redondeo. Si algún día no trae el crudo (no pasa con el PoS), se cae
  // a la suma de los días ya redondeados, que es lo que había.
  let cts = 0, ctsDelivery = 0, todosConCrudo = true
  for (const f of ds) {
    const s = dias[f]?.saloneros[nombre] as { crudoCts?: { neta: number; delivery: number }; esCajero?: boolean } | undefined
    if (!s || s.esCajero) continue
    if (!s.crudoCts) { todosConCrudo = false; break }
    cts += s.crudoCts.neta; ctsDelivery += s.crudoCts.delivery
  }
  const ventas = todosConCrudo ? Math.round(cts / 100) : a.total
  const deliveryRedondeado = ds.reduce((acc, f) => {
    const s = dias[f]?.saloneros[nombre] as { delivery?: number } | undefined
    return acc + (s?.delivery ?? 0)
  }, 0)
  const salon = todosConCrudo ? (cts - ctsDelivery) / 100 : a.total - deliveryRedondeado
  // `a.iBeb` ya trae el multiplicador de las bebidas clasificadas a mano (aggSalonero).
  const items = a.iCom + a.iBeb
  const misPropinas = propinas.filter(p => p.session_date >= r.desde && p.session_date <= r.hasta)
  return {
    dias:         a.days,
    ventas,
    pax:          a.pax,
    ventaPersona: ventaPorPersonaDeTotales(salon, a.pax),
    ticketItem:   items > 0 ? ventas / items : null,
    bebidasPax:   a.pax > 0 ? a.iBeb / a.pax : null,
    icp:          ventas > 0 ? computeICP(sumElectronicTips(misPropinas), ventas) : null,
  }
}

/** Variación en %, `null` sin base o sin dato (nunca −100 % por falta de datos). */
export function variacionPct(ahora: number | null, antes: number | null): number | null {
  if (ahora === null || antes === null || !antes) return null
  return ((ahora - antes) / antes) * 100
}

export interface Comparacion {
  titulo:      string
  /** «Misma semana del año pasado» / «Mismo mes del año pasado». */
  tituloAnio:  string
  /** El período (para pedir las proporciones del local de esos mismos días). */
  rango:       Rango
  rotulo:      string
  rotuloBase:  string | null
  notaLargo:   string | null
  ahora:       MisIndicadores
  antes:       MisIndicadores | null
  /** Decisión del dueño 18-nov 13:58 (d): el mismo período corrido 364 días (mismo día de semana). */
  rangoAnio:   Rango | null
  rotuloAnio:  string | null
  anioPasado:  MisIndicadores | null
}

/** «Esta semana» y «este mes» a la fecha, contra los mismos días del período anterior (motor de Ventas). */
export function comparacionesPersonales(
  nombre: string, fechas: readonly string[], dias: DiasMap, pm: ProductMap, hoy: string,
  propinas: readonly FilaPropina[] = [],
): Comparacion[] {
  const out: Comparacion[] = []
  const PERIODOS = [
    ['semana', 'Esta semana vs la semana pasada', 'Misma semana del año pasado'],
    ['mesALaFecha', 'Este mes vs el mes pasado', 'Mismo mes del año pasado'],
  ] as const
  for (const [tipo, titulo, tituloAnio] of PERIODOS) {
    const p = calcularPeriodo({ tipo, ancla: hoy })
    const b = p.bases.anteriorEquivalente
    // «Año anterior, mismo día de semana» del motor = el período corrido 364 días.
    const a = p.bases.anioMismoDiaSemana
    out.push({
      titulo,
      tituloAnio,
      rango:      { desde: p.desde, hasta: p.hasta },
      rangoAnio:  a ? { desde: a.desde, hasta: a.hasta } : null,
      rotuloAnio: a?.rotulo ?? null,
      anioPasado: a ? misIndicadores(nombre, fechas, a, dias, pm, propinas) : null,
      rotulo:     p.rotulo,
      rotuloBase: b?.rotulo ?? null,
      notaLargo:  b?.notaLargo ?? null,
      ahora:      misIndicadores(nombre, fechas, p, dias, pm, propinas),
      antes:      b ? misIndicadores(nombre, fechas, b, dias, pm, propinas) : null,
    })
  }
  return out
}

export interface SemanaPersonal extends MisIndicadores {
  lunes:   string
  rango:   Rango
  rotulo:  string
  /** La semana en curso (llega hasta ayer). */
  enCurso: boolean
}

/** Las últimas `n` semanas ISO (lunes a domingo) hasta ayer, la más nueva primero. La en curso, cortada a ayer. */
export function semanasPersonales(
  nombre: string, fechas: readonly string[], dias: DiasMap, pm: ProductMap, hoy: string, n = 12,
  propinas: readonly FilaPropina[] = [],
): SemanaPersonal[] {
  const ayer = sumarDias(hoy, -1)
  const anio = Number(hoy.slice(0, 4))
  const out: SemanaPersonal[] = []
  let lunes = lunesDe(ayer)
  for (let i = 0; i < n; i++) {
    const domingo = sumarDias(lunes, 6)
    const rango = { desde: lunes, hasta: domingo < ayer ? domingo : ayer }
    out.push({
      ...misIndicadores(nombre, fechas, rango, dias, pm, propinas),
      lunes, rango, rotulo: rotuloRango(rango, anio), enCurso: domingo > ayer,
    })
    lunes = sumarDias(lunes, -7)
  }
  return out
}

/**
 * La tendencia de la venta por persona: promedio de las últimas 4 semanas trabajadas contra las 4 anteriores
 * (de `semanas`, la más nueva primero). `null` si no hay 8 semanas con datos.
 */
export function tendenciaVentaPersona(semanas: readonly SemanaPersonal[]): number | null {
  const conDato = semanas.filter(s => s.dias > 0 && s.ventaPersona !== null).map(s => s.ventaPersona as number)
  if (conDato.length < 8) return null
  const prom = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length
  return variacionPct(prom(conDato.slice(0, 4)), prom(conDato.slice(4, 8)))
}
