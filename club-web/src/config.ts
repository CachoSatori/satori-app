/**
 * LC-ML: el local del cupón (nombre, dirección y mapa) sale de `club_config` vía la API; acá solo queda la marca, para
 * cuando no hay señal. Ningún local escrito en el código.
 */
export const LOCAL = { nombre: 'Satori Sushi Bar' }

/**
 * LC-DES-07: versión del aviso de privacidad que acepta el socio en la autoalta. TIENE que ser igual a
 * `club_config.aviso_privacidad_version`; si no, la base rechaza el alta (así nadie acepta un aviso viejo).
 * Al cambiar el texto del aviso (i18n: alta_aviso), se sube acá y en la base el mismo día.
 */
export const AVISO_PRIVACIDAD_VERSION = 'v1'

/** Turnstile: clave pública del sitio. Sin VITE_TURNSTILE_SITEKEY, la clave de PRUEBA de Cloudflare (siempre pasa). */
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY || '1x00000000000000000000AA'

/**
 * B2: muestra «Agregar a Google Wallet» solo con VITE_WALLET_GOOGLE=1 en el build (apagado hasta que el Edge
 * `club-pase` esté desplegado con sus secretos).
 */
export const WALLET_GOOGLE_ACTIVO: boolean = import.meta.env.VITE_WALLET_GOOGLE === '1'
