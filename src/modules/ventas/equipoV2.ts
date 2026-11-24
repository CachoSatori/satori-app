// ── Ventas v2 · 3.5.4 · «Equipo» (SPEC-ventas-v2 §5.3) — el cálculo, PURO ──────────────────────
//
// Junta «Saloneros» y «Evaluación» en UNA tabla por salonero, para el período de la barra global. Sin I/O ni
// reloj. Dos fuentes, cada una para lo suyo, sin duplicar cuentas:
//
//   · El lector de siempre (`cargarLineasPeriodo` → `DiasMap` del período, el de «Hoy» e «Histórico»): venta,
//     personas (PAX cargado), Prom/PAX de personas cargadas, bebidas por persona, relación comida/bebida, precio
//     por plato y por bebida, ticket por ítem, días trabajados y los productos. Son `aggSalonero` / `aggGeneral`
//     / `aggCajero` / `mixComBeb` de `ventasUtils.ts`, LAS MISMAS que usaban «Saloneros» y «Evaluación»: por
//     eso la venta y las personas de cada salonero dan lo mismo al colón que antes (paridad, criterio 7).
//   · La venta por persona D4 (`indicadores.ts`, firmada) sobre las facturas de la 190, la MISMA lectura que el
//     «Resumen» (`cargarLecturaResumen`): con personas estimadas en las mesas sin pax y sin mesas de dueños ni
//     regalías totales. La del equipo da lo mismo que la del «Resumen» para el mismo período.
//
// Evaluación (owner y manager): consistencia, tendencia y racha con la cuenta de «Evaluación» (`calcAdvanced`,
// portada tal cual), SOBRE LOS DÍAS DEL PERÍODO elegido, como hacía «Evaluación» con su selector (7 días, 30 días,
// mes). Con menos de 14 días trabajados la tendencia no se calcula (la pantalla lo dice).
//
// «Contra el equipo de su turno»: la venta por persona del salonero contra la del equipo en los mismos turnos de
// caja, ponderada por SUS personas en cada turno. Un salonero de la noche se compara con la noche.

import type { AggCajero, DiasMap, Meta, ProductMap } from '../../shared/types/ventas'
import { CLAVE_SALON_SIN_MESERO } from './baldesNoMesero'
import { diaCRDeFactura, estimadorPorNeta, ventaPorPersona, type FacturaIndicador, type VentaPorPersona } from './indicadores'
import type { Rango } from './periodos'
import type { TurnoPromPax } from './ventasPromPaxExplicado'
import { nombreSalonero } from './ventasEnVivoDatos'
import {
  aggCajero, aggGeneral, aggSalonero, allSaloneros, getMeta, mixComBeb, topProds,
} from './ventasUtils'

/** Debajo de esta cantidad de personas (cargadas) en el período, la fila de un salonero va en gris. */
export const MUESTRA_CHICA_SALONERO = 30

/** Con menos días trabajados que esto en el período, la tendencia (7 contra 7) no se calcula. */
export const DIAS_PARA_TENDENCIA = 14

const TURNOS: readonly TurnoPromPax[] = ['mañana', 'noche']

// ── Evaluación: la cuenta de «Evaluación», portada sin cambios ─────────────────────────────────

export interface Evaluacion {
  /** % de sus días trabajados con Prom/PAX ≥ el general del restaurante ese día. */
  consistencia: number
  /** % de los últimos 7 días trabajados contra los 7 anteriores. `null` con menos de 14 días trabajados. */
  tendencia:    number | null
  /** Días seguidos (hasta el último trabajado del período) con Prom/PAX ≥ su meta. 0 sin meta. */
  racha:        number
  /** Prom/PAX ÷ su meta × 100. `null` sin meta. */
  pctMeta:      number | null
}

/**
 * Misma cuenta que `calcAdvanced` de «Evaluación» (consistencia, tendencia 7/7, racha, % meta), para cada salonero
 * de `nombres`. El general de cada día se calcula UNA vez (como el caché de «Evaluación»).
 */
