// (13-nov) Fecha de factura leída por la IA: Costa Rica escribe DÍA/MES/AÑO, y la IA a veces la lee al revés
// («9/11/2026» → 2026-09-11 en vez de 2026-11-09). Esta capa es determinística y corre en el cliente, después de la IA:
//  a) si hay clave FE de 50 dígitos, la fecha de emisión está en la clave (posiciones 4–9 = DDMMAA) y manda;
//  b) sin clave, una fecha ambigua (día y mes ≤ 12 y distintos) se invierte si la leída queda en el futuro o a más de
//     VENTANA_DIAS en el pasado mientras la invertida cae dentro de la ventana; se avisa;
//  c) una fecha de factura en el futuro nunca queda sin aviso.
// `hoy` es siempre la fecha de Costa Rica (todayCR()) en YYYY-MM-DD; acá no se lee el reloj.

export const VENTANA_DIAS = 60
export const MSG_FECHA_INVERTIDA = 'Revisá la fecha: la leímos como D/M.'
export const MSG_FECHA_FUTURA = 'Revisá la fecha: queda en el futuro.'

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

// ¿Es una fecha real (YYYY-MM-DD)? 2026-02-30 no lo es.
export function esFechaValida(iso: string | null | undefined): iso is string {
  const m = ISO.exec(String(iso ?? ''))
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// Días de `a` a `b` (b − a), contando días de calendario.
function dias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

// Fecha de emisión de una clave FE de Hacienda: 506 + DDMMAA + … (50 dígitos). null si no hay clave o no da fecha real.
export function fechaDeClaveFE(clave: string | null | undefined): string | null {
  const dig = String(clave ?? '').replace(/\D/g, '')
  if (dig.length !== 50) return null
  const dd = dig.slice(3, 5), mm = dig.slice(5, 7), aa = dig.slice(7, 9)
  const iso = `20${aa}-${mm}-${dd}`
  return esFechaValida(iso) ? iso : null
}

// La misma fecha con día y mes intercambiados, solo si es ambigua (ambos ≤ 12 y distintos). Si no, null.
export function invertirDiaMes(iso: string): string | null {
  const m = ISO.exec(iso)
  if (!m) return null
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])]
  if (mo > 12 || d > 12 || mo === d) return null
  const inv = `${y}-${String(d).padStart(2, '0')}-${String(mo).padStart(2, '0')}`
  return esFechaValida(inv) ? inv : null
}

export interface FechaNormalizada {
  fecha: string | null
  origen: 'clave' | 'invertida' | 'ia' | 'ninguna'
  aviso: string | null
}

export function normalizarFechaFactura(
  fechaIA: string | null | undefined, claveFe: string | null | undefined, hoy: string,
): FechaNormalizada {
  const deClave = fechaDeClaveFE(claveFe)
  if (deClave) return { fecha: deClave, origen: 'clave', aviso: avisoFechaFactura(deClave, hoy) }

  const leida = esFechaValida(fechaIA) ? fechaIA : null
  if (!leida) return { fecha: null, origen: 'ninguna', aviso: null }

  const inv = invertirDiaMes(leida)
  if (inv) {
    const dLeida = dias(leida, hoy)           // > 0: en el pasado; < 0: en el futuro
    const dInv = dias(inv, hoy)
    const invEnVentana = dInv >= 0 && dInv <= VENTANA_DIAS
    const futura = dLeida < 0
    if ((futura && dInv >= 0) || (dLeida > VENTANA_DIAS && invEnVentana)) {
      return { fecha: inv, origen: 'invertida', aviso: MSG_FECHA_INVERTIDA }
    }
  }
  return { fecha: leida, origen: 'ia', aviso: avisoFechaFactura(leida, hoy) }
}

// Aviso para una fecha de factura cualquiera (también la que escribe el usuario): solo si queda en el futuro.
export function avisoFechaFactura(fecha: string | null | undefined, hoy: string): string | null {
  return esFechaValida(fecha) && fecha > hoy ? MSG_FECHA_FUTURA : null
}
