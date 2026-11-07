// Alta de empleados desde Admin + cambio de contraseña inicial — Edge Function `alta-empleado`
// (firmado por Ismael, 05/11). La función valida TODO del lado del servidor (owner activo, rol
// permitido, email no repetido, empleado disponible); acá solo se arma el pedido y se traduce la
// respuesta a un error con mensaje fijo, sin texto técnico.
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { UserRole } from '../types/database'

// Mismos roles que la función (sin `owner`: un owner nuevo se promueve desde Admin).
export const ROLES_ALTA: UserRole[] = ['manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina', 'contador', 'proveedor']
export const PASSWORD_MIN = 8

export interface AltaEmpleadoInput {
  full_name: string
  email: string
  role: UserRole
  employee_id?: string | null
}
export interface AltaEmpleadoResultado {
  user_id: string
  email: string
  full_name: string
  role: UserRole
  employee_linked: boolean
  temp_password: string
}

export class AltaEmpleadoError extends Error {
  code: string
  ref?: string
  constructor(message: string, code: string, ref?: string) {
    super(message); this.code = code; this.ref = ref
  }
}

async function invocar<T>(body: Record<string, unknown>, sinRed: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('alta-empleado', { body })
  if (!error) return data as T
  // FunctionsHttpError trae la Response en `context`: la función siempre responde { code, error, ref }.
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    const j = await ctx.json().catch(() => null) as { code?: string; error?: string; ref?: string } | null
    if (j?.error) throw new AltaEmpleadoError(j.error + (j.ref && j.code === 'interno' ? ` (ref ${j.ref})` : ''), j.code ?? 'desconocido', j.ref)
    throw new AltaEmpleadoError('No se pudo completar la operación', 'desconocido')
  }
  throw new AltaEmpleadoError(sinRed, 'red')
}

export const crearCuentaEmpleado = (i: AltaEmpleadoInput) =>
  invocar<AltaEmpleadoResultado>({ action: 'crear', ...i, employee_id: i.employee_id || null }, 'Sin conexión — no se creó nada')

export const cambiarPasswordInicial = (actual: string, nueva: string) =>
  invocar<{ ok: true }>({ action: 'cambiar_password', actual, nueva }, 'Sin conexión — no se cambió nada')

// El flag vive en app_metadata (solo lo escribe service_role): el usuario no puede bajarlo solo.
export const debeCambiarPassword = (user: User | null | undefined): boolean =>
  user?.app_metadata?.cambiar_password === true
