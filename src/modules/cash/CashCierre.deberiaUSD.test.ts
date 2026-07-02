import { describe, it, expect, vi } from 'vitest'

// calcDeberiaUSD vive en CashCierre.tsx (función pura exportada para test) — se mockean
// las dependencias del componente para no tocar red/DB al importar el módulo, igual que
// en CashTurno.mercaderia.test.tsx.
vi.mock('../../shared/api/cash', () => ({
  getCierresDia: vi.fn(),
  getAllCashMovements: vi.fn(),
  getCashSessions: vi.fn(),
  saveCierreParcial: vi.fn(),
  updateCierreCompleto: vi.fn(),
  recordCierreSales: vi.fn(),
  recordCierreRetiro: vi.fn(),
  discardCierreDia: vi.fn(),
  discardDiaCompleto: vi.fn(),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 640) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn() }))

import { calcDeberiaUSD } from './CashCierre'

describe('calcDeberiaUSD — cuadre USD del cierre (espeja la fórmula CRC)', () => {
  it('incluye el saldo USD de Caja Fuerte además de las ventas de ambas fases', () => {
    expect(calcDeberiaUSD(100, 50, 30)).toBe(180)
  })

  it('con saldo base 0 equivale a la fórmula vieja (solo ventas)', () => {
    expect(calcDeberiaUSD(0, 50, 30)).toBe(80)
  })

  it('un faltante ahora SE VE: si los dólares de CF no están físicos, contado < debería', () => {
    // Antes: debería = 40 (solo ventas) → contar 40 "cuadraba" aunque faltaran los $200 de CF.
    const deberia = calcDeberiaUSD(200, 40, 0)
    const contado = 40
    expect(deberia).toBe(240)
    expect(contado - deberia).toBe(-200) // el faltante queda expuesto
  })

  it('día sin ventas USD: debería = saldo base (los dólares de CF no desaparecen)', () => {
    expect(calcDeberiaUSD(120, 0, 0)).toBe(120)
  })
})
