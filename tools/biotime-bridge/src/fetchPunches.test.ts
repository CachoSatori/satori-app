import { describe, it, expect } from 'vitest'
import {
  FETCH_SQL, mapRow, fetchPunches, NaiveTimestampError, normalizarInstante, conOffsetCR, CR_OFFSET,
  type BiotimeRow, type Queryable,
} from './fetchPunches.js'

// F1c: el mapeo fila→body y el filtro incremental. Si esto se rompe, el edge cuenta las
// marcas como `invalid` o se pierden horas — nada falla a la vista.

/**
 * Misma fórmula que `hhmmCR` de `src/shared/api/salarios.ts`: así el test compara contra lo
 * que la app REALMENTE muestra, y no contra una conversión inventada acá.
 */
function hhmmCR(iso: string): string {
  const cr = new Date(new Date(iso).getTime() - 6 * 3600_000)
  return `${String(cr.getUTCHours()).padStart(2, '0')}:${String(cr.getUTCMinutes()).padStart(2, '0')}`
}

const FILA: BiotimeRow = {
  id: '4821',                                        // bigint: pg lo da como string
  emp_code: 17,
  punch_time: new Date('2026-08-21T22:30:00-06:00'), // timestamptz → Date
  punch_state: '0',
  terminal_alias: 'RELOJ-ST',
}

describe('mapRow · fila de BioTime → cuerpo del edge', () => {
  it('biotime_id es el id de iclock_transaction, numérico', () => {
    expect(mapRow(FILA).biotime_id).toBe(4821)
  })

  it('punch_time sale SIEMPRE con zona horaria explícita (mismo instante)', () => {
    const p = mapRow(FILA)
    expect(p.punch_time).toBe('2026-08-22T04:30:00.000Z')
    expect(/(Z|[+-]\d{2}:?\d{2})$/i.test(p.punch_time)).toBe(true)
    expect(Date.parse(p.punch_time)).toBe(Date.parse('2026-08-21T22:30:00-06:00'))
  })

  it('un timestamp SIN zona se lee como hora de Costa Rica (UTC−6), no como hora de la PC', () => {
    // El `timestamp` naive de BioTime es reloj de pared de Costa Rica. Antes lo parseaba
    // `pg` con la zona del PROCESO y una PC en UTC−5 corría todo 1 hora. Ahora el offset
    // es explícito y el resultado NO depende de cómo esté configurada la PC del local.
    expect(mapRow({ ...FILA, punch_time: '2026-08-21 22:30:00' }).punch_time)
      .toBe('2026-08-21T22:30:00-06:00')
  })

  it('respeta un string que YA trae offset de Costa Rica', () => {
    expect(mapRow({ ...FILA, punch_time: '2026-08-21T22:30:00-06:00' }).punch_time)
      .toBe('2026-08-21T22:30:00-06:00')
  })

  it('un punch_time con formato irreconocible frena el ciclo', () => {
    expect(() => mapRow({ ...FILA, punch_time: '21/08/2026 22:30' })).toThrow(NaiveTimestampError)
    expect(() => mapRow({ ...FILA, punch_time: '' })).toThrow(NaiveTimestampError)
  })

  it('punch_state va CRUDO: el 0/1 lo traduce el edge, no el agente', () => {
    expect(mapRow(FILA).punch_state).toBe('0')
    expect(mapRow({ ...FILA, punch_state: 1 }).punch_state).toBe(1)
    expect(mapRow({ ...FILA, punch_state: '7' }).punch_state).toBe('7')   // ni se filtra
  })

  it('emp_code a string, terminal desde terminal_alias y raw con la fila original', () => {
    const p = mapRow(FILA)
    expect(p.emp_code).toBe('17')
    expect(p.terminal).toBe('RELOJ-ST')
    expect(p.raw).toEqual({
      id: '4821', emp_code: 17, punch_time: '2026-08-22T04:30:00.000Z',
      punch_state: '0', terminal_alias: 'RELOJ-ST',
    })
  })

  it('sin terminal_alias no manda la clave terminal', () => {
    expect(mapRow({ ...FILA, terminal_alias: null })).not.toHaveProperty('terminal')
  })

  it('un id que no entra en un entero seguro explota en vez de truncarse', () => {
    expect(() => mapRow({ ...FILA, id: '99999999999999999999' })).toThrow(/fuera de rango/i)
  })
})

