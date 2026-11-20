// REGLA (dueño, 14-nov): la fecha del MOVIMIENTO de caja es el día en que se registró (el turno, o el día de la caja si
// es un movimiento a nivel día), NUNCA la fecha de la factura. La fecha de la factura es un dato aparte (va a la
// descripción como «fact AAAA-MM-DD»): los proveedores suelen facturar el día del pedido y entregar 1–3 días después.
// Nada de este archivo decide en qué día cae un movimiento: solo limpia y revisa la fecha de la factura.
//
// (13-nov) Fecha de factura leída por la IA: Costa Rica escribe DÍA/MES/AÑO, y la IA a veces la lee al revés
// («9/11/2026» → 2026-09-11 en vez de 2026-11-09). Esta capa es determinística y corre en el cliente, después de la IA:
//  a) si hay clave FE de 50 dígitos, la fecha de emisión está en la clave (posiciones 4–9 = DDMMAA) y manda; (15-nov)
//     si la fecha impresa difiere, se avisa con las dos («La clave dice … y la factura dice …») y el usuario la
//     puede corregir: nunca se pisa una con otra en silencio;
//  b) (14-nov) sin clave, una fecha ambigua (día y mes ≤ 12 y distintos) se analiza con el calendario: una lectura es
//     POSIBLE si no queda en el futuro y tiene a lo sumo VENTANA_DIAS. Si solo una es posible, se toma esa (con aviso
//     si es la invertida). Si las dos son posibles —o ninguna, pero las dos quedan en el pasado— la app no adivina:
//     origen 'ambigua', sin fecha, y la pantalla pregunta «¿9 de noviembre o 11 de septiembre?» (la más cercana a hoy
//     primero) y no deja guardar hasta que el usuario elija o escriba la fecha. Si las dos son futuras, queda la leída
//     con el aviso de futuro;
//  c) una fecha de factura en el futuro nunca queda sin aviso;
//  d) (14-nov) una factura de más de DIAS_FACTURA_VIEJA días avisa «Factura de hace X días: revisá la fecha.» (no bloquea:
//     es raro pagar en caja una factura física tan vieja).
// `hoy` es siempre la fecha de Costa Rica (todayCR()) en YYYY-MM-DD; acá no se lee el reloj.

// Antigüedad máxima con la que una lectura ambigua se considera posible. Sigue en 60 (14-nov): con la elección por
// cercanía ya no decide QUÉ lectura se toma cuando las dos son recientes (eso lo decide el usuario), solo cuándo una
// lectura queda descartada por vieja. 60 días cubre los proveedores a crédito (ciclos de 30 días + atraso); bajarla
// haría que la app elija sola en casos en que la otra lectura es real; subirla haría preguntar más seguido.
export const VENTANA_DIAS = 60
// (14-nov, decisión a validar por el dueño) A partir de cuántos días la fecha de factura se marca como vieja.
// Los proveedores entregan 1–3 días después de facturar; una semana deja margen para fines de semana y feriados.
export const DIAS_FACTURA_VIEJA = 7
export const MSG_FECHA_INVERTIDA = 'Revisá la fecha: la leímos como D/M.'
export const MSG_FECHA_FUTURA = 'Revisá la fecha: queda en el futuro.'
// (15-nov) La fecha de emisión de la clave FE y la impresa (leída por la IA) no coinciden.
export const msgClaveDistinta = (deClave: string, leida: string, hoy: string) =>
  `La clave dice ${fechaLarga(deClave, hoy)} y la factura dice ${fechaLarga(leida, hoy)}: revisá la fecha.`
export const msgFacturaVieja = (n: number) => `Factura de hace ${n} días: revisá la fecha.`

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre']

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

// «9 de noviembre» (con « de 2026» si el año no es el de hoy).
export function fechaLarga(iso: string, hoy: string): string {
  const m = ISO.exec(iso)
  if (!m) return iso
  const base = `${Number(m[3])} de ${MESES[Number(m[2]) - 1]}`
  return m[1] === hoy.slice(0, 4) ? base : `${base} de ${m[1]}`
}

// La pregunta que muestra la pantalla cuando la fecha es ambigua: «¿9 de noviembre o 11 de septiembre?».
export function preguntaFechaAmbigua(opciones: readonly [string, string], hoy: string): string {
  return `¿${fechaLarga(opciones[0], hoy)} o ${fechaLarga(opciones[1], hoy)}?`
}

