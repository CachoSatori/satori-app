import type { Employee, UserRole } from '../../shared/types/database'

/**
 * Empleados disponibles para asignar como cobertura: los que NO participan ya en
 * el turno (línea `active`). Las coberturas ya entran como `active`, así que también
 * quedan excluidas. Puro (sin React/supabase) → testeable con node-test.
 */
export function availableForCobertura(
  employees: Employee[],
  lines: { employeeId: string; active: boolean }[],
): Employee[] {
  return employees.filter(e => !lines.some(l => l.employeeId === e.id && l.active))
}

// ── Elegibilidad de propina por rol (config, mig 048) ────────────
type RoleFlag = { role: UserRole; recibe_propina?: boolean | null }

/**
 * ¿El rol recibe propina? Configuración por rol (role_tip_points.recibe_propina).
 * NULL-SAFE: si el flag viene null/undefined o el rol no está en la config → true
 * (default del esquema). Así, sin migración aplicada o con cache viejo, nada se excluye.
 */
export function roleReceivesTips(role: UserRole, rolePoints: RoleFlag[] | null | undefined): boolean {
  const rp = rolePoints?.find(r => r.role === role)
  return rp?.recibe_propina !== false
}

/**
 * Roster elegible: deja SOLO empleados cuyo rol recibe propina. `keepIds` preserva
 * empleados que YA tienen entrada en el turno (no re-tocar turnos en curso/cerrados):
 * aunque su rol pase a no-elegible, si ya participaban siguen visibles.
 */
export function eligibleRoster(
  employees: Employee[],
  rolePoints: RoleFlag[] | null | undefined,
  keepIds?: Set<string>,
): Employee[] {
  return employees.filter(e => roleReceivesTips(e.role, rolePoints) || (keepIds?.has(e.id) ?? false))
}
