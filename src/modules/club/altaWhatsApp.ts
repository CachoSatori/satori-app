/**
 * D1 (14-nov, el dueño) · Alta de socio en caja: al terminar, el enlace «Mandarle su link por WhatsApp ↗».
 *
 * Mismo mecanismo que el aviso de canje (`avisoCanje`: un `https://wa.me/<tel>?text=…` que abre WhatsApp con el
 * texto armado; lo manda el cajero a mano) y el mismo link que «⎘ Link del portal» de Miembros.
 *
 * Mig 156 (firma del dueño, 14-nov 06:04): `club_socio_alta_caja` devuelve `token_portal` del socio que ESA alta acaba
 * de crear, también al cajero. Si el número ya era de alguien (socio dado de baja que vuelve, anfitrión), viene null:
 * owner y manager lo piden con `club_miembro_token` (solo para ellos, mig 150); al cajero no se le muestra el enlace y
 * el link lo manda un manager desde Miembros.
 *
 * El texto lo lee el CLIENTE: va de «usted» (lo cuida `altaWhatsApp.test.ts` con la misma expresión que el pase).
 */
import { waNumber } from '../cash/comprobante'

/** Primer nombre, para el saludo («Ana María Pérez» → «Ana»). */
const nombrePila = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? ''

/** Texto del mensaje de bienvenida con el link del portal. */
export function textoAltaWhatsApp(nombre: string, urlPortal: string): string {
  const pila = nombrePila(nombre)
  return `${pila ? `Hola, ${pila}. ` : 'Hola. '}Le damos la bienvenida al Local Club de Satori. ` +
    `Este es su portal, con su QR de socio: ${urlPortal}\n` +
    'Guárdelo y muéstrelo en caja en cada visita.'
}

/**
 * Hallazgo 230 (D 16-nov, el dueño): el número como se lo lee el cajero al cliente antes de mandarle el link del portal.
 * CR (8 dígitos o 506 + 8): «+506 8888 0000». Otro país: «+<dígitos>» tal cual (no adivinamos su formato). Sin dígitos: ''.
 */
export function formatoWhatsApp(tel: string): string {
  const n = waNumber(tel)
  if (!n) return ''
  if (n.startsWith('506') && n.length === 11) return `+506 ${n.slice(3, 7)} ${n.slice(7)}`
  return `+${n}`
}

/**
 * `https://wa.me/<número internacional>?text=…`, o `null` si el WhatsApp cargado no tiene dígitos.
 * Hallazgo 230: el link del portal da acceso a la cuenta del socio, así que solo sale con el número CONFIRMADO con el
 * cliente («¿Este es su WhatsApp?» → «Sí, es este»). `telConfirmado` es el número que el cajero confirmó; si no hay
 * confirmación o no es el mismo número que se va a usar, no hay link.
 */
export function linkAltaWhatsApp(tel: string, nombre: string, urlPortal: string, telConfirmado: string | null): string | null {
  const n = waNumber(tel)
  if (!n || telConfirmado == null || waNumber(telConfirmado) !== n) return null
  return `https://wa.me/${n}?text=${encodeURIComponent(textoAltaWhatsApp(nombre, urlPortal))}`
}

/** Solo owner y manager pueden pedir el token de CUALQUIER miembro (`club_miembro_token`, mig 150). */
export const puedeMandarLinkPortal = (rol: string | null | undefined) => rol === 'owner' || rol === 'manager'

/**
 * Token para el link del alta: el que devolvió el alta (mig 156, también al cajero); si no vino, owner y manager lo
 * piden con `pedirToken`; el resto, null (sin pedir nada: la base se lo negaría).
 */
export async function tokenDelAlta(
  alta: { miembro_id: string; token_portal?: string | null },
  rol: string | null | undefined,
  pedirToken: (miembro: string) => Promise<string>,
): Promise<string | null> {
  if (alta.token_portal) return alta.token_portal
  if (puedeMandarLinkPortal(rol)) return pedirToken(alta.miembro_id)
  return null
}
