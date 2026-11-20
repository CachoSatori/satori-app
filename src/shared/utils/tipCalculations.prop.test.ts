// Pruebas de PROPIEDADES de la lógica de propinas (sagrado `tipCalculations.ts`, NO se toca).
//
// No prueban ejemplos sueltos: generan cientos de turnos ficticios (montos realistas en colones enteros,
// dólares con 2 decimales, TC 300–900 con 2 decimales) y verifican reglas que tienen que valer SIEMPRE.
// Las propiedades que el código de hoy NO cumple están marcadas `it.fails` con el contraejemplo mínimo
// que dio fast-check: son hallazgos documentados, no arreglos.
//
// Semilla fija (R11: determinista, sin reintentos). Si una propiedad cae, fast-check imprime la semilla
// y el `path` del contraejemplo; para explorar otra: `FC_SEED=123 npx vitest run <este archivo>`.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcTurno, calcHistory, BAR_ROLES, type DraftLine } from './tipCalculations'
import type { UserRole } from '../types/database'

const SEED = Number(process.env.FC_SEED ?? 20261117)
fc.configureGlobal({ seed: SEED, numRuns: 300 })

// ── Generadores (datos ficticios) ───────────────────────────────────────────────────────────
const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']
const crc = (max: number) => fc.integer({ min: 0, max })                       // colones enteros
const usd = (maxCents: number) => fc.integer({ min: 0, max: maxCents }).map(c => c / 100) // 2 decimales
const tc = fc.integer({ min: 30000, max: 90000 }).map(c => c / 100)            // 300,00 – 900,00
const horas = fc.integer({ min: 0, max: 28 }).map(x => x / 2)                  // 0 – 14 h, de a media
const vacioO = <T>(a: fc.Arbitrary<T>) => fc.oneof({ weight: 1, arbitrary: fc.constant('' as const) }, { weight: 6, arbitrary: a })

const linea = fc.record({
  role: fc.constantFrom(...ROLES),
  active: fc.boolean(),
  hours: vacioO(horas),
  propina_crc: vacioO(crc(150000)),
  propina_usd: vacioO(usd(30000)),
  pts_rol: fc.integer({ min: 0, max: 6 }),
})

const lineas = (min = 0) =>
  fc.array(linea, { minLength: min, maxLength: 14 }).map(ls =>
    ls.map((l, i): DraftLine => ({
      ...l,
      employeeId: `emp-${i}`,
      employeeName: `Persona Ficticia ${i}`,
      pts_val: 0,
      take_home: 0,
    })),
  )

const pozo = fc.record({ efCrc: crc(2_000_000), efUsd: usd(100_000), barra: crc(500_000), tc })

type Pozo = { efCrc: number; efUsd: number; barra: number; tc: number }
const correr = (ls: DraftLine[], p: Pozo) => calcTurno(ls, p.efCrc, p.efUsd, p.barra, p.tc)

const activas = (ls: DraftLine[]) => ls.filter(l => l.active)
const esBar = (l: DraftLine) => BAR_ROLES.includes(l.role)
const puntos = (ls: DraftLine[]) => activas(ls).reduce((s, l) => s + (Number(l.hours) || 0) * l.pts_rol, 0)
const horasBar = (ls: DraftLine[]) => activas(ls).filter(esBar).reduce((s, l) => s + (Number(l.hours) || 0), 0)
/** El pozo tiene a quién repartirse: hay puntos, y si hay pozo de barra, hay horas de barra. */
const repartible = (ls: DraftLine[], p: Pozo) => puntos(ls) > 0 && (p.barra === 0 || horasBar(ls) > 0)

const cerca = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

