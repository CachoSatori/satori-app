/**
 * (11-nov, modo transición; decisión del dueño) El link del anfitrión para mandar por WhatsApp.
 *
 * Los anfitriones de Airbnb hacen el check-in por WhatsApp: no tienen dónde mostrar un QR. El portal les da el MISMO destino
 * que su QR, como link: `<dominio>/r/<código>` (la página donde el huésped obtiene su cupón del 10 %). NUNCA el link del
 * portal (`/p/<token>`): ese es privado (saldo y canje).
 *
 * El mensaje va en el idioma del HUÉSPED, que no es el de la pantalla del anfitrión: por eso hay un botón por idioma y los
 * dos textos viven acá (aprobados por el dueño el 11-nov), no en i18n.ts.
 * LC-ML: ningún local escrito en el código. El lugar («Santa Teresa») sale de la API de locales: se nombra solo cuando hay
 * exactamente un local encendido; con dos o más, el cupón vale en cualquiera y el mensaje no nombra ninguno.
 */
export type IdiomaMensaje = 'es' | 'en'

/** El alfabeto de los códigos del Club (sin 0, 1, I, O): 8 caracteres para el anfitrión. */
const RE_CODIGO_ANFITRION = /^[A-HJ-NP-Z2-9]{8}$/

/** El link público del anfitrión (lo mismo que codifica su QR), o null si el código no tiene la forma esperada. */
export function linkAnfitrion(base: string, codigo: string): string | null {
  if (!RE_CODIGO_ANFITRION.test(codigo)) return null
  return `${base}/r/${codigo}`
}

/** El lugar que se nombra en el mensaje: el nombre del ÚNICO local encendido, o null. */
export function lugarDelMensaje(locales: ReadonlyArray<{ nombre: string }> | null | undefined): string | null {
  if (!locales || locales.length !== 1) return null
  const n = (locales[0].nombre ?? '').trim()
  return n && n.length <= 60 ? n : null
}

/** Texto listo para WhatsApp (aprobado por el dueño, 11-nov). `marca` = «Satori Sushi Bar»; `lugar` puede faltar. */
export function mensajeWhatsapp(idioma: IdiomaMensaje, marca: string, lugar: string | null, link: string): string {
  const donde = lugar ? `${marca} (${lugar})` : marca
  return idioma === 'es'
    ? `¡Bienvenidos! Con este link tienen 10 % de descuento en ${donde}. Ábranlo y muestren el cupón al pedir la cuenta: ${link}`
    : `Welcome! This link gets you 10% off at ${donde}. Open it and show the coupon when you ask for the bill: ${link}`
}

/** WhatsApp con el texto cargado y SIN destinatario: el anfitrión elige el chat del huésped. */
export const urlWhatsapp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`
