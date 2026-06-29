import { describe, it, expect } from 'vitest'
import { availableForCobertura } from './tipShiftHelpers'
import type { Employee } from '../../shared/types/database'

// Employee mínimo: el helper solo mira `id`; el resto se castea para el tipo.
const emp = (id: string, name: string): Employee =>
  ({ id, full_name: name } as unknown as Employee)

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
