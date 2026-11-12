import { clubUrlValida, ERROR_SIN_CLUB_URL } from './clubUrl'

/**
 * LC-ML: el local del cupón (nombre, dirección y mapa) sale de `club_config` vía la API; acá solo queda la marca, para
 * cuando no hay señal. Ningún local escrito en el código.
 */
export const LOCAL = { nombre: 'Satori Sushi Bar' }

/**
 * (08-nov noche) Dominio público del Club: sale de la variable de build `VITE_CLUB_URL` (https://…, sin barra final) para
 * poder cambiarlo sin tocar el código. Ningún dominio escrito acá. Los QR y links que arma club-web usan este valor.
 * (09-nov, auditoría) En PRODUCCIÓN, sin la variable (o mal formada) el sitio NO arranca: tira un error en vez de usar el
 * origen donde corre (un QR con el dominio equivocado es peor que un sitio caído). El build de producción también se
 * frena antes (vite.config.ts). En desarrollo y en las pruebas, sin la variable, el origen.
 */
export function normalizarClubUrl(env: string | undefined, origen: string, produccion = false): string {
  const v = clubUrlValida(env)
  if (v) return v
  if (produccion) throw new Error(ERROR_SIN_CLUB_URL)
  return origen
}
export const CLUB_URL: string = normalizarClubUrl(
  import.meta.env.VITE_CLUB_URL,
  typeof location !== 'undefined' ? location.origin : '',
  import.meta.env.PROD,
)

/**
 * LC-DES-07: versión del aviso de privacidad que acepta el socio en la autoalta. TIENE que ser igual a
 * `club_config.aviso_privacidad_version`; si no, la base rechaza el alta (así nadie acepta un aviso viejo).
 * Al cambiar el texto del aviso (i18n: alta_aviso), se sube acá y en la base el mismo día.
 */
// v1.1 (08-nov noche): «Qué datos guardamos» suma el email (el cupón y el alta en caja lo piden). Cambia lo aceptado
// (una categoría de datos más): versión nueva, no aclaración. Quien aceptó v1 queda con v1 en su fila.
// v1.2 (12-nov, pedido del dueño): el texto en español pasa de «vos» a «usted», con el mismo sentido. Versión nueva porque
// cambia el texto aceptado (y su huella); el inglés es el mismo de v1.1. Quien aceptó v1.1 queda con v1.1 en su fila.
export const AVISO_PRIVACIDAD_VERSION = 'v1.2'
// (09-nov, B8) Huella sha256 del texto COMPLETO del aviso (alta_aviso, UTF-8) por idioma, para esta versión. La base
// guarda las mismas en club_avisos_privacidad: cambiar una coma del texto sin subir la versión hace fallar aviso.test.ts.
export const AVISO_PRIVACIDAD_SHA256 = {
  es: '661a25dd310346231d49429c7bf216c3bc84d5670bd107d35ae638028a607df7',
  en: '748b783881f21370e3238517996a2a47780b0c7a18c597ecc7528a56018fddf7',
} as const

/** Turnstile: clave pública del sitio. Sin VITE_TURNSTILE_SITEKEY, la clave de PRUEBA de Cloudflare (siempre pasa). */
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY || '1x00000000000000000000AA'
