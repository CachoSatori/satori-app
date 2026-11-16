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
