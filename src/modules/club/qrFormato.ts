/**
 * Formato de los QR del Club Satori. Fuente única: lo usan la caja (F1c) y la
 * página pública del cupón y el portal (F1d). El SQL de `club_resolver` (mig 075)
 * reconoce exactamente estos formatos, o el código solo.
 *
 *   referente: <club_url>/r/{codigo8}
 *   cupón:     <club_url>/c/{codigo10}
 *   portal:    <club_url>/p/{token64}   (link del referente, solo lectura)
 *   canje:     <club_url>/k/{codigo6}   (R-01: código de canje del portal, 10 min, un uso)
 *   socio:     <club_url>/s/{codigo9}   (Local Club: QR fijo del socio; solo identifica)
 *
 * (08-nov noche) `club_url` es CONFIGURACIÓN (`club_config_global.club_url`), no código: el módulo del Club la carga al
 * abrir (`configurarClubUrl`). Sin cargar, los links fallan con un aviso claro y la caja solo acepta códigos sueltos.
 */
const RE_CLUB_URL = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?$/i
let clubBase: string | null = null
let reUrl: RegExp | null = null
export function configurarClubUrl(url: string | null | undefined): void {
  const v = (url ?? '').trim().replace(/\/+$/, '')
  clubBase = RE_CLUB_URL.test(v) ? v.toLowerCase() : null
  reUrl = clubBase
    ? new RegExp(`^https?://${clubBase.replace(/^https:\/\//, '').replace(/[.]/g, '\\.')}/([rcks])/([A-Za-z0-9]+)/?$`, 'i')
    : null
}
export const MSG_SIN_DOMINIO = 'Falta el dominio del Club: el owner lo carga en la configuración (club_config_global.club_url).'
export function clubUrl(): string {
  if (!clubBase) throw new Error(MSG_SIN_DOMINIO)
  return clubBase
}

export const CLUB_ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const LARGO_CODIGO_REFERENTE = 8
export const LARGO_CODIGO_CUPON = 10
export const LARGO_CODIGO_CANJE = 6
export const LARGO_CODIGO_SOCIO = 9

export const urlReferente = (codigo: string) => `${clubUrl()}/r/${codigo}`
export const urlCupon     = (codigo: string) => `${clubUrl()}/c/${codigo}`
export const urlPortal    = (token: string)  => `${clubUrl()}/p/${token}`
export const urlCanje     = (codigo: string) => `${clubUrl()}/k/${codigo}`
export const urlSocio     = (codigo: string) => `${clubUrl()}/s/${codigo}`

export type TipoQR = 'referente' | 'cupon' | 'canje' | 'socio' | 'desconocido'

/**
 * (11-nov, modo transición) El QR ÚNICO de caja, pegado al lado de la caja: cuando llega un cliente con una tarjeta vieja
 * (de papel, sin QR), la caja lo escanea y se abre «Tarjeta vieja (sin QR)» (buscar al anfitrión → personas → pedido).
 * Es un texto FIJO, el mismo en todos los locales, y no es un link: escaneado con la cámara de un teléfono no abre nada.
 * NO da ningún permiso: es un atajo de pantalla. El permiso sigue siendo el usuario, su rol y `tarjeta_manual_activa`.
 * No pasa por `club_resolver` (no es un código del Club): lo reconoce la pantalla.
 */
export const QR_CAJA_TARJETA_VIEJA = 'SATORI-CAJA:TARJETA-VIEJA'
export const esQrCaja = (texto: string | null | undefined): boolean =>
  (texto ?? '').trim().toUpperCase() === QR_CAJA_TARJETA_VIEJA

const RE_COD = /^[A-HJ-NP-Z2-9]+$/

/**
 * Interpretación local (sin red) de lo leído: sirve para validar antes de llamar
 * a `club_resolver`, que es quien decide. Acepta URL completa o código solo.
 */
export function parsearQR(texto: string): { tipo: TipoQR; codigo: string | null } {
  const t = (texto ?? '').trim()
  const m = reUrl ? t.match(reUrl) : null
  let kind: 'r' | 'c' | 'k' | 's' | null
  let cod: string
  if (m) {
    kind = m[1].toLowerCase() as 'r' | 'c' | 'k' | 's'
    cod = m[2].toUpperCase()
  } else {
    cod = t.replace(/\s/g, '').toUpperCase()
    kind = cod.length === LARGO_CODIGO_REFERENTE ? 'r' : cod.length === LARGO_CODIGO_CUPON ? 'c'
         : cod.length === LARGO_CODIGO_CANJE ? 'k' : cod.length === LARGO_CODIGO_SOCIO ? 's' : null
  }
  if (kind === 'r' && cod.length === LARGO_CODIGO_REFERENTE && RE_COD.test(cod)) return { tipo: 'referente', codigo: cod }
  if (kind === 'c' && cod.length === LARGO_CODIGO_CUPON && RE_COD.test(cod)) return { tipo: 'cupon', codigo: cod }
  if (kind === 'k' && cod.length === LARGO_CODIGO_CANJE && RE_COD.test(cod)) return { tipo: 'canje', codigo: cod }
  if (kind === 's' && cod.length === LARGO_CODIGO_SOCIO && RE_COD.test(cod)) return { tipo: 'socio', codigo: cod }
  return { tipo: 'desconocido', codigo: null }
}
