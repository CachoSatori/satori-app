/**
 * D6 A (mig 163): cuándo la pantalla del personal muestra la casilla «Es mayor de 18 años». Espeja las reglas de la base
 * (club_socio_validar_v2, club_miembro_guardar_v2 y el trigger club_roles_mayor_edad_chk): la casilla aparece SOLO
 * cuando la base la va a pedir. Si la lectura del rol falla (`undefined`), se muestra igual: preguntar de más no rompe
 * nada; preguntar de menos deja el botón en un error.
 */
import type { EdadSocio } from '../../shared/api/club'

/** «Validar socio»: hace falta si la persona no tiene la edad registrada (autoaltas de antes de la 159). */
export function pideEdadAlValidar(rol: EdadSocio | null | undefined): boolean {
  if (rol === undefined) return true
  return rol !== null && !rol.mayor_edad_en
}

/**
 * Reactivar (Editar → Estado: de «Dado de baja» a «Activo»): hace falta si la persona tiene un rol de socio sin la edad
 * que VUELVE A ACTIVO. No vuelve si se dio de baja él mismo (portal); vuelve a pendiente si era una autoalta sin validar
 * (ahí la edad la pide «Validar socio»).
 */
export function pideEdadAlReactivar(rol: EdadSocio | null | undefined, estadoAntes: 'activo' | 'baja' | undefined,
                                    estadoNuevo: 'activo' | 'baja'): boolean {
  if (estadoAntes !== 'baja' || estadoNuevo !== 'activo') return false
  if (rol === undefined) return true
  if (rol === null || rol.mayor_edad_en) return false
  if (rol.estado === 'baja' && rol.baja_por === 'socio') return false
  if (rol.alta_por === 'autoalta' && !rol.validado_en) return false
  return true
}
