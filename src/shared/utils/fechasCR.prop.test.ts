// Pruebas de PROPIEDADES de las fechas de caja: «hoy» es Costa Rica (UTC-6, sin horario de verano) — R10.
// `todayCR` / `dateCR` / `horaCR` de `src/shared/utils` (no se tocan). Se prueba todo minuto de cualquier día
// 2024–2035, con el borde 23:30 CR (= 05:30 UTC del día siguiente) forzado en una parte de los casos.
//
// Semilla fija (R11). Si cae, fast-check imprime semilla y `path`; otra: `FC_SEED=123 npx vitest run <archivo>`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fc from 'fast-check'
import { todayCR, dateCR, horaCR } from './index'

const SEED = Number(process.env.FC_SEED ?? 20261117)
fc.configureGlobal({ seed: SEED, numRuns: 400 })

const DIA_MS = 86_400_000
const BASE = Date.parse('2024-01-01T00:00:00Z')
const dia = fc.integer({ min: 0, max: 365 * 12 })                               // 2024-01-01 … ~2035
const minuto = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 1439 }) },
  { weight: 1, arbitrary: fc.constantFrom(1410, 1439, 0, 1080) },              // 23:30, 23:59, 00:00, 18:00 CR
)
/** Instante UTC = medianoche CR del día k (06:00 UTC) + m minutos. */
const instante = (k: number, m: number) => BASE + k * DIA_MS + 6 * 3_600_000 + m * 60_000
const ymd = (k: number) => new Date(BASE + k * DIA_MS).toISOString().slice(0, 10)
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

afterEach(() => { vi.useRealTimers() })

describe('fechas CR — propiedades', () => {
  it('dateCR: cualquier minuto del día CR cae en ese día (incluido 23:30 CR = 05:30 UTC del siguiente)', () => {
    fc.assert(fc.property(dia, minuto, (k, m) => {
      const t = instante(k, m)
      expect(dateCR(t)).toBe(ymd(k))
      expect(dateCR(new Date(t).toISOString())).toBe(ymd(k))   // mismo resultado desde el string ISO (created_at)
      expect(horaCR(t)).toBe(hhmm(m))
    }))
  })

  it('dateCR es monótona: un instante posterior nunca da un día anterior', () => {
    fc.assert(fc.property(dia, minuto, fc.integer({ min: 0, max: 3 * DIA_MS }), (k, m, delta) => {
      const t = instante(k, m)
      expect(dateCR(t + delta) >= dateCR(t)).toBe(true)
    }))
  })

  it('todayCR() con el reloj fijado = dateCR(ahora), también de noche en CR', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fc.assert(fc.property(dia, minuto, (k, m) => {
      vi.setSystemTime(instante(k, m))
      expect(todayCR()).toBe(ymd(k))
      expect(todayCR()).toBe(dateCR(Date.now()))
    }), { numRuns: 200 })
  })

  it('entradas vacías o inválidas → cadena vacía (nunca una fecha inventada)', () => {
    fc.assert(fc.property(fc.constantFrom<unknown>(null, undefined, '', 'no-es-fecha', Number.NaN), x => {
      expect(dateCR(x as string)).toBe('')
      expect(horaCR(x as string)).toBe('')
    }))
  })
})
