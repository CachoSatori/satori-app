// @vitest-environment happy-dom
//
// Calendario (fase 1.3): la venta por persona es la de `indicadores.ts` (salón ÷ personas), no la neta
// total ÷ personas. Datos ficticios: 100.000 de neta, 80.000 de salón, 10 personas → ₡8.000/PAX.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import VentasCalendario from './VentasCalendario'
import type { HistMap } from '../../shared/types/ventas'

afterEach(() => cleanup())

const hist: HistMap = {
  '2026-10-05': { ventaBruta: 100_000, ventaNeta: 100_000, iva: 0, serv: 0, salon: 80_000, delivery: 20_000, pax: 10, promPax: 0, source: 'hist' },
}

describe('VentasCalendario', () => {
  it('Prom/PAX por día de semana y por día = salón ÷ personas', () => {
    render(<VentasCalendario dias={{}} hist={hist} />)
    const txt = document.body.textContent!
    expect(txt).toContain('₡8.000')
    expect(txt).not.toContain('₡10.000')
  })
})
