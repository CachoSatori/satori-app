import { describe, it, expect } from 'vitest'
import { avisosCierrePropinas } from './guardasCierre'
import { calcTurno, type DraftLine } from '../../shared/utils/tipCalculations'
import type { UserRole } from '../../shared/types/database'

// Datos ficticios. pts/hora: salonero 10 · barman 5 · barback 3 · cocina 4.
const PTS: Partial<Record<UserRole, number>> = { salonero: 10, barman: 5, barback: 3, cocina: 4, runner: 0 }
const linea = (id: string, role: UserRole, hours: number | '', extra: Partial<DraftLine> = {}): DraftLine => ({
  employeeId: id, employeeName: id, role, active: true, hours,
  propina_crc: '', propina_usd: '', pts_rol: PTS[role] ?? 0, pts_val: 0, take_home: 0, ...extra,
})
const TC = 500

describe('avisosCierrePropinas — flujo feliz (no cambia nada)', () => {
  it('turno normal con sala y barra con horas → sin avisos', () => {
    const lines = [linea('a', 'salonero', 6, { propina_crc: 10000 }), linea('b', 'barman', 8)]
    expect(avisosCierrePropinas(lines, 20000, 10, 15000, TC)).toEqual([])
  })
  it('todo en 0 → sin avisos (no hay pozo)', () => {
    expect(avisosCierrePropinas([linea('a', 'salonero', 0)], 0, 0, 0, TC)).toEqual([])
  })
  it('sin barra y sin barman → sin aviso de barra', () => {
    expect(avisosCierrePropinas([linea('a', 'salonero', 5)], 1000, 0, 0, TC)).toEqual([])
  })
  it('cuando no hay aviso, todo el pozo queda repartido (coincide con el sagrado)', () => {
    const lines = [linea('a', 'salonero', 6, { propina_crc: 10000 }), linea('b', 'barback', 4)]
    expect(avisosCierrePropinas(lines, 20000, 10, 15000, TC)).toEqual([])
    const { totals, updatedLines } = calcTurno(lines, 20000, 10, 15000, TC)
    const repartido = updatedLines.filter(l => l.active).reduce((s, l) => s + l.take_home, 0)
    expect(repartido).toBeCloseTo(totals.totalPool, 6)
  })
})

describe('H1 — pozo de barra sin horas de barra', () => {
  it('barra > 0 y nadie de barra marcado → bloquea con el monto', () => {
    const av = avisosCierrePropinas([linea('a', 'salonero', 6)], 0, 0, 15000, TC)
    expect(av).toHaveLength(1)
    expect(av[0].tipo).toBe('barra_sin_horas')
    expect(av[0].monto).toBe(15000)
    expect(av[0].texto).toBe('Hay ₡15.000 de propina de barra y nadie de barra tiene horas cargadas. Cargá las horas de barra; si nadie de barra trabajó, avisá al owner.')
  })
  it('barman marcado con 0 horas (o vacío) → bloquea', () => {
    expect(avisosCierrePropinas([linea('a', 'salonero', 6), linea('b', 'barman', 0)], 0, 0, 5000, TC)[0]?.tipo).toBe('barra_sin_horas')
    expect(avisosCierrePropinas([linea('a', 'salonero', 6), linea('b', 'barman', '')], 0, 0, 5000, TC)[0]?.tipo).toBe('barra_sin_horas')
  })
  it('barman desmarcado (active=false) con horas no cuenta → bloquea', () => {
    const av = avisosCierrePropinas([linea('a', 'salonero', 6), linea('b', 'barman', 8, { active: false })], 0, 0, 5000, TC)
    expect(av.map(a => a.tipo)).toEqual(['barra_sin_horas'])
  })
  it('covered_role: un salonero que cubre barra (rol efectivo barman) con horas → NO bloquea', () => {
    // Las líneas llegan con el rol efectivo, igual que a calcTurno.
    const av = avisosCierrePropinas([linea('a', 'salonero', 6), linea('c', 'barman', 5)], 0, 0, 5000, TC)
    expect(av).toEqual([])
  })
  it('covered_role: un barman que cubre sala (rol efectivo salonero) deja la barra sin horas → bloquea', () => {
    const av = avisosCierrePropinas([linea('b', 'salonero', 8)], 0, 0, 5000, TC)
    expect(av.map(a => a.tipo)).toEqual(['barra_sin_horas'])
  })
  it('barback con horas alcanza para la barra', () => {
    expect(avisosCierrePropinas([linea('a', 'salonero', 6), linea('d', 'barback', 2)], 0, 0, 5000, TC)).toEqual([])
  })
  it('USD de un barman: no es pozo (el sagrado no lo suma) → no inventa aviso', () => {
    // La propina individual de barra no entra al pozo general en calcTurno: la guarda tampoco la ve.
    const lines = [linea('a', 'salonero', 6), linea('b', 'barman', 8, { propina_usd: 20 })]
    expect(avisosCierrePropinas(lines, 0, 0, 0, TC)).toEqual([])
  })
})

describe('H2 — pozo general sin puntos', () => {
  it('pozo general > 0 y nadie tiene puntos (horas 0) → bloquea con el monto', () => {
    const av = avisosCierrePropinas([linea('a', 'salonero', 0)], 12000, 0, 0, TC)
    expect(av).toHaveLength(1)
    expect(av[0].tipo).toBe('general_sin_puntos')
    expect(av[0].monto).toBe(12000)
    expect(av[0].texto).toBe('Hay ₡12.000 para repartir y nadie del turno tiene puntos. Revisá los roles o las horas antes de cerrar.')
  })
  it('rol con 0 pts/hora (p. ej. runner configurado en 0) con horas → bloquea', () => {
    expect(avisosCierrePropinas([linea('r', 'runner', 6)], 12000, 0, 0, TC)[0]?.tipo).toBe('general_sin_puntos')
  })
  it('solo USD en el pozo, convertido al TC → el monto del aviso va en colones', () => {
    const av = avisosCierrePropinas([linea('a', 'salonero', 0)], 0, 10, 0, TC)
    expect(av[0]).toMatchObject({ tipo: 'general_sin_puntos', monto: 5000 })
  })
  it('el electrónico individual de sala es pozo general (₡ y $)', () => {
    const av = avisosCierrePropinas([linea('a', 'salonero', 0, { propina_crc: 1000, propina_usd: 2 })], 0, 0, 0, TC)
    expect(av[0]).toMatchObject({ tipo: 'general_sin_puntos', monto: 2000 })
  })
  it('0 empleados marcados con pozo → bloquea (nadie cobra)', () => {
    expect(avisosCierrePropinas([], 8000, 0, 0, TC).map(a => a.tipo)).toEqual(['general_sin_puntos'])
    expect(avisosCierrePropinas([linea('a', 'salonero', 6, { active: false })], 8000, 0, 0, TC).map(a => a.tipo)).toEqual(['general_sin_puntos'])
  })
  it('basta una persona con puntos > 0', () => {
    expect(avisosCierrePropinas([linea('a', 'salonero', 0), linea('k', 'cocina', 1)], 8000, 0, 0, TC)).toEqual([])
  })
})

describe('H1 + H2 a la vez', () => {
  it('barman con 0 horas, pozo general y barra → dos avisos, barra primero', () => {
    const av = avisosCierrePropinas([linea('b', 'barman', 0)], 3000, 0, 4000, TC)
    expect(av.map(a => a.tipo)).toEqual(['barra_sin_horas', 'general_sin_puntos'])
    expect(av.map(a => a.monto)).toEqual([4000, 3000])
  })
})
