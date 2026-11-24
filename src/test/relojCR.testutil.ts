// Ayuda de PRUEBAS (no la carga la app): fija el reloj en una fecha de Costa Rica, de noche (R34).
//
// Por qué existe (gate rojo en `main` el martes 24-nov, #343): una prueba que arma sus fixtures o sus
// expectativas desde la fecha real (`todayCR()`, `new Date()`, `Date.now()`) pasa o cae según el día en
// que corra. Lo más traicionero es la noche en CR: de 18:00 a 24:00 la fecha UTC ya es la del día
// siguiente, así que un `toISOString().slice(0, 10)` o un `getUTCFullYear()` de más se ve solo a esa hora
// (y el 31-dic, en otro año).
//
// Uso (ver MiRendimiento.render.test.tsx y los archivos que lista R34):
//
//   describe.each(RELOJES_CR)('reloj fijo $hoy · $caso', reloj => {
//     conRelojCR(reloj)                    // beforeEach fija el reloj, afterEach lo suelta
//     it('…', () => { const hoy = todayCR(); … })
//   })
//
// Solo se finge `Date`: los temporizadores (setTimeout, promesas, `waitFor`) siguen siendo los reales.
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { todayCR } from '../shared/utils'

export interface RelojCR {
  /** La fecha de Costa Rica que tiene que dar `todayCR()` con el reloj fijo. */
  hoy: string
  /** El instante UTC que se fija (23:30 CR = 05:30 UTC del día siguiente). */
  iso: string
  caso: string
}

/**
 * La matriz de R34: un martes, fin de mes, 31-dic de noche y 1-ene — todos a las 23:30 CR, la hora en
 * que la fecha UTC ya es la del día siguiente.
 */
export const RELOJES_CR: readonly RelojCR[] = [
  { hoy: '2026-11-24', iso: '2026-11-25T05:30:00Z', caso: 'martes 23:30 CR' },
  { hoy: '2026-11-30', iso: '2026-12-01T05:30:00Z', caso: 'lunes 30-nov 23:30 CR, fin de mes (en UTC ya es diciembre)' },
  { hoy: '2026-12-31', iso: '2027-01-01T05:30:00Z', caso: '31-dic 23:30 CR (en UTC ya es 1-ene de otro año)' },
  { hoy: '2027-01-01', iso: '2027-01-02T05:30:00Z', caso: '1-ene 23:30 CR' },
]

/** Fija el reloj (solo `Date`) en `iso` y, si se da, verifica que `todayCR()` quedó en `hoyEsperado`. */
export function fijarRelojCR(iso: string, hoyEsperado?: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
  if (hoyEsperado !== undefined) expect(todayCR()).toBe(hoyEsperado)
}

/** Devuelve el reloj real. */
export function soltarRelojCR(): void {
  vi.useRealTimers()
}

/** Registra en el `describe` actual un beforeEach que fija `reloj` y un afterEach que lo suelta. */
export function conRelojCR(reloj: Pick<RelojCR, 'iso'> & Partial<Pick<RelojCR, 'hoy'>>): void {
  beforeEach(() => fijarRelojCR(reloj.iso, reloj.hoy))
  afterEach(soltarRelojCR)
}
