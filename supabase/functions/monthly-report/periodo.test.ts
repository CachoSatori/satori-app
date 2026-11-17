// Período del reporte (periodo.ts) — decisión del dueño del 16-nov-2026:
//   · día 15 (cron jobid 4, `0 8 15 * *` = 02:00 CR, body {"periodo":"quincena"}): 1.ª quincena (1–14) del mes en
//     curso vs 1–14 del mes anterior;
//   · día 1 (cron jobid 3, body {}): mes anterior completo vs el mes previo (sin cambios).
// Datos ficticios: no hay montos ni nombres acá, solo fechas y textos.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  elegirPeriodo, planReporte, quincenaCompleta, quincenaPorDefectoCR, rangoQuincena, diaActualCR, mesLargo,
} from './periodo'

const ok = (periodo: unknown, ym: string, cuando: string) => {
  const r = elegirPeriodo(periodo, ym, new Date(cuando))
  if (!r.ok) throw new Error(`esperaba ok, vino ${r.code}`)
  return r.plan
}

// Cron del 15: body {"periodo":"quincena"}, sin month.
const QUINCENAS: Array<{ cuando: string; ym: string; desde: string; hasta: string; cDesde: string; cHasta: string; mes: string; prev: string }> = [
  { cuando: '2026-11-15T08:00:00Z', ym: '2026-11', desde: '2026-11-01', hasta: '2026-11-14', cDesde: '2026-10-01', cHasta: '2026-10-14', mes: 'noviembre de 2026', prev: 'octubre' },
  { cuando: '2026-12-15T08:00:00Z', ym: '2026-12', desde: '2026-12-01', hasta: '2026-12-14', cDesde: '2026-11-01', cHasta: '2026-11-14', mes: 'diciembre de 2026', prev: 'noviembre' },
  { cuando: '2027-03-15T08:00:00Z', ym: '2027-03', desde: '2027-03-01', hasta: '2027-03-14', cDesde: '2027-02-01', cHasta: '2027-02-14', mes: 'marzo de 2027', prev: 'febrero' },
  { cuando: '2027-01-15T08:00:00Z', ym: '2027-01', desde: '2027-01-01', hasta: '2027-01-14', cDesde: '2026-12-01', cHasta: '2026-12-14', mes: 'enero de 2027', prev: 'diciembre' },
]

describe('cron del día 15 → 1.ª quincena del mes en curso vs la misma del mes anterior', () => {
  for (const c of QUINCENAS) {
    it(`${c.cuando} → ${c.desde}…${c.hasta} vs ${c.cDesde}…${c.cHasta}`, () => {
      const p = ok('quincena', '', c.cuando)
      expect(p.periodo).toBe('quincena')
      expect(p.ym).toBe(c.ym)
      expect(p.rango).toEqual({ desde: c.desde, hasta: c.hasta })
      expect(p.rangoComparado).toEqual({ desde: c.cDesde, hasta: c.cHasta })
      expect(p.titulo).toBe(`Reporte 1.ª quincena de ${c.mes}`)
      expect(p.etiqueta).toBe(`1.ª quincena de ${c.mes}`)
      expect(p.comparacion).toBe(`vs 1.ª quincena de ${c.prev}`)
      expect(p.asuntoVentas).toBe(`📈 Satori — Ventas · Reporte 1.ª quincena de ${c.mes}`)
      expect(p.asuntoPropinas).toBe(`💰 Satori — Propinas · Reporte 1.ª quincena de ${c.mes}`)
      expect(p.asuntoVentas).not.toMatch(/mensual/)
    })
  }
})

// Cron del 1: body {} (sin periodo) → mensual de siempre.
const MENSUALES: Array<{ cuando: string; ym: string; hasta: string; cDesde: string; cHasta: string; mes: string; prev: string }> = [
  { cuando: '2026-12-01T08:00:00Z', ym: '2026-11', hasta: '2026-11-30', cDesde: '2026-10-01', cHasta: '2026-10-31', mes: 'noviembre de 2026', prev: 'octubre' },
  { cuando: '2027-03-01T08:00:00Z', ym: '2027-02', hasta: '2027-02-28', cDesde: '2027-01-01', cHasta: '2027-01-31', mes: 'febrero de 2027', prev: 'enero' },
]

