/**
 * Quién crea y da de baja competencias de Ventas (D18 ampliada, dueño 23-nov ~23:50 CR): owner y manager. El contador
 * las ve SOLO PARA MIRAR (sin «+ Nueva» ni «×»). `saveComp` y `deleteComp` rechazan los demás roles aunque una
 * pantalla lo intentara. En la base lo cierra la migración 197 (`ventas_comps_write` solo owner y manager; hasta que
 * se aplique con firma del dueño, la de la 011 deja escribir también al contador). `ventasComps.contrato197.test.ts`
 * exige que la base y esta lista coincidan.
 */
export const ROLES_EDITAN_COMPETENCIAS: readonly string[] = ['owner', 'manager']
export const puedeEditarCompetencias = (role: string): boolean => ROLES_EDITAN_COMPETENCIAS.includes(role)
export const SIN_PERMISO_COMPETENCIAS = 'Su rol puede ver las competencias, pero no crearlas ni darlas de baja.'
