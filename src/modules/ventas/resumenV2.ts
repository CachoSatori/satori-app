// ── Ventas v2 · «Resumen» (SPEC-ventas-v2 §5.1, fase 2.1) — el cálculo, PURO ─────────────────
//
// Sin I/O ni reloj: recibe las facturas y líneas del PoS (funciones de la 067) y devuelve las cifras
// de un rango. Las fechas y las bases salen de `periodos.ts`; acá no se calcula ninguna fecha.
//
// ── DOS FUENTES DE VERDAD QUE NO SE DUPLICAN ───────────────────────────────────────────────
// · Venta neta, salón, delivery, personas (PAX) y el detalle por día salen del MISMO camino que
//   «Contabilidad»: `armarDiasMap` → `getDayStats` (un redondeo por día) → `totalesContabilidad`
//   (el TOTAL del período = la suma de los días mostrados; decisión del dueño del 18-nov, #288).
//   Por construcción, el Resumen y Contabilidad dan el mismo número para el mismo período (lo
//   cuida `resumenV2.test.ts`). El día es el día CR de la FACTURA, el corte del reporte del PoS.
// · La venta por persona es LA de `indicadores.ts` (D4, firmada): neta de salón ÷ (personas
//   cargadas + estimadas), sin mesas de dueños ni regalías totales, día y turno por la sesión de
//   caja. Su numerador NO es la «Salón» de Contabilidad (esa incluye las mesas de dueños, las
//   regalías y llevar/barra): por eso la tarjeta dice qué dejó afuera.

import type { LineaNdfRow, TicketVentaRow } from '../../shared/api/posNdf'
import type { ContabilidadDay } from '../../shared/types/ventas'
import { alertaMesasSinPax, facturasDesdePos, ventaPorPersona, diaCRDeFactura,
  type AlertaMesasSinPax, type FacturaIndicador, type VentaPorPersona } from './indicadores'
import type { BaseId, PeriodoV2, Rango } from './periodos'
import { contabilidadDayDeAgregado, juntarAgregados, type DiaAgregado, type ParteAgregada } from './resumenV2Agregado'
import type { InternaRpc } from './tiemposV2Rpc'
import { armarDiasMap } from './ventasDiasDesdePos'
import { getDayStats, totalesContabilidad, type TotalesContabilidad } from './ventasUtils'

/** Debajo de esta cantidad de personas el cambio de la venta por persona se muestra en gris (§3.3). */
export const MUESTRA_CHICA_PERSONAS = 100

/** Aviso de calidad del dato: más de este % de facturas de salón sin pax (§5.1, ítem 8). */
export const UMBRAL_SIN_PAX_PCT = 5

/**
 * Las facturas y líneas leídas (ya sin repetidos), y las facturas del indicador armadas una vez.
 * Con la función de la 190 (`pos_ventas_resumen`) no hay facturas ni líneas sueltas: vienen los
 * días ya sumados (`dias`) y las facturas de salón con las anclas de lote (`facturas`).
 */
export interface Lectura {
  tickets:   readonly TicketVentaRow[]
  lineas:    readonly LineaNdfRow[]
  facturas:  readonly FacturaIndicador[]
  nombres:   Record<string, string>
  /** Solo por la 190: los días CR de factura, en céntimos crudos. */
  dias?:     ReadonlyMap<string, DiaAgregado>
  /**
   * Facturas de mesas internas (mig 193), ya marcadas `interna` en `facturas`. Solo las saca la alerta de mesas sin
   * pax (decisión del dueño 18-nov 13:45: son venta y siguen en todo lo demás). `null` = la base no tiene la 193.
   */
  internas?: readonly InternaRpc[] | null
}

export function armarLectura(
  tickets: readonly TicketVentaRow[],
  lineas: readonly LineaNdfRow[],
  nombres: Record<string, string> = {},
): Lectura {
  return { tickets, lineas, facturas: facturasDesdePos(tickets, lineas), nombres }
}

