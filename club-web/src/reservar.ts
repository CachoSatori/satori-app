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

/**
 * D 16-nov (el dueño): «Reservar» se hace con el WIDGET de OpenTable dentro del portal (sin salir del Club). El dueño carga
 * UN dato por local, el LINK (Promociones); el widget se arma a partir de él:
 * - rid = `restref` (links /r/…?restref=) o `rid` (links /restref/client/?rid=) del link; solo dígitos.
 * - otSource / otCampaign = `ot_source` / `ot_campaign` del link (así OpenTable registra el origen «Club Satori»); si
 *   faltan o traen algo raro, «Club Satori».
 * - lang = el idioma que eligió el socio en el portal (es → es-MX, en → en-US).
 * - El resto fijo, como lo arma el loader de OpenTable para el script que generó el dueño (type standard, tema 1).
 * Sin link del local (o uno que no es de OpenTable) → el rid por defecto (config.ts) con origen «Club Satori». Con link
 * válido pero sin rid reconocible → null: no hay widget y queda el botón (nunca el widget de otro local).
 *
 * Revisión de seguridad (#214): NINGÚN script de OpenTable corre en nuestro origen (el loader veía el DOM, la ruta con el
 * token y el localStorage, y su log mandaba location.href). En su lugar, un <iframe> directo a la página «mural» que arma
 * el loader, aislado con sandbox y sin Referer. isNewTab=true a propósito: sin el loader no hay ventana encima del
 * portal, así que «reservar» abre la disponibilidad de OpenTable en otra pestaña.
 * Siempre https://www.opentable.com (lo único que permite frame-src en _headers); parámetros con URLSearchParams: nada
 * del socio (ni su token, ni su nombre, ni su teléfono) entra en la URL.
 */
export const OT_ORIGEN_DEFECTO = 'Club Satori'
export const OT_WIDGET_ORIGEN = 'https://www.opentable.com'
const OT_WIDGET_RUTA = '/widget/reservation/mural'
const OT_LANG = { es: 'es-MX', en: 'en-US' } as const
const RID_OK = /^\d{1,12}$/
// el origen que ve el dueño en OpenTable: letras, números, espacio, punto, guion y guion bajo (≤ 60)
const ORIGEN_OK = /^[\p{L}\p{N} ._-]{1,60}$/u

function origen(v: string | null): string {
  const x = (v ?? '').trim()
  return ORIGEN_OK.test(x) ? x : OT_ORIGEN_DEFECTO
}

export function urlWidgetOpenTable(reservaUrl: unknown, idioma: 'es' | 'en'): string | null {
  const local = urlReservaLocal(reservaUrl)
  let rid: string = OPENTABLE_RID
  let src = OT_ORIGEN_DEFECTO
  let camp = OT_ORIGEN_DEFECTO
  if (local) {
    const q = new URL(local).searchParams
    rid = (q.get('restref') ?? q.get('rid') ?? '').trim()
    src = origen(q.get('ot_source'))
    camp = origen(q.get('ot_campaign'))
  }
  if (!RID_OK.test(rid)) return null
  const p = new URLSearchParams([
    ['colorThemeId', '1'], ['isDarkMode', 'false'], ['domain', 'com'], ['isIframe', 'true'],
    ['lang', OT_LANG[idioma] ?? OT_LANG.es], ['isNewTab', 'true'], ['otCampaign', camp], ['otSource', src],
    ['restaurantIds', rid], ['type', 'standard'], ['font', 'BrandonText'], ['primaryColor', 'ffffff'],
    ['primaryFontColor', '333333'], ['buttonColor', 'da3743'], ['buttonFontColor', 'ffffff'], ['logoPid', '0'],
    ['backgroundPid', '0'], ['demo', 'false'], ['otLogo', 'standard'], ['loadAllWidgets', 'false'], ['theme', 'standard'],
  ])
  // URLSearchParams escribe el espacio como «+»; OpenTable lo genera como %20 («Club%20Satori»). Un «+» real ya viene %2B.
  const url = `${OT_WIDGET_ORIGEN}${OT_WIDGET_RUTA}?${p.toString().replace(/\+/g, '%20')}`
  return new URL(url).origin === OT_WIDGET_ORIGEN ? url : null
}

export interface TextosReservar { titulo: string; txt: string; boton: string; abrir: string; falla: string; marco: string }

/** Cuánto se espera a que cargue el iframe del widget antes de avisar que use el link. */
export const WIDGET_ESPERA_MS = 10000
/** El sandbox del iframe: scripts y formularios de OpenTable en SU origen; popups para «reservar» (isNewTab). Sin top-navigation. */
export const WIDGET_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

/**
 * La tarjeta «Reservar una mesa» de «Mi Club». Con `widgetSrc`: el widget de OpenTable en un <iframe> (224×301, el tamaño
 * del widget «standard») y debajo un link chico «Abrir en OpenTable» con el link tal cual, por si el widget no carga; si
 * el iframe no termina de cargar en WIDGET_ESPERA_MS, aparece el aviso para usar el link. Sin `widgetSrc`: el link con
 * forma de botón. Sin link válido, no hay tarjeta (null). DOM sin innerHTML.
 */
export function tarjetaReservar(x: TextosReservar, url: string | null = urlReservaOpenTable(), widgetSrc: string | null = null): HTMLElement | null {
  if (!url) return null
  const box = document.createElement('div')
  box.className = 'avance reservar'
  const h3 = document.createElement('h3'); h3.textContent = x.titulo
  const p = document.createElement('p'); p.className = 'sub'; p.textContent = x.txt
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  if (!widgetSrc || !widgetSrc.startsWith(OT_WIDGET_ORIGEN + OT_WIDGET_RUTA + '?')) {
    a.className = 'btn'
    a.textContent = x.boton
    box.append(h3, p, a)
    return box
  }
  a.className = 'reservar-abrir'
  a.textContent = x.abrir
  const widget = document.createElement('div')
  widget.className = 'reservar-widget'
  const aviso = document.createElement('p')
  aviso.className = 'sub reservar-falla'
  aviso.textContent = x.falla
  aviso.hidden = true
  const f = document.createElement('iframe')
  f.src = widgetSrc
  f.title = x.marco
  f.width = '224'
  f.height = '301'
  f.setAttribute('loading', 'lazy')
  f.setAttribute('referrerpolicy', 'no-referrer')
  f.setAttribute('sandbox', WIDGET_SANDBOX)
  f.setAttribute('scrolling', 'no')
  let cargo = false
  f.addEventListener('load', () => { cargo = true; aviso.hidden = true })
  f.addEventListener('error', () => { aviso.hidden = false })
  widget.append(f)
  setTimeout(() => { if (!cargo) aviso.hidden = false }, WIDGET_ESPERA_MS)
  const pie = document.createElement('p'); pie.className = 'sub'; pie.append(a)
  box.append(h3, p, widget, aviso, pie)
  return box
}