describe('cron del día 1 → mes anterior completo (intacto)', () => {
  for (const c of MENSUALES) {
    for (const periodo of [undefined, null, '', 'mes']) {
      it(`${c.cuando} periodo=${JSON.stringify(periodo)} → ${c.ym}-01…${c.hasta} vs ${c.cDesde}…${c.cHasta}`, () => {
        const p = ok(periodo, '', c.cuando)
        expect(p.periodo).toBe('mes')
        expect(p.ym).toBe(c.ym)
        expect(p.rango).toEqual({ desde: `${c.ym}-01`, hasta: c.hasta })
        expect(p.rangoComparado).toEqual({ desde: c.cDesde, hasta: c.cHasta })
        expect(p.titulo).toBe(`Reporte mensual de ${c.mes}`)
        expect(p.comparacion).toBe(`vs mes anterior (${c.prev})`)
        expect(p.asuntoVentas).toBe(`📈 Satori — Ventas · Reporte mensual de ${c.mes}`)
        expect(p.asuntoPropinas).toBe(`💰 Satori — Propinas · Reporte mensual de ${c.mes}`)
      })
    }
  }

  it('el día 15 SIN periodo sigue siendo el mensual (el cambio lo pide el cron, no la fecha)', () => {
    const p = ok(undefined, '', '2026-12-15T08:00:00Z')
    expect(p.periodo).toBe('mes')
    expect(p.rango).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' })
  })

  it('month explícito + mes: igual que antes', () => {
    const p = ok('mes', '2026-09', '2026-11-20T18:00:00Z')
    expect(p.rango).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(p.rangoComparado).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })
})

describe('quincena: bordes en hora CR y validación', () => {
  it('14-dic 23:30 CR (15-dic 05:30 UTC): la quincena de diciembre aún no terminó → por defecto la de noviembre', () => {
    const cuando = '2026-12-15T05:30:00Z'
    expect(diaActualCR(new Date(cuando))).toBe(14)
    expect(quincenaPorDefectoCR(new Date(cuando))).toBe('2026-11')
    expect(quincenaCompleta('2026-12', new Date(cuando))).toBe(false)
    expect(ok('quincena', '', cuando).rango).toEqual({ desde: '2026-11-01', hasta: '2026-11-14' })
  })
  it('15-dic 00:00 CR (06:00 UTC): ya es la de diciembre', () => {
    expect(quincenaPorDefectoCR(new Date('2026-12-15T06:00:00Z'))).toBe('2026-12')
  })
  it('31-dic 23:30 CR (01-ene 05:30 UTC): sigue siendo diciembre en CR', () => {
    expect(quincenaPorDefectoCR(new Date('2027-01-01T05:30:00Z'))).toBe('2026-12')
  })
  it('month explícito de una quincena incompleta → 400 quincena_incompleta', () => {
    const r = elegirPeriodo('quincena', '2026-12', new Date('2026-12-10T18:00:00Z'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('quincena_incompleta')
  })
  it('month explícito de un mes pasado → su quincena', () => {
    expect(ok('quincena', '2026-10', '2026-11-03T18:00:00Z').rango).toEqual({ desde: '2026-10-01', hasta: '2026-10-14' })
  })
  it('periodo desconocido → 400 periodo', () => {
    for (const bad of ['quincenal', 'QUINCENA', 2, true, {}]) {
      const r = elegirPeriodo(bad, '', new Date('2026-12-15T08:00:00Z'))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('periodo')
    }
  })
  it('febrero (28 o 29 días) también corta en el 14', () => {
    expect(rangoQuincena('2027-02')).toEqual({ desde: '2027-02-01', hasta: '2027-02-14' })
    expect(rangoQuincena('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-14' })
    expect(() => rangoQuincena('2027-13')).toThrow()
  })
  it('mesLargo y planReporte del mensual de enero comparan con diciembre del año anterior', () => {
    expect(mesLargo('2027-01')).toBe('enero de 2027')
    expect(planReporte('mes', '2027-01').rangoComparado).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
  })
})

describe('guarda estática: index.ts usa el plan para rangos, comparación y asuntos', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  it('ventas compara contra plan.rangoComparado y propinas usa plan.rango', () => {
    expect(codigo).toMatch(/calcVentas\(supabase, plan\.rango, plan\.rangoComparado\)/)
    expect(codigo).toMatch(/calcPropinas\(supabase, plan\.rango\)/)
  })
  it('asuntos y fila de comparación salen del plan (no texto fijo «vs mes anterior» ni asunto armado a mano)', () => {
    expect(codigo).toMatch(/send\(plan\.asuntoVentas, html\)/)
    expect(codigo).toMatch(/send\(plan\.asuntoPropinas, html\)/)
    expect(codigo).toMatch(/kRow\(plan\.comparacion,/)
    expect(codigo).not.toMatch(/'vs mes anterior'/)
  })
  it('un período inválido corta con 400 antes de leer la base', () => {
    expect(codigo).toMatch(/if \(!elegido\.ok\) return falla\(400, elegido\.code, elegido\.error\)/)
    expect(codigo.indexOf('elegirPeriodo(')).toBeLessThan(codigo.indexOf('await calcVentas('))
  })
})
