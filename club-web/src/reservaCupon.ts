import { urlReservaLocal } from './reservar'

/**
 * Mig 180 (pedido del dueño, 16-nov): la página del cupón del turista (el QR que entrega el anfitrión) suma «Reservar una
 * mesa» con el link de reservas del LOCAL DEL CUPÓN (`local.reserva` de club_cupon_ver, que se carga en Club → Locales).
 * Se usa TAL CUAL (trae el seguimiento de OpenTable) y abre en otra pestaña con rel="noopener noreferrer". Sin link
 * válido de OpenTable (local sin link, base sin la 180 o sin señal) no hay botón: null. Aquí NO cae al rid por defecto
 * (eso es solo del portal del socio). DOM sin innerHTML, como el resto de club-web.
 */
export function botonReservaCupon(local: { reserva?: unknown } | null | undefined, texto: string): HTMLAnchorElement | null {
  const url = urlReservaLocal(local?.reserva)
  if (!url) return null
  const a = document.createElement('a')
  a.className = 'btn sec reservar-cupon'
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.textContent = texto
  return a
}
