/**
 * Quién crea y da de baja competencias de Ventas (D18 ampliada, dueño 23-nov ~23:50 CR): owner y manager. El contador
 * las ve SOLO PARA MIRAR (sin «+ Nueva» ni «×»). `saveComp` y `deleteComp` rechazan los demás roles aunque una
 * pantalla lo intentara. La base todavía deja escribir al contador (`ventas_comps_write`, migración 011): cerrarlo
 * también ahí es una migración aparte, con firma del dueño.
 */
export const ROLES_EDITAN_COMPETENCIAS: readonly string[] = ['owner', 'manager']
export const puedeEditarCompetencias = (role: string): boolean => ROLES_EDITAN_COMPETENCIAS.includes(role)
export const SIN_PERMISO_COMPETENCIAS = 'Su rol puede ver las competencias, pero no crearlas ni darlas de baja.'
