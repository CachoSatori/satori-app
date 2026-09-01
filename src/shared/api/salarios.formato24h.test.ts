import { describe, it, expect, vi } from 'vitest'
import type { Employee } from '../types/database'

// `salarios.ts` importa el cliente real, que explota sin variables de entorno. Todo lo que
// se prueba acá es PURO: solo hace falta que el módulo cargue.
vi.mock('./supabase', () => ({ supabase: { from: () => ({}) } }))

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ FORMATO 24 h EN TODA LA NÓMINA (v3, fix del piloto)                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Toda hora de reloj del módulo —marcas de BioTime, horario habitual, la bandeja de
// fichajes, la Ficha— se escribe HH:MM en 24 horas. Nunca a.m./p.m.
//
// No es estética: un turno de nómina cruza la medianoche todas las noches. «2:00» sin el
// a.m./p.m., o con el a.m./p.m. leído rápido, es la diferencia entre una salida de
// madrugada y una entrada de tarde — entre 8 horas y −6.
//
// Estas pruebas recorren TODAS las salidas de hora del módulo con las horas que más se
// prestan a confusión (mediodía, medianoche, la tarde y la madrugada). Si alguien mete un
// `toLocaleTimeString` —que con `es-CR` devuelve el reloj de 12 h— alguna se pone roja.

import { hhmm24, hhmmCR, horaHabitualHHMM, horarioHabitualTexto, horarioResumen, motivoRegla } from './salarios'

/**
 * Nada de a.m./p.m., ni en español ni en inglés, ni con puntos ni sin ellos. El marcador
 * de 12 h siempre viene PEGADO a un número («04:00 p. m.», «4 pm»); sin el dígito adelante
 * el patrón matchearía dentro de cualquier palabra («c-am-bios»).
 */
const SIN_12H = /\d\s*(a\.?\s?m\.?|p\.?\s?m\.?)\b/i
const ES_24H  = /^([01]\d|2[0-3]):[0-5]\d$/

const emp = (e: string | null, s: string | null): Employee =>
  ({ hora_entrada_habitual: e, hora_salida_habitual: s } as Employee)

describe('hhmm24 · la única salida de hora del módulo', () => {
  it('siempre HH:MM con el cero adelante', () => {
    expect(hhmm24(2, 3)).toBe('02:03')
    expect(hhmm24(0, 0)).toBe('00:00')
    expect(hhmm24(23, 59)).toBe('23:59')
  })

  it('la tarde va en 24 h: las 4 de la tarde son 16:00, no 04:00', () => {
    expect(hhmm24(16, 0)).toBe('16:00')
    expect(hhmm24(16, 0)).not.toBe('04:00')
  })
})

describe('marcas de BioTime · hhmmCR', () => {
  // Instantes en UTC; Costa Rica es UTC−6 fijo.
  const casos: [string, string][] = [
    ['2026-08-16T06:00:00Z', '00:00'],   // medianoche — NO 12:00
    ['2026-08-16T08:03:00Z', '02:03'],   // madrugada
    ['2026-08-16T17:05:00Z', '11:05'],   // mañana (Fran, 16/08)
    ['2026-08-16T18:00:00Z', '12:00'],   // mediodía — NO 00:00
    ['2026-08-16T22:08:00Z', '16:08'],   // tarde (Fran, 16/08) — NO 04:08
    ['2026-08-21T04:03:00Z', '22:03'],   // noche (Lester, 20/08) — NO 10:03
    ['2026-08-16T05:59:00Z', '23:59'],   // el último minuto del día
  ]

  it.each(casos)('%s → %s, en 24 h', (iso, esperado) => {
    const out = hhmmCR(iso)
    expect(out).toBe(esperado)
    expect(out).toMatch(ES_24H)
    expect(out).not.toMatch(SIN_12H)
  })
})

describe('horario habitual · horaHabitualHHMM', () => {
  it('la columna `time` sale en 24 h, con y sin segundos', () => {
    expect(horaHabitualHHMM('16:00:00')).toBe('16:00')
    expect(horaHabitualHHMM('16:00')).toBe('16:00')
    expect(horaHabitualHHMM('02:00:00')).toBe('02:00')
    expect(horaHabitualHHMM('00:00:00')).toBe('00:00')
    expect(horaHabitualHHMM('23:30:00.500')).toBe('23:30')
  })

  it('rechaza lo que no es una hora de reloj de 24 h', () => {
    // Una hora en 12 h («04:00 p. m.») no es un valor válido de esta columna: entra por
    // el `<input type="time">`, que siempre manda 24 h por más que el widget pinte otra cosa.
    expect(horaHabitualHHMM('04:00 p. m.')).toBeNull()
    expect(horaHabitualHHMM('24:00')).toBeNull()
    expect(horaHabitualHHMM('')).toBeNull()
    expect(horaHabitualHHMM(null)).toBeNull()
  })
})

describe('lo que se lee en Personal, Tarifas y Ficha', () => {
  it('el turno de tarde se lee 16:00 → 23:30, nunca 4:00 → 11:30', () => {
    const e = emp('16:00:00', '23:30:00')
    expect(horarioHabitualTexto(e)).toBe('16:00 → 23:30')
    expect(horarioResumen(e)).toBe('Fijo · 16:00 → 23:30')
    expect(horarioResumen(e)).not.toMatch(SIN_12H)
  })

  it('el turno que cruza la medianoche también', () => {
    expect(horarioResumen(emp('18:00:00', '02:00:00'))).toBe('Fijo · 18:00 → 02:00')
  })

  it('sin regla no inventa una hora', () => {
    expect(horarioHabitualTexto(emp(null, null))).toBe('—')
    expect(horarioResumen(emp(null, null))).toBe('Flexible')
  })

  it('con media regla cargada muestra la mitad que hay', () => {
    expect(horarioHabitualTexto(emp('11:00:00', null))).toBe('11:00 → —')
  })
})

describe('el rastro que queda en las horas corregidas', () => {
  it('el motivo del override se escribe en 24 h', () => {
    const m = motivoRegla('16:01', '22:03', 'in', '16:01')
    expect(m).toContain('entró 16:01 → salió 22:03')
    expect(m).not.toMatch(SIN_12H)
  })
})
