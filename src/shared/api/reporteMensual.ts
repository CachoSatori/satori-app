// Botón «Reportes» de Admin → Edge Function `monthly-report` (SEC-02, 06/11).
// La función exige el JWT de un owner activo (o service_role, el cron): `functions.invoke` reenvía
// la sesión. La respuesta ya no trae montos ni nombres: solo qué correos se enviaron.
import { supabase } from './supabase'

export type TipoReporte = 'ventas' | 'propinas' | 'ambos'
export interface ReporteResultado { ok: boolean; month?: string; enviados?: readonly string[]; sin_datos?: readonly string[]; error?: string }

export async function enviarReporteMensual(tipo: TipoReporte, month?: string): Promise<ReporteResultado> {
  const { data, error } = await supabase.functions.invoke('monthly-report', {
    body: { tipo, ...(month ? { month } : {}) },
  })
  if (!error) return data as ReporteResultado
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    const j = await ctx.json().catch(() => null) as { error?: string; message?: string } | null
    return { ok: false, error: j?.error ?? 'No se pudo enviar el reporte' }
  }
  return { ok: false, error: 'Sin conexión — no se envió nada' }
}

export function mensajeReporte(tipo: TipoReporte, r: ReporteResultado): string {
  if (!r.ok) return `✗ ${(r.error ?? 'No se pudo enviar el reporte').slice(0, 80)}`
  const enviados = r.enviados ?? []
  if (enviados.length === 0) return `✗ Sin datos para ${r.month ?? 'ese mes'} — no se envió nada`
  const que = enviados.length === 2 ? 'Ambos reportes enviados' : `Reporte ${enviados[0]} enviado`
  const falta = (r.sin_datos ?? []).length ? ` (sin datos: ${r.sin_datos!.join(', ')})` : ''
  return `✓ ${que} — ${r.month}${tipo === 'ambos' ? falta : ''}`
}
