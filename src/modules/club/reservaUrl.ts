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

/**
 * D 16-nov (el dueño, opción B): copia de `conCampanaOpenTable` de club-web/src/reservar.ts (la app no importa club-web);
 * reservaUrl.test.ts corre las dos con los mismos casos. La usa el WhatsApp de cumpleaños del Inicio (`cumpleanos`).
 * Solo cambia `ot_campaign` (reemplaza o agrega) si el link es https de OpenTable y trae `ot_source` con valor; si no,
 * el link queda igual. Nada del socio viaja: solo la etiqueta del grupo.
 */
export type GrupoReserva = 'local' | 'turista' | 'referente' | 'cumpleanos'
export const GRUPOS_RESERVA: readonly GrupoReserva[] = ['local', 'turista', 'referente', 'cumpleanos']

function claveParam(par: string): string {
  const k = par.split('=')[0]
  try { return decodeURIComponent(k.replace(/\+/g, ' ')) } catch { return k }
}

export function conCampanaOpenTable(url: string, grupo: GrupoReserva): string {
  if (!GRUPOS_RESERVA.includes(grupo) || typeof url !== 'string' || url.length > RESERVA_MAX || !RE_RESERVA_OPENTABLE.test(url)) return url
  let host: URL
  try { host = new URL(url) } catch { return url }
  if (host.protocol !== 'https:' || host.username || host.password || host.port || !RE_HOST_OPENTABLE.test(host.hostname)) return url
  const iHash = url.indexOf('#')
  const sinHash = iHash < 0 ? url : url.slice(0, iHash)
  const hash = iHash < 0 ? '' : url.slice(iHash)
  const iQ = sinHash.indexOf('?')
  if (iQ < 0) return url
  const pares = sinHash.slice(iQ + 1).split('&')
  if (!pares.some(p => claveParam(p) === 'ot_source' && p.includes('=') && p.slice(p.indexOf('=') + 1) !== '')) return url
  const nuevo = `ot_campaign=${grupo}`
  const salida: string[] = []
  let puesto = false
  for (const p of pares) {
    if (claveParam(p) !== 'ot_campaign') { salida.push(p); continue }
    if (!puesto) { salida.push(nuevo); puesto = true }
  }
  if (!puesto) {
    if (salida.length > 0 && salida[salida.length - 1] === '') salida[salida.length - 1] = nuevo
    else salida.push(nuevo)
  }
  return `${sinHash.slice(0, iQ)}?${salida.join('&')}${hash}`
}
