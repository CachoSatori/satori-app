// ── Ventas · «Mesas internas» (Ajustes): la lista de mesas que no son venta real (mig 193) ──────────────
//
// Decisión del dueño (18-nov): las mesas 51, 52 y 53 de santa-teresa son internas (dueños, regalías, errores).
// Sus facturas no cuentan para los indicadores de venta real (venta por persona, promedios, alertas de pax, día
// de semana, hora, tiempo sentado) y SÍ siguen en Contabilidad y en el correo del contador (tienen IVA).
// La lista vive en `pos_mesas_internas` (local, mesa). Lee owner, manager y contador; agrega y quita solo el
// owner (la base lo hace cumplir con RLS: acá solo se esconde el botón).
import { supabase } from '../../shared/api/supabase'

/** El número de mesa como lo guarda la base: sin espacios ni ceros a la izquierda. `null` si no sirve. */
export function normalizarMesa(txt: string): string | null {
  const m = txt.trim().replace(/^0+/, '')
  return /^[1-9][0-9A-Za-z]{0,9}$/.test(m) ? m : null
}

/** Orden natural: 9 antes que 51. */
export function ordenarMesas(mesas: readonly string[]): string[] {
  return [...mesas].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
}

type Tabla = {
  select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
  insert: (f: object) => PromiseLike<{ error: { message: string; code?: string } | null }>
  delete: () => { eq: (k: string, v: string) => { eq: (k: string, v: string) => PromiseLike<{ error: { message: string } | null }> } }
}
const tabla = () => (supabase as unknown as { from: (t: string) => Tabla }).from('pos_mesas_internas')

export async function listarMesasInternas(local: string): Promise<string[]> {
  const { data, error } = await tabla().select('mesa').eq('local', local)
  if (error) throw new Error(error.message)
  return ordenarMesas(((data ?? []) as { mesa: string }[]).map(r => r.mesa))
}

export async function agregarMesaInterna(local: string, mesa: string): Promise<void> {
  const { error } = await tabla().insert({ local, mesa })
  if (error) throw new Error(error.code === '23505' ? 'Esa mesa ya está en la lista' : error.message)
}

export async function quitarMesaInterna(local: string, mesa: string): Promise<void> {
  const { error } = await tabla().delete().eq('local', local).eq('mesa', mesa)
  if (error) throw new Error(error.message)
}
