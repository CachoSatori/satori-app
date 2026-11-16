/**
 * 180 · Link de reservas (OpenTable) de cada local («Locales», solo owner). Lo usan «Reservar» del portal del socio, el
 * botón «Reservar una mesa» de la página del cupón y el WhatsApp de cumpleaños. Se guarda TAL CUAL (OpenTable registra el
 * canal de entrada por sus parámetros). La base valida lo mismo (trigger club_config_reserva_url_trg con
 * club_reserva_url_ok, mig 179) y club-web también (club-web/src/reservar.ts); reservaUrl.test.ts controla que no se separen.
 */
export const RE_HOST_OPENTABLE = /^([a-z0-9-]+\.)*opentable\.(com|ca|de|es|fr|it|ie|jp|nl|hk|sg|ae|co\.uk|co\.nz|co\.th|com\.au|com\.mx|com\.tw)$/i
/** La misma expresión que club_reserva_url_ok (179): https, host de OpenTable y después solo / ? # o el final. */
export const RE_RESERVA_OPENTABLE =
  /^https:\/\/([a-z0-9-]+\.)*opentable\.(com|ca|de|es|fr|it|ie|jp|nl|hk|sg|ae|co\.uk|co\.nz|co\.th|com\.au|com\.mx|com\.tw)([/?#][^\s<>"]*)?$/i
export const RESERVA_MAX = 300

/** `null` = borrar el link · string = link válido (sin espacios alrededor, sin tocar nada más) · Error = no es de OpenTable. */
export function normalizarReservaUrl(entrada: string): string | null {
  const u = entrada.trim()
  if (u === '') return null
  if (u.length > RESERVA_MAX || !RE_RESERVA_OPENTABLE.test(u)) {
    throw new Error('El link de reservas tiene que ser de OpenTable (https://www.opentable.com/…): copialo tal cual del navegador')
  }
  return u
}