// ── EL DESFASE DE 1 HORA (piloto v3) ────────────────────────────────────────────────────
// Costa Rica es UTC−6 FIJO, sin horario de verano. Estos tests son la red que impide que el
// desfase vuelva: fijan el offset y, sobre todo, prueban que el resultado NO cambia con la
// zona del proceso, que es exactamente por donde se coló el error.
describe('zona horaria · Costa Rica es UTC−6 FIJO', () => {
  it('el offset es -06:00 y no hay horario de verano', () => {
    expect(CR_OFFSET).toBe('-06:00')
    // Enero y agosto: el MISMO offset. Si alguien metiera DST, agosto daría -05:00.
    expect(conOffsetCR('2026-01-15 16:00:00')).toBe('2026-01-15T16:00:00-06:00')
    expect(conOffsetCR('2026-08-15 16:00:00')).toBe('2026-08-15T16:00:00-06:00')
  })

  it('las marcas reales del piloto se mandan con la hora que muestra BioTime', () => {
    // BioTime = correcto. Estas son las tres marcas que Ismael verificó a mano.
    const casos: [string, string][] = [
      ['2026-08-16 11:05:00', '2026-08-16T17:05:00.000Z'],  // Fran[4]   entrada 11:05
      ['2026-08-16 16:08:00', '2026-08-16T22:08:00.000Z'],  // Fran[4]   salida  16:08
      ['2026-08-20 16:01:00', '2026-08-20T22:01:00.000Z'],  // Lester[10] entrada 16:01
      ['2026-08-20 22:03:00', '2026-08-21T04:03:00.000Z'],  // Lester[10] salida  22:03
      ['2026-08-16 19:04:00', '2026-08-17T01:04:00.000Z'],  // Ampi[25]   entrada 19:04
    ]
    for (const [crudo, instante] of casos) {
      const enviado = mapRow({ ...FILA, punch_time: crudo }).punch_time
      expect(new Date(enviado).toISOString()).toBe(instante)
      // Y de vuelta a hora de Costa Rica: tiene que dar la MISMA hora de pared que BioTime.
      expect(hhmmCR(enviado)).toBe(crudo.slice(11, 16))
    }
  })

  it('el turno de tarde entra ~16:00, NO ~15:00 (el síntoma que reportó el piloto)', () => {
    expect(hhmmCR(mapRow({ ...FILA, punch_time: '2026-08-20 16:01:00' }).punch_time)).toBe('16:01')
    expect(hhmmCR(mapRow({ ...FILA, punch_time: '2026-08-16 11:05:00' }).punch_time)).toBe('11:05')
  })

  it('el resultado NO depende de la zona del proceso — que es donde estaba el bug', () => {
    const original = process.env.TZ
    const salidas: string[] = []
    // America/Chicago corre a UTC−5 en agosto (horario de verano); Bogotá es UTC−5 fijo.
    // Con el parseo viejo, cada una de estas zonas daba un instante distinto.
    for (const tz of ['America/Costa_Rica', 'America/Chicago', 'America/Bogota', 'UTC']) {
      process.env.TZ = tz
      salidas.push(normalizarInstante('2026-08-16 16:00:00'))
    }
    process.env.TZ = original
    expect(new Set(salidas).size).toBe(1)
    expect(salidas[0]).toBe('2026-08-16T16:00:00-06:00')
  })

  it('CORTE 05:00 · la salida de madrugada sigue cayendo en la jornada de apertura', () => {
    // La derivación (mig 059) hace `(punch_at at time zone 'America/Costa_Rica') - 05:00`.
    // Un turno que abre el 20 a las 16:00 y cierra el 21 a las 02:00 tiene que dar la MISMA
    // jornada (2026-08-20) para los dos extremos, o el par no existe y se pierden las horas.
    const jornada = (crudo: string): string => {
      const iso = mapRow({ ...FILA, punch_time: crudo }).punch_time
      const cr = new Date(new Date(iso).getTime() - 6 * 3600_000 - 5 * 3600_000)
      return cr.toISOString().slice(0, 10)
    }
    expect(jornada('2026-08-20 16:01:00')).toBe('2026-08-20')
    expect(jornada('2026-08-21 02:03:00')).toBe('2026-08-20')   // madrugada → día de apertura
    expect(jornada('2026-08-21 04:59:00')).toBe('2026-08-20')   // justo antes del corte
    expect(jornada('2026-08-21 05:00:00')).toBe('2026-08-21')   // justo en el corte → día nuevo
  })
})

describe('fetchPunches · el SELECT incremental', () => {
  const filas = (ids: number[]): BiotimeRow[] =>
    ids.map(id => ({ ...FILA, id: String(id) }))

  interface FakeDb extends Queryable { sql: string; params: unknown[] }

  function fakeDb(rows: BiotimeRow[]): FakeDb {
    const db: FakeDb = {
      sql: '',
      params: [],
      async query<T>(text: string, params: unknown[]) {
        db.sql = text
        db.params = params
        // Simulamos el `id > $1` y el LIMIT del motor.
        const last = Number(params[0]), lim = Number(params[1])
        return { rows: rows.filter(r => Number(r.id) > last).slice(0, lim) as T[] }
      },
    }
    return db
  }

  it('pide solo los ids mayores al último confirmado, en orden y con LIMIT', async () => {
    const db = fakeDb(filas([10, 11, 12]))
    const out = await fetchPunches(db, 10, 200)
    expect(out.map(p => p.biotime_id)).toEqual([11, 12])
    expect(db.params).toEqual([10, 200])
    expect(db.sql).toBe(FETCH_SQL)
    expect(FETCH_SQL).toContain('WHERE id > $1')
    expect(FETCH_SQL).toContain('ORDER BY id ASC')
    expect(FETCH_SQL).toContain('LIMIT $2')
  })

  it('desde 0 trae el histórico completo (reingestar no duplica: (local, biotime_id))', async () => {
    const db = fakeDb(filas([1, 2, 3]))
    expect((await fetchPunches(db, 0, 200)).map(p => p.biotime_id)).toEqual([1, 2, 3])
  })

  it('el LIMIT corta el lote', async () => {
    const db = fakeDb(filas([1, 2, 3, 4, 5]))
    expect((await fetchPunches(db, 0, 2)).map(p => p.biotime_id)).toEqual([1, 2])
  })

  it('nada nuevo → lote vacío (el ciclo se va a dormir)', async () => {
    const db = fakeDb(filas([1, 2]))
    expect(await fetchPunches(db, 2, 200)).toEqual([])
  })

  it('el SQL es un SELECT y nada más: BioTime NUNCA se escribe', () => {
    expect(FETCH_SQL.trim().toUpperCase().startsWith('SELECT')).toBe(true)
    expect(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(FETCH_SQL)).toBe(false)
  })
})
