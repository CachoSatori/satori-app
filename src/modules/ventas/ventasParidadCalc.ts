// ── P3 · Paridad xls ↔ pos_ndf ─────────────────────────────────────────────────────────────
//
// Compara, día por día, el `DiasMap` que arma el PoS (`getDiasMapDesdePos`, P1b) contra el que
// hoy sale del xls (`ventas_dias`). Es el diagnóstico que se corre ANTES del swap (P2) para
// poder firmar que las dos fuentes dicen lo mismo.
//
// ── SOLO LECTURA ───────────────────────────────────────────────────────────────────────────
// Este módulo es PURO: recibe los dos `DiasMap` ya cargados y devuelve el reporte. No lee, no
// escribe, no toca la base. Nada de lo que hay acá puede modificar un dato.
//
// ── POR QUÉ EL TOTAL DEL RANGO ES LA SEÑAL QUE MANDA ───────────────────────────────────────
// El xls y `pos_ndf` NO cortan el día igual: el xls usa el corte del reporte del PoS, y
// `pos_ndf` usa el LOTE DE CIERRE (ver `shared/ndf/jornada.ts`). Una factura de después de
// medianoche puede caer en un día para uno y en el otro para el otro. Eso produce diferencias
// por día que NO son errores: son la misma plata puesta en dos casilleros distintos, y **se
// cancelan en el total del rango**. Por eso el total es lo que se mira para firmar la paridad,
// y las filas por día sirven para investigar las diferencias GRANDES, no para exigir cero.
//
// ── NO REIMPLEMENTA MÉTRICAS ───────────────────────────────────────────────────────────────
// Las nueve cifras salen de `getDayStats` y `aggGeneral`, las mismas que usa toda la app. Los
// dos lados se miden con la MISMA función, que es lo único que hace la comparación honesta.

import type { DiaData, DiasMap, ProductMap } from '../../shared/types/ventas'
import { aggGeneral, getDayStats } from './ventasUtils'

/** Las nueve métricas que se comparan, en el orden en que se muestran. */
export const METRICAS = [
  { clave: 'ventaNeta',  etiqueta: 'Venta neta',  unidad: 'crc' },
  { clave: 'ventaBruta', etiqueta: 'Venta bruta', unidad: 'crc' },
  { clave: 'iva',        etiqueta: 'IVA',         unidad: 'crc' },
  { clave: 'servicio',   etiqueta: 'Servicio',    unidad: 'crc' },
  { clave: 'salon',      etiqueta: 'Salón',       unidad: 'crc' },
  { clave: 'delivery',   etiqueta: 'Delivery',    unidad: 'crc' },
  { clave: 'pax',        etiqueta: 'PAX',         unidad: 'pax' },
  { clave: 'comidas',    etiqueta: 'Comidas',     unidad: 'crc' },
  { clave: 'bebidas',    etiqueta: 'Bebidas',     unidad: 'crc' },
] as const

export type ClaveMetrica = (typeof METRICAS)[number]['clave']
export type Cifras = Record<ClaveMetrica, number>

/**
 * Cuándo un día se marca para investigar.
 *
 * Hacen falta LAS DOS condiciones: que la diferencia sea relativamente grande (`pct`) Y
 * absolutamente grande (`abs`). Con una sola, un día flojo de ₡40.000 se marcaría por ₡500 de
 * diferencia (1,25%), y un día fuerte escondería ₡50.000 bajo el 1%.
 *
 * `absPax` existe aparte porque el pax se cuenta en personas, no en colones: con el umbral de
 * ₡1.000 el pax NUNCA se marcaría y el reporte mentiría por omisión.
 */
export interface Tolerancia {
  /** Diferencia relativa, en %. */
  pct:    number
  /** Diferencia absoluta en colones, para las métricas de plata. */
  abs:    number
  /** Diferencia absoluta en personas, para el pax. */
  absPax: number
}

export const TOLERANCIA_POR_DEFECTO: Tolerancia = { pct: 1, abs: 1000, absPax: 2 }

export interface Comparacion {
  clave:    ClaveMetrica
  etiqueta: string
  unidad:   'crc' | 'pax'
  xls:      number
  pos:      number
  /** `pos − xls`. Positivo = el PoS dice MÁS que el xls. */
  diff:     number
  /** `diff / xls` en %. `null` cuando el xls es 0 (no hay porcentaje que calcular). */
  diffPct:  number | null
  fuera:    boolean
}

export interface FilaParidad {
  fecha:        string
  enXls:        boolean
  enPos:        boolean
  comparaciones: Comparacion[]
  /** El día pide mirada: alguna métrica fuera de tolerancia, o falta en una de las fuentes. */
  flag:         boolean
}

export interface ResumenParidad {
  dias:     number
  ok:       number
  flag:     number
  /** Días que están en una fuente y no en la otra. Son un flag aparte: no hay qué comparar. */
  soloXls:  number
  soloPos:  number
}

export interface ReporteParidad {
  filas:      FilaParidad[]
  /** La suma del rango en las dos fuentes. Es la señal que manda. */
  total:      FilaParidad
  resumen:    ResumenParidad
  tolerancia: Tolerancia
}

