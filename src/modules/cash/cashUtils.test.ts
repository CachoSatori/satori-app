import { describe, it, expect } from 'vitest'
import { saldoCajaFuerte } from './cashUtils'
import type { CashMovement } from '../../shared/types/database'

// Fila mínima de movimiento para el helper (el resto de columnas no participan).
function mov(over: Partial<CashMovement>): CashMovement {
  return {
    movement_type: 'ingreso',
    amount_crc: 0,
    amount_usd: 0,
    caja_origen: 'Caja Fuerte',
    status: 'aprobado',
    subcategory: '',
    ...over,
  } as CashMovement
}

describe('saldoCajaFuerte — la fórmula ÚNICA del saldo (tarjeta = cierre = simulador)', () => {
  it('suma ingresos y resta egresos (₡ y $)', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'ingreso', amount_crc: 100_000, amount_usd: 50 }),
      mov({ movement_type: 'egreso_mercaderia', amount_crc: 30_000, amount_usd: 10 }),
      mov({ movement_type: 'egreso_operativo', amount_crc: 5_000 }),
    ])
    expect(r.crc).toBe(65_000)
    expect(r.usd).toBe(40)
  })

  it('excluye pendientes (no descontaron plata todavía)', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'ingreso', amount_crc: 100_000 }),
      mov({ movement_type: 'egreso_mercaderia', amount_crc: 99_999, status: 'pendiente' }),
    ])
    expect(r.crc).toBe(100_000)
  })

  it('ignora movimientos de otras cajas (Caja Proveedores, Banco, Registradora)', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'ingreso', amount_crc: 50_000 }),
      mov({ movement_type: 'egreso_mercaderia', amount_crc: 20_000, caja_origen: 'Caja Proveedores' }),
      mov({ movement_type: 'egreso_operativo', amount_crc: 15_000, caja_origen: 'Banco' }),
    ])
    expect(r.crc).toBe(50_000)
  })

  it('traspasos por dirección: "→ Caja Fuerte" suma, el resto resta', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'traspaso', amount_crc: 200_000, subcategory: 'Banco → Caja Fuerte' }),
      mov({ movement_type: 'traspaso', amount_crc: 80_000, subcategory: 'Caja Fuerte → Banco' }),
    ])
    expect(r.crc).toBe(120_000)
  })

  it('la dirección del traspaso es case-insensitive y tolera espacios', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'traspaso', amount_crc: 10_000, subcategory: 'banco →   CAJA FUERTE' }),
    ])
    expect(r.crc).toBe(10_000)
  })

  it('el ajuste de saldo inicial (cargado como traspaso a Caja Fuerte) cuenta', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'traspaso', amount_crc: 534_750, amount_usd: 1_054, subcategory: 'Ajuste apertura → Caja Fuerte' }),
      mov({ movement_type: 'egreso_socios', amount_crc: 100_000 }),
    ])
    expect(r.crc).toBe(434_750)
    expect(r.usd).toBe(1_054)
  })

  it('montos null/undefined cuentan como 0 (sin NaN)', () => {
    const r = saldoCajaFuerte([
      mov({ movement_type: 'ingreso', amount_crc: null as unknown as number, amount_usd: undefined as unknown as number }),
      mov({ movement_type: 'ingreso', amount_crc: 1_000 }),
    ])
    expect(r.crc).toBe(1_000)
    expect(r.usd).toBe(0)
  })

  it('lista vacía → saldo 0/0', () => {
    expect(saldoCajaFuerte([])).toEqual({ crc: 0, usd: 0 })
  })
})
