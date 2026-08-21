import { describe, it, expect } from 'vitest'
import {
  FETCH_SQL, mapRow, fetchPunches, NaiveTimestampError,
  type BiotimeRow, type Queryable,
} from './fetchPunches.js'

// F1c: el mapeo fila→body y el filtro incremental. Si esto se rompe, el edge cuenta las
// marcas como `invalid` o se pierden horas — nada falla a la vista.

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

  it('un timestamp SIN zona frena el ciclo en vez de mandar una marca corrida 6 horas', () => {
    expect(() => mapRow({ ...FILA, punch_time: '2026-08-21 22:30:00' })).toThrow(NaiveTimestampError)
  })

  it('respeta un string que YA trae offset de Costa Rica', () => {
    expect(mapRow({ ...FILA, punch_time: '2026-08-21T22:30:00-06:00' }).punch_time)
      .toBe('2026-08-21T22:30:00-06:00')
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