describe('calcTurno — propiedades', () => {
  it('conservación: Σ take_home de los activos = totalPool (sin redondeo, error de coma flotante ≤ 1e-9 relativo)', () => {
    fc.assert(fc.property(lineas(1), pozo, (ls, p) => {
      fc.pre(repartible(ls, p))
      const { totals, updatedLines } = correr(ls, p)
      const suma = activas(updatedLines).reduce((s, l) => s + l.take_home, 0)
      expect(cerca(suma, totals.totalPool)).toBe(true)
    }))
  })

  it('el pozo general en ₡ = efectivo ₡ + USD×TC + propinas de sala, sin pérdida mayor a 0,01 ₡ (cálculo exacto en enteros)', () => {
    fc.assert(fc.property(lineas(), pozo, (ls, p) => {
      const { totals } = correr(ls, p)
      // Exacto: todo en centésimas (USD en centavos × TC en céntimos → /10000 colones).
      const tcC = BigInt(Math.round(p.tc * 100))
      let exacto10k = BigInt(p.efCrc) * 10000n + BigInt(Math.round(p.efUsd * 100)) * tcC
      for (const l of activas(ls).filter(l => !esBar(l))) {
        exacto10k += BigInt(Number(l.propina_crc) || 0) * 10000n
        exacto10k += BigInt(Math.round((Number(l.propina_usd) || 0) * 100)) * tcC
      }
      expect(Math.abs(totals.generalPool - Number(exacto10k) / 10000)).toBeLessThanOrEqual(0.01)
    }))
  })

  it('nadie recibe negativo (horas, puntos y montos ≥ 0)', () => {
    fc.assert(fc.property(lineas(), pozo, (ls, p) => {
      for (const l of activas(correr(ls, p).updatedLines)) expect(l.take_home).toBeGreaterThanOrEqual(0)
    }))
  })

  it('invariancia al orden de los empleados: cada uno cobra lo mismo', () => {
    const conPermutacion = lineas(1).chain(ls =>
      fc.tuple(fc.constant(ls), fc.shuffledSubarray(ls, { minLength: ls.length, maxLength: ls.length })))
    fc.assert(fc.property(conPermutacion, pozo, ([ls, perm], p) => {
      const a = new Map(correr(ls, p).updatedLines.filter(l => l.active).map(l => [l.employeeId, l.take_home]))
      const b = new Map(correr(perm, p).updatedLines.filter(l => l.active).map(l => [l.employeeId, l.take_home]))
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
      for (const [id, v] of a) expect(cerca(v, b.get(id)!)).toBe(true)
    }))
  })

  it('monotonía: si un activo trabaja más horas (lo demás igual), no cobra menos', () => {
    fc.assert(fc.property(lineas(1), pozo, fc.nat(), fc.integer({ min: 1, max: 12 }).map(x => x / 2), (ls, p, k, extra) => {
      const idx = activas(ls).map(l => ls.indexOf(l))
      fc.pre(idx.length > 0)
      const i = idx[k % idx.length]
      const mas = ls.map((l, j) => (j === i ? { ...l, hours: (Number(l.hours) || 0) + extra } : l))
      const antes = correr(ls, p).updatedLines[i].take_home
      const despues = correr(mas, p).updatedLines[i].take_home
      expect(despues).toBeGreaterThanOrEqual(antes - 1e-9 * Math.max(1, antes))
    }))
  })

  it('las líneas inactivas no cambian lo que cobra nadie (ni sus propinas entran al pozo)', () => {
    fc.assert(fc.property(lineas(), lineas(1), pozo, (ls, extras, p) => {
      const inactivas = extras.map((l, i) => ({ ...l, active: false, employeeId: `inactivo-${i}` }))
      const base = correr(ls, p)
      const con = correr([...ls, ...inactivas], p)
      expect(con.totals).toEqual(base.totals)
      ls.forEach((l, i) => { if (l.active) expect(con.updatedLines[i].take_home).toBe(base.updatedLines[i].take_home) })
    }))
  })

  it('no muta las líneas que recibe', () => {
    fc.assert(fc.property(lineas(), pozo, (ls, p) => {
      const copia = structuredClone(ls)
      correr(ls, p)
      expect(ls).toEqual(copia)
    }))
  })

  it('0 empleados: tasa 0, sin puntos, sin líneas; pozo 0 y sin propinas: todos cobran 0', () => {
    fc.assert(fc.property(pozo, p => {
      const r = correr([], p)
      expect(r.updatedLines).toEqual([])
      expect(r.totals.totalPoints).toBe(0)
      expect(r.totals.generalRate).toBe(0)
    }))
    fc.assert(fc.property(lineas(), tc, (ls, t) => {
      const sinPropinas = ls.map(l => ({ ...l, propina_crc: 0, propina_usd: 0 }))
      for (const l of activas(calcTurno(sinPropinas, 0, 0, 0, t).updatedLines)) expect(l.take_home).toBe(0)
    }))
  })

  // ── HALLAZGOS (el código de hoy no cumple; no se arregla acá) ──────────────────────────────

  // H1 · Contraejemplo mínimo (fast-check, semilla 20261117, 39 reducciones): un salonero activo con 0,5 h y
  // 1 punto, sin nadie de barra; efectivo ₡0, pozo de barra ₡1. El pozo de barra NO se reparte (no hay horas
  // de barra) pero `totalPool` sí lo incluye: Σ cobrado = ₡0 contra totalPool = ₡1.
  it.fails('HALLAZGO H1: pozo de barra > 0 sin horas de barra → la barra no se reparte y Σ ≠ totalPool', () => {
    fc.assert(fc.property(lineas(1), pozo, (ls, p) => {
      fc.pre(puntos(ls) > 0)
      const { totals, updatedLines } = correr(ls, p)
      const suma = activas(updatedLines).reduce((s, l) => s + l.take_home, 0)
      expect(cerca(suma, totals.totalPool)).toBe(true)
    }))
  })

  // H2 · Contraejemplo mínimo (fast-check, semilla 20261117): sin líneas, efectivo $0,01 a TC 300 → pozo ₡3,
  // generalRate = 0, nadie cobra y los ₡3 quedan sin repartir sin que el cálculo lo marque (igual con
  // todos en 0 horas o 0 puntos).
  it.fails('HALLAZGO H2: pozo general > 0 sin puntos → nadie cobra y la plata queda sin repartir', () => {
    fc.assert(fc.property(lineas(), pozo, (ls, p) => {
      fc.pre(p.barra === 0)
      const { totals, updatedLines } = correr(ls, p)
      const suma = activas(updatedLines).reduce((s, l) => s + l.take_home, 0)
      expect(cerca(suma, totals.totalPool)).toBe(true)
    }))
  })
})