export interface CifrasRango {
  rango:              Rango
  /** Detalle por día, igual que «Contabilidad → Detalle por día». */
  dias:               ContabilidadDay[]
  /** Fila TOTAL = suma de los días (la misma función que Contabilidad y el correo del contador). */
  totales:            TotalesContabilidad
  /** Facturas cerradas por día CR de factura. */
  facturas:           number
  /** Días con venta neta > 0. */
  diasAbiertos:       number
  /** Neta ÷ facturas. `null` sin facturas. */
  cuentaPromedio:     number | null
  /** Neta ÷ días abiertos. `null` sin días abiertos. */
  ventaPorDiaAbierto: number | null
  /** LA venta por persona (D4). */
  vpp:                VentaPorPersona
}

/** La lectura desde la función de la 190: los tramos ya juntados, sin facturas ni líneas sueltas. */
export function armarLecturaAgregada(
  partes: readonly ParteAgregada[],
  nombres: Record<string, string> = {},
): Lectura {
  const { dias, facturas } = juntarAgregados(partes)
  return { tickets: [], lineas: [], facturas, nombres, dias }
}

/** Días y facturas del rango desde la 190: la misma fila por día que `getDayStats`. */
function diasDesdeAgregado(dias: ReadonlyMap<string, DiaAgregado>, rango: Rango) {
  const out: ContabilidadDay[] = []
  let facturas = 0
  for (const f of [...dias.keys()].sort()) {
    if (f < rango.desde || f > rango.hasta) continue
    const d = dias.get(f)!
    out.push(contabilidadDayDeAgregado(d))
    facturas += d.facturas
  }
  return { dias: out, facturas }
}

/** Días y facturas del rango desde las filas de la 067 (el camino de siempre). */
function diasDesdeFilas(l: Lectura, rango: Rango) {
  const { dias: mapa } = armarDiasMap([...l.tickets], [...l.lineas], rango,
    { uploadedAt: rango.hasta, nombres: l.nombres, avisar: () => {} })
  const dias: ContabilidadDay[] = Object.keys(mapa).sort().map(f => ({ ...getDayStats(mapa[f]), fecha: f }))
  let facturas = 0
  for (const t of l.tickets) {
    if (t.estado !== 'C') continue
    const d = diaCRDeFactura(t.fecha_registra)
    if (d >= rango.desde && d <= rango.hasta) facturas += 1
  }
  return { dias, facturas }
}

/** Las cifras de UN rango (período o base). */
export function cifrasDelRango(l: Lectura, rango: Rango): CifrasRango {
  const { dias, facturas } = l.dias ? diasDesdeAgregado(l.dias, rango) : diasDesdeFilas(l, rango)
  const totales = totalesContabilidad(dias)
  const diasAbiertos = dias.filter(d => d.ventaNeta > 0).length
  return {
    rango, dias, totales, facturas, diasAbiertos,
    cuentaPromedio:     facturas > 0 ? totales.ventaNeta / facturas : null,
    ventaPorDiaAbierto: diasAbiertos > 0 ? totales.ventaNeta / diasAbiertos : null,
    vpp:                ventaPorPersona(l.facturas, rango),
  }
}

/** Cambio % de `a` contra `b`. `null` = «sin comparación» (sin base o base en 0): nunca 0 ni −100 %. */
export function cambioPct(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  return ((a - b) / b) * 100
}

export type CifraId = 'ventaNeta' | 'personas' | 'ventaPorPersona' | 'cuentaPromedio'

export const CIFRAS: readonly { id: CifraId; label: string }[] = [
  { id: 'ventaNeta',       label: 'Venta neta' },
  { id: 'personas',        label: 'Personas' },
  { id: 'ventaPorPersona', label: 'Venta por persona' },
  { id: 'cuentaPromedio',  label: 'Cuenta promedio' },
]

export function valorCifra(c: CifrasRango, id: CifraId): number | null {
  switch (id) {
    case 'ventaNeta':       return c.totales.ventaNeta
    case 'personas':        return c.totales.pax
    case 'ventaPorPersona': return c.vpp.valor
    case 'cuentaPromedio':  return c.cuentaPromedio
  }
}

/** Personas de la venta por persona (cargadas + estimadas): define la «muestra chica». */
export const personasVpp = (c: CifrasRango): number => c.vpp.personasCargadas + c.vpp.personasEstimadas