export function evaluarEquipo(
  nombres: readonly string[], fechas: readonly string[], dias: DiasMap, pm: ProductMap, metas: Meta,
): Map<string, Evaluacion> {
  const genDia = new Map(fechas.map(d => [d, aggGeneral([d], dias, pm)]))
  const out = new Map<string, Evaluacion>()
  for (const name of nombres) {
    const porDia = new Map(fechas.map(d => [d, aggSalonero(name, [d], dias, pm)]))
    const metaPP = getMeta(metas, name, 'promPax')
    const trabajados = fechas.filter(d => porDia.get(d)!.days > 0)
    const sobre = trabajados.filter(d => { const g = genDia.get(d)!; return g.pax > 0 && porDia.get(d)!.promPax >= g.promPax }).length
    const consistencia = trabajados.length > 0 ? (sobre / trabajados.length) * 100 : 0
    let tendencia: number | null = null
    if (trabajados.length >= DIAS_PARA_TENDENCIA) {
      const prom = (ds: string[]) => ds.reduce((s, d) => s + porDia.get(d)!.promPax, 0) / ds.length
      const ult = prom(trabajados.slice(-7)), ant = prom(trabajados.slice(-14, -7))
      tendencia = ant > 0 ? ((ult - ant) / ant) * 100 : null
    }
    let racha = 0
    if (metaPP > 0) for (const d of [...trabajados].reverse()) { if (porDia.get(d)!.promPax >= metaPP) racha++; else break }
    const total = aggSalonero(name, [...fechas], dias, pm)
    out.set(name, { consistencia, tendencia, racha, pctMeta: metaPP > 0 ? (total.promPax / metaPP) * 100 : null })
  }
  return out
}

// ── Venta por persona D4 por salonero, con «contra el equipo de su turno» ──────────────────────

export interface VppSalonero {
  vpp:      VentaPorPersona
  /** % de su venta por persona contra la del equipo en sus turnos (ponderada por sus personas). `null` sin base. */
  vsTurno:  number | null
}

/** El nombre con que una factura aparece en el ranking: la MISMA regla que arma el `DiasMap` (`nombreSalonero`). */
export function nombreDeFactura(f: Pick<FacturaIndicador, 'salonero_login' | 'fecha_registra'>, nombres: Record<string, string>): string | null {
  return f.salonero_login ? nombreSalonero(f.salonero_login, nombres, diaCRDeFactura(f.fecha_registra)) : null
}

const personas = (v: VentaPorPersona) => v.personasCargadas + v.personasEstimadas

/**
 * La venta por persona D4 de cada salonero en `r` (por nombre del ranking: una persona con dos códigos es una
 * fila) y la del equipo por turno. La referencia del estimador es la del local entero (todas las facturas
 * leídas), igual que el «Resumen».
 */
export function vppPorSalonero(
  facturas: readonly FacturaIndicador[],
  nombres: Record<string, string>,
  r: Rango,
): { porNombre: Map<string, VppSalonero>; equipo: VentaPorPersona } {
  const estimador = estimadorPorNeta(facturas)
  const nombreDe = new Map<FacturaIndicador, string | null>()
  for (const f of facturas) nombreDe.set(f, nombreDeFactura(f, nombres))
  const equipo = ventaPorPersona(facturas, r, { estimador })
  const equipoTurno = new Map(TURNOS.map(t => [t, ventaPorPersona(facturas, r, { estimador, turno: t })]))
  const enRango = facturas.filter(f => { const d = diaCRDeFactura(f.fecha_registra); return d >= r.desde && d <= r.hasta })
  const nombresEn = [...new Set(enRango.map(f => nombreDe.get(f)).filter((n): n is string => !!n))].sort()
  const porNombre = new Map<string, VppSalonero>()
  for (const nombre of nombresEn) {
    const filtro = (f: FacturaIndicador) => nombreDe.get(f) === nombre
    const vpp = ventaPorPersona(facturas, r, { estimador, filtro })
    if (vpp.facturasSalon === 0) continue
    let pesos = 0, esperado = 0
    for (const t of TURNOS) {
      const suyo = ventaPorPersona(facturas, r, { estimador, turno: t, filtro })
      const eq = equipoTurno.get(t)!.valor
      const p = personas(suyo)
      if (p > 0 && eq !== null) { pesos += p; esperado += p * eq }
    }
    const base = pesos > 0 ? esperado / pesos : null
    porNombre.set(nombre, { vpp, vsTurno: vpp.valor !== null && base !== null && base > 0 ? (vpp.valor / base - 1) * 100 : null })
  }
  return { porNombre, equipo }
}

