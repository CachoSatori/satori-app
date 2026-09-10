import { describe, it, expect } from 'vitest'
import { promPorPaxDe } from './ventasEnVivoTypes'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ En vivo · columna PROM/PAX de la mesa abierta — solo display, nunca plata             ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// El promedio por pax sale de dos campos que ya viajan en `MesaAbiertaDetalle` (montoEstimado,
// paxPedido). Lo que se clava acá es el fail-closed: si falta cualquiera de los dos o el pax es
// 0, la pantalla muestra «—», no un número inventado ni una división por cero.

describe('promPorPaxDe — monto estimado ÷ pax del pedido', () => {
  it('divide y redondea cuando hay monto y pax', () => {
    expect(promPorPaxDe(24_600, 2)).toBe(12_300)
    expect(promPorPaxDe(10_000, 3)).toBe(3_333)
    expect(promPorPaxDe(12_345, 1)).toBe(12_345)
  })

  it('es null sin monto estimado: el PoS no lo mandó, no se inventa', () => {
    expect(promPorPaxDe(null, 2)).toBeNull()
  })

  it('es null sin pax del pedido', () => {
    expect(promPorPaxDe(24_600, null)).toBeNull()
  })

  it('es null con pax 0 o negativo: nunca divide por cero', () => {
    expect(promPorPaxDe(24_600, 0)).toBeNull()
    expect(promPorPaxDe(24_600, -1)).toBeNull()
  })

  it('es null si ambos faltan', () => {
    expect(promPorPaxDe(null, null)).toBeNull()
  })

  it('un estimado de ₡0 con pax da 0: cortesía real, no dato ausente', () => {
    expect(promPorPaxDe(0, 2)).toBe(0)
  })

  it('no propaga NaN ni Infinity', () => {
    expect(promPorPaxDe(Number.NaN, 2)).toBeNull()
    expect(promPorPaxDe(24_600, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
