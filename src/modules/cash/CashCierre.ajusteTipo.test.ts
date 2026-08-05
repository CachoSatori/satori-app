import { describe, it, expect } from 'vitest'
import { ajusteTipoPorSigno } from './ajusteTipo'
import { cierreNecesitaAjuste } from './CashCierre'

// Ítem 3 — la etiqueta del ajuste se DERIVA del signo de la diferencia (Faltante <0 · Sobrante >0).
// Regla de moneda: si hay diferencia en ₡ (≥ tolerancia), manda ₡; si solo hay en $, manda $.
// La plata ya se deriva del mismo signo en recordCierreAjuste — esto solo alinea la etiqueta.
describe('ajusteTipoPorSigno — etiqueta por signo (Ítem 3)', () => {
  it('₡ manda: Faltante si < 0, Sobrante si > 0', () => {
    expect(ajusteTipoPorSigno(-1500, null)).toBe('Faltante')
    expect(ajusteTipoPorSigno(1500, null)).toBe('Sobrante')
  })

  it('si hay diferencia en ₡, manda ₡ aunque el signo de $ sea el opuesto', () => {
    expect(ajusteTipoPorSigno(-1500, 5)).toBe('Faltante')   // ₡ faltante gana sobre $ sobrante
    expect(ajusteTipoPorSigno(1500, -5)).toBe('Sobrante')   // ₡ sobrante gana sobre $ faltante
  })

  it('solo $ (₡ null o sub-tolerancia): manda el signo de $', () => {
    expect(ajusteTipoPorSigno(null, -5)).toBe('Faltante')
    expect(ajusteTipoPorSigno(null, 5)).toBe('Sobrante')
    expect(ajusteTipoPorSigno(0, -5)).toBe('Faltante')      // |0|<500 → ₡ no cuenta → manda $
    expect(ajusteTipoPorSigno(200, 5)).toBe('Sobrante')     // |200|<500 → ₡ no cuenta → manda $
  })

  it('tolerancias alineadas con cierreNecesitaAjuste (₡500 · $1)', () => {
    expect(ajusteTipoPorSigno(-500, null)).toBe('Faltante')  // ₡ exactamente en tolerancia cuenta
    expect(cierreNecesitaAjuste(-500, null)).toBe(true)
    expect(cierreNecesitaAjuste(200, null)).toBe(false)      // ₡ sub-tolerancia y sin $ → no hay ajuste
  })

  it('sin diferencia relevante → default Faltante (no se usa: requiresAjuste sería false)', () => {
    expect(ajusteTipoPorSigno(null, null)).toBe('Faltante')
    expect(ajusteTipoPorSigno(200, 0.5)).toBe('Faltante')
  })
})