// ── calcHistory: el pago se redondea al colón POR PERSONA (Math.round) ───────────────────────

const historia = fc.array(
  fc.record({ role: fc.constantFrom(...ROLES), hours: horas, crc: crc(150000), usd: usd(30000), cubre: fc.option(fc.constantFrom(...ROLES), { nil: null }) }),
  { minLength: 1, maxLength: 14 },
)
const puntosRol = fc.record(Object.fromEntries(ROLES.map(r => [r, fc.integer({ min: 0, max: 6 })])) as Record<UserRole, fc.Arbitrary<number>>)

function armarHistoria(h: { role: UserRole; hours: number; crc: number; usd: number; cubre: UserRole | null }[], pts: Record<string, number>, p: Pozo) {
  const employees = h.map((e, i) => ({ id: `emp-${i}`, full_name: `Persona Ficticia ${i}`, role: e.role }))
  const entries = h.map((e, i) => ({
    employee_id: `emp-${i}`, hours_worked: e.hours, tip_amount_crc: e.crc, tip_amount_usd: e.usd,
    points: null, payout_crc: null, covered_role: e.cubre,
  }))
  const rolePoints = ROLES.map(r => ({ role: r, points: pts[r] }))
  return calcHistory(entries, employees, rolePoints, { pool_efectivo_crc: p.efCrc, pool_efectivo_usd: p.efUsd, pool_barra_crc: p.barra, exchange_rate: p.tc })
}
const repartibleH = (r: ReturnType<typeof calcHistory>) =>
  r.totalPoints > 0 && (r.barraPool === 0 || r.rows.some(x => BAR_ROLES.includes(x.role) && x.hours > 0))

describe('calcHistory — propiedades', () => {
  it('cada payout_crc es un colón entero ≥ 0', () => {
    fc.assert(fc.property(historia, puntosRol, pozo, (h, pts, p) => {
      for (const r of armarHistoria(h, pts, p).rows) {
        expect(Number.isInteger(r.payout_crc)).toBe(true)
        expect(r.payout_crc).toBeGreaterThanOrEqual(0)
      }
    }))
  })

  it('conservación al colón con la regla declarada (Math.round por persona): |Σ payout − totalPool| ≤ n/2', () => {
    fc.assert(fc.property(historia, puntosRol, pozo, (h, pts, p) => {
      const r = armarHistoria(h, pts, p)
      fc.pre(repartibleH(r))
      const suma = r.rows.reduce((s, x) => s + x.payout_crc, 0)
      expect(Math.abs(suma - r.totalPool)).toBeLessThanOrEqual(r.rows.length / 2 + 1e-6)
    }))
  })

  // H3 · El redondeo es por persona, sin «resto mayor»: Σ payout puede no dar el pozo redondeado.
  // Contraejemplo mínimo (fast-check, semilla 20261117): 2 personas con 0,5 h y 1 punto cada una (por
  // cobertura), pozo $795,24 a TC 300,11 = ₡238.661,48 → ₡119.330,74 c/u → round 119.331 × 2 = ₡238.662
  // contra round(pozo) = ₡238.661: se paga ₡1 de más. El desvío máximo es n/2 colones por turno.
  it.fails('HALLAZGO H3: Σ payout_crc = round(totalPool) exacto al colón', () => {
    fc.assert(fc.property(historia, puntosRol, pozo, (h, pts, p) => {
      const r = armarHistoria(h, pts, p)
      fc.pre(repartibleH(r))
      expect(r.rows.reduce((s, x) => s + x.payout_crc, 0)).toBe(Math.round(r.totalPool))
    }))
  })
})
