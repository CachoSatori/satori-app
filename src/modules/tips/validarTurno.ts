// ── Validación del turno de propinas antes de cerrar o de guardar una edición (fuera de sagrados) ──
//
// Módulo PURO. calcTurno (sagrado) no valida su entrada; estas reglas frenan en la pantalla lo que la
// medición del 08-nov mostró que podía pasar (o pasó: el 11-jun un pozo de ₡8.900 quedó sin repartir
// porque nadie sumaba puntos). No cambia ningún cálculo: si pasa la validación, todo sigue igual.

export interface LineaTurno {
  nombre:       string
  activa:       boolean
  hours:        number | string | ''
  propina_crc?: number | string | ''
  propina_usd?: number | string | ''
}

export interface DatosTurno {
  lineas:        readonly LineaTurno[]
  efectivoCRC:   number | string | ''
  efectivoUSD:   number | string | ''
  barraCRC:      number | string | ''
  barraElecCRC:  number | string | ''
  exchangeRate:  number | string | null | undefined
  /** Del cálculo (calcTurno): pozo total y puntos totales. */
  totalPool:     number
  totalPoints:   number
}

const vacio = (v: unknown) => v === '' || v === null || v === undefined
const num = (v: unknown): number => (vacio(v) ? 0 : Number(v))

/** Primer problema encontrado, en palabras para el cajero/encargado; null = se puede cerrar. */
export function validarTurno(d: DatosTurno): string | null {
  const montos: [string, unknown][] = [
    ['Efectivo ₡ del pozo', d.efectivoCRC], ['Efectivo $ del pozo', d.efectivoUSD],
    ['Barra efectivo', d.barraCRC], ['Barra electrónico', d.barraElecCRC],
  ]
  for (const [que, v] of montos) {
    const n = num(v)
    if (!Number.isFinite(n)) return `${que}: no es un número válido.`
    if (n < 0) return `${que}: no puede ser negativo.`
  }
  let hayDolares = num(d.efectivoUSD) > 0
  for (const l of d.lineas.filter(x => x.activa)) {
    const h = num(l.hours)
    if (!Number.isFinite(h)) return `${l.nombre}: las horas no son un número válido.`
    if (h < 0) return `${l.nombre}: las horas no pueden ser negativas.`
    for (const [que, v] of [['propina ₡', l.propina_crc], ['propina $', l.propina_usd]] as const) {
      const n = num(v)
      if (!Number.isFinite(n)) return `${l.nombre}: la ${que} no es un número válido.`
      if (n < 0) return `${l.nombre}: la ${que} no puede ser negativa.`
    }
    if (num(l.propina_usd) > 0) hayDolares = true
  }
  const tc = Number(d.exchangeRate)
  if (hayDolares && !(Number.isFinite(tc) && tc > 0)) {
    return 'Hay dólares en el turno y el tipo de cambio no es válido: tiene que ser mayor que 0.'
  }
  if (!Number.isFinite(d.totalPool) || !Number.isFinite(d.totalPoints)) {
    return 'El cálculo del turno no dio un número válido: revisá montos, horas y tipo de cambio.'
  }
  if (d.totalPool > 0 && d.totalPoints <= 0) {
    return 'El pozo tiene plata y nadie suma puntos (horas × puntos del rol = 0): nadie cobraría. ' +
      'Revisá las horas de cada persona o los puntos del rol antes de cerrar.'
  }
  return null
}
