import type { Employee } from '../../shared/types/database'

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
