// «Meses y temporadas» (Ventas v2 · 3.5.3, SPEC §5.4 ítem 4) — el cálculo, PURO. Reloj de NOCHE en CR: el corte se
// arma con «hoy» = 18-nov-2026 (23:30 CR), así que ayer = 17-nov. Datos ficticios.
import { describe, expect, it } from 'vitest'
import type { ContabilidadDay, HistMap } from '../../shared/types/ventas'
import { corteDe } from './aLaFecha'
import { CORTE_HIST, diasDeAnios, fechasConAnio, mesesTemporadas, rotuloCambio } from './mesesTemporadas'
import { CORTE_POS } from './ventasFuente'

const sumar = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const dia = (fecha: string, v: number): ContabilidadDay =>
  ({ fecha, ventaBruta: v, ventaNeta: v, iva: 0, serv: 0, salon: v * 0.8, delivery: v * 0.2, pax: 10, promPax: 0 })
function llenar(desde: string, hasta: string, v: number): ContabilidadDay[] {
  const out: ContabilidadDay[] = []
  for (let d = desde; d <= hasta; d = sumar(d, 1)) out.push(dia(d, v))
  return out
}

const c = corteDe('2026-11-18')
// 2025 entero a 100.000 por día y 2026 hasta HOY a 110.000 (hoy no tiene que entrar).
const DIAS = [...llenar('2025-01-01', '2025-12-31', 100_000), ...llenar('2026-01-01', '2026-11-18', 110_000)]

describe('mesesTemporadas · el corte del histórico viejo', () => {
  it('es el mismo día que `CORTE_POS` (el primer día del PoS)', () => {
    expect(CORTE_HIST).toBe(CORTE_POS)
  })

  it('diasDeAnios: `ventas_hist` solo ANTES del corte, el PoS solo DESDE el corte, nada después de ayer', () => {
    const hist: HistMap = {}
    for (const f of ['2023-12-31', '2024-01-04', '2024-01-05', '2024-02-01']) {
      hist[f] = { ventaBruta: 1, ventaNeta: 1, iva: 0, serv: 0, salon: 1, delivery: 0, pax: 1, promPax: 1, source: 'hist' }
    }
    const pos = [dia('2024-01-04', 9), dia('2024-01-05', 2), dia('2026-11-17', 3), dia('2026-11-18', 4)]
    const out = diasDeAnios(hist, pos, '2026-11-17')
    expect(out.map(d => [d.fecha, d.ventaNeta])).toEqual([
      ['2023-12-31', 1], ['2024-01-04', 1],            // del histórico viejo
      ['2024-01-05', 2], ['2026-11-17', 3],            // del PoS; el 18 (hoy) no entra
    ])
  })
})

describe('mesesTemporadas · a la fecha (hasta ayer), contra los mismos días', () => {
  const mt = mesesTemporadas(DIAS, c)

  it('años del más nuevo al más viejo; 2026 a la fecha (1-ene → 17-nov, 321 días) contra 2025 a la misma fecha: +10 %', () => {
    expect(mt.anios).toEqual([2026, 2025])
    expect(mt.anioVivo).toBe(true)
    const [t26, t25] = mt.tarjetas
    expect(t26).toMatchObject({ anio: 2026, vivo: true, rango: { desde: '2026-01-01', hasta: '2026-11-17' } })
    expect(t26.t.dias).toBe(321)
    expect(t26.t.ventaNeta).toBe(321 * 110_000)
    expect(t26.cambio).toMatchObject({ contra: 2025, rangoContra: { desde: '2025-01-01', hasta: '2025-11-17' } })
    expect(t26.cambio!.pct).toBeCloseTo(10, 6)
    expect(t25.cambio).toBeNull()
    expect(rotuloCambio(t26.cambio!)).toBe('2026 contra 2025: 1 ene – 17 nov 2026 contra 1 ene – 17 nov 2025')
  })

  it('el mes en curso: 1–17 nov de cada año, rotulado; diciembre (sin días en 2026) da «sin comparación», nunca −100 %', () => {
    const nov = mt.meses.find(f => f.mes === 11)!
    expect(nov.vivo).toBe(true)
    expect(nov.rangoVivo).toEqual({ desde: '2026-11-01', hasta: '2026-11-17' })
    expect(nov.valores.map(v => v.rango)).toEqual([{ desde: '2026-11-01', hasta: '2026-11-17' }, { desde: '2025-11-01', hasta: '2025-11-17' }])
    expect(nov.cambios[0].pct).toBeCloseTo(10, 6)
    const dic = mt.meses.find(f => f.mes === 12)!
    expect(dic.valores[0].t.dias).toBe(0)
    expect(dic.cambios[0].pct).toBeNull()
    // Octubre, cerrado: mes entero contra mes entero.
    const oct = mt.meses.find(f => f.mes === 10)!
    expect(oct.vivo).toBe(false)
    expect(oct.valores.map(v => v.t.dias)).toEqual([31, 31])
  })

  it('«A LA FECHA» compara; «AÑO COMPLETO» no compara el año en curso contra uno entero', () => {
    expect(mt.aLaFecha!.cambios[0].pct).toBeCloseTo(10, 6)
    expect(mt.completo.valores.map(v => v.t.ventaNeta)).toEqual([321 * 110_000, 365 * 100_000])
    expect(mt.completo.cambios[0].pct).toBeNull()
  })

  it('el 4.º trimestre va a la fecha (1-oct → 17-nov de cada año); los otros, enteros', () => {
    const q4 = mt.trimestres[3]
    expect(q4.vivo).toBe(true)
    expect(q4.valores.map(v => v.rango)).toEqual([{ desde: '2026-10-01', hasta: '2026-11-17' }, { desde: '2025-10-01', hasta: '2025-11-17' }])
    expect(q4.cambios[0]!.pct).toBeCloseTo(10, 6)
    expect(q4.cambios[1]).toBeNull()
    expect(mt.trimestres[0].vivo).toBe(false)
    expect(mt.trimestres[0].valores[1].rango).toEqual({ desde: '2025-01-01', hasta: '2025-03-31' })
  })

  it('el 31-dic el año ya no está en curso: «TOTAL» compara año entero contra año entero, sin fila «A LA FECHA»', () => {
    const fin = mesesTemporadas([...llenar('2025-01-01', '2025-12-31', 100_000), ...llenar('2026-01-01', '2026-12-31', 120_000)], corteDe('2027-01-01'))
    expect(fin.anioVivo).toBe(false)
    expect(fin.aLaFecha).toBeNull()
    expect(fin.completo.cambios[0].pct).toBeCloseTo(20, 6)
  })

  it('fechasConAnio siempre lleva el año; sin rango, «sin días»', () => {
    expect(fechasConAnio({ desde: '2025-11-01', hasta: '2025-11-17' })).toBe('1–17 nov 2025')
    expect(fechasConAnio(null)).toBe('sin días')
  })
})