export interface FechaNormalizada {
  fecha: string | null
  origen: 'clave' | 'invertida' | 'ia' | 'ninguna' | 'ambigua'
  aviso: string | null
  // Solo con origen 'ambigua': las dos lecturas, la más cercana a hoy primero.
  opciones?: [string, string]
}

export function normalizarFechaFactura(
  fechaIA: string | null | undefined, claveFe: string | null | undefined, hoy: string,
): FechaNormalizada {
  const deClave = fechaDeClaveFE(claveFe)
  const leida = esFechaValida(fechaIA) ? fechaIA : null
  if (deClave) {
    // (15-nov, hallazgo 228) La clave manda, pero no pisa en silencio la fecha impresa: si difieren, se avisa con las
    // dos. Si es la misma con día y mes al revés, es la lectura D/M de siempre (aviso corto de fecha invertida).
    let difiere: string | null = null
    if (leida && leida !== deClave) {
      difiere = invertirDiaMes(leida) === deClave ? MSG_FECHA_INVERTIDA : msgClaveDistinta(deClave, leida, hoy)
    }
    return { fecha: deClave, origen: 'clave', aviso: unirONull(difiere, avisoFechaFactura(deClave, hoy)) }
  }

  if (!leida) return { fecha: null, origen: 'ninguna', aviso: null }

  const inv = invertirDiaMes(leida)
  if (inv) {
    const dLeida = dias(leida, hoy)           // > 0: en el pasado; < 0: en el futuro
    const dInv = dias(inv, hoy)
    const posible = (d: number) => d >= 0 && d <= VENTANA_DIAS
    const pLeida = posible(dLeida), pInv = posible(dInv)
    if (pInv && !pLeida) {
      return { fecha: inv, origen: 'invertida', aviso: unir(MSG_FECHA_INVERTIDA, avisoFechaFactura(inv, hoy)) }
    }
    if (pLeida && !pInv && dInv >= 0) {
      // la invertida quedó vieja (y no futura): la leída es la única posible
      return { fecha: leida, origen: 'ia', aviso: avisoFechaFactura(leida, hoy) }
    }
    if (dLeida >= 0 && dInv >= 0 && pLeida === pInv) {
      // Las dos posibles, o las dos viejas: la app no adivina, pregunta (la más cercana a hoy primero).
      const opciones: [string, string] = dLeida <= dInv ? [leida, inv] : [inv, leida]
      return { fecha: null, origen: 'ambigua', aviso: preguntaFechaAmbigua(opciones, hoy), opciones }
    }
    if (dLeida < 0 && dInv >= 0) {
      // la leída es futura y la invertida no (aunque sea vieja): la invertida es la más cercana sin futuro
      return { fecha: inv, origen: 'invertida', aviso: unir(MSG_FECHA_INVERTIDA, avisoFechaFactura(inv, hoy)) }
    }
  }
  return { fecha: leida, origen: 'ia', aviso: avisoFechaFactura(leida, hoy) }
}

function unir(...avisos: (string | null)[]): string {
  return avisos.filter(Boolean).join(' ')
}

function unirONull(...avisos: (string | null)[]): string | null {
  return unir(...avisos) || null
}

// (20-nov) La fecha de factura de un movimiento, leída de su descripción («… · fact AAAA-MM-DD», como la escriben
// AgregarAsistente e InboxModule). Si hay más de una, manda la última (la que agregó la app al final). null si no hay o
// no es una fecha real: los movimientos anteriores al 14-nov no la tienen. No decide el día del movimiento (regla 11).
const FACT_EN_DESC = /·\s*fact\s+(\d{4}-\d{2}-\d{2})(?!\d)/g
export function fechaFacturaDeDescripcion(desc: string | null | undefined): string | null {
  const todas = [...String(desc ?? '').matchAll(FACT_EN_DESC)]
  const ult = todas.length ? todas[todas.length - 1][1] : null
  return esFechaValida(ult) ? ult : null
}

// Aviso para una fecha de factura cualquiera (también la que escribe el usuario): si queda en el futuro, o si tiene más
// de DIAS_FACTURA_VIEJA días. Nunca bloquea.
export function avisoFechaFactura(fecha: string | null | undefined, hoy: string): string | null {
  if (!esFechaValida(fecha)) return null
  if (fecha > hoy) return MSG_FECHA_FUTURA
  const n = dias(fecha, hoy)
  return n > DIAS_FACTURA_VIEJA ? msgFacturaVieja(n) : null
}