export interface ComparacionCifra {
  id:         CifraId
  valor:      number | null
  base:       number | null
  cambio:     number | null
  /** Venta por persona con menos de 100 personas de un lado: el cambio va en gris, sin flecha. */
  muestraChica: boolean
}

export function compararCifras(p: CifrasRango, b: CifrasRango | null): ComparacionCifra[] {
  return CIFRAS.map(({ id }) => {
    const valor = valorCifra(p, id)
    const base = b ? valorCifra(b, id) : null
    const muestraChica = id === 'ventaPorPersona' && b !== null &&
      (personasVpp(p) < MUESTRA_CHICA_PERSONAS || personasVpp(b) < MUESTRA_CHICA_PERSONAS)
    return { id, valor, base, cambio: b ? cambioPct(valor, base) : null, muestraChica }
  })
}

// ── La bajada (una frase con los datos) ─────────────────────────────────────────────────────

export const NOMBRE_BASE: Record<BaseId, string> = {
  anteriorEquivalente: 'período anterior',
  anioMismasFechas:    'año pasado (mismas fechas)',
  anioMismoDiaSemana:  'año pasado (mismo día de semana)',
}

/** Cómo se nombra una base en la frase: el nombre concreto y sus fechas cortas (de la barra). */
export interface NombreEnFrase {
  texto:    string
  articulo: 'el' | 'la' | 'los'
  /** «16–31 oct». Va entre paréntesis después del nombre. */
  fechas?:  string | null
}

const genericoDe = (id: BaseId): NombreEnFrase => ({ texto: NOMBRE_BASE[id], articulo: 'el' })
const deArt = (n: NombreEnFrase) => (n.articulo === 'el' ? 'del' : `de ${n.articulo}`)
const conFechas = (n: NombreEnFrase) => (n.fechas ? `${n.texto} (${n.fechas})` : n.texto)

const pctTxt = (x: number) => `${Math.round(Math.abs(x))} %`

function tramoBajada(c: number | null, n: NombreEnFrase): string | null {
  if (c === null) return null
  if (Math.abs(c) < 1) return `parejo con ${n.articulo} ${conFechas(n)}`
  return `${pctTxt(c)} ${c > 0 ? 'arriba' : 'abajo'} ${deArt(n)} ${conFechas(n)}`
}

/** Más de 2 % es «más/menos»; menos, «casi lo mismo». */
const tendencia = (c: number | null, mas: string, menos: string, igual: string): string | null =>
  c === null ? null : Math.abs(c) < 2 ? igual : c > 0 ? mas : menos

/**
 * «Vas 9 % arriba del mes anterior a la misma fecha (1–15 oct) y 7 % abajo del año pasado, mismo día de
 * semana (2–16 nov 2025). Entra más gente; gasta casi lo mismo.» Con voseo (lo lee la gerencia). El nombre de
 * cada base lo pone la barra (`nombreBase`); sin él, el genérico. Sin bases: dice que no hay comparación.
 */
export function bajada(
  p: CifrasRango,
  a: { id: BaseId; cifras: CifrasRango | null; nombre?: NombreEnFrase },
  b: { id: BaseId; cifras: CifrasRango | null; nombre?: NombreEnFrase },
): string {
  if (p.totales.ventaNeta <= 0) return 'No hay ventas del PoS en este período.'
  const ca = a.cifras ? cambioPct(p.totales.ventaNeta, a.cifras.totales.ventaNeta) : null
  const cb = b.cifras ? cambioPct(p.totales.ventaNeta, b.cifras.totales.ventaNeta) : null
  const tramos = [tramoBajada(ca, a.nombre ?? genericoDe(a.id)), tramoBajada(cb, b.nombre ?? genericoDe(b.id))].filter((t): t is string => !!t)
  if (tramos.length === 0) return 'Sin comparación para este período: no hay ventas del PoS en las bases.'
  const ref = a.cifras && ca !== null ? a.cifras : b.cifras
  const gente = ref ? tendencia(cambioPct(p.totales.pax, ref.totales.pax), 'Entra más gente', 'Entra menos gente', 'Entra la misma gente') : null
  const gasto = ref ? tendencia(cambioPct(p.vpp.valor, ref.vpp.valor), 'gasta más por persona', 'gasta menos por persona', 'gasta casi lo mismo') : null
  const cola = [gente, gasto].filter(Boolean).join('; ')
  return `Vas ${tramos.join(' y ')}.${cola ? ` ${cola}.` : ''}`
}