// ── La fila del equipo ────────────────────────────────────────────────────────────────────────

export interface FilaEquipo {
  nombre:        string
  /** Del lector de siempre (`aggSalonero`): lo mismo que «Saloneros». */
  venta:         number
  personas:      number
  /** Prom/PAX con personas cargadas (la cifra vieja; D4, excepción 1 del criterio 7). */
  promPax:       number
  bebPax:        number
  ratioCB:       number
  promPlato:     number
  promBebida:    number
  ticketItem:    number
  dias:          number
  /** % de la venta de saloneros del período. */
  pctDelEquipo:  number
  /** D4. `null` si la 190 no trae facturas de salón suyas en el período. */
  vpp:           VppSalonero | null
  muestraChica:  boolean
  productos:     { nombre: string; q: number; m: number }[]
}

export interface Equipo {
  filas:      FilaEquipo[]
  /** Lo de la fila «GENERAL» de «Saloneros» (`aggGeneral`) con el Ratio C/B por familia (`mixComBeb`). */
  general:    { venta: number; personas: number; promPax: number; bebPax: number; ticketItem: number; ratioCB: number }
  /** «Salón sin mesero»: no compite en el ranking (como en «Saloneros»). */
  sinMesero:  AggCajero
}

export type OrdenEquipo = 'venta' | 'personas' | 'vpp' | 'promPax' | 'bebPax' | 'ratioCB' | 'ticketItem' | 'dias'

const valorOrden = (f: FilaEquipo, o: OrdenEquipo): number => {
  switch (o) {
    case 'venta': return f.venta
    case 'personas': return f.personas
    case 'vpp': return f.vpp?.vpp.valor ?? -Infinity
    case 'promPax': return f.promPax
    case 'bebPax': return f.bebPax
    case 'ratioCB': return f.ratioCB
    case 'ticketItem': return f.ticketItem
    case 'dias': return f.dias
  }
}

/** Ordena de mayor a menor; a igual valor, por nombre (estable). */
export function ordenarEquipo(filas: readonly FilaEquipo[], o: OrdenEquipo): FilaEquipo[] {
  return [...filas].sort((a, b) => valorOrden(b, o) - valorOrden(a, o) || a.nombre.localeCompare(b.nombre))
}

/** La tabla del equipo para `fechas` (los días del período con datos). Ordenada por venta por persona D4. */
export function armarEquipo(
  dias: DiasMap,
  pm: ProductMap,
  fechas: readonly string[],
  vpp: Map<string, VppSalonero> | null,
): Equipo {
  const ds = [...fechas]
  const gen = aggGeneral(ds, dias, pm)
  const mix = mixComBeb(dias, ds, pm)
  const filas: FilaEquipo[] = allSaloneros(dias)
    .map(n => aggSalonero(n, ds, dias, pm))
    .filter(s => s.total > 0)
    .map(s => ({
      nombre: s.nombre, venta: s.total, personas: s.pax, promPax: s.promPax, bebPax: s.bebPax, ratioCB: s.ratioCB,
      promPlato: s.promPlato, promBebida: s.promBebida, ticketItem: s.promTicket, dias: s.days,
      pctDelEquipo: gen.total > 0 ? (s.total / gen.total) * 100 : 0,
      vpp: vpp?.get(s.nombre) ?? null,
      muestraChica: s.pax < MUESTRA_CHICA_SALONERO,
      productos: topProds(s.prods, 'monto', 5).map(p => ({ nombre: p.nombre, q: p.q, m: p.m })),
    }))
  return {
    filas: ordenarEquipo(filas, 'vpp'),
    general: {
      venta: gen.total, personas: gen.pax, promPax: gen.promPax, bebPax: gen.bebPax, ticketItem: gen.promTicket,
      ratioCB: mix.beb > 0 ? mix.com / mix.beb : 0,
    },
    sinMesero: aggCajero(CLAVE_SALON_SIN_MESERO, ds, dias),
  }
}

// ── La ficha: 12 semanas ──────────────────────────────────────────────────────────────────────

export interface SemanaFicha { desde: string; hasta: string; suya: number | null; equipo: number | null }

const sumar = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** La ventana de 12 semanas (84 días) que termina el último día del período. */
export function ventana12Semanas(hasta: string): Rango {
  return { desde: sumar(hasta, -83), hasta }
}

