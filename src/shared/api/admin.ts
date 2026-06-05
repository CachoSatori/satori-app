import { supabase } from './supabase'
import type { Employee, Profile, UserRole } from '../types/database'

// ── Empleados ───────────────────────────────────────────────

export async function getAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('full_name')
  if (error) throw new Error(error.message)
  return data as Employee[]
}

export async function createEmployee(payload: {
  full_name: string
  role: UserRole
}): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Employee
}

export async function updateEmployee(
  id: string,
  payload: Partial<Pick<Employee, 'full_name' | 'role' | 'is_active'>>
): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update(payload)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function toggleEmployeeActive(id: string, is_active: boolean): Promise<void> {
  await updateEmployee(id, { is_active })
}

// ── Puntos por rol ──────────────────────────────────────────

export async function updateRoleTipPoints(role: UserRole, points: number): Promise<void> {
  const { error } = await supabase
    .from('role_tip_points')
    .upsert({ role, points }, { onConflict: 'role' })
  if (error) throw new Error(error.message)
}

// ── Perfiles (solo owner) ───────────────────────────────────

export async function getAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name')
  if (error) throw new Error(error.message)
  return data as Profile[]
}

export async function updateProfileRole(id: string, role: UserRole): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Activar / desactivar una cuenta (aprobación del owner)
export async function setProfileActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ is_active })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Vincular perfil a empleado ──────────────────────────────
export async function linkProfileToEmployee(employeeId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update({ profile_id: profileId })
    .eq('id', employeeId)
  if (error) throw new Error(error.message)
}

export async function getEmployeeByProfileId(profileId: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Employee | null
}
