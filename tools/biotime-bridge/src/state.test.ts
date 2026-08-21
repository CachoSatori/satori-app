import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState, getLastId, setLastId, advanceLastId } from './state.js'
import type { IngestPunch } from './fetchPunches.js'

// F1c: el `last_id` es lo único que separa "reingestar" (inocuo) de "saltearse marcas"
// (horas perdidas para siempre). Estas pruebas cuidan justamente eso.

const punch = (biotime_id: number): IngestPunch => ({
  biotime_id, emp_code: '17', punch_time: '2026-08-22T04:30:00.000Z', punch_state: '0', raw: {},
})

let dir = ''
let file = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-state-'))
  file = join(dir, '.bridge-state.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('advanceLastId · avanza solo hasta lo confirmado', () => {
  it('toma el mayor id del lote empujado', () => {
    expect(advanceLastId(10, [punch(11), punch(12), punch(13)])).toBe(13)
  })

  it('un lote vacío NO mueve el last_id', () => {
    expect(advanceLastId(10, [])).toBe(10)
  })

  it('nunca retrocede (un lote viejo reenviado no baja el corte)', () => {
    expect(advanceLastId(50, [punch(11), punch(12)])).toBe(50)
  })

  it('no se saltea ids que no vinieron en el lote', () => {
    // El lote llegó hasta el 12: aunque en BioTime existan el 13 y el 14, el corte queda en 12.
    expect(advanceLastId(10, [punch(11), punch(12)])).toBe(12)
  })
})

describe('readState / writeState', () => {
  it('sin archivo (primer arranque) arranca en 0 → trae el histórico', () => {
    expect(getLastId(readState(file), 'santa-teresa')).toBe(0)
  })

  it('un archivo corrupto NO inventa un corte alto: vuelve a 0', () => {
    writeFileSync(file, '{ esto no es json', 'utf8')
    expect(getLastId(readState(file), 'santa-teresa')).toBe(0)
  })

  it('descarta valores que no sean enteros >= 0', () => {
    writeFileSync(file, JSON.stringify({ lastIds: { 'santa-teresa': -3, nosara: 'x', otro: 7 } }), 'utf8')
    const s = readState(file)
    expect(getLastId(s, 'santa-teresa')).toBe(0)
    expect(getLastId(s, 'nosara')).toBe(0)
    expect(getLastId(s, 'otro')).toBe(7)
  })

  it('guarda y relee el corte por local, sin pisar el del otro', () => {
    let s = readState(file)
    s = setLastId(s, 'santa-teresa', 4821)
    writeState(file, s)
    s = setLastId(readState(file), 'nosara', 90)
    writeState(file, s)

    const releido = readState(file)
    expect(getLastId(releido, 'santa-teresa')).toBe(4821)
    expect(getLastId(releido, 'nosara')).toBe(90)
  })

  it('la escritura es atómica: no deja el .tmp tirado', () => {
    writeState(file, setLastId(readState(file), 'santa-teresa', 1))
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lastIds: { 'santa-teresa': 1 } })
  })
})
