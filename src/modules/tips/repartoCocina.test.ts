// PROP-AUD-01: el reparto de cocina lo decide la marca de la base, no el nombre.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mondayOf, semanasCocina, type EmpleadoCocina, type FilaCocina } from './repartoCocina'

const emp = (id: string, full_name: string, recibe?: boolean): EmpleadoCocina =>
  ({ id, full_name, recibe_reparto_cocina: recibe })
const mapa = (es: EmpleadoCocina[]) => new Map(es.map(e => [e.id, e]))

// Nombres ficticios. «ANA» es la subcadena que comparten los homónimos.
const A = emp('a', 'ANA PRUEBA', false)
const B = emp('b', 'ANA EJEMPLO', true)
const C = emp('c', 'LUIS FICTICIO')

describe('semanasCocina · quién recibe', () => {
  const filas: FilaCocina[] = [
    { employee_id: 'a', session_date: '2026-10-05', payout_crc: 10_000 },
    { employee_id: 'b', session_date: '2026-10-06', payout_crc: 20_000 },
    { employee_id: 'c', session_date: '2026-10-07', payout_crc: 30_001 },
  ]

  it('homónimo: solo queda afuera el que tiene la marca en false', () => {
    const [s] = semanasCocina(filas, mapa([A, B, C]))
    expect(s.receptores.map(r => r.id).sort()).toEqual(['b', 'c'])
  })

  it('renombre: el excluido sigue afuera aunque cambie el nombre', () => {
    const [s] = semanasCocina(filas, mapa([{ ...A, full_name: 'OTRO NOMBRE' }, B, C]))
    expect(s.receptores.map(r => r.id).sort()).toEqual(['b', 'c'])
  })

  it('sin marca (null/undefined) o en true: recibe, tenga el nombre que tenga', () => {
    const [s] = semanasCocina(filas, mapa([{ ...A, recibe_reparto_cocina: null }, B, C]))
    expect(s.receptores.map(r => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('quien no recibe aporta igual al pozo; por persona = pozo ÷ receptores', () => {
    const [s] = semanasCocina(filas, mapa([A, B, C]))
    expect(s.pool).toBe(60_001)
    expect(s.perPerson).toBe(60_001 / 2)
  })

  it('las entradas de alguien que no es de cocina no entran', () => {
    const [s] = semanasCocina([...filas, { employee_id: 'z', session_date: '2026-10-07', payout_crc: 99_999 }], mapa([A, B, C]))
    expect(s.pool).toBe(60_001)
  })
})

describe('el pozo no cambia al colón (regla vieja por nombre vs marca nueva)', () => {
  // La regla vieja, reconstruida con una subcadena FICTICIA: excluía por nombre.
  const SUB = 'ana prueba'
  function viejo(filas: FilaCocina[], cocina: Map<string, EmpleadoCocina>) {
    const m: Record<string, { pool: number; rec: Set<string> }> = {}
    for (const r of filas) {
      const k = mondayOf(r.session_date)
      m[k] ??= { pool: 0, rec: new Set() }
      m[k].pool += r.payout_crc ?? 0
      const e = cocina.get(r.employee_id)
      if (e && !e.full_name.toLowerCase().includes(SUB)) m[k].rec.add(e.id)
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => ({ key, pool: b.pool, n: b.rec.size, per: b.rec.size ? b.pool / b.rec.size : 0 }))
  }

  it('un mes de prueba: mismo pozo por semana, mismos receptores y misma parte', () => {
    const filas: FilaCocina[] = []
    let x = 7
    for (let d = 1; d <= 30; d++) {
      for (const id of ['a', 'b', 'c']) {
        x = (x * 48271) % 2147483647                      // pseudoaleatorio fijo
        if (x % 5 === 0) continue                          // no todos van todos los días
        filas.push({ employee_id: id, session_date: `2026-09-${String(d).padStart(2, '0')}`, payout_crc: x % 37_000 + 0.5 })
      }
    }
    const antes = viejo(filas, mapa([emp('a', 'ANA PRUEBA'), B, C]))
    const ahora = semanasCocina(filas, mapa([A, B, C]))
    expect(ahora.map(s => s.key)).toEqual(antes.map(s => s.key))
    for (let i = 0; i < antes.length; i++) {
      expect(Math.round(ahora[i].pool)).toBe(Math.round(antes[i].pool))
      expect(ahora[i].pool).toBe(antes[i].pool)
      expect(ahora[i].receptores.length).toBe(antes[i].n)
      expect(Math.round(ahora[i].perPerson)).toBe(Math.round(antes[i].per))
    }
  })
})

describe('sin texto fijo', () => {
  it('TipCocina.tsx no compara nombres contra literales', () => {
    const src = readFileSync(join(__dirname, 'TipCocina.tsx'), 'utf8')
    expect(src).not.toMatch(/full_name[^\n]*\.(includes|startsWith|endsWith)\(\s*['"`]/)
    expect(src).not.toMatch(/name\.toLowerCase\(\)\.includes\(/)
    expect(src).not.toMatch(/function is[A-Z][a-z]+\(name/)
  })
})
