// ── Ventas v2 · 3.5.4 · «Equipo» → columna ICP: las propinas del período y del local (solo lectura) ─────────────
//
// Las MISMAS filas que `getAttendanceHistory` (`shared/api/tips.ts`, la sub-vista «ICP»), pero de un RANGO de días de
// sesión (`session_date`, día CR) y de UN local (`tip_sessions.location_id`, mig 091). Vive acá y no en `tips.ts` para
// no tocar el módulo de propinas. La RLS es la de siempre (mig 192). No escribe nada.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../shared/api/supabase'
import type { AttendanceRow } from '../../shared/api/tips'

// `location_id` no está en los tipos generados de `tip_sessions`: cliente sin tipos de tabla (como `posNdf.ts`).
const sb = supabase as unknown as SupabaseClient

export async function getPropinasRango(desde: string, hasta: string, local: string): Promise<AttendanceRow[]> {
  const { data, error } = await sb
    .from('tip_sessions')
    .select('id, session_date, shift_type, exchange_rate, tip_entries (employee_id, hours_worked, payout_crc, points, tip_amount_crc, tip_amount_usd)')
    .eq('status', 'closed')
    .eq('location_id', local)
    .gte('session_date', desde)
    .lte('session_date', hasta)
    .order('session_date', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)
  const rows: AttendanceRow[] = []
  for (const s of (data ?? []) as unknown as Array<{
    session_date: string; shift_type: string; exchange_rate: number | null
    tip_entries: Array<{ employee_id: string; hours_worked: number; payout_crc: number | null; points: number | null; tip_amount_crc: number | null; tip_amount_usd: number | null }> | null
  }>) {
    for (const e of s.tip_entries ?? []) {
      rows.push({
        session_date: s.session_date, shift_type: s.shift_type, employee_id: e.employee_id, hours_worked: e.hours_worked,
        payout_crc: e.payout_crc, points: e.points, tip_amount_crc: e.tip_amount_crc, tip_amount_usd: e.tip_amount_usd,
        exchange_rate: s.exchange_rate,
      })
    }
  }
  return rows
}
