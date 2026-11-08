import { supabase } from './supabase'
import type { Employee, Profile, UserRole } from '../types/database'
import { EMPLOYEE_COLUMNS, PLANILLA_KEYS } from './employeeColumns'

export { EMPLOYEE_COLUMNS, PLANILLA_KEYS }

// ── Empleados ───────────────────────────────────────────────

export async function getAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .order('full_name')
  if (error) throw new Error(error.message)
  return data as unknown as Employee[]
}

// ── Salarios · Fase 0 (mig 055) ─────────────────────────────
// Datos maestros de nómina que vivían en el Excel. Desde la mig 083 (SAL-AUD-01) la tarifa y el
// salario fijo van a `employee_payroll` (RLS: owner/contador activos); el resto (servicio,
// BioTime, ingreso) sigue en employees (RLS: owner/manager gestionan empleados).
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

/** Parte un payload: lo de planilla (→ employee_payroll) y lo demás (→ employees). */
export function separarPlanilla<T extends Record<string, unknown>>(payload: T): {
  planilla: Partial<Pick<EmployeePayroll, 'hourly_rate_crc' | 'fixed_salary_crc'>>
  resto: Omit<T, 'hourly_rate_crc' | 'fixed_salary_crc'>
} {
  const planilla: Record<string, unknown> = {}
  const resto: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue
    if ((PLANILLA_KEYS as readonly string[]).includes(k)) planilla[k] = v
    else resto[k] = v
  }
  return { planilla, resto } as never
}

/** Upsert de la planilla de un empleado (employee_payroll, 1 a 1). Solo owner/contador. */
export async function upsertPlanilla(
  employeeId: string,
  campos: Partial<Pick<EmployeePayroll, 'hourly_rate_crc' | 'fixed_salary_crc'>> & { nombre_homebanking?: string | null },
): Promise<void> {
  if (Object.keys(campos).length === 0) return
  // employee_payroll no está en supabase.gen.ts (mismo criterio que las tablas de la 056 en
  // salarios.ts): cast acotado del builder, con .bind para no perder `this`.
  const tabla = supabase.from?.bind(supabase) as unknown as (t: string) => {
    upsert(row: unknown, opts: { onConflict: string }): PromiseLike<{ error: { message: string; code?: string } | null }>
  }
  const { error } = await tabla('employee_payroll')
    .upsert({ employee_id: employeeId, ...campos }, { onConflict: 'employee_id' })
  if (error) {
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      throw new Error('La tarifa y los datos bancarios los cargan solo el dueño o el contador.')
    }
    throw new Error(error.message)
  }
}

export async function updateEmployeePayroll(
  id: string,
  payload: Partial<EmployeePayroll>,
): Promise<void> {
  const { planilla, resto } = separarPlanilla(payload)
  if (Object.keys(resto).length > 0) {
    const { error } = await supabase
      .from('employees')
      .update(resto)
      .eq('id', id)
    if (error) throw payrollError(error, payload.biotime_emp_code)
  }
  await upsertPlanilla(id, planilla)
}

export async function createEmployee(
  payload: { full_name: string; role: UserRole } & Partial<EmployeePayroll>,
): Promise<Employee> {
  // profile_id queda null: el empleado existe sin cuenta de login (cocina/back).
  // La FK a profiles es nullable, así que es una fila válida y completa.
  // La planilla NO va a employees (mig 083): se inserta el empleado y después su planilla.
  const { planilla, resto } = separarPlanilla(payload)
  const { data, error } = await supabase
    .from('employees')
    .insert(resto)
    .select(EMPLOYEE_COLUMNS)
    .single()
  if (error) throw payrollError(error, payload.biotime_emp_code)
  const creado = data as unknown as Employee
  await upsertPlanilla(creado.id, planilla)
  return { ...creado, ...planilla }
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
  // Un perfil puede tener MÁS de una fila de empleado (p. ej. alguien que pasó de salonero a
  // manager: la de manager activa y la de salonero inactiva). Con `maybeSingle()` sobre dos filas PostgREST tira error y Mi Rendimiento lo
  // mostraba como «sin vínculo». Se toma la ACTIVA primero (y la más nueva si empatan).
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('profile_id', profileId)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as Employee | null
}
