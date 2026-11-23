// ── Ventas v2 · 3.5.2: «Salón en detalle» (Resumen) y lo que hoy existe de «Regalías» — PURO ──────
//
// Lo que mostraba «Hoy» para un día, llevado al PERÍODO de la barra (SPEC §5.1 ítem 10 y §12.2). Las
// cuentas son EXACTAMENTE las de «Hoy» (`aggGeneral`, `mixComBeb`, `topProds`, `aggSalonero`,
// `getDayStats` → `totalesContabilidad`) sobre las fechas del período: con un período de un día da lo
// mismo que «Hoy» daba para ese día (lo cuida `__paridad__/resumen352.paridad.test.tsx`).
//
// Sin I/O ni reloj.
import type { AggGeneral, AggSalonero, DiasMap, ProductMap } from '../../shared/types/ventas'
import {
  aggGeneral, aggSalonero, allSaloneros, fi, getDayStats, mixComBeb, topProds, totalesContabilidad,
  type TotalesContabilidad,
} from './ventasUtils'

export interface SalonEnDetalle {
  fechas:     string[]
  gen:        AggGeneral
  /** La cuenta del período (un redondeo por día, período = Σ días): la de Contabilidad y la del 📤. */
  totales:    TotalesContabilidad
  /** ₡ de comida y de bebida por FAMILIA del PoS (no es la neta: la caja no trae el desglose). */
  com:        number
  beb:        number
  promPlato:  number
  promBebida: number
  /** Ratio C/B en ₡, de la misma base que «Comidas» y «Bebidas» (como «Hoy», no `gen.ratioCB`). */
  ratioCB:    number
  saloneros:  AggSalonero[]
}

export function salonEnDetalle(dias: DiasMap, pm: ProductMap, fechas: readonly string[]): SalonEnDetalle {
  const f = [...fechas]
  const gen = aggGeneral(f, dias, pm)
  const { com, beb } = mixComBeb(dias, f, pm)
  const totales = totalesContabilidad(f.filter(d => dias[d]).map(d => ({ ...getDayStats(dias[d]), fecha: d })))
  const delPeriodo: DiasMap = Object.fromEntries(f.filter(d => dias[d]).map(d => [d, dias[d]]))
  const saloneros = allSaloneros(delPeriodo).map(n => aggSalonero(n, f, dias, pm)).filter(s => s.days > 0)
  return {
    fechas: f, gen, totales, com, beb,
    promPlato:  gen.iCom > 0 ? com / gen.iCom : 0,
    promBebida: gen.iBeb > 0 ? beb / gen.iBeb : 0,
    ratioCB:    beb > 0 ? com / beb : 0,
    saloneros,
  }
}

export type VistaProductos = 'general' | 'comidas' | 'bebidas'
export type OrdenProductos = 'monto' | 'unidades'

/** Los más vendidos del período (los 10 de «Hoy»/«Histórico»), opcionalmente de un salonero. */
export function masVendidos(
  d: SalonEnDetalle, dias: DiasMap, pm: ProductMap,
  vista: VistaProductos = 'general', orden: OrdenProductos = 'monto', salonero = '',
): { nombre: string; q: number; m: number }[] {
  const prods = salonero ? aggSalonero(salonero, d.fechas, dias, pm).prods : d.gen.prods
  return topProds(prods, orden, 10, vista === 'general' ? undefined : vista === 'comidas' ? ['comida'] : ['bebida'], pm)
}

/**
 * El texto del 📤 (el mismo formato que el de «Hoy»), para el período. `rotulo` es el período en
 * palabras de la barra; `local`, el nombre del local.
 */
export function textoCompartir(d: SalonEnDetalle, rotulo: string, local: string): string {
  const top = [...d.saloneros].sort((a, b) => b.promPax - a.promPax).slice(0, 3)
    .map((s, i) => `${['🥇', '🥈', '🥉'][i]} ${s.nombre}: ${fi(s.total)} · ${fi(s.promPax)}/PAX`).join('\n')
  return [
    `🍣 *SATORI — ${rotulo}*`,
    '━━━━━━━━━━━━━━━━━━━━',
    `💰 Ventas: *${fi(d.totales.ventaNeta)}*`,
    d.gen.pax > 0 ? `👥 PAX: ${d.gen.pax}  •  Prom/PAX: *${fi(d.gen.promPax)}*` : '',
    d.totales.delivery > 0 ? `🛵 Delivery: ${fi(d.totales.delivery)}` : '',
    `🍺 Beb/PAX: ${d.gen.bebPax.toFixed(2)}  •  Ratio C/B: ${d.ratioCB.toFixed(1)}`,
    top ? '━━━━━━━━━━━━━━━━━━━━\n' + top : '',
    '━━━━━━━━━━━━━━━━━━━━',
    `_Satori · ${local}, CR_`,
  ].filter(Boolean).join('\n')
}

// ── «Regalías» con lo que hoy existe (D11 = A) ─────────────────────────────────────────────────

/** Lo que falta en «Regalías» y llega con la 3.4 (D11): el aviso de la pantalla, en una lista fija. */
export const FALTA_EN_REGALIAS = [
  'descuentos por programa (Local Club, hoteles, Club Satori)',
  'anulaciones y refacturas',
  'el detalle por salonero y por día',
  'el cambio contra el período anterior y el año pasado',
  'el control de la quincena',
] as const

export interface GrupoRegalia {
  total: number
  prods: { nombre: string; q: number; m: number }[]
}

export interface RegaliasDeLineas {
  /** Productos que «Ajustes → Productos» clasifica como cortesía (lo de «Hoy»: `gen.cortTotal`). */
  cortesias:    GrupoRegalia
  /** Productos clasificados como comida del personal (`gen.persTotal`). */
  personal:     GrupoRegalia
  /** Productos sin clasificar (`desconocido`): su ₡ es la suma de los 8 más grandes, como en «Hoy». */
  desconocidos: GrupoRegalia
}

/** El bloque «Regalías, Personal & Desconocidos» de «Hoy», para las fechas del período. */
export function regaliasDeLineas(dias: DiasMap, pm: ProductMap, fechas: readonly string[]): RegaliasDeLineas {
  const gen = aggGeneral([...fechas], dias, pm)
  const desc = topProds(gen.prods, 'monto', 8, ['desconocido'], pm)
  return {
    cortesias:    { total: gen.cortTotal, prods: topProds(gen.prods, 'monto', 8, ['cortesia'], pm) },
    personal:     { total: gen.persTotal, prods: topProds(gen.prods, 'monto', 8, ['personal'], pm) },
    desconocidos: { total: desc.reduce((s, p) => s + p.m, 0), prods: desc },
  }
}
