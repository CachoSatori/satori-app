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
// cambia el texto aceptado (y su huella). (14-nov, D6 A firmada) Suma edad (solo mayores de 18) y el cumpleaños opcional
// con permiso, en ES y EN: cambian las dos huellas y sigue siendo v1.2 (todavía no salió a prod). Migración 159 (origen 101).
// Quien aceptó v1.1 queda con v1.1 en su fila.
export const AVISO_PRIVACIDAD_VERSION = 'v1.2'
// (09-nov, B8) Huella sha256 del texto COMPLETO del aviso (alta_aviso, UTF-8) por idioma, para esta versión. La base
// guarda las mismas en club_avisos_privacidad: cambiar una coma del texto sin subir la versión hace fallar aviso.test.ts.
export const AVISO_PRIVACIDAD_SHA256 = {
  es: '755d3ac1c19bf0d679f6e7844bcf950aec4803abd2098616d0c2b6b897e256dc',
  en: 'a83ec65f5cc5eecb1a9d9a1c59c13af9b222110931c01d0b873c990404a306cf',
} as const

/** Turnstile: clave pública del sitio. Sin VITE_TURNSTILE_SITEKEY, la clave de PRUEBA de Cloudflare (siempre pasa). */
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY || '1x00000000000000000000AA'

/**
 * B2: muestra «Agregar a Google Wallet» solo con VITE_WALLET_GOOGLE=1 en el build (apagado hasta que el Edge
 * `club-pase` esté desplegado con sus secretos).
 */
export const WALLET_GOOGLE_ACTIVO: boolean = import.meta.env.VITE_WALLET_GOOGLE === '1'
