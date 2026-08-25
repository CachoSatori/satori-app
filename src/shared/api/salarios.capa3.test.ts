import { describe, it, expect, vi } from 'vitest'
import type { PunchException } from '../types/database'
import { horasEntreMarcas } from '../utils/horasCorreccion'

// Salarios · Capa 3: la regla de hora habitual del empleado (mig 061).
//
// Lo que se fija acá es el LÍMITE de la regla, que es lo único que puede costar plata:
// a qué impares alcanza y —sobre todo— a cuáles no. La regla completa la mitad que falta
// de un fichaje donde el reloj ya probó que la persona estuvo; nunca inventa una jornada.

vi.mock('./supabase', () => ({ supabase: { from: () => ({}) } }))

const {
  horaHabitualHHMM, horaHabitualFaltante, hhmmCR, imparesConRegla, motivoRegla, MOTIVO_REGLA,
} = await import('./salarios')

// 08:00 en Costa Rica (UTC−6 fijo) = 14:00Z.
const cr = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `2026-08-03T${String(h + 6).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
}

function exc(over: Partial<PunchException> & { id: string }): PunchException {
  return {
    tipo: 'impar', employee_id: 'e1', emp_code: null, work_date: '2026-08-03',
    local: 'santa-teresa', detalle: null, estado: 'abierta', resuelto_by: null,
    resuelto_at: null, created_at: '', updated_at: '', ...over,
  } as PunchException
}

/** Un impar de UNA marca, que es el único caso que la regla puede completar. */
const imparCon = (id: string, hora: string, lado: 'in' | 'out', over: Partial<PunchException> = {}) =>
  exc({ id, detalle: { marcas: [{ id: `m-${id}`, punch_at: cr(hora), punch_state: lado }] }, ...over })

const CON_REGLA = { hora_entrada_habitual: '08:00:00', hora_salida_habitual: '17:00:00' }

describe('Capa 3 · horaHabitualHHMM — la columna `time` y el input hablan distinto', () => {
  it('acepta "08:00:00" (lo que devuelve la base) y "08:00" (lo que da el navegador)', () => {
    expect(horaHabitualHHMM('08:00:00')).toBe('08:00')
    expect(horaHabitualHHMM('08:00')).toBe('08:00')
    expect(horaHabitualHHMM('23:59:59.999')).toBe('23:59')
    expect(horaHabitualHHMM(' 17:30:00 ')).toBe('17:30')
  })

  it('sin regla o con basura devuelve null — nunca una hora inventada', () => {
    for (const v of [null, undefined, '', '  ', '24:00', '8:00', '12:60', 'mañana']) {
      expect(horaHabitualHHMM(v as string | null)).toBeNull()
    }
  })
})

describe('Capa 3 · horaHabitualFaltante — la regla completa el lado que FALTA', () => {
  it('marca real = entrada → propone la SALIDA habitual', () => {
    expect(horaHabitualFaltante(CON_REGLA, 'in')).toBe('17:00')
  })

  it('marca real = salida → propone la ENTRADA habitual', () => {
    expect(horaHabitualFaltante(CON_REGLA, 'out')).toBe('08:00')
  })

  it('con solo una de las dos horas cargadas, el otro lado sigue sin regla', () => {
    const soloEntrada = { hora_entrada_habitual: '08:00:00', hora_salida_habitual: null }
    expect(horaHabitualFaltante(soloEntrada, 'out')).toBe('08:00')   // falta la entrada: la tiene
    expect(horaHabitualFaltante(soloEntrada, 'in')).toBeNull()       // falta la salida: no la tiene
    expect(horaHabitualFaltante(null, 'in')).toBeNull()
  })
})

describe('Capa 3 · las horas salen de la RESTA, igual que en Capa 2', () => {
  it('falta la salida: marca real 08:00 + salida habitual 17:00 = 9 h', () => {
    expect(horasEntreMarcas(hhmmCR(cr('08:00')), '17:00')).toBe(9)
  })

  it('falta la entrada: entrada habitual 08:00 + marca real 17:00 = 9 h', () => {
    expect(horasEntreMarcas('08:00', hhmmCR(cr('17:00')))).toBe(9)
  })

  it('el turno que cruza la medianoche da 8 h, no −16', () => {
    expect(horasEntreMarcas('18:00', '02:00')).toBe(8)
  })
})

describe('Capa 3 · imparesConRegla — a qué alcanza la regla y a qué NO', () => {
  it('el impar de una marca con regla del lado que falta entra, con sus horas resueltas', () => {
    const [a] = imparesConRegla([imparCon('x1', '08:00', 'in')], CON_REGLA)
    expect(a).toMatchObject({ lado: 'in', horaReal: '08:00', habitual: '17:00', entrada: '08:00', salida: '17:00', horas: 9 })
  })

  it('la marca real que es la SALIDA se completa con la entrada habitual', () => {
    const [a] = imparesConRegla([imparCon('x1', '17:00', 'out')], CON_REGLA)
    expect(a).toMatchObject({ lado: 'out', entrada: '08:00', salida: '17:00', horas: 9 })
  })

  // ── El límite que NO se mueve ────────────────────────────────────────────────────
  it('un día SIN NINGUNA marca queda afuera: es una ausencia, y rellenarlo inventaría plata', () => {
    const sinMarcas  = exc({ id: 'x1', detalle: { marcas: [] } })
    const sinDetalle = exc({ id: 'x2', detalle: null })
    expect(imparesConRegla([sinMarcas, sinDetalle], CON_REGLA)).toEqual([])
  })

  it('lo que no es impar de UNA marca sigue con criterio humano, no con la regla', () => {
    const dosMarcas = exc({
      id: 'x1',
      detalle: { marcas: [
        { id: 'm1', punch_at: cr('08:00'), punch_state: 'in' },
        { id: 'm2', punch_at: cr('12:00'), punch_state: 'out' },
      ] },
    })
    const otrosTipos = (['solapado', 'turno_largo', 'sin_mapear'] as const).map((tipo, i) =>
      imparCon(`t${i}`, '08:00', 'in', { tipo }))
    expect(imparesConRegla([dosMarcas, ...otrosTipos], CON_REGLA)).toEqual([])
  })

  it('sin la hora habitual DEL LADO que falta, el impar se queda para corrección manual', () => {
    const soloEntrada = { hora_entrada_habitual: '08:00:00', hora_salida_habitual: null }
    // La marca real es la entrada → falta la salida → esta persona no la tiene cargada.
    expect(imparesConRegla([imparCon('x1', '08:00', 'in')], soloEntrada)).toEqual([])
    // Sin ninguna regla, tampoco.
    expect(imparesConRegla([imparCon('x1', '08:00', 'in')], null)).toEqual([])
    expect(imparesConRegla([imparCon('x1', '08:00', 'in')], {})).toEqual([])
  })

  it('las excepciones ya resueltas no se vuelven a tocar', () => {
    expect(imparesConRegla([imparCon('x1', '08:00', 'in', { estado: 'resuelta' })], CON_REGLA)).toEqual([])
  })

  it('separa la paja del trigo en una bandeja mezclada', () => {
    const items = [
      imparCon('ok1', '08:00', 'in'),                          // con regla
      imparCon('ok2', '17:00', 'out'),                         // con regla, del otro lado
      exc({ id: 'no-marcas', detalle: { marcas: [] } }),        // ausencia
      imparCon('otro-tipo', '08:00', 'in', { tipo: 'solapado' }),
    ]
    expect(imparesConRegla(items, CON_REGLA).map(a => a.x.id)).toEqual(['ok1', 'ok2'])
  })

  it('respeta el lado que la persona ya volteó en la pantalla', () => {
    // BioTime la etiquetó `in`, pero en la pantalla se volteó a `out`: entonces la que
    // falta es la ENTRADA, y la regla tiene que proponer 08:00 (no 17:00).
    const [a] = imparesConRegla([imparCon('x1', '17:00', 'in')], CON_REGLA, () => 'out')
    expect(a).toMatchObject({ lado: 'out', habitual: '08:00', entrada: '08:00', salida: '17:00', horas: 9 })
  })

  it('un turno absurdo NO se descarta: se devuelve para que la pantalla avise', () => {
    // Marca real 18:00 con salida habitual 17:00 → cruza medianoche → 23 h.
    const [a] = imparesConRegla([imparCon('x1', '18:00', 'in')], CON_REGLA)
    expect(a.horas).toBe(23)
  })
})

describe('Capa 3 · el rastro para el contador', () => {
  it('el motivo dice qué mitad puso el reloj y que la otra la puso la REGLA, no una persona', () => {
    const m = motivoRegla('08:00', '17:00', 'in', '08:00')
    expect(m).toBe('entró 08:00 → salió 17:00 (marca real: entrada 08:00, mitad completada por regla del empleado (hora habitual))')
    expect(m).toContain(MOTIVO_REGLA)
  })

  it('con la marca real del otro lado, el rastro lo dice igual de claro', () => {
    expect(motivoRegla('08:00', '17:00', 'out', '17:00')).toContain('marca real: salida 17:00')
  })
})
