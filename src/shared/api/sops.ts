import { supabase } from './supabase'
// SOP interface — same shape as the sops table
export type { SOP } from '../types/database'
import type { SOP } from '../types/database'

export const SOP_CATEGORIES = [
  'Apertura', 'Cierre', 'Servicio', 'Barra', 'Cocina',
  'Delivery', 'Propinas', 'Emergencias', 'General',
]

/** Las 5 áreas del paquete de SoP (noviembre 2026), en orden. */
export const SOP_AREAS = [
  '1. Cultura y servicio',
  '2. Salón y recepción',
  '3. Menú y producto',
  '4. Administración y caja',
  '5. Equipo',
]

function mensajeSop(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Ya existe otro procedimiento con ese código.'
  return error.message
}

export async function getSOPs(): Promise<SOP[]> {
  const { data, error } = await supabase
    .from('sops')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('display_order')
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []) as SOP[]
}

export async function saveSOPItem(sop: {
  id?: string
  title: string
  category: string
  content: string
  display_order?: number
  created_by: string
  // Mig 076. Opcionales: si no vienen, la fila conserva lo que tenía.
  code?: string | null
  area?: string | null
}): Promise<SOP> {
  const payload: {
    title: string; category: string; content: string; display_order: number
    created_by: string; updated_at: string; code?: string | null; area?: string | null
  } = {
    title:         sop.title,
    category:      sop.category,
    content:       sop.content,
    display_order: sop.display_order ?? 0,
    created_by:    sop.created_by,
    updated_at:    new Date().toISOString(),
  }
  if (sop.code !== undefined) payload.code = sop.code?.trim() || null
  if (sop.area !== undefined) payload.area = sop.area || null

  if (sop.id) {
    const { data, error } = await supabase
      .from('sops')
      .update(payload)
      .eq('id', sop.id)
      .select()
      .single()
    if (error) throw new Error(mensajeSop(error))
    return data as SOP
  } else {
    const { data, error } = await supabase
      .from('sops')
      .insert({ ...payload, is_active: true })
      .select()
      .single()
    if (error) throw new Error(mensajeSop(error))
    return data as SOP
  }
}

export async function deleteSOPItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('sops')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
