// Fechas del reporte mensual (fechas.ts) + guarda estática sobre index.ts.
// Bug de prod (logs del 01/10, 15/10, 01/11 y 15/11/2026): rango `${ym}-01`…`${ym}-31` para todo mes →
// Postgres «date/time field value out of range: "2026-09-31"» → 400 → el reporte leía «sin datos».
// Los crons corren a las 08:00 UTC = 02:00 CR (jobs 3 y 4: `0 8 1 * *` y `0 8 15 * *`).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { diasDelMes, rangoMes, mesAnterior, mesActualCR, mesPorDefectoCR } from './fechas'

/** ¿`YYYY-MM-DD` es una fecha de calendario real? (lo que Postgres acepta para `date`). */
function fechaReal(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3])
}

// ── Reproducción del código de prod (v20, rama claude/sec-02-monthly-report-fn) ─────────────────────
// Mes por defecto: toLocaleString CR → Date local → setMonth(-1). En el runtime (UTC) equivale a esto:
function mesDefectoViejo(ahora: Date): string {
  const cr = new Date(ahora.getTime() - 6 * 3600 * 1000)
  const d = new Date(Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth(), cr.getUTCDate()))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const hastaViejo = (ym: string) => `${ym}-31`

// fecha del cron/llamada · mes reportado · rango esperado · mes anterior (para «vs mes anterior»)
const CASOS: Array<{ cuando: string; ym: string; hasta: string; prev: string; prevHasta: string }> = [
  { cuando: '2026-11-01T08:00:00Z', ym: '2026-10', hasta: '2026-10-31', prev: '2026-09', prevHasta: '2026-09-30' },
  { cuando: '2026-11-15T08:00:00Z', ym: '2026-10', hasta: '2026-10-31', prev: '2026-09', prevHasta: '2026-09-30' },
  { cuando: '2026-12-01T08:00:00Z', ym: '2026-11', hasta: '2026-11-30', prev: '2026-10', prevHasta: '2026-10-31' },
  { cuando: '2026-12-15T08:00:00Z', ym: '2026-11', hasta: '2026-11-30', prev: '2026-10', prevHasta: '2026-10-31' },
  { cuando: '2027-01-01T08:00:00Z', ym: '2026-12', hasta: '2026-12-31', prev: '2026-11', prevHasta: '2026-11-30' },
  { cuando: '2027-03-01T08:00:00Z', ym: '2027-02', hasta: '2027-02-28', prev: '2027-01', prevHasta: '2027-01-31' },
  { cuando: '2027-03-15T08:00:00Z', ym: '2027-02', hasta: '2027-02-28', prev: '2027-01', prevHasta: '2027-01-31' },
  { cuando: '2027-04-01T08:00:00Z', ym: '2027-03', hasta: '2027-03-31', prev: '2027-02', prevHasta: '2027-02-28' },
  { cuando: '2028-03-01T08:00:00Z', ym: '2028-02', hasta: '2028-02-29', prev: '2028-01', prevHasta: '2028-01-31' },
  // Botón de Admin sin mes, un 31 de mes largo a mediodía CR (18:00 UTC): el viejo desbordaba al mes en curso.
  { cuando: '2027-03-31T18:00:00Z', ym: '2027-02', hasta: '2027-02-28', prev: '2027-01', prevHasta: '2027-01-31' },
  { cuando: '2027-05-31T18:00:00Z', ym: '2027-04', hasta: '2027-04-30', prev: '2027-03', prevHasta: '2027-03-31' },
  { cuando: '2027-07-31T18:00:00Z', ym: '2027-06', hasta: '2027-06-30', prev: '2027-05', prevHasta: '2027-05-31' },
  { cuando: '2026-10-31T18:00:00Z', ym: '2026-09', hasta: '2026-09-30', prev: '2026-08', prevHasta: '2026-08-31' },
  { cuando: '2026-12-31T18:00:00Z', ym: '2026-11', hasta: '2026-11-30', prev: '2026-10', prevHasta: '2026-10-31' },
  { cuando: '2027-01-31T18:00:00Z', ym: '2026-12', hasta: '2026-12-31', prev: '2026-11', prevHasta: '2026-11-30' },
  // Noche en CR: 30-nov 23:30 CR = 01-dic 05:30 UTC → sigue siendo noviembre en CR → reporta octubre.
  { cuando: '2026-12-01T05:30:00Z', ym: '2026-10', hasta: '2026-10-31', prev: '2026-09', prevHasta: '2026-09-30' },
  // 01-ene 00:30 CR = 06:30 UTC: ya es enero en CR → diciembre del año anterior.
  { cuando: '2027-01-01T06:30:00Z', ym: '2026-12', hasta: '2026-12-31', prev: '2026-11', prevHasta: '2026-11-30' },
]

