/**
 * Formato de los QR del Club Satori. Fuente única: lo usan la caja (F1c) y la
 * página pública del cupón y el portal (F1d). El SQL de `club_resolver` (mig 075)
 * reconoce exactamente estos formatos, o el código solo.
 *
 *   referente: https://club.satoricostarica.com/r/{codigo8}
 *   cupón:     https://club.satoricostarica.com/c/{codigo10}
 *   portal:    https://club.satoricostarica.com/p/{token64}   (link del referente, solo lectura)
 *   canje:     https://club.satoricostarica.com/k/{codigo6}   (R-01: código de canje del portal, 10 min, un uso)
 *   socio:     https://club.satoricostarica.com/s/{codigo9}   (Local Club: QR fijo del socio; solo identifica)
 */
export const CLUB_BASE_URL = 'https://club.satoricostarica.com'

/** Alfabeto sin ambigüedad (sin 0/O ni 1/I), igual que `club_gen_codigo`. */
export const CLUB_ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const LARGO_CODIGO_REFERENTE = 8
export const LARGO_CODIGO_CUPON = 10
export const LARGO_CODIGO_CANJE = 6
export const LARGO_CODIGO_SOCIO = 9

export const urlReferente = (codigo: string) => `${CLUB_BASE_URL}/r/${codigo}`
export const urlCupon     = (codigo: string) => `${CLUB_BASE_URL}/c/${codigo}`
export const urlPortal    = (token: string)  => `${CLUB_BASE_URL}/p/${token}`
export const urlCanje     = (codigo: string) => `${CLUB_BASE_URL}/k/${codigo}`
export const urlSocio     = (codigo: string) => `${CLUB_BASE_URL}/s/${codigo}`

export type TipoQR = 'referente' | 'cupon' | 'canje' | 'socio' | 'desconocido'

const RE_URL = /^https?:\/\/club\.satoricostarica\.com\/([rcks])\/([A-Za-z0-9]+)\/?$/i
const RE_COD = /^[A-HJ-NP-Z2-9]+$/

/**
 * Interpretación local (sin red) de lo leído: sirve para validar antes de llamar
 * a `club_resolver`, que es quien decide. Acepta URL completa o código solo.
 */
export function parsearQR(texto: string): { tipo: TipoQR; codigo: string | null } {
  const t = (texto ?? '').trim()
  const m = t.match(RE_URL)
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
