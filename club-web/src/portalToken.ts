/**
 * Revisión de seguridad #214, hallazgo 2 (privacidad): el link del portal (/p/{token}) es una llave. Apenas carga, se saca
 * de la barra de direcciones (history.replaceState a /p/, el mismo patrón que /b/ de la baja del turista) para que no
 * quede a la vista, en el historial ni al copiar la barra. A diferencia de /b/, el portal se recorre (idioma, pestañas) y
 * se recarga: el token queda en memoria y en sessionStorage de ESTA pestaña (se borra al cerrarla; ningún script de
 * terceros corre en el origen del Club). Recargar /p/ en la misma pestaña vuelve al portal; en otra pestaña, /p/ sin token
 * muestra el inicio (el socio vuelve a entrar por su link de WhatsApp).
 */
export const CLAVE_TOKEN_PORTAL = 'club.portal'

export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface Historial { replaceState(data: unknown, unused: string, url?: string | URL | null): void }

/** (16-nov) Mismo cuidado para /w/{token}, el botón «Canjear» del pase de Wallet: su token también es una llave. */
export const CLAVE_TOKEN_PASE = 'club.pase'

/** El token de /{prefijo}/{token}: lo saca de la barra (replaceState a /{prefijo}/) y lo guarda en memoria y en el
 *  almacén de esta pestaña; en /{prefijo}/ (después de limpiar, al cambiar de idioma o al recargar) lo devuelve de ahí. */
export function crearTokenRuta(prefijo: 'p' | 'w', clave: string, almacen: () => Almacen | null) {
  let enMemoria: string | null = null
  const conToken = new RegExp(`^/${prefijo}/([^/]+)/?$`)
  const sinToken = new RegExp(`^/${prefijo}/?$`)
  /** El token para esta ruta (o null si no es la ruta). Si viene en la ruta, la limpia. */
  return function token(pathname: string, historial: Historial): string | null {
    const m = pathname.match(conToken)
    if (m) {
      const tok = m[1].toLowerCase()
      enMemoria = tok
      try { almacen()?.setItem(clave, tok) } catch { /* sin storage: queda en memoria */ }
      historial.replaceState(null, '', `/${prefijo}/`)
      return tok
    }
    if (!sinToken.test(pathname)) return null
    if (enMemoria) return enMemoria
    try { enMemoria = almacen()?.getItem(clave) || null } catch { enMemoria = null }
    return enMemoria
  }
}

export const crearTokenPortal = (almacen: () => Almacen | null) => crearTokenRuta('p', CLAVE_TOKEN_PORTAL, almacen)
export const crearTokenPase = (almacen: () => Almacen | null) => crearTokenRuta('w', CLAVE_TOKEN_PASE, almacen)
