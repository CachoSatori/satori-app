import { describe, it, expect } from 'vitest'
import { computeOverShort, overShortEstado, OVER_SHORT_TOL } from './cierreStats'
import type { CashCierreDia } from '../../shared/types/database'

// Fixture mínimo de un cierre; se sobreescribe lo relevante por caso.
const cierre = (over: Partial<CashCierreDia>): CashCierreDia => ({
  id: 'c-' + (over.session_date ?? 'x'), session_date: '2026-07-01', manager: 'M',
  tipo: 'completo',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0,
  diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '', notas: '', tipo_cambio: 500,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

describe('overShortEstado — clasificación con tolerancia', () => {
  it('cuadra bajo la tolerancia (ambos signos)', () => {
    expect(overShortEstado(0)).toBe('cuadro')
    expect(overShortEstado(OVER_SHORT_TOL - 1)).toBe('cuadro')
    expect(overShortEstado(-(OVER_SHORT_TOL - 1))).toBe('cuadro')
  })
  it('sobrante en el umbral y por encima; faltante por debajo', () => {
    expect(overShortEstado(OVER_SHORT_TOL)).toBe('sobrante')
    expect(overShortEstado(1200)).toBe('sobrante')
    expect(overShortEstado(-OVER_SHORT_TOL)).toBe('faltante')
    expect(overShortEstado(-3000)).toBe('faltante')
  })
})

describe('computeOverShort — agregados sobre cierres con/sin diferencia', () => {
  const cierres = [
    cierre({ session_date: '2026-07-02', diferencia_crc: 0 }),                                    // cuadró
    cierre({ session_date: '2026-07-03', diferencia_crc: 1500, ajuste_tipo: 'Sobrante', ajuste_motivo: 'vuelto de más' }), // sobrante
    cierre({ session_date: '2026-07-04', diferencia_crc: -2000, ajuste_tipo: 'Faltante', ajuste_motivo: 'sin tiquete' }),  // faltante
    cierre({ session_date: '2026-07-05', diferencia_crc: 300 }),                                  // cuadró (bajo tolerancia)
  ]

  it('cuenta cuadraron vs no, y suma neta y absoluta', () => {
    const s = computeOverShort(cierres)
    expect(s.total).toBe(4)
    expect(s.nCuadraron).toBe(2)           // 0 y 300
    expect(s.nDescuadraron).toBe(2)        // 1500 y -2000
    expect(s.sumaNeta).toBe(1500 - 2000 + 300)   // -200
    expect(s.sumaAbs).toBe(1500 + 2000 + 300)    // 3800
  })

  it('ordena por fecha descendente y clasifica cada ítem', () => {
    const s = computeOverShort(cierres)
    expect(s.items.map(i => i.session_date)).toEqual(['2026-07-05', '2026-07-04', '2026-07-03', '2026-07-02'])
    const byDate = Object.fromEntries(s.items.map(i => [i.session_date, i.estado]))
    expect(byDate['2026-07-03']).toBe('sobrante')
    expect(byDate['2026-07-04']).toBe('faltante')
    expect(byDate['2026-07-02']).toBe('cuadro')
  })

  it('excluye cierres parciales (solo completo cuenta)', () => {
    const conParcial = [...cierres, cierre({ session_date: '2026-07-06', tipo: 'parcial_mediodia', diferencia_crc: 99999 })]
    const s = computeOverShort(conParcial)
    expect(s.total).toBe(4)                // el parcial NO entra
    expect(s.items.some(i => i.session_date === '2026-07-06')).toBe(false)
  })

  it('acota por mes cuando se pasa YYYY-MM', () => {
    const conJunio = [...cierres, cierre({ session_date: '2026-06-20', diferencia_crc: -5000 })]
    const soloJulio = computeOverShort(conJunio, '2026-07')
    expect(soloJulio.total).toBe(4)
    expect(soloJulio.sumaNeta).toBe(-200)
    const soloJunio = computeOverShort(conJunio, '2026-06')
    expect(soloJunio.total).toBe(1)
    expect(soloJunio.items[0].estado).toBe('faltante')
  })

  it('NULL-SAFE: diferencia_crc/ajuste null (fila vieja) cuenta como que cuadró (0), sin romper', () => {
    // database.ts miente: en la base estos campos son nullable. Un cierre viejo puede traerlos null.
    const nulo = cierre({ session_date: '2026-07-07' })
    ;(nulo as unknown as Record<string, unknown>).diferencia_crc = null
    ;(nulo as unknown as Record<string, unknown>).ajuste_tipo = null
    ;(nulo as unknown as Record<string, unknown>).ajuste_motivo = null
    const s = computeOverShort([nulo])
    expect(s.total).toBe(1)
    expect(s.nCuadraron).toBe(1)
    expect(s.sumaNeta).toBe(0)
    expect(s.items[0].estado).toBe('cuadro')
    expect(s.items[0].ajuste_tipo).toBe('')
  })
})
