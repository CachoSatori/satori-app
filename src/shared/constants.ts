// ── Constantes compartidas (fuente única) ───────────────────────

// Etiqueta visible por rol. Fuente única — antes estaba copiada en 8 archivos
// (HomePage, CashModule, InboxModule, MisPropinas, UserApprovals,
// RolePointsConfig, EmployeeHours, EmployeeList) con los MISMOS valores.
// Tipada como Record<string,string> para permitir indexar con role:string;
// los call sites mantienen su fallback `?? role` para roles fuera del mapa.
export const ROLE_LABELS: Record<string, string> = {
  owner:    'Propietario',
  contador: 'Contador',
  manager:  'Encargado',
  cajero:   'Cajero',
  salonero: 'Salonero',
  barman:   'Barman',
  barback:  'Barback',
  runner:   'Runner',
  cocina:   'Cocina',
  proveedor: 'Bandeja proveedores',
}