describe('fechas del reporte — mes por defecto y rangos (hora CR, sin desbordes)', () => {
  for (const c of CASOS) {
    it(`${c.cuando} → ${c.ym} (${c.ym}-01…${c.hasta}), anterior ${c.prev}`, () => {
      const ym = mesPorDefectoCR(new Date(c.cuando))
      expect(ym).toBe(c.ym)
      expect(rangoMes(ym)).toEqual({ desde: `${c.ym}-01`, hasta: c.hasta })
      expect(mesAnterior(ym)).toBe(c.prev)
      expect(rangoMes(mesAnterior(ym))).toEqual({ desde: `${c.prev}-01`, hasta: c.prevHasta })
      expect(fechaReal(rangoMes(ym).hasta)).toBe(true)
      expect(fechaReal(rangoMes(mesAnterior(ym)).hasta)).toBe(true)
    })
  }

  it('los 12 meses de 2026, 2027 (no bisiesto), 2028 (bisiesto) y 2100 (no bisiesto): último día real', () => {
    const esperado = (y: number) => [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    for (const y of [2026, 2027, 2028, 2100]) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, '0')}`
        expect(diasDelMes(ym)).toBe(esperado(y)[m - 1])
        const { hasta } = rangoMes(ym)
        expect(fechaReal(hasta)).toBe(true)
        // el día siguiente a `hasta` ya es otro mes (no se queda corto)
        const sig = new Date(Date.UTC(y, m - 1, Number(hasta.slice(8)) + 1))
        expect(sig.getUTCMonth() + 1).not.toBe(m)
      }
    }
  })

  it('mesAnterior cruza el año y mesActualCR usa UTC-6 fijo', () => {
    expect(mesAnterior('2027-01')).toBe('2026-12')
    expect(mesAnterior('2026-03')).toBe('2026-02')
    expect(mesActualCR(new Date('2026-12-01T05:59:59Z'))).toBe('2026-11')
    expect(mesActualCR(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12')
  })

  it('rechaza meses mal formados', () => {
    for (const bad of ['2026-13', '2026-00', '2026-9', '26-09', '']) expect(() => rangoMes(bad)).toThrow()
  })
})

describe('reproducción del bug de prod (documenta qué fallaba; no corre en prod)', () => {
  it('01-nov y 15-nov: octubre OK, pero el mes anterior pedía "2026-09-31" → «vs mes anterior» vacío', () => {
    for (const cuando of ['2026-11-01T08:00:00Z', '2026-11-15T08:00:00Z']) {
      const ym = mesDefectoViejo(new Date(cuando))
      expect(ym).toBe('2026-10')
      expect(fechaReal(hastaViejo(ym))).toBe(true)
      expect(hastaViejo(mesAnterior(ym))).toBe('2026-09-31')
      expect(fechaReal(hastaViejo(mesAnterior(ym)))).toBe(false)
    }
  })
  it('01-dic, 15-dic, 01-mar y 15-mar: el mes reportado mismo es inválido → «sin datos» → no sale correo', () => {
    for (const cuando of ['2026-12-01T08:00:00Z', '2026-12-15T08:00:00Z', '2027-03-01T08:00:00Z', '2027-03-15T08:00:00Z']) {
      expect(fechaReal(hastaViejo(mesDefectoViejo(new Date(cuando))))).toBe(false)
    }
  })
  it('31 de mes largo sin mes: el viejo devolvía el mes EN CURSO', () => {
    expect(mesDefectoViejo(new Date('2027-03-31T18:00:00Z'))).toBe('2027-03')
    expect(mesDefectoViejo(new Date('2027-05-31T18:00:00Z'))).toBe('2027-05')
    expect(mesDefectoViejo(new Date('2026-12-31T18:00:00Z'))).toBe('2026-12')
  })
})

describe('guarda estática: index.ts usa fechas.ts y no ignora errores de lectura', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  it('ningún rango con día fijo (`-31`, `-30`, `-28`) ni Date#setMonth / toLocaleString para el mes', () => {
    expect(codigo).not.toMatch(/\}-3[01]`/)
    expect(codigo).not.toMatch(/\}-2[89]`/)
    expect(codigo).not.toMatch(/setMonth\(/)
    expect(codigo).not.toMatch(/toLocaleString\('en-US'/)
  })
  it('los rangos y el mes por defecto salen de periodo.ts (que usa rangoMes / mesPorDefectoCR de fechas.ts)', () => {
    expect(codigo).toMatch(/from '\.\/periodo\.ts'/)
    expect(codigo).toMatch(/elegirPeriodo\(body\.periodo, ym, new Date\(\)\)/)
    // ninguna fecha armada a mano en index.ts: todo rango viene del plan
    expect(codigo).not.toMatch(/`\$\{ym\}-\d\d`/)
  })
  it('cada lectura de la base revisa su error (supabase-js no tira en un 400)', () => {
    const lecturas = (codigo.match(/await supabase\.from\(/g) ?? []).length
    const chequeos = (codigo.match(/exigirLectura\('/g) ?? []).length
    // 16-nov: las 2 lecturas de `ventas_dias` salieron (ventas del PoS, en ventasPos.ts).
    expect(lecturas).toBe(5)
    expect(chequeos).toBe(lecturas)
  })
  it('ventasPos.ts revisa el error de cada lectura (tickets, líneas, nombres)', () => {
    const vp = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ventasPos.ts'), 'utf8')
    expect(vp).toMatch(/exigir\(etapa, error\)/)          // leerTodo: tickets y líneas
    expect(vp).toMatch(/exigir\('nombres', error\)/)
  })
})
