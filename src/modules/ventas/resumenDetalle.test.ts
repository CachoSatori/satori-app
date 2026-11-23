// 3.5.2: margen bruto del mes en el «Resumen» y los meses que lee el «🖨 Reporte». Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { Meta } from '../../shared/types/ventas'
import { margenDelMes, rangosDelReporte } from './resumenDetalle'

const metas = (margen: Record<string, number>) => ({ restaurante: {}, margen, global: {}, salMetas: {} }) as unknown as Meta

describe('margenDelMes (lo de «Análisis → Detalle anual»: bruta × % ÷ 100)', () => {
  it('con % cargado: el ₡ sobre la venta bruta', () => {
    expect(margenDelMes(metas({ '2026-10': 32.5 }), '2026-10', 1_000_000)).toEqual({ pct: 32.5, crc: 325_000 })
  })
  it('sin % del mes, con 0 o sin metas: no hay margen (nunca ₡0)', () => {
    expect(margenDelMes(metas({ '2026-09': 30 }), '2026-10', 1_000_000)).toBeNull()
    expect(margenDelMes(metas({ '2026-10': 0 }), '2026-10', 1_000_000)).toBeNull()
    expect(margenDelMes(undefined, '2026-10', 1_000_000)).toBeNull()
  })
})

describe('rangosDelReporte: el mes, el anterior y el mismo mes del año pasado', () => {
  it('enero cruza el año', () => {
    expect(rangosDelReporte('2026-01')).toEqual([
      { desde: '2026-01-01', hasta: '2026-01-31' },
      { desde: '2025-12-01', hasta: '2025-12-31' },
      { desde: '2025-01-01', hasta: '2025-01-31' },
    ])
  })
  it('marzo de un año bisiesto: febrero con 29 días', () => {
    expect(rangosDelReporte('2028-03')[1]).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })
})
