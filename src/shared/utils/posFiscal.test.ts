import { describe, it, expect } from 'vitest'
import {
  splitNetIva, lineFinal, computeTotals, groupBySeat, SERVICE_CONFIG,
} from './posFiscal'
import type { BillItem } from './posFiscal'

// Caso de referencia de la dueña: MOJITO ₡4.500 final + Zacapa ₡3.000 = ₡7.500 final, IVA 13%.
const mojitoZacapa: BillItem = {
  product_name: 'MOJITO ZACAPA 23', qty: 1, price_final_crc: 4500, tax_type: 'iva13',
  modifiers: [{ name: 'Zacapa', price_delta_crc: 3000 }], seat: 1,
}
const mojitoSimple: BillItem = {
  product_name: 'MOJITO', qty: 1, price_final_crc: 4500, tax_type: 'iva13',
  modifiers: [{ name: 'Flor de Caña', price_delta_crc: 0 }], seat: 2,
}

describe('splitNetIva — desglose neto/IVA derivado del precio final', () => {
  it('₡7.500 final @ IVA 13% → neto 6637.17 + IVA 862.83', () => {
    const { neto, iva } = splitNetIva(7500, 'iva13')
    expect(neto).toBe(6637.17)
    expect(iva).toBe(862.83)
    expect(neto + iva).toBe(7500)
  })
  it('exento → todo es neto, IVA 0', () => {
    expect(splitNetIva(5000, 'exento')).toEqual({ neto: 5000, iva: 0 })
  })
  it('null-safety: precio no numérico = 0', () => {
    expect(splitNetIva(NaN as unknown as number, 'iva13')).toEqual({ neto: 0, iva: 0 })
  })
})

describe('lineFinal — base + deltas (todo IVA incluido) × qty', () => {
  it('base + delta del modificador', () => {
    expect(lineFinal(mojitoZacapa)).toBe(7500)
  })
  it('qty multiplica la línea completa', () => {
    expect(lineFinal({ ...mojitoZacapa, qty: 2 })).toBe(15000)
  })
})

describe('computeTotals — servicio 10% por canal', () => {
  it('SALÓN: servicio = 10% del neto, total = consumo + servicio', () => {
    const t = computeTotals([mojitoZacapa], 'salon')
    expect(t.consumo).toBe(7500)
    expect(t.neto).toBe(6637.17)
    expect(t.iva).toBe(862.83)
    expect(t.servicioAplica).toBe(true)
    expect(t.servicio).toBe(663.72)          // 10% de 6637.17
    expect(t.servicioIva).toBe(0)            // default: servicio sin IVA
    expect(t.total).toBe(8163.72)
  })
  it('BARRA: también cobra servicio', () => {
    expect(computeTotals([mojitoZacapa], 'barra').servicioAplica).toBe(true)
  })
  it('DELIVERY: NO cobra servicio, total = consumo', () => {
    const t = computeTotals([mojitoZacapa], 'delivery')
    expect(t.servicioAplica).toBe(false)
    expect(t.servicio).toBe(0)
    expect(t.total).toBe(7500)
  })
  it('mesa con varios ítems: suma consumo, neto e IVA por línea', () => {
    const t = computeTotals([mojitoZacapa, mojitoSimple], 'salon')
    expect(t.consumo).toBe(12000)            // 7500 + 4500
    expect(t.neto).toBe(round(6637.17 + 3982.30))
    expect(t.iva).toBe(round(862.83 + 517.70))
  })
  it('cuenta vacía → todo en cero', () => {
    const t = computeTotals([], 'salon')
    expect(t).toMatchObject({ consumo: 0, neto: 0, iva: 0, servicio: 0, total: 0 })
  })
})

describe('REGRESIÓN — ticket real de Nube de Fuego (calibración 2026-06-12)', () => {
  // Pre-cuenta + factura electrónica reales del sistema actual (idénticas en cálculo):
  // subtotal neto 314.250,37 → servicio 31.425,04 · IVA 40.852,55 · total 386.527,94.
  // La factura redondea POR LÍNEA; acá reconstruimos el consumo final equivalente
  // (neto × 1,13) en una línea → tolerancia de ±0,05 en el total agregado.
  it('reproduce servicio, IVA y total de la factura real', () => {
    const finalConIva = 355102.92   // = 314250.37 × 1.13 (precio final IVA incluido)
    const t = computeTotals([
      { product_name: 'CONSUMO MESA REAL', qty: 1, price_final_crc: finalConIva, modifiers: [], tax_type: 'iva13' },
    ], 'salon')
    expect(t.neto).toBeCloseTo(314250.37, 2)        // subtotal neto exacto
    expect(t.servicio).toBeCloseTo(31425.04, 2)     // 10% del NETO (no del total con IVA)
    expect(t.iva).toBeCloseTo(40852.55, 2)          // 13% solo del neto
    expect(t.servicioIva).toBe(0)                   // el servicio NO lleva IVA
    expect(Math.abs(t.total - 386527.94)).toBeLessThan(0.05)  // redondeo por línea de la factura
    // identidad del modelo confirmado: total = neto × 1,23
    expect(t.total).toBeCloseTo(314250.37 * 1.23, 1)
  })
})

describe('SERVICE_CONFIG — calibrado contra factura real (solo CIIU/CABYS pendiente)', () => {
  it('criterio confirmado: 10% sobre el neto, sin IVA, salón+barra', () => {
    expect(SERVICE_CONFIG.rate).toBe(0.10)
    expect(SERVICE_CONFIG.base).toBe('neto')
    expect(SERVICE_CONFIG.taxed).toBe(false)
    expect(SERVICE_CONFIG.channels).toEqual(['salon', 'barra'])
  })
})

describe('groupBySeat — vista por cliente de la cuenta', () => {
  it('agrupa los ítems por asiento', () => {
    const g = groupBySeat([mojitoZacapa, mojitoSimple])
    expect(g.get(1)).toHaveLength(1)
    expect(g.get(2)).toHaveLength(1)
  })
})

function round(n: number) { return Math.round(n * 100) / 100 }

describe('flag aplica_servicio por ítem (refinamiento 06-12)', () => {
  it('un ítem sin servicio (merchandising) NO aporta a la base del 10%', async () => {
    const { computeTotals } = await import('./posFiscal')
    const r = computeTotals([
      { product_name: 'ROLL', qty: 1, price_final_crc: 11300, modifiers: [], tax_type: 'iva13' },                          // neto 10000
      { product_name: 'GORRA SATORI', qty: 1, price_final_crc: 11300, modifiers: [], tax_type: 'iva13', applies_service: false },
    ], 'salon')
    expect(r.servicio).toBe(1000)        // 10% SOLO sobre el neto del roll
    expect(r.consumo).toBe(22600)        // el consumo sí incluye ambos
  })
  it('en delivery nadie paga servicio aunque el flag esté en true', async () => {
    const { computeTotals } = await import('./posFiscal')
    const r = computeTotals([{ product_name: 'ROLL', qty: 1, price_final_crc: 11300, modifiers: [], tax_type: 'iva13', applies_service: true }], 'delivery')
    expect(r.servicio).toBe(0)
  })
})
