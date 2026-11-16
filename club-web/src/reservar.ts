import { OPENTABLE_RID } from './config'

/**
 * D 16-nov (el dueño): link de reserva de OpenTable para el botón «Reservar» del portal del socio. Es el mismo formato
 * que el default de `club_cumple_config.reserva_url` (mig 173). Un rid que no sea solo dígitos no arma link (null).
 */
export function urlReservaOpenTable(rid: string = OPENTABLE_RID): string | null {
  const r = String(rid ?? '').trim()
  if (!/^\d{1,12}$/.test(r)) return null
  return `https://www.opentable.com/restref/client/?rid=${r}`
}

/** Mismos dominios que `club_reserva_url_ok` (mig 179): opentable.com, sus subdominios y las variantes regionales. */
const HOST_OPENTABLE = /^([a-z0-9-]+\.)*opentable\.(com|ca|de|es|fr|it|ie|jp|nl|hk|sg|ae|co\.uk|co\.nz|co\.th|com\.au|com\.mx|com\.tw)$/i

/**
 * D 16-nov (el dueño, opción A; mig 179): el link de reserva del LOCAL del socio (`socio.reserva_url`, el de Club →
 * Promociones) se usa TAL CUAL: trae los parámetros con los que OpenTable registra el canal de entrada. Nada se
 * reconstruye ni se le quita. Solo se revisa que sea https de OpenTable (sin usuario ni puerto; ≤ 300); si no, null y el
 * portal cae al rid por defecto.
 */
export function urlReservaLocal(url: unknown): string | null {
  if (typeof url !== 'string' || url === '' || url.length > 300 || /[\s<>"]/.test(url)) return null
  if (!/^https:\/\//.test(url)) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOST_OPENTABLE.test(u.hostname)) return null
  return url
}

/** El link del botón: el del local del socio si vino y es de OpenTable; si no, el rid por defecto (config.ts). */
export function urlReservaSocio(reservaUrl: unknown): string | null {
  return urlReservaLocal(reservaUrl) ?? urlReservaOpenTable()
}

export interface TextosReservar { titulo: string; txt: string; boton: string }

/**
 * La tarjeta «Reservar una mesa» de «Mi Club»: un link con forma de botón que abre OpenTable en otra pestaña. Sin link
 * válido, no hay tarjeta (null). DOM sin innerHTML, como el resto de club-web.
 */
export function tarjetaReservar(x: TextosReservar, url: string | null = urlReservaOpenTable()): HTMLElement | null {
  if (!url) return null
  const box = document.createElement('div')
  box.className = 'avance reservar'
  const h3 = document.createElement('h3'); h3.textContent = x.titulo
  const p = document.createElement('p'); p.className = 'sub'; p.textContent = x.txt
  const a = document.createElement('a')
  a.className = 'btn'
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.textContent = x.boton
  box.append(h3, p, a)
  return box
}
