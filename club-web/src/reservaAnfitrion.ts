import { conCampanaOpenTable, urlReservaLocal } from './reservar'

/**
 * (16-nov, pedido del dueño) «Reservar una mesa» en la pestaña del ANFITRIÓN del portal, con la campaña `referente` de
 * OpenTable (#220, opción B): así las reservas de anfitriones se separan en OpenTable de las de socios y turistas.
 *
 * El link sale del LOCAL de la persona. Desde la mig 182 (decisión del dueño 16-nov 13:38: para TODO anfitrión)
 * `club_portal` lo devuelve arriba (`reserva_url`) a todo anfitrión, sea socio o no; se usa ese primero. Si la base
 * todavía no tiene la 182 (prod antes del pase), cae a `socio.reserva_url` (179/180: solo si también es socio). Sin
 * link → no hay tarjeta (null): nunca el rid por defecto ni otro local (como la página del cupón).
 */
export function urlReservaAnfitrion(p: { reserva_url?: unknown; socio?: { reserva_url?: unknown } | null } | null | undefined): string | null {
  const local = urlReservaLocal(p?.reserva_url) ?? urlReservaLocal(p?.socio?.reserva_url)
  return local ? conCampanaOpenTable(local, 'referente') : null
}