const CERO: Cifras = {
  ventaNeta: 0, ventaBruta: 0, iva: 0, servicio: 0, salon: 0,
  delivery: 0, pax: 0, comidas: 0, bebidas: 0,
}

/**
 * Un `DiaData` → sus nueve cifras.
 *
 * Todo sale de `getDayStats` y de `aggGeneral`; acá no se calcula nada nuevo. Comidas y bebidas
 * se derivan de `prods` con el `ProductMap`, exactamente como lo hacen «En vivo» y Mix — o sea
 * que, por la convención de `aggGeneral`, NO incluyen lo que facturó caja/sistema. Da igual
 * para la paridad: los dos lados se miden con la misma función.
 */
export function cifrasDeDia(
  fecha: string,
  dia: DiaData | undefined,
  pm: ProductMap,
): Cifras {
  if (!dia) return { ...CERO }
  const s = getDayStats(dia)
  const g = aggGeneral([fecha], { [fecha]: dia }, pm)
  const porTipo = (tipo: string): number =>
    Object.entries(g.prods).reduce((a, [n, v]) => a + (pm[n]?.tipo === tipo ? v.m : 0), 0)

  return {
    ventaNeta:  s.ventaNeta,
    ventaBruta: s.ventaBruta,
    iva:        s.iva,
    servicio:   s.serv,
    salon:      s.salon,
    delivery:   s.delivery,
    pax:        s.pax,
    comidas:    porTipo('comida'),
    bebidas:    porTipo('bebida'),
  }
}

const sumar = (a: Cifras, b: Cifras): Cifras => {
  const out = { ...CERO }
  for (const { clave } of METRICAS) out[clave] = a[clave] + b[clave]
  return out
}

/** ¿Esta diferencia pide mirada? Necesita pasar el umbral RELATIVO **y** el ABSOLUTO. */
export function fueraDeTolerancia(
  xls: number, pos: number, unidad: 'crc' | 'pax', tol: Tolerancia,
): boolean {
  const diff = Math.abs(pos - xls)
  const umbralAbs = unidad === 'pax' ? tol.absPax : tol.abs
  if (diff <= umbralAbs) return false
  // Sin base contra la cual sacar el %, manda el absoluto: 0 → algo es una diferencia real.
  if (xls === 0) return true
  return (diff / Math.abs(xls)) * 100 > tol.pct
}

function comparar(xls: Cifras, pos: Cifras, tol: Tolerancia): Comparacion[] {
  return METRICAS.map(m => {
    const a = xls[m.clave]
    const b = pos[m.clave]
    return {
      clave:    m.clave,
      etiqueta: m.etiqueta,
      unidad:   m.unidad,
      xls:      a,
      pos:      b,
      diff:     b - a,
      diffPct:  a === 0 ? null : ((b - a) / Math.abs(a)) * 100,
      fuera:    fueraDeTolerancia(a, b, m.unidad, tol),
    }
  })
}

/**
 * El reporte completo. PURO: los dos `DiasMap` ya vienen cargados.
 *
 * Se recorre la UNIÓN de fechas de las dos fuentes: un día que está en una y no en la otra es
 * justamente lo que hay que ver, y esconderlo sería el peor bug posible de este reporte.
 */
export function compararParidad(
  xls: DiasMap,
  pos: DiasMap,
  pm: ProductMap,
  tolerancia: Tolerancia = TOLERANCIA_POR_DEFECTO,
): ReporteParidad {
  const fechas = [...new Set([...Object.keys(xls), ...Object.keys(pos)])].sort()

  let totXls = { ...CERO }
  let totPos = { ...CERO }
  let soloXls = 0, soloPos = 0

  const filas: FilaParidad[] = fechas.map(fecha => {
    const enXls = xls[fecha] !== undefined
    const enPos = pos[fecha] !== undefined
    if (enXls && !enPos) soloXls++
    if (!enXls && enPos) soloPos++

    const cXls = cifrasDeDia(fecha, xls[fecha], pm)
    const cPos = cifrasDeDia(fecha, pos[fecha], pm)
    totXls = sumar(totXls, cXls)
    totPos = sumar(totPos, cPos)

    const comparaciones = comparar(cXls, cPos, tolerancia)
    return {
      fecha, enXls, enPos, comparaciones,
      // Faltar en una fuente es flag por sí solo: no hay comparación posible que lo redima.
      flag: !enXls || !enPos || comparaciones.some(c => c.fuera),
    }
  })

  const total: FilaParidad = {
    fecha: 'TOTAL',
    enXls: true,
    enPos: true,
    comparaciones: comparar(totXls, totPos, tolerancia),
    flag: comparar(totXls, totPos, tolerancia).some(c => c.fuera),
  }

  const flag = filas.filter(f => f.flag).length
  return {
    filas,
    total,
    resumen: { dias: filas.length, ok: filas.length - flag, flag, soloXls, soloPos },
    tolerancia,
  }
}