// ── Calidad del dato y alerta diaria ────────────────────────────────────────────────────────

export interface AvisoCalidad { pctSinPax: number; supera: boolean }

/** % de facturas de salón sin pax (sin mesas de dueños ni regalías totales) del rango. */
export function avisoCalidad(c: CifrasRango): AvisoCalidad {
  const base = c.vpp.facturasSalon - c.vpp.mesasDuenos - c.vpp.regaliasTotales
  const pct = base > 0 ? (c.vpp.facturasSinPax / base) * 100 : 0
  return { pctSinPax: pct, supera: pct > UMBRAL_SIN_PAX_PCT }
}

/** La alerta de AYER (último día cerrado): mesas sin pax por salonero y mesas cargadas desde la caja. */
export function alertaDeAyer(l: Lectura, periodo: Pick<PeriodoV2, 'N'>): AlertaMesasSinPax {
  return alertaMesasSinPax(l.facturas, { desde: periodo.N, hasta: periodo.N })
}

// ── CSV (las tres bases, para el contador) ──────────────────────────────────────────────────

const num = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : String(Math.round(v)))
const pctCsv = (v: number | null) => (v === null ? 'sin comparación' : `${v.toFixed(1)}%`)
const q = (s: string) => `"${s.replace(/"/g, '""')}"`

/**
 * El CSV del Resumen: una fila por cifra, con el período y LAS TRES bases (también «año anterior,
 * mismas fechas», que en pantalla está a un clic). Cada base dice sus fechas en el encabezado.
 */
export function csvResumen(
  periodo: PeriodoV2,
  p: CifrasRango,
  bases: Record<BaseId, CifrasRango | null>,
): string {
  const ids: BaseId[] = ['anteriorEquivalente', 'anioMismasFechas', 'anioMismoDiaSemana']
  const titulo = (id: BaseId) => {
    const b = periodo.bases[id]
    return b ? `${NOMBRE_BASE[id]}: ${b.desde} a ${b.hasta}` : `${NOMBRE_BASE[id]}: sin comparación`
  }
  const hdr = ['Cifra', `Período ${periodo.desde} a ${periodo.hasta}`,
    ...ids.flatMap(id => [titulo(id), `Cambio vs ${NOMBRE_BASE[id]}`])]
  const filas: string[][] = [
    ...CIFRAS.map(({ id, label }) => {
      const v = valorCifra(p, id)
      return [label, num(v), ...ids.flatMap(b => {
        const c = bases[b]
        const bv = c ? valorCifra(c, id) : null
        return [num(bv), pctCsv(c ? cambioPct(v, bv) : null)]
      })]
    }),
    ...([['Venta bruta', 'ventaBruta'], ['IVA', 'iva'], ['Servicio', 'serv'], ['Salón', 'salon'], ['Delivery', 'delivery']] as const)
      .map(([label, k]) => [label, num(p.totales[k]), ...ids.flatMap(b => {
        const c = bases[b]
        return [num(c ? c.totales[k] : null), pctCsv(c ? cambioPct(p.totales[k], c.totales[k]) : null)]
      })]),
    ['Facturas', num(p.facturas), ...ids.flatMap(b => { const c = bases[b]; return [num(c ? c.facturas : null), pctCsv(c ? cambioPct(p.facturas, c.facturas) : null)] })],
    ['Días abiertos', num(p.diasAbiertos), ...ids.flatMap(b => { const c = bases[b]; return [num(c ? c.diasAbiertos : null), ''] })],
    ['% personas estimadas (venta por persona)', p.vpp.pctEstimado.toFixed(1), ...ids.flatMap(b => { const c = bases[b]; return [c ? c.vpp.pctEstimado.toFixed(1) : '', ''] })],
  ]
  return '﻿' + [hdr, ...filas].map(f => f.map(q).join(',')).join('\n')
}
