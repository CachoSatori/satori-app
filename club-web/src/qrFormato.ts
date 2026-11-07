/**
 * Formato de los QR del Club. ⚠️ Copia de src/modules/club/qrFormato.ts (rama F1c):
 * tiene que coincidir con esa y con `club_resolver` (mig 075). Al juntar las ramas,
 * importar desde allá y borrar esta copia.
 */
export const CLUB_BASE_URL = 'https://club.satoricostarica.com'
export const urlReferente = (codigo: string) => `${CLUB_BASE_URL}/r/${codigo}`
export const urlCupon     = (codigo: string) => `${CLUB_BASE_URL}/c/${codigo}`
export const urlPortal    = (token: string)  => `${CLUB_BASE_URL}/p/${token}`
export const urlCanje     = (codigo: string) => `${CLUB_BASE_URL}/k/${codigo}`   // R-01: código de canje (10 min)
export const urlSocio     = (codigo: string) => `${CLUB_BASE_URL}/s/${codigo}`   // LC-A1: QR fijo del socio (solo identifica)
