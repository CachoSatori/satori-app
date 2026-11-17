// @vitest-environment happy-dom
//
// Mix → Comparar (fase 1.3): con el mes de hoy elegido, va hasta AYER y los otros meses se cortan a los
// mismos días. Reloj de noche en CR: 17-nov 23:30 CR = 18-nov 05:30 UTC → hoy 17, ayer 16. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import VentasMix from './VentasMix'
import type { DiasMap, ProductInfo, ProductMap, SaloneroDay } from '../../shared/types/ventas'

const info = (o: Partial<ProductInfo>): ProductInfo =>
  ({ tipo: 'comida', clasificacion: 'SUSHI ROLLS', subclasificacion: '', multiplicador: 1, costo_unitario: 0, ...o }) as ProductInfo
const sal = (monto: number): SaloneroDay => ({
  pax: 0, total: monto, com: monto, beb: 0, iCom: 1, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [['Rollo de prueba', 1, monto]],
})
const pm: ProductMap = { 'Rollo de prueba': info({}) }
const dia = (monto: number) => ({ fileName: 'prueba', uploadedAt: '2026-11-01T12:00:00Z', saloneros: { 'Mesero A': sal(monto) } })
const dias: DiasMap = {
  '2026-10-05': dia(1_000),
  '2026-10-25': dia(9_000),   // después del 16: no entra en la comparación a la fecha
  '2026-11-05': dia(1_200),
  '2026-11-17': dia(5_000),   // HOY: no entra
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T05:30:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Mix → Comparar a la fecha', () => {
  it('noviembre (en curso) contra octubre: 1 al 16 de cada uno, rotulado en palabras', () => {
    render(<VentasMix dias={dias} pm={pm} />)
    fireEvent.click(screen.getByText('⇄ Comparar'))
    expect(screen.getByTestId('mix-aviso-a-la-fecha').textContent).toContain('noviembre 2026 va a la fecha: hasta ayer, 16 nov 2026')
    const rangos = screen.getAllByTestId('mix-rango').map(e => e.textContent)
    expect(rangos).toEqual(['1 al 16 de noviembre (16 días)', '1 al 16 de octubre (16 días)'])
    const kpis = document.body.textContent!
    expect(kpis).toContain('Nov 2026 · a la fecha')
    expect(kpis).toContain('Oct 2026 · mismos días')
    expect(kpis).toContain('₡1.200')        // noviembre sin hoy
    expect(kpis).toContain('▼ -16.7%')      // 1.000 contra 1.200 (antes: 10.000 contra 6.200)
    expect(kpis).not.toContain('₡6.200')
    expect(kpis).not.toContain('₡10.000')
  })

  it('dos meses cerrados: enteros y sin aviso', () => {
    render(<VentasMix dias={{ '2026-09-05': dia(700), '2026-10-25': dia(900) }} pm={pm} />)
    fireEvent.click(screen.getByText('⇄ Comparar'))
    expect(screen.queryByTestId('mix-aviso-a-la-fecha')).toBeNull()
    expect(screen.getAllByTestId('mix-rango').map(e => e.textContent))
      .toEqual(['1 al 31 de octubre (31 días)', '1 al 30 de septiembre (30 días)'])
  })
})
