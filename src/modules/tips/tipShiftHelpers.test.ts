import { describe, it, expect } from 'vitest'
import { availableForCobertura, roleReceivesTips, eligibleRoster } from './tipShiftHelpers'
import type { Employee, UserRole } from '../../shared/types/database'

// Employee mínimo: el helper solo mira `id`; el resto se castea para el tipo.
const emp = (id: string, name: string): Employee =>
  ({ id, full_name: name } as unknown as Employee)
const empR = (id: string, role: UserRole): Employee =>
  ({ id, full_name: id, role } as unknown as Employee)

describe('availableForCobertura — el picker excluye a quienes ya participan en el turno', () => {
  it('empleado ACTIVO en el turno → EXCLUIDO del picker', () => {
    const employees = [emp('a', 'Ana'), emp('b', 'Beto')]
    const lines = [{ employeeId: 'a', active: true }, { employeeId: 'b', active: false }]
    expect(availableForCobertura(employees, lines).map(e => e.id)).toEqual(['b'])
  })

  it('empleado NO-activo → INCLUIDO', () => {
    const employees = [emp('a', 'Ana')]
    const lines = [{ employeeId: 'a', active: false }]
    expect(availableForCobertura(employees, lines).map(e => e.id)).toEqual(['a'])
  })

  it('cobertura (línea activa) → EXCLUIDA', () => {
    const employees = [emp('a', 'Ana'), emp('c', 'Caro')]
    const lines = [{ employeeId: 'c', active: true }]  // c entró como cobertura → active
    expect(availableForCobertura(employees, lines).map(e => e.id)).toEqual(['a'])
  })

  it('sin líneas activas → todos disponibles', () => {
    const employees = [emp('a', 'Ana'), emp('b', 'Beto')]
    expect(availableForCobertura(employees, []).map(e => e.id)).toEqual(['a', 'b'])
  })
})

describe('roleReceivesTips — elegibilidad por rol (config, null-safe)', () => {
  const cfg = [
    { role: 'salonero' as UserRole, points: 10, recibe_propina: true },
    { role: 'manager'  as UserRole, points: 10, recibe_propina: false },   // flip a false
    { role: 'runner'   as UserRole, points: 8 },                            // sin flag → true
    { role: 'cocina'   as UserRole, points: 5, recibe_propina: null },      // null → true
  ]
  it('recibe_propina=false → NO recibe', () => {
    expect(roleReceivesTips('manager', cfg)).toBe(false)
  })
  it('recibe_propina=true → recibe', () => {
    expect(roleReceivesTips('salonero', cfg)).toBe(true)
  })
  it('flag ausente o null → recibe (default esquema)', () => {
    expect(roleReceivesTips('runner', cfg)).toBe(true)
    expect(roleReceivesTips('cocina', cfg)).toBe(true)
  })
  it('null-safe: rol no configurado / config nula/vacía → recibe', () => {
    expect(roleReceivesTips('barman', cfg)).toBe(true)   // no está en cfg
    expect(roleReceivesTips('manager', null)).toBe(true)
    expect(roleReceivesTips('manager', [])).toBe(true)
  })
})

describe('eligibleRoster — excluye roles no-elegibles, preserva a quien ya participa', () => {
  const cfg = [
    { role: 'salonero' as UserRole, points: 10, recibe_propina: true },
    { role: 'manager'  as UserRole, points: 10, recibe_propina: false },
  ]
  const employees = [empR('s1', 'salonero'), empR('m1', 'manager'), empR('r1', 'runner')]

  it('turno NUEVO: el rol no-elegible (manager) no aparece', () => {
    expect(eligibleRoster(employees, cfg).map(e => e.id).sort()).toEqual(['r1', 's1'])
  })
  it('manager con entrada previa (keepIds) → se PRESERVA (no re-tocar)', () => {
    const keep = new Set(['m1'])
    expect(eligibleRoster(employees, cfg, keep).map(e => e.id).sort()).toEqual(['m1', 'r1', 's1'])
  })
  it('null-safe: sin config → nadie se excluye', () => {
    expect(eligibleRoster(employees, null).map(e => e.id).sort()).toEqual(['m1', 'r1', 's1'])
  })
})
