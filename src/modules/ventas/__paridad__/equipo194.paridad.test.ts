// Paridad de la 194: lo que calcula `pos_mi_rendimiento_equipo` en la base TIENE que dar lo mismo que las reglas de
// la app (armarDiasMap → aggSalonero / aggGeneral, D4) con los mismos datos. Los datos son la fixture ficticia
// `equipo194.fixture.ts`; el lado de la base es `equipo194.staging.json`, la salida de la función en staging
// (transacción con ROLLBACK, 18-nov-2026 ~15:10, `194_pruebas.py --paridad`) para esa misma fixture. Si cambia una regla de la app (neta, PAX, persona,
// multiplicador, días), esta prueba cae: hay que cambiar la 194 (o una migración nueva) y volver a correr staging.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { armarDiasMap } from '../ventasDiasDesdePos'
import { aggGeneral, aggSalonero, allDates, allSaloneros, dayOfWeek, fusionarProductMap } from '../ventasUtils'
import { claveDeEmpleado } from '../../../shared/ndf/personasNdf'
import {
  CURADO_194, DESDE_194, FIXTURE_194, HASTA_194, NOMBRES_194, YO_194, sqlFixture194,
} from './equipo194.fixture'
import STAGING from './equipo194.staging.json'

/** Redondeo «lejos del cero», como `round(numeric, d)` de Postgres. */
function rnd(x: number | null, d: number): number | null {
  if (x === null || !Number.isFinite(x)) return null
  const f = 10 ** d
  const v = Math.abs(x) * f
  return Math.sign(x) * Math.round(v + 1e-9) / f
}
const mediana = (xs: number[]) => {
  const a = [...xs].sort((p, q) => p - q)
  if (a.length === 0) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const promedio = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)

function esperadoDesdeLaApp() {
  const { dias, pm: pmFam } = armarDiasMap(FIXTURE_194.tickets, FIXTURE_194.lineas,
    { desde: DESDE_194, hasta: HASTA_194 }, { uploadedAt: HASTA_194, nombres: NOMBRES_194, avisar: () => {} })
  const pm = fusionarProductMap(CURADO_194, pmFam)
  const fechas = allDates(dias)
  const yo = claveDeEmpleado({ full_name: NOMBRES_194[YO_194], pos_login: YO_194 }, NOMBRES_194, allSaloneros(dias))
  const pers = allSaloneros(dias)
    .map(n => ({ n, a: aggSalonero(n, fechas, dias, pm) }))
    .filter(p => p.a.total > 0)
    .map(({ n, a }) => ({
      n, total: a.total,
      // Sin PAX no hay venta por persona (la 194 deja afuera, la app pondría 0: ver el encabezado de la 194).
      prom_pax:    a.pax > 0 ? a.promPax : null,
      beb_pax:     a.pax > 0 ? a.bebPax : null,
      comida_pax:  a.pax > 0 ? a.iCom / a.pax : null,
      prom_ticket: a.iCom + a.iBeb > 0 ? a.promTicket : null,
      pax_dia:     a.days > 0 ? a.pax / a.days : null,
    }))
  const g = aggGeneral(fechas, dias, pm)
  const mio = pers.find(p => p.n === yo)!
  type K = 'prom_pax' | 'beb_pax' | 'comida_pax' | 'prom_ticket' | 'pax_dia'
  const vals = (k: K) => pers.map(p => p[k]).filter((v): v is number => v !== null)
  const pos = (k: K | 'total') => 1 + pers.filter(p => p.n !== yo && (p[k] ?? -Infinity) > (mio[k] as number)).length
  const dec = { prom_pax: -2, beb_pax: 2, comida_pax: 2, prom_ticket: -2, pax_dia: 1 } as const
  const resumen = (f: (xs: number[]) => number | null) =>
    Object.fromEntries((Object.keys(dec) as K[]).map(k => [k, rnd(f(vals(k)), dec[k])]))
  const porDow = [...new Set(fechas.map(dayOfWeek))].sort().map(dow => {
    const ds = fechas.filter(f => dayOfWeek(f) === dow)
    const gd = aggGeneral(ds, dias, pm)
    const n = allSaloneros(dias).filter(s => aggSalonero(s, ds, dias, pm).total > 0).length
    // Opción C: el Prom/PAX del local por día de semana sale siempre (n queda como dato de la fixture).
    void n
    return { dow, prom_pax: gd.pax > 0 ? rnd(gd.promPax, -2) : null }
  })
  return {
    personas: pers.length,
    ranking: { posicion: pos('total'), de: pers.length },
    general: {
      prom_pax: rnd(g.promPax, -2), comida_pax: rnd(g.pax > 0 ? g.iCom / g.pax : null, 2),
      beb_pax: rnd(g.bebPax, 2), prom_ticket: rnd(g.promTicket, -2),
    },
    mediana: resumen(mediana),
    promedio: resumen(promedio),
    mi_posicion: { prom_pax: pos('prom_pax'), beb_pax: pos('beb_pax'), comida_pax: pos('comida_pax'),
                   prom_ticket: pos('prom_ticket'), pax_dia: pos('pax_dia'), ventas: pos('total') },
    por_dow: porDow,
  }
}

describe('paridad 194: la base calcula como la app', () => {
  const app = esperadoDesdeLaApp()
  const db = STAGING as unknown as {
    personas: number; ranking: unknown; general: unknown
    equipo: { mediana: unknown; promedio: unknown; mi_posicion: unknown }; por_dow: unknown
  }

  it('la fixture ejercita lo que tiene que ejercitar (8 claves de persona, alias y vigencia)', () => {
    expect(app.personas).toBeGreaterThanOrEqual(6)
  })
  it('personas y ranking', () => {
    expect(db.personas).toBe(app.personas)
    expect(db.ranking).toEqual(app.ranking)
  })
  it('general del restaurante (D4, PAX, comida/PAX, bebida/PAX, ticket/ítem)', () => {
    expect(db.general).toEqual(app.general)
  })
  it('mediana y promedio por persona', () => {
    expect(db.equipo.mediana).toEqual(app.mediana)
    expect(db.equipo.promedio).toEqual(app.promedio)
  })
  it('mi posición en cada indicador', () => {
    expect(db.equipo.mi_posicion).toEqual(app.mi_posicion)
  })
  it('Prom/PAX del restaurante por día de semana', () => {
    expect(db.por_dow).toEqual(app.por_dow)
  })
  it.runIf(process.env.PARIDAD194_SQL === '1')('imprime el SQL de la fixture', () => {
    writeFileSync('/tmp/paridad194.sql', sqlFixture194())
    writeFileSync('/tmp/paridad194.app.json', JSON.stringify(app, null, 2))
  })
})
