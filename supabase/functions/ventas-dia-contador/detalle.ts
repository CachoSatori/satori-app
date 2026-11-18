// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Armado del «Detalle por día» de una quincena — PURO (sin red, sin reloj).
//
//  No hay cálculo propio: cada fila sale de `getContabilidadDays` (la misma que «Ventas →
//  Contabilidad»), que a su vez usa `getDayStats` (neta según `netaVenta.ts`, Prom/PAX = neta de salón
//  ÷ pax), y la fila TOTAL de `totalesContabilidad` (la misma que la pantalla). Las funciones llegan
//  del paquete `ventasPos.gen.js` (entrada `src/modules/ventas/ventasDiaContadorPuro.ts`).
//
//  Única diferencia con la pantalla, pedida por el dueño: un día de la quincena SIN ventas sale igual,
//  como fila en 0 (la pantalla solo lista los días con datos). Las sumas no cambian.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import type { Quincena } from './quincena.ts'

export interface DiaContable {
  fecha: string; ventaBruta: number; ventaNeta: number; iva: number; serv: number
  salon: number; delivery: number; pax: number; promPax: number
}
export interface TotalesContables {
  ventaBruta: number; iva: number; serv: number; ventaNeta: number
  salon: number; delivery: number; pax: number; promPax: number
}

/** Lo que se usa del paquete (la lógica de la app). */
export interface LogicaApp {
  getContabilidadDays(year: number, month: number | null, dias: Record<string, unknown>, hist: Record<string, unknown>): DiaContable[]
  totalesContabilidad(days: readonly DiaContable[]): TotalesContables
  dayOfWeek(fecha: string): number
  dowLabel(d: number): string
}

export interface FilaDetalle extends DiaContable { n: number; dia: string; conVentas: boolean }
export interface Detalle {
  quincena: Quincena
  filas: FilaDetalle[]
  total: TotalesContables
  diasConVentas: number
}

const CERO = { ventaBruta: 0, ventaNeta: 0, iva: 0, serv: 0, salon: 0, delivery: 0, pax: 0, promPax: 0 }

export function armarDetalle(V: LogicaApp, dias: Record<string, unknown>, q: Quincena): Detalle {
  const [y, m] = q.ym.split('-').map(Number)
  // Mes completo como la pantalla (sin `hist`: ventas = solo PoS, R18) y después el rango de la quincena.
  const porFecha = new Map<string, DiaContable>()
  for (const d of V.getContabilidadDays(y, m, dias, {})) porFecha.set(d.fecha, d)
  const filas: FilaDetalle[] = q.fechas.map((fecha, i) => {
    const d = porFecha.get(fecha)
    // Solo los números de la fila (getDayStats trae además `saloneroNames`: nombres, no viajan).
    const num = d ? {
      ventaBruta: d.ventaBruta, ventaNeta: d.ventaNeta, iva: d.iva, serv: d.serv,
      salon: d.salon, delivery: d.delivery, pax: d.pax, promPax: d.promPax,
    } : CERO
    return {
      ...num, fecha,
      n: i + 1, dia: V.dowLabel(V.dayOfWeek(fecha)), conVentas: !!d && d.ventaNeta !== 0,
    }
  })
  const delRango = filas.filter(f => porFecha.has(f.fecha)).map(f => porFecha.get(f.fecha)!)
  return {
    quincena: q,
    filas,
    total: V.totalesContabilidad(delRango),
    diasConVentas: filas.filter(f => f.conVentas).length,
  }
}

/** Redondeo para los archivos: colones con 2 decimales (quita el ruido de coma flotante). */
export const r2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100

export const COLUMNAS = ['#', 'Fecha', 'Día', 'Venta bruta', 'IVA', 'Servicio', 'Venta neta', 'Salón', 'Delivery',
  'PAX', 'Prom/PAX'] as const
