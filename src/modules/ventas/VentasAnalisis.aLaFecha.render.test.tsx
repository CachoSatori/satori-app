// @vitest-environment happy-dom
//
// Ventas → Análisis (fases 0.2 y 1.3): reloj de NOCHE en CR (16-nov 23:30 CR = 17-nov 05:30 UTC).
// Hoy = 16-nov, ayer = 15-nov. Lo en curso va «a la fecha» (1-ene/1-nov → 15-nov) y se compara contra los
// MISMOS días del año anterior, nunca contra el año o el mes completo. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HistMap, Meta } from '../../shared/types/ventas'

vi.mock('./VentasPromPaxExplicado', () => ({ default: () => null }))
import VentasAnalisis from './VentasAnalisis'

const sumar = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Un día del resumen: neta `v`, salón = 80 % de la neta, 10 personas. */
function llenar(h: HistMap, desde: string, hasta: string, v: number) {
  for (let d = desde; d <= hasta; d = sumar(d, 1)) {
    h[d] = { ventaBruta: v, ventaNeta: v, iva: 0, serv: 0, salon: v * 0.8, delivery: v * 0.2, pax: 10, promPax: 0, source: 'hist' }
  }
}

const hist: HistMap = {}
llenar(hist, '2025-01-01', '2025-12-31', 100_000)
llenar(hist, '2026-01-01', '2026-11-16', 110_000)   // el 16 es HOY: no tiene que entrar
const metas: Meta = {
  restaurante: { '2026-11': 3_000_000 }, margen: {},
  global: { promPax: 0, bebPax: 0, ratioCB: 0, ticketItem: 0, ventas: 0 }, salMetas: {},
} as unknown as Meta

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Análisis → Año vs Año, a la fecha', () => {
  it('2026 va a la fecha (hasta ayer) contra 2025 a la misma fecha: +10 %, no −4 %', () => {
    render(<VentasAnalisis dias={{}} hist={hist} metas={metas} />)
    const card = screen.getByTestId('an-anio-2026').textContent!
    expect(card).toContain('a la fecha · 319 días')                 // 1-ene → 15-nov (hoy no entra)
    expect(card).toContain('₡35.090.000')                            // 319 × 110.000
    expect(card).toContain('▲ +10% vs 2025 a la misma fecha')
    expect(card).toContain('1 de enero al 15 de noviembre (319 días)')
    // Venta por persona D4 = salón ÷ personas = 88.000 ÷ 10 (antes: neta total ÷ personas = 11.000).
    expect(card).toContain('₡8.800/PAX')
    expect(screen.getByTestId('an-aviso-fecha').textContent).toContain('hasta ayer (hoy no entra)')
  })

  it('el mes en curso se compara contra los mismos días del año anterior', () => {
    render(<VentasAnalisis dias={{}} hist={hist} metas={metas} />)
    const fila = screen.getByTestId('an-mes-en-curso').textContent!
    expect(fila).toContain('Noviembre · a la fecha (1 al 15)')
    expect(fila).toContain('₡1.650.000')                             // 15 × 110.000
    expect(fila).toContain('₡1.500.000')                             // 15 × 100.000, no noviembre-2025 entero
    expect(fila).toContain('▲ +10.0%')
    // Diciembre 2026 no tiene datos: «—», nunca −100 %.
    expect(screen.getByTestId('an-tabla-meses').textContent).not.toContain('100.0%')
    const fila2 = screen.getByTestId('an-total-a-la-fecha').textContent!
    expect(fila2).toContain('A LA FECHA (al 15 de noviembre)')
    expect(fila2).toContain('▲ +10%')
    expect(screen.getByTestId('an-q4').textContent).toContain('a la fecha')
  })
})

describe('Análisis → Detalle anual', () => {
  it('mes en curso: vs mes anterior y vs año anterior, los mismos 15 días', () => {
    render(<VentasAnalisis dias={{}} hist={hist} metas={metas} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detalle anual' }))
    const fila = screen.getByTestId('an-detalle-mes-en-curso').textContent!
    expect(fila).toContain('a la fecha (1 al 15)')
    expect(fila).toContain('▲ +0.0%')       // 1–15 oct 2026, misma venta diaria
    expect(fila).toContain('▲ +10.0%')      // 1–15 nov 2025
    expect(fila).toContain('₡8.800')
    expect(screen.getByTestId('an-detalle-a-la-fecha').textContent).toContain('Se compara contra')
    // El 15 cierra la 1.ª quincena (no está en curso); la 2.ª solo tiene HOY, que no entra.
    expect(screen.queryByTestId('an-quincena-en-curso')).toBeNull()
    expect(screen.getByTestId('an-quincenas').textContent).not.toContain('Nov 16–fin')
  })

  it('quincena en curso (hoy 12-nov): 1 al 11 contra los primeros 11 días de la anterior y del año anterior', () => {
    vi.setSystemTime(new Date('2026-11-12T18:00:00Z'))
    render(<VentasAnalisis dias={{}} hist={hist} metas={metas} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detalle anual' }))
    const fila = screen.getByTestId('an-quincena-en-curso').textContent!
    expect(fila).toContain('Nov 1–15 · a la fecha (al 11)')
    expect(fila).toContain('₡1.210.000')                 // 11 × 110.000
    expect(fila).toContain('▲ +0.0%')                    // 16–26 oct 2026
    expect(fila).toContain('▲ +10.0%')                   // 1–11 nov 2025
  })
})

describe('Análisis → Proyección (hora CR)', () => {
  it('la meta del mes va a la fecha y el mes en curso se proyecta desde sus días cerrados', () => {
    render(<VentasAnalisis dias={{}} hist={hist} metas={metas} />)
    fireEvent.click(screen.getByRole('button', { name: 'Proyección' }))
    const p = screen.getByTestId('an-proyeccion').textContent!
    expect(p).toContain('Meta de noviembre a la fecha')
    expect(p).toContain('₡1.500.000')                    // 3.000.000 × 15 ÷ 30
    expect(p).toContain('vendido ₡1.650.000 (110%)')
    expect(p).toContain('2026 a la fecha (319 días, hasta ayer)')
    expect(p).toContain('Meta 2026')
    expect(p).not.toContain('Mes en curso — meta')
    const fila = screen.getByTestId('an-proy-mes-en-curso').textContent!
    expect(fila).toContain('← a la fecha (1 al 15)')
    expect(fila).toContain('₡3.300.000')                 // 1.650.000 ÷ 15 × 30
    expect(fila).toContain('110% a la fecha')
  })
})
