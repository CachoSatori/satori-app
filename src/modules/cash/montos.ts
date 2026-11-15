// Lectura de un monto escrito a mano en un campo de texto (hallazgos 225/226 de la auditoría externa, 15-nov).
//
// Antes, CreditoModals limpiaba el texto con replace(/[^\d.]/g, ''): el punto pasaba y la coma se borraba, así que
// «12,345» se guardaba como 12345 y «12.345» como 12,345 (doce colones). Esta capa no adivina:
//  · UN solo separador decimal, punto o coma («12345.50» y «12345,50» → 12345.5), igual que el TC del cierre
//    (parseTipoCambio, #189), que se reutiliza para leer el número;
//  · hasta `maxDecimales` (2 por defecto: las columnas de plata son numeric(12,2) y redondearían en silencio). Con eso
//    «12.345» o «12,345» (¿miles o decimales?) no pasan: se pide escribir el monto sin separador de miles;
//  · sin signo: un monto negativo o con letras es un error con mensaje, nunca un número recortado;
//  · vacío → valor null y sin error (el formulario decide si es obligatorio).
import { parseTipoCambio } from './tipoCambio'

export interface MontoLeido {
  valor: number | null
  error: string | null
}

export const MSG_MONTO_NEGATIVO = 'El monto no puede ser negativo.'
export const MSG_MONTO_MILES = 'Escribí el monto sin separador de miles (por ejemplo 12345 o 12345,50).'
export const MSG_MONTO_INVALIDO = 'Escribí solo números (por ejemplo 12345 o 12345,50).'
export const msgMontoDecimales = (n: number) =>
  n === 0
    ? 'Este monto va en colones enteros, sin decimales ni separador de miles.'
    : `Hasta ${n} decimales y sin separador de miles (por ejemplo 12345 o 12345,50).`

export function parseMonto(txt: string | null | undefined, maxDecimales = 2): MontoLeido {
  const t = String(txt ?? '').trim()
  if (!t) return { valor: null, error: null }
  if (t.includes('-')) return { valor: null, error: MSG_MONTO_NEGATIVO }
  const n = parseTipoCambio(t)
  if (!Number.isFinite(n)) {
    // Más de un separador (1.234.567, 1.234,50…): casi siempre es separador de miles.
    if (/^[\d.,]+$/.test(t)) return { valor: null, error: MSG_MONTO_MILES }
    return { valor: null, error: MSG_MONTO_INVALIDO }
  }
  const dec = /[.,](\d+)$/.exec(t)?.[1].length ?? 0
  if (dec > maxDecimales) return { valor: null, error: msgMontoDecimales(maxDecimales) }
  return { valor: n, error: null }
}
