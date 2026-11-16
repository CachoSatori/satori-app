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

export function crearTokenPortal(almacen: () => Almacen | null) {
  let enMemoria: string | null = null
  /** El token del portal para esta ruta (o null si no es el portal). Si viene en la ruta, la limpia. */
  return function tokenPortal(pathname: string, historial: Historial): string | null {
    const m = pathname.match(/^\/p\/([^/]+)\/?$/)
    if (m) {
      const tok = m[1].toLowerCase()
      enMemoria = tok
      try { almacen()?.setItem(CLAVE_TOKEN_PORTAL, tok) } catch { /* sin storage: queda en memoria */ }
      historial.replaceState(null, '', '/p/')
      return tok
    }
    if (!/^\/p\/?$/.test(pathname)) return null
    if (enMemoria) return enMemoria
    try { enMemoria = almacen()?.getItem(CLAVE_TOKEN_PORTAL) || null } catch { enMemoria = null }
    return enMemoria
  }
}
