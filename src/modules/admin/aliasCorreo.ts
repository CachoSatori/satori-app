// Alias de correo para empleados sin correo propio: «base+nombre@dominio», con el correo base DEL LOCAL guardado en la
// base (`locations.correo_base`, mig 195; decisión del dueño 20-nov). Repo público: el correo no va en el código ni
// en el build. Sin correo base cargado, la pantalla pide cargarlo en Admin → Locales.

/** Lo que muestra la pantalla de alta cuando el local no tiene correo base. */
export const FALTA_CORREO_LOCAL = 'Cargá el correo del local en Admin → Locales'

/** Largo máximo (igual que el check de la 195). */
export const MAX_CORREO_BASE = 254

/**
 * MISMO patrón que el check `locations_correo_base_formato` de la 195 (aliasCorreo.test.ts compara las dos cadenas).
 * Sin «+» en la parte local (el «+nombre» lo agrega el alias) y sin espacios.
 */
export const PATRON_CORREO_BASE = /^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/** Local por defecto de la caja (default de `location_id` en la 091): se usa si no hay otro elegido. */
export const LOCAL_POR_DEFECTO = 'santa-teresa'

export interface LocalCorreo {
  id: string
  name: string
  is_active: boolean
  correo_base: string | null
}

export function esCorreoBaseValido(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length <= MAX_CORREO_BASE && PATRON_CORREO_BASE.test(v)
}

/** `local@dominio` → `local+nombre@dominio`; vacío o inválido → null (la pantalla muestra FALTA_CORREO_LOCAL). */
export function aliasCorreoEjemplo(base: string | null | undefined): string | null {
  if (!esCorreoBaseValido(base)) return null
  const i = base.indexOf('@')
  return `${base.slice(0, i)}+nombre${base.slice(i)}`
}

export type CorreoBaseValidado = { ok: true; valor: string | null } | { ok: false; error: string }

/** Lo que escribió el owner en Admin → Locales: se recorta; vacío = borrar (null). */
export function validarCorreoBase(entrada: string): CorreoBaseValidado {
  const v = entrada.trim()
  if (v === '') return { ok: true, valor: null }
  if (v.length > MAX_CORREO_BASE) return { ok: false, error: `Máximo ${MAX_CORREO_BASE} caracteres` }
  if (v.includes('+')) return { ok: false, error: 'Sin «+»: el «+nombre» lo agrega la app' }
  if (!PATRON_CORREO_BASE.test(v)) return { ok: false, error: 'Revisá el correo (ej.: local@ejemplo.com)' }
  return { ok: true, valor: v }
}

/**
 * El local del alias: el que la app tiene elegido (`preferido`, el local con el que trabaja la pantalla) si está
 * encendido; si no, el local por defecto de la caja; si no, el primer local encendido (por id). Sin locales → null.
 */
export function localDelAlias(locales: LocalCorreo[], preferido: string | null): LocalCorreo | null {
  const activos = locales.filter(l => l.is_active).sort((a, b) => a.id.localeCompare(b.id))
  return activos.find(l => l.id === preferido)
    ?? activos.find(l => l.id === LOCAL_POR_DEFECTO)
    ?? activos[0]
    ?? null
}
