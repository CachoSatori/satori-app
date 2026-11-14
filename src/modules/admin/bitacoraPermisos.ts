// B10 (mig 165): textos de la sección «Cambios» de Admin → Usuarios. Puro, sin red: lo prueba bitacoraPermisos.test.ts.
import { ROLE_LABELS } from '../../shared/constants'

export interface CambioPermiso {
  id: number
  profile_id: string
  campo: 'rol' | 'activo' | 'local' | string
  antes: string | null
  despues: string | null
  cambiado_por: string | null
  origen: 'sesion' | 'service_role' | 'sistema' | string
  cambiado_en: string
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']

/** «14-nov-2026 09:05» en hora de Costa Rica (UTC−6 fijo, sin horario de verano). */
export function fechaHoraCR(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const d = new Date(ms - 6 * 3600 * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()} ${hh}:${mm}`
}

function valor(campo: string, v: string | null): string {
  if (v == null) return '—'
  if (campo === 'rol') return ROLE_LABELS[v] ?? v
  if (campo === 'activo') return v === 'true' ? 'habilitada' : v === 'false' ? 'deshabilitada' : v
  return v
}

/** «Rol: Salonero → Cajero» · «Cuenta: deshabilitada → habilitada» · «Local: — → santa-teresa». */
export function describirCambio(c: Pick<CambioPermiso, 'campo' | 'antes' | 'despues'>): string {
  const etiqueta = c.campo === 'rol' ? 'Rol' : c.campo === 'activo' ? 'Cuenta' : c.campo === 'local' ? 'Local' : c.campo
  return `${etiqueta}: ${valor(c.campo, c.antes)} → ${valor(c.campo, c.despues)}`
}

/** Quién: el nombre del usuario que lo hizo, «Sistema» sin sesión, o «usuario borrado» si ya no existe. */
export function quienCambio(c: Pick<CambioPermiso, 'cambiado_por' | 'origen'>, nombres: Map<string, string>): string {
  if (!c.cambiado_por) return c.origen === 'service_role' ? 'Sistema (servicio)' : 'Sistema'
  return nombres.get(c.cambiado_por) ?? 'usuario borrado'
}

/** Más reciente primero (la base ya ordena; esto lo asegura si llegan mezclados). */
export function ordenarCambios<T extends Pick<CambioPermiso, 'cambiado_en' | 'id'>>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (Date.parse(b.cambiado_en) - Date.parse(a.cambiado_en)) || (b.id - a.id))
}
