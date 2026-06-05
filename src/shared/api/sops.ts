import { supabase } from './supabase'
// SOP interface — same shape as the sops table
export type { SOP } from '../types/database'
import type { SOP } from '../types/database'

export const SOP_CATEGORIES = [
  'Apertura', 'Cierre', 'Servicio', 'Barra', 'Cocina',
  'Delivery', 'Propinas', 'Emergencias', 'General',
]

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
}): Promise<SOP> {
  const payload = {
    title:         sop.title,
    category:      sop.category,
    content:       sop.content,
    display_order: sop.display_order ?? 0,
    created_by:    sop.created_by,
    updated_at:    new Date().toISOString(),
  }

  if (sop.id) {
    const { data, error } = await supabase
      .from('sops')
      .update(payload)
      .eq('id', sop.id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as SOP
  } else {
    const { data, error } = await supabase
      .from('sops')
      .insert({ ...payload, is_active: true })
      .select()
      .single()
    if (error) throw new Error(error.message)
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
