// ── Ventas v2 · 3.5.2: piezas puras del «Detalle por día» del Resumen (lo que traía la vieja «Ventas») ──
//
// · Margen bruto del mes: el % que carga el contador en «Metas» × la venta bruta del período (la cuenta de
//   «Análisis → Detalle anual», `mCRC = bruta × % ÷ 100`, que se retiró).
// · El CSV por día: EXACTAMENTE el «⬇ CSV» de la vieja «Ventas → Detalle por día» (el que usa el contador; mismas
//   columnas, comillas y BOM), para el período de la barra.
// · Los rangos que lee el «🖨 Reporte» del mes: el mes, el anterior y el mismo mes del año pasado (contra los
//   que compara `ReporteMensual`).
// Sin I/O ni reloj.
import type { ContabilidadDay, Meta } from '../../shared/types/ventas'
import { dayOfWeek, dowLabel } from './ventasUtils'
import { sumarDias, type Rango } from './periodos'

export interface MargenMes { pct: number; crc: number }

/** El margen bruto del mes `ym` sobre `ventaBruta`; `null` si el contador no cargó el %. */
export function margenDelMes(metas: Meta | undefined, ym: string, ventaBruta: number): MargenMes | null {
  const pct = metas?.margen?.[ym] ?? 0
  if (!(pct > 0)) return null
  return { pct, crc: ventaBruta * pct / 100 }
}

/** El mes natural (1 al último día). */
function mesNatural(y: number, m: number): Rango {
  const sig = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { desde: `${y}-${String(m).padStart(2, '0')}-01`, hasta: sumarDias(sig, -1) }
}

/** Mes `ym`, el mes anterior y el mismo mes del año anterior (rangos naturales, 1 al último día). */
export function rangosDelReporte(ym: string): Rango[] {
  const [y, m] = ym.split('-').map(Number)
  return [mesNatural(y, m), m === 1 ? mesNatural(y - 1, 12) : mesNatural(y, m - 1), mesNatural(y - 1, m)]
}

/** El CSV por día de la vieja «Ventas» (`VentasContabilidad.exportCSV`), tal cual, para los días dados. */
export function csvPorDia(dias: readonly ContabilidadDay[]): string {
  const BOM = '\uFEFF'
  const hdrs = ['Fecha', 'Día', 'Venta Bruta', 'IVA', 'Servicio', 'Venta Neta', 'Salón', 'Delivery', 'PAX', 'Prom/PAX']
  const rows = dias.map(d => [
    d.fecha, dowLabel(dayOfWeek(d.fecha)),
    d.ventaBruta, d.iva, d.serv, d.ventaNeta,
    d.salon, d.delivery, d.pax,
    Math.round(d.promPax),
  ].map(v => `"${v}"`).join(','))
  return BOM + [hdrs.join(','), ...rows].join('\n')
}
