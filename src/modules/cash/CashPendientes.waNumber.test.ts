// El botón WhatsApp de Pendientes arma wa.me, que EXIGE código de país: sin él, un número local CR
// (8 dígitos) no resuelve. waNumber normaliza a internacional (506…) sin duplicar si ya viene codeado.
import { describe, it, expect, vi } from 'vitest'

// Cortar la cadena de imports pesados de CashPendientes.tsx — solo queremos la función pura.
vi.mock('../../shared/api/cash', () => ({
  updateMovementStatus: vi.fn(), updateCashMovement: vi.fn(), sendPagoProveedorEmail: vi.fn(),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { waNumber } from './CashPendientes'

describe('waNumber — normaliza WhatsApp CR a internacional para wa.me', () => {
  it('local CR de 8 dígitos → 506 + número', () => {
    expect(waNumber('80000090')).toBe('50680000090')
  })
  it('ya con código CR (11 dígitos) → sin cambios', () => {
    expect(waNumber('50680000090')).toBe('50680000090')
  })
  it("'+506 8000 0090' con formato → 50680000090 (no duplica el 506)", () => {
    expect(waNumber('+506 8000 0090')).toBe('50680000090')
  })
  it('vacío / sin dígitos → cadena vacía', () => {
    expect(waNumber('')).toBe('')
    expect(waNumber('  ---  ')).toBe('')
  })
})
