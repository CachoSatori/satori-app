/**
 * D2 (14-nov, el dueño) · Logins del PoS que facturaron en los últimos 14 días y no son el `pos_login` de ningún
 * empleado → aviso en Admin → Empleados («Login del PoS 041 sin empleado: asignar»).
 *
 * Solo lectura y con lo que ya existe: `pos_prompax_agregado` (mig 080, owner/manager/contador activos) agrega
 * `pos_ndf_tickets` cerrados (`estado = 'C'`) por día, franja, `salonero_login` y canal. No hace falta función nueva
 * ni abrir `pos_ndf_*` (regla 6 de ESTADO). `salonero_login` ya viene en null para los logins de caja (111/222) y de
 * sistema (mig 062), así que esos nunca salen como «sin empleado».
 */
import { getPromPaxAgregado, type FilaPromPaxRpc } from '../../shared/api/posNdf'
import { LOCALES } from '../ventas/ventasEnVivoTypes'
import { todayCR } from '../../shared/utils'

/** El login del PoS de un empleado: 3 dígitos (ej. 041). */
export const POS_LOGIN_RE = /^\d{3}$/

/** Días hacia atrás que se miran (hoy incluido). */
export const DIAS_LOGINS = 14

export interface LoginSinEmpleado { login: string; facturas: number; ultimoDia: string }

/** Los logins con facturas que ningún empleado (activo o no) tiene como `pos_login`. Más facturas primero. */
export function loginsSinEmpleado(
  filas: Array<Pick<FilaPromPaxRpc, 'salonero_login' | 'tickets' | 'dia'>>,
  employees: Array<{ pos_login?: string | null }>,
): LoginSinEmpleado[] {
  const asignados = new Set(employees.map(e => (e.pos_login ?? '').trim()).filter(Boolean))
  const por = new Map<string, LoginSinEmpleado>()
  for (const f of filas) {
    const login = (f.salonero_login ?? '').trim()
    if (!login || asignados.has(login)) continue
    const x = por.get(login) ?? { login, facturas: 0, ultimoDia: '' }
    x.facturas += Number(f.tickets) || 0
    if (f.dia > x.ultimoDia) x.ultimoDia = f.dia
    por.set(login, x)
  }
  return [...por.values()].sort((a, b) => b.facturas - a.facturas || a.login.localeCompare(b.login))
}

/** `[desde, hasta]` de los últimos `DIAS_LOGINS` días en Costa Rica. */
export function rangoLogins(hoy: string = todayCR()): { desde: string; hasta: string } {
  const [y, m, d] = hoy.split('-').map(Number)
  const desde = new Date(Date.UTC(y, m - 1, d - (DIAS_LOGINS - 1))).toISOString().slice(0, 10)
  return { desde, hasta: hoy }
}

/**
 * Lee los locales y arma la lista. Si TODOS los locales fallan, rechaza (la pantalla dice «no se pudo revisar»);
 * si falla uno solo, sigue con los otros.
 */
export async function leerLoginsSinEmpleado(
  employees: Array<{ pos_login?: string | null }>,
  hoy: string = todayCR(),
): Promise<LoginSinEmpleado[]> {
  const { desde, hasta } = rangoLogins(hoy)
  const r = await Promise.allSettled(LOCALES.map(l => getPromPaxAgregado(l.id, desde, hasta)))
  const ok = r.filter((x): x is PromiseFulfilledResult<FilaPromPaxRpc[]> => x.status === 'fulfilled')
  if (ok.length === 0) throw (r[0] as PromiseRejectedResult).reason
  return loginsSinEmpleado(ok.flatMap(x => x.value), employees)
}
