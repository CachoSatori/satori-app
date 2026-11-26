// ── Compras F1 (mig 203): «Es un proveedor real · recordar» y la lista de emisores conocidos ──────────────────────
//
// Lee `fe_comprobantes` y `fe_emisores_conocidos` directo (RLS de la 199/201: owner y contador). Escribe SOLO por
// `fe_emisor_recordar` (owner y contador) y `fe_emisor_desactivar` (solo owner): el rol lo valida la base (42501).
// Un error se devuelve tal cual a la pantalla: nunca se inventa un estado.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { agruparPendientes, type ComprobantePendiente, type EmisorPendiente } from '../fe/emisoresPendientes'

const sb = supabase as unknown as SupabaseClient

export interface EmisorConocido {
  cedula: string
  nombre: string | null
  activo: boolean
  origen: 'manual' | 'revision'
  aprobado_en: string | null
}
export interface ResultadoRecordar { resultado: 'recordar' | 'reactivar' | 'resolver' | 'ya_estaba'; pasan_a_ok: number; siguen_revisar: number }

type R<T> = { ok: true; data: T } | { ok: false; error: string }

const MSJ: Record<string, string> = {
  '42501': 'No tenés permiso para esto.',
  '22023': 'Esa cédula no llegó en ninguna factura para un local.',
}
function textoError(e: { code?: string; message?: string }): string {
  // los 42501 de la 203 traen su propio texto claro («solo el owner lo vuelve a activar»)
  if (e.code === '42501' && e.message && /owner/.test(e.message)) return e.message
  return (e.code && MSJ[e.code]) || 'No se pudo guardar. Probá de nuevo.'
}

export async function getEmisoresPendientes(): Promise<R<EmisorPendiente[]>> {
  const { data, error } = await sb
    .from('fe_comprobantes')
    .select('clave, fecha_emision, emisor_cedula, emisor_nombre, emisor_nombre_comercial, total_comprobante, moneda, estado_parseo, motivo')
    .eq('estado_parseo', 'revisar')
    .ilike('motivo', '%emisor no conocido%')
    .order('fecha_emision', { ascending: false })
    .order('clave', { ascending: true })
    .limit(500)
  if (error) return { ok: false, error: 'No se pudieron leer los emisores por revisar.' }
  // el filtro exacto (el motivo entero, no un pedazo) lo hace agruparPendientes
  return { ok: true, data: agruparPendientes((data ?? []) as ComprobantePendiente[]) }
}

export async function getEmisoresConocidos(): Promise<R<EmisorConocido[]>> {
  const { data, error } = await sb
    .from('fe_emisores_conocidos')
    .select('cedula, nombre, activo, origen, aprobado_en')
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true })
    .order('cedula', { ascending: true })
  if (error) return { ok: false, error: 'No se pudo leer la lista de emisores conocidos.' }
  return { ok: true, data: (data ?? []) as EmisorConocido[] }
}

export async function recordarEmisor(cedula: string): Promise<R<ResultadoRecordar>> {
  const { data, error } = await sb.rpc('fe_emisor_recordar', { p_cedula: cedula })
  if (error) return { ok: false, error: textoError(error) }
  const d = (data ?? {}) as Record<string, unknown>
  return { ok: true, data: { resultado: d.resultado as ResultadoRecordar['resultado'], pasan_a_ok: Number(d.pasan_a_ok ?? 0), siguen_revisar: Number(d.siguen_revisar ?? 0) } }
}

export async function desactivarEmisor(cedula: string): Promise<R<'desactivar' | 'ya_estaba'>> {
  const { data, error } = await sb.rpc('fe_emisor_desactivar', { p_cedula: cedula })
  if (error) return { ok: false, error: textoError(error) }
  return { ok: true, data: ((data ?? {}) as { resultado: 'desactivar' | 'ya_estaba' }).resultado }
}
