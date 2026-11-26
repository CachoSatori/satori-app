// ── Compras F1: pantalla de control de la ingesta de facturas electrónicas (mig 199) — SOLO LECTURA ─────────────
//
// Lee `fe_ingesta_resumen(p_dias)` (owner y contador; el resto recibe 42501). Los arreglos vienen por POSICIÓN; el
// orden lo fija la 199 y lo cuida src/shared/api/feIngesta.contrato199.test.ts. Si la función no está (antes de la
// 199) o falla, se devuelve el error y la pantalla lo dice: nunca se inventa un conteo.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { parsearResumenIngesta, type ResumenIngesta } from '../fe/resumenIngesta'
export { haceCuanto, HORAS_ALERTA_LATIDO, parsearResumenIngesta } from '../fe/resumenIngesta'
export type { DiaIngesta, ResumenIngesta } from '../fe/resumenIngesta'

const sb = supabase as unknown as SupabaseClient

export async function getResumenIngesta(dias = 14): Promise<{ ok: true; resumen: ResumenIngesta } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('fe_ingesta_resumen', { p_dias: dias })
  if (error) return { ok: false, error: error.code === '42501' ? 'Solo el owner y el contador ven esta pantalla.' : 'No se pudo leer la ingesta.' }
  return { ok: true, resumen: parsearResumenIngesta(data) }
}