/**
 * La venta por persona D4 del salonero y del equipo en cada una de las 12 semanas de 7 días que terminan el
 * último día del período (la vieja «Tendencia Prom/PAX — últimas 12 semanas» y la evolución de «Histórico»).
 */
export function doceSemanas(
  facturas: readonly FacturaIndicador[],
  nombres: Record<string, string>,
  nombre: string,
  hasta: string,
): SemanaFicha[] {
  const estimador = estimadorPorNeta(facturas)
  const filtro = (f: FacturaIndicador) => nombreDeFactura(f, nombres) === nombre
  const out: SemanaFicha[] = []
  for (let w = 11; w >= 0; w--) {
    const h = sumar(hasta, -7 * w)
    const r = { desde: sumar(h, -6), hasta: h }
    out.push({
      ...r,
      suya: ventaPorPersona(facturas, r, { estimador, filtro }).valor,
      equipo: ventaPorPersona(facturas, r, { estimador }).valor,
    })
  }
  return out
}

// ── ICP por salonero en el período (regla 5 de ESTADO) ────────────────────────────────────────
//
// ICP = propina ELECTRÓNICA declarada (voluntaria: tarjeta/SINPE; `electronicTipCrc`) ÷ neta de SUS mesas × 100.
// El 10 % de servicio no entra ni arriba ni abajo; `payout_crc` (lo cobrado del reparto) NO es ICP; barra (barman,
// barback) → «no aplica». Es la cuenta de la sub-vista «ICP» (`VentasICP.tsx`: mismo vínculo empleado → ventas por
// `clavesPropinaDeEmpleado`, misma `normName`), solo que sobre los días del período de la barra y del local elegido.

/** Roles de barra: sin mesas propias, el ICP no aplica. */
export const ROLES_BARRA_ICP: ReadonlySet<string> = new Set(['barman', 'barback'])

/** La misma normalización que `VentasICP.tsx`. */
export function normNombreIcp(s: string): string {
  return s.toLowerCase()
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]/g, '')
}

export type IcpFila = { icp: number; propina: number } | 'barra' | null

export interface FilaPropina {
  session_date: string
  employee_id: string
  tip_amount_crc?: number | null
  tip_amount_usd?: number | null
  exchange_rate?: number | null
}

export interface EmpleadoIcp {
  id: string
  role: string
  full_name?: string | null
  pos_name?: string | null
  pos_login?: string | null
}

/**
 * El ICP de cada fila del equipo en `r`. `null` = sin turnos de propina que lo vinculen (se muestra «—», nunca 0 %).
 * `ventaDe(nombre)` es la neta de sus mesas (la `venta` de la fila: `aggSalonero.total`, la misma de «ICP»).
 */
export function icpPorNombre(
  filas: readonly FilaPropina[],
  empleados: readonly EmpleadoIcp[],
  r: Rango,
  saloneros: readonly string[],
  ventaDe: (nombre: string) => number,
  claves: (emp: EmpleadoIcp, sals: readonly string[]) => string[],
  propinaDe: (f: FilaPropina) => number,
): Map<string, IcpFila> {
  const porClave = new Map<string, { propina: number; roles: Set<string> }>()
  const empPorId = new Map(empleados.map(e => [e.id, e]))
  for (const f of filas) {
    if (f.session_date < r.desde || f.session_date > r.hasta) continue
    const emp = empPorId.get(f.employee_id)
    if (!emp) continue
    for (const k of claves(emp, saloneros)) {
      const a = porClave.get(k) ?? { propina: 0, roles: new Set<string>() }
      a.propina += propinaDe(f)
      a.roles.add(emp.role)
      porClave.set(k, a)
    }
  }
  const out = new Map<string, IcpFila>()
  for (const nombre of saloneros) {
    const a = porClave.get(normNombreIcp(nombre))
    if (!a) { out.set(nombre, null); continue }
    if (a.roles.size > 0 && [...a.roles].every(x => ROLES_BARRA_ICP.has(x))) { out.set(nombre, 'barra'); continue }
    const venta = ventaDe(nombre)
    out.set(nombre, venta > 0 ? { icp: (a.propina / venta) * 100, propina: a.propina } : null)
  }
  return out
}
