import { conCampanaOpenTable, urlReservaLocal } from './reservar'

/**
 * (16-nov, pedido del dueño) «Reservar una mesa» en la pestaña del ANFITRIÓN del portal, con la campaña `referente` de
 * OpenTable (#220, opción B): así las reservas de anfitriones se separan en OpenTable de las de socios y turistas.
 *
 * El link sale del LOCAL de la persona, tal como lo devuelve hoy `club_portal`: `socio.reserva_url` (mig 179/180, el
 * OpenTable de Club → Locales del local del miembro). Hoy la base lo devuelve SOLO cuando la persona también es socia del
 * Local Club; a un anfitrión puro no le llega ningún link → no hay tarjeta (null). Nunca cae al rid por defecto ni a otro
 * local (como la página del cupón). Si algún día `club_portal` devuelve `reserva_url` arriba (para todo miembro), se usa
 * ese primero sin tocar la pantalla.
 */
export function urlReservaAnfitrion(p: { reserva_url?: unknown; socio?: { reserva_url?: unknown } | null } | null | undefined): string | null {
  const local = urlReservaLocal(p?.reserva_url) ?? urlReservaLocal(p?.socio?.reserva_url)
  return local ? conCampanaOpenTable(local, 'referente') : null
}
