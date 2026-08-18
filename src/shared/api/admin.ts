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

// ── Salarios · Fase 0 (mig 055) ─────────────────────────────
// Datos maestros de nómina que vivían en el Excel. Se escriben con un update normal
// sobre employees (RLS: owner/manager gestionan empleados); no hay RPC nueva porque
// acá todavía no se mueve plata — son solo los datos que Fase 1+ va a consumir.
export interface EmployeePayroll {
  hourly_rate_crc:    number
  fixed_salary_crc:   number
  participa_servicio: boolean
  biotime_emp_code:   string | null
  fecha_ingreso:      string | null
}

// El índice único parcial employees_biotime_emp_code_key (mig 055) es el que manda:
// dos empleados no pueden compartir código de BioTime. Traducimos su 23505 a algo
// que se entienda en la UI (la validación de la UI es la primera línea, esta es la red).
function payrollError(error: { code?: string; message: string }, code?: string | null): Error {
  const dup = error.code === '23505' || error.message.includes('employees_biotime_emp_code_key')
  if (dup) {
    return new Error(
      `El código de BioTime${code ? ` «${code}»` : ''} ya está asignado a otro empleado. ` +
      'Cada usuario del reloj lleva su propio código.',
    )
  }
  return new Error(error.message)
}

export async function updateEmployeePayroll(
  id: string,
  payload: Partial<EmployeePayroll>,
): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update(payload)
    .eq('id', id)
  if (error) throw payrollError(error, payload.biotime_emp_code)
}

export async function createEmployee(
  payload: { full_name: string; role: UserRole } & Partial<EmployeePayroll>,
): Promise<Employee> {
  // profile_id queda null: el empleado existe sin cuenta de login (cocina/back).
  // La FK a profiles es nullable, así que es una fila válida y completa.
  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select()
    .single()
  if (error) throw payrollError(error, payload.biotime_emp_code)
  return data as Employee
}

export async function updateEmployee(
  id: string,
  payload: Partial<Pick<Employee, 'full_name' | 'role' | 'is_active' | 'pos_name'>>
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

// Guarda puntos + elegibilidad (recibe_propina) en un solo upsert (onConflict 'role').
// Se envían AMBOS: mandar points junto al flag evita reventar la restricción NOT NULL de
// points en el INSERT propuesto (Postgres la evalúa antes de resolver el conflicto).
export async function upsertRoleTipConfig(
  role: UserRole,
  points: number,
  recibe_propina: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('role_tip_points')
    .upsert({ role, points, recibe_propina }, { onConflict: 'role' })
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
