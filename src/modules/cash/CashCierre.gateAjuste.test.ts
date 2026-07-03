import { describe, it, expect, vi } from 'vitest'

// cierreNecesitaAjuste (Opción B firmada) — el gate del motivo obligatorio cubre AMBAS monedas:
// |dif ₡| ≥ 500 O |dif USD| ≥ 1 (con datos USD presentes; null = sin datos). Antes era solo ₡:
// un faltante solo-USD cerraba sin pedir motivo (criterio 1 de la tarea).
// Se mockean las dependencias del componente para no tocar red/DB al importar el módulo —
// mismo harness que CashCierre.deberiaUSD.test.ts.
vi.mock('../../shared/api/cash', () => ({
  getCierresDia: vi.fn(),
  getAllCashMovements: vi.fn(),
  getCashSessions: vi.fn(),
  saveCierreParcial: vi.fn(),
  updateCierreCompleto: vi.fn(),
  recordCierreSales: vi.fn(),
  recordCierreRetiro: vi.fn(),
  recordCierreAjuste: vi.fn(),
  discardCierreDia: vi.fn(),
  discardDiaCompleto: vi.fn(),
  createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 640) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn() }))

import { cierreNecesitaAjuste } from './CashCierre'

describe('cierreNecesitaAjuste — gate de motivo obligatorio en ₡ Y US$ (Opción B)', () => {
  it('sin diferencias (null/null) no exige motivo', () => {
    expect(cierreNecesitaAjuste(null, null)).toBe(false)
  })

  it('₡ dentro de tolerancia (|dif| < 500) no exige motivo', () => {
    expect(cierreNecesitaAjuste(-499, null)).toBe(false)
    expect(cierreNecesitaAjuste(499, null)).toBe(false)
  })

  it('₡ en/sobre tolerancia exige motivo (comportamiento existente, intacto)', () => {
    expect(cierreNecesitaAjuste(-500, null)).toBe(true)
    expect(cierreNecesitaAjuste(12000, null)).toBe(true)
  })

  it('faltante SOLO-USD exige motivo (criterio 1 — antes cerraba sin pedir nada)', () => {
    expect(cierreNecesitaAjuste(null, -1)).toBe(true)
    expect(cierreNecesitaAjuste(0, -3.5)).toBe(true)
  })

  it('USD dentro de tolerancia (|dif| < $1) no exige motivo', () => {
    expect(cierreNecesitaAjuste(null, 0.99)).toBe(false)
    expect(cierreNecesitaAjuste(null, -0.5)).toBe(false)
  })

  it('mixto: cualquiera de las dos monedas sobre tolerancia dispara el gate', () => {
    expect(cierreNecesitaAjuste(-300, 1.5)).toBe(true)   // ₡ cuadra, $ no
    expect(cierreNecesitaAjuste(-2000, 0.2)).toBe(true)  // $ cuadra, ₡ no
  })
})
