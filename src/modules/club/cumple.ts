/**
 * Mig 173 (D-cumple-2, firmada por el dueño el 15-nov) · Beneficio de cumpleaños del Local Club.
 *
 *  · `textoCumpleWhatsApp` / `linkCumpleWhatsApp`: el saludo que owner o manager mandan desde el Inicio con «WhatsApp ↗»
 *    (mismo mecanismo que el alta: `https://wa.me/<tel>?text=…`, lo manda la persona a mano). Lo lee el CLIENTE: va de
 *    «usted» (lo cuida cumple.test.ts con la misma expresión que el pase). Incluye el beneficio vigente del local, sus
 *    condiciones y el link de reserva: así sirve para ofrecer otra cosa cambiando el texto en Club → Promociones.
 *  · `condicionesCumple` / `textoCumpleCaja`: lo que ve el cajero en Escanear. Pantalla del personal: voseo.
 * Las fechas son días de Costa Rica ('YYYY-MM-DD' que arma la base); se formatean sin pasar por la hora local.
 */
import { waNumber } from '../cash/comprobante'
import type { CumpleConfig, CumpleEnvio } from '../../shared/api/club'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']

/** '2027-01-02' → '2 de enero' (sin zona horaria: el día ya es de Costa Rica). */
export function diaMesTexto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]}`
}

/** Inicio: «hoy», «mañana» o «en N días». */
export const cuandoCumple = (faltan: number) => faltan <= 0 ? 'hoy' : faltan === 1 ? 'mañana' : `en ${faltan} días`

const nombrePila = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? ''

type Condiciones = Pick<CumpleConfig, 'min_personas' | 'uno_por_mesa' | 'solo_reserva'>

/** Condiciones para el cliente, en «usted»: «para mesas de 5 personas o más, uno por mesa y con reserva». */
export function condicionesCumple(c: Condiciones): string {
  const partes: string[] = []
  if (c.min_personas > 1) partes.push(`para mesas de ${c.min_personas} personas o más`)
  if (c.uno_por_mesa) partes.push('uno por mesa')
  if (c.solo_reserva) partes.push('con reserva')
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1]
}

/** El saludo de cumpleaños (WhatsApp), en «usted». `hoy` = día CR de hoy ('YYYY-MM-DD'), para no ofrecer días pasados. */
export function textoCumpleWhatsApp(e: CumpleEnvio, hoy: string): string {
  const pila = nombrePila(e.nombre)
  const cond = condicionesCumple(e)
  const desde = e.desde < hoy ? hoy : e.desde
  const vigencia = desde === e.hasta ? `el ${diaMesTexto(e.hasta)}` : `del ${diaMesTexto(desde)} al ${diaMesTexto(e.hasta)}`
  const lineas = [
    `${pila ? `Hola, ${pila}.` : 'Hola.'} ¡Feliz cumpleaños de parte de Satori!`,
    `Como socio del Local Club, le invitamos a celebrarlo con nosotros: ${e.beneficio}${cond ? ` ${cond}` : ''}. Vale ${vigencia}.`,
  ]
  if (e.reserva_url) lineas.push(`${e.solo_reserva ? 'Reserve aquí' : 'Puede reservar aquí'}: ${e.reserva_url}`)
  lineas.push('Muestre su QR de socio en caja.')
  return lineas.join('\n')
}

/** `https://wa.me/<número internacional>?text=…`, o `null` si el WhatsApp no tiene dígitos. */
export function linkCumpleWhatsApp(e: CumpleEnvio, hoy: string): string | null {
  const n = waNumber(e.whatsapp)
  if (!n) return null
  return `https://wa.me/${n}?text=${encodeURIComponent(textoCumpleWhatsApp(e, hoy))}`
}

/** Escanear: la línea para el cajero (voseo, como el resto de la caja). Sin artículo cargado, que no lo ofrezca. */
export function textoCumpleCaja(c: Condiciones & Pick<CumpleConfig, 'beneficio' | 'cortesia' | 'lista_para_caja'>): { titulo: string; detalle: string; ofrecer: boolean } {
  const reglas: string[] = []
  if (c.min_personas > 1) reglas.push(`mesa de ${c.min_personas} o más`)
  if (c.solo_reserva) reglas.push('con reserva')
  if (c.uno_por_mesa) reglas.push('uno por mesa')
  const titulo = `Cumpleaños del socio: ${c.beneficio}`
  if (!c.lista_para_caja || !c.cortesia) {
    return { titulo, ofrecer: false,
      detalle: 'NO lo ofrezcas: en este local no hay un artículo de cortesía activo para el cumpleaños. Avisale al owner o al manager.' }
  }
  return { titulo, ofrecer: true,
    detalle: `${reglas.length ? `Solo si: ${reglas.join(', ')}. ` : ''}Marcá el artículo ${c.cortesia.codigo} (${c.cortesia.nombre}) de «CORTESÍA CLUB».` }
}

const MAX_DIA = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const MESES_CORTOS = MESES

/**
 * Alta en caja (D-cumple-1 A): lo que eligió el cajero. Todo vacío y sin permiso = no lo dio (ok, null). Día y mes con
 * el permiso = ok. Cualquier mezcla (sin permiso, permiso sin fecha) = 'falta'; una fecha que no existe = 'invalido'.
 * La base valida lo mismo (club_socio_alta_caja_v3); esto solo evita el viaje.
 */
export function cumpleDelFormulario(dia: string, mes: string, permiso: boolean):
  { ok: true; cumple: { dia: number; mes: number } | null } | { ok: false; error: 'falta' | 'invalido' } {
  if (!dia && !mes && !permiso) return { ok: true, cumple: null }
  if (!dia || !mes || !permiso) return { ok: false, error: 'falta' }
  const d = Number(dia), m = Number(mes)
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1 || d > MAX_DIA[m - 1]) return { ok: false, error: 'invalido' }
  return { ok: true, cumple: { dia: d, mes: m } }
}
