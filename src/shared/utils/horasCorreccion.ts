// Salarios · Capa 2: corregir un fichaje incompleto por RESTA, no escribiendo horas.
//
// El caso típico es el de alguien que marcó UNA sola vez en el día (entró y se olvidó de
// salir, o al revés). BioTime igual etiqueta esa marca como `in` o `out`, y se equivoca
// seguido: quien ficha una vez sola suele quedar etiquetado como entrada aunque la marca
// sea la salida. Por eso la pantalla muestra la hora REAL —que sí es dato del reloj— y
// deja corregir de qué lado va, más la mitad que falta. Las horas salen de la resta, no
// de que alguien las estime.
//
// Todo en hora local de Costa Rica, que es UTC−6 FIJO (no hay horario de verano), así que
// restar minutos de reloj no tiene bordes raros.

/** "HH:MM" en 24 h. Rechaza "9:00", "24:00", "12:60" y cualquier cosa que no sea eso. */
const RELOJ = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Horas por encima de las cuales el resultado es SOSPECHOSO y la pantalla avisa. No
 * bloquea: un turno largo de verdad existe, y frenar el guardado obligaría a inventar un
 * número más chico. Es una bandera para que alguien mire, no un tope.
 */
export const HORAS_SOSPECHOSAS = 16

export function esHoraReloj(v: string): boolean {
  return RELOJ.test(v)
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Horas decimales entre dos marcas de reloj. `null` si alguna no es "HH:MM" válida.
 *
 * Si la salida no es POSTERIOR a la entrada se asume cruce de medianoche y se suman 24 h:
 * el turno que entra 18:00 y sale 02:00 dura 8 h, no −16. Incluye el caso entrada ==
 * salida, que da 24 h — es absurdo, pero es lo que dijo quien lo cargó, y para eso está
 * el aviso de HORAS_SOSPECHOSAS: preferimos mostrar el número raro a inventar uno lindo.
 */
export function horasEntreMarcas(entrada: string, salida: string): number | null {
  if (!RELOJ.test(entrada) || !RELOJ.test(salida)) return null
  let diff = aMinutos(salida) - aMinutos(entrada)
  if (diff <= 0) diff += 24 * 60
  return Math.round((diff / 60) * 100) / 100
}

/**
 * El rastro que queda en `work_days.flags.override.motivo`. Deja escrito qué mitad la
 * puso el reloj y cuál una persona, que es lo único que el contador va a necesitar para
 * entender el número dentro de seis meses.
 */
export function motivoCorreccion(
  entrada: string,
  salida: string,
  ladoReal: 'in' | 'out',
  horaReal: string,
): string {
  const etiqueta = ladoReal === 'in' ? 'entrada' : 'salida'
  return `entró ${entrada} → salió ${salida} (marca real: ${etiqueta} ${horaReal}, mitad completada a mano)`
}

// ── ¿Este caso se puede corregir por resta? ──────────────────────────────────────

export interface MarcaCruda {
  id:          string
  punch_at:    string
  punch_state: 'in' | 'out'
}

/**
 * La ÚNICA marca de un impar de una sola marca, o `null` si el caso no aplica.
 *
 * Sale de `detalle.marcas`, que la mig 059 ya escribió al derivar (id + punch_at +
 * punch_state por cada marca suelta): no hace falta ir a buscar nada a la base.
 *
 * Solo el `impar` de UNA marca se puede corregir por resta, porque es el único donde no
 * hay ambigüedad sobre qué mitad falta. Multi-marca, `solapado`, `turno_largo` y
 * `sin_mapear` siguen con la carga numérica a mano: ahí hace falta criterio, no una resta.
 */
export function marcaUnicaDeImpar(x: {
  tipo:        string
  employee_id: string | null
  work_date:   string | null
  detalle:     Record<string, unknown> | null
}): MarcaCruda | null {
  if (x.tipo !== 'impar' || !x.employee_id || !x.work_date) return null
  const marcas = (x.detalle as { marcas?: unknown } | null)?.marcas
  if (!Array.isArray(marcas) || marcas.length !== 1) return null
  const m = marcas[0] as Partial<MarcaCruda>
  if (typeof m?.punch_at !== 'string') return null
  if (m.punch_state !== 'in' && m.punch_state !== 'out') return null
  return { id: String(m.id ?? ''), punch_at: m.punch_at, punch_state: m.punch_state }
}
