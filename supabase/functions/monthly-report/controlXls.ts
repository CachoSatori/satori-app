// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Control del pase al PoS (solo dry_run): ¿cuánto cambia el reporte contra lo que habría mandado el
//  código viejo, que sumaba `ventas_dias` (xls)? Lee `ventas_dias` SOLO para comparar; el correo
//  nunca sale de acá. Devuelve CONTEOS y RAZONES (4 decimales), jamás montos: va al log y a la
//  respuesta, que no deben traer plata (SEC-02).
// ─────────────────────────────────────────────────────────────────────────────────────────────
import type { RangoMes } from './fechas.ts'
import { netaDelPeriodo, type Cliente, type DiaData } from './ventasPos.ts'

type FilaXls = { session_date: string; data: { saloneros?: Record<string, { total?: number }> } }
type ConsultaXls = { select(c: string): ConsultaXls; gte(c: string, v: string): ConsultaXls
  lte(c: string, v: string): PromiseLike<{ data: FilaXls[] | null; error: unknown }> }

/** Lo que sumaba el código viejo por día: Σ `total` de todos los buckets (meseros + caja). */
export function netaXls(dia: { saloneros?: Record<string, { total?: number }> } | null | undefined): number {
  let n = 0
  for (const s of Object.values(dia?.saloneros ?? {})) n += s.total ?? 0
  return n
}

const razon = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null)

/** PURO: compara los días del PoS con las filas del xls del mismo período. */
export function compararConXls(
  pos: Record<string, DiaData>,
  xls: FilaXls[],
): Record<string, number | null> {
  const netaPosDia: Record<string, number> = {}
  for (const [f, d] of Object.entries(pos)) netaPosDia[f] = netaDelPeriodo({ [f]: d })
  const netaXlsDia: Record<string, number> = {}
  for (const r of xls) netaXlsDia[r.session_date] = netaXls(r.data)

  const comunes = Object.keys(netaXlsDia).filter(f => (netaPosDia[f] ?? 0) > 0)
  const sum = (m: Record<string, number>, fs: string[]) => fs.reduce((s, f) => s + (m[f] ?? 0), 0)
  const totalPos = sum(netaPosDia, Object.keys(netaPosDia))
  const totalXls = sum(netaXlsDia, Object.keys(netaXlsDia))
  return {
    dias_pos:             Object.values(netaPosDia).filter(n => n > 0).length,
    dias_xls:             Object.keys(netaXlsDia).length,
    dias_en_comun:        comunes.length,
    dias_xls_sin_pos:     Object.keys(netaXlsDia).filter(f => !((netaPosDia[f] ?? 0) > 0)).length,
    // En los días que tienen las dos fuentes: ~1 = mismas ventas (paridad ya validada por el dueño).
    razon_neta_dias_en_comun: razon(sum(netaPosDia, comunes), sum(netaXlsDia, comunes)),
    // Todo el período: lo que dirá el correo nuevo ÷ lo que decía el viejo («Ventas totales»).
    razon_total_pos_vs_xls:   razon(totalPos, totalXls),
  }
}

export async function controlContraXls(sb: Cliente, r: RangoMes, pos: Record<string, DiaData>): Promise<Record<string, number | null>> {
  const { data, error } = await (sb.from('ventas_dias') as ConsultaXls).select('session_date, data')
    .gte('session_date', r.desde).lte('session_date', r.hasta)
  if (error) return { control_error: 1 }
  return compararConXls(pos, data ?? [])
}
