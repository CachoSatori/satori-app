import { supabase } from './supabase'
import type { Profile } from '../types/database'

// Obtener perfil del usuario autenticado
export async function getMyProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .single()
  if (error) return null
  return data as Profile
}

// Actualizar nombre del perfil
export async function updateProfileName(id: string, fullName: string) {
  // Usamos query directa para evitar conflicto de tipos con el cliente genérico
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName } as never)
    .eq('id', id)
  return { error: error?.message ?? null }
}
