/**
 * D1 (14-nov, el dueño) · Alta de socio en caja: al terminar, el enlace «Mandarle su link por WhatsApp ↗».
 *
 * Mismo mecanismo que el aviso de canje (`avisoCanje`: un `https://wa.me/<tel>?text=…` que abre WhatsApp con el
 * texto armado; lo manda el cajero a mano) y el mismo link que «⎘ Link del portal» de Miembros
 * (`urlPortal(await tokenPortal(id))`). `club_miembro_token` (mig 150) es solo para owner y manager: al cajero no
 * se le muestra el enlace (la base se lo negaría) y el link lo manda un manager desde Miembros.
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

/** `https://wa.me/<número internacional>?text=…`, o `null` si el WhatsApp cargado no tiene dígitos. */
export function linkAltaWhatsApp(tel: string, nombre: string, urlPortal: string): string | null {
  const n = waNumber(tel)
  if (!n) return null
  return `https://wa.me/${n}?text=${encodeURIComponent(textoAltaWhatsApp(nombre, urlPortal))}`
}

/** Solo owner y manager pueden pedir el token del portal (`club_miembro_token`, mig 150). */
export const puedeMandarLinkPortal = (rol: string | null | undefined) => rol === 'owner' || rol === 'manager'
