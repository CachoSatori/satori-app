// Las cajas de turno con su nombre canónico (firmado por Ismael, 2026-10-29).
//
// En prod, con FUENTE_VENTAS='xls', el Excel trae las cajas como «Cajero Turno Mañana» y
// «cajero turno tarde». El merge 9ada841 las buscaba por la clave exacta del PoS
// («Cajero turno mañana» / «Cajero turno tarde») y Cajeros, Hoy y Mix las dejaban en ₡0 o
// no las reconocían como caja. Estos son los nombres REALES del Excel de prod.
import { describe, it, expect } from 'vitest'

import {
  CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, claveCajeroDeTurno, esCajaDeTurno, normalizarNombreBalde,
} from './baldesNoMesero'
import { aggCajero, diaConCajasDeTurno, diasConCajasDeTurno, getDayStats, mixComBeb } from './ventasUtils'
import type { CajeroDay, DiaData, DiasMap, ProductMap, SaloneroDay } from '../../shared/types/ventas'

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0, ordenes: 0, ticketProm: 0, prods: [], ...o,
})
const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})
const dia = (saloneros: DiaData['saloneros'], fileName = 'ventas.xls'): DiaData => ({ fileName, uploadedAt: 'x', saloneros })

describe('claveCajeroDeTurno — sin mayúsculas, tildes ni espacios de más', () => {
  it.each([
    ['Cajero Turno Mañana', CLAVE_CAJERO_MANANA],   // nombre REAL del Excel de prod
    ['cajero turno tarde',  CLAVE_CAJERO_TARDE],    // nombre REAL del Excel de prod
    ['Cajero turno mañana', CLAVE_CAJERO_MANANA],   // clave del PoS
    ['Cajero turno tarde',  CLAVE_CAJERO_TARDE],
    ['CAJERO TURNO MANANA', CLAVE_CAJERO_MANANA],
    ['  cajero   turno  Mediodía ', CLAVE_CAJERO_MANANA],  // el «mediodía» del .xls es la mañana
  ])('%s → %s', (nombre, clave) => {
    expect(claveCajeroDeTurno(nombre)).toBe(clave)
    expect(esCajaDeTurno(nombre)).toBe(true)
  })

  it.each(['MAXO', 'Cajero-salón', 'Salón sin mesero', 'Sistema y otros', '', null])(
    '%s no es una caja de turno', (nombre) => {
      expect(claveCajeroDeTurno(nombre)).toBeNull()
    })

  it('normaliza tildes y mayúsculas', () => {
    expect(normalizarNombreBalde('  Cajero  Turno MAÑANA ')).toBe('cajero turno manana')
  })
})

describe('diaConCajasDeTurno — renombra a la clave canónica sin tocar la plata', () => {
  const xls = dia({
    GONZA: sal({ total: 95_451, pax: 4 }),
    'Cajero Turno Mañana': caj({ total: 90_756, salon: 20_000, delivery: 70_756, ordenes: 10, prods: [['ROLL', 2, 9_000]] }),
    'cajero turno tarde':  caj({ total: 56_345, salon: 0, delivery: 56_345, ordenes: 6 }),
  })

  it('las cajas del Excel pasan a las claves que buscan Cajeros y Hoy', () => {
    const d = diaConCajasDeTurno(xls)
    expect(Object.keys(d.saloneros).sort()).toEqual(['Cajero turno mañana', 'Cajero turno tarde', 'GONZA'])
    const dias = { '2026-10-05': d }
    expect(aggCajero(CLAVE_CAJERO_MANANA, ['2026-10-05'], dias).total).toBe(90_756)
    expect(aggCajero(CLAVE_CAJERO_TARDE,  ['2026-10-05'], dias).total).toBe(56_345)
  })

  it('no cambia la neta ni nada del día', () => {
    const antes = getDayStats(xls), despues = getDayStats(diaConCajasDeTurno(xls))
    expect(despues).toEqual(antes)
  })

  it('dos nombres para el mismo turno en el mismo día se SUMAN', () => {
    const d = diaConCajasDeTurno(dia({
      'Cajero Turno Mañana': caj({ total: 10_000, salon: 4_000, delivery: 6_000, ordenes: 2, prods: [['ROLL', 1, 5_000]] }),
      'cajero turno mañana': caj({ total: 5_000, salon: 0, delivery: 5_000, ordenes: 1, prods: [['ROLL', 1, 5_000]] }),
    }))
    const c = d.saloneros[CLAVE_CAJERO_MANANA] as CajeroDay
    expect(c).toMatchObject({ total: 15_000, salon: 4_000, delivery: 11_000, ordenes: 3, ticketProm: 5_000 })
    expect(c.prods).toEqual([['ROLL', 2, 10_000]])
    expect(Object.keys(d.saloneros)).toEqual([CLAVE_CAJERO_MANANA])
  })

  it('un día que ya está en claves canónicas vuelve IDÉNTICO (mismo objeto)', () => {
    const pos = dia({ 'Cajero turno mañana': caj({ total: 1 }), 'Cajero-salón': caj({ total: 2 }) }, 'ndf 2026-10-05')
    expect(diaConCajasDeTurno(pos)).toBe(pos)
  })

  it('un mesero que se llamara como una caja NO se toca (solo entradas con la marca esCajero)', () => {
    const raro = dia({ 'cajero turno tarde': sal({ total: 1_000 }) })
    expect(diaConCajasDeTurno(raro)).toBe(raro)
  })

  it('diasConCajasDeTurno aplica a todos los días', () => {
    const dias: DiasMap = { a: xls, b: xls }
    expect(Object.keys(diasConCajasDeTurno(dias).b.saloneros)).toContain(CLAVE_CAJERO_TARDE)
  })
})

describe('mixComBeb — cada día con su fuente', () => {
  const PM: ProductMap = {
    ROLL:     { tipo: 'comida', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
    IMPERIAL: { tipo: 'bebida', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
  }
  // Mismo contenido: el Excel dice com/beb = 1.000/1.000 en sus columnas, pero el ProductMap
  // sobre sus productos da 3.000/500. Un día del .xls tiene que usar el ProductMap (como antes).
  const s = sal({ total: 3_500, com: 1_000, beb: 1_000, prods: [['ROLL', 1, 3_000], ['IMPERIAL', 1, 500]] })

  it("día del .xls → ProductMap (la cuenta de siempre del modo 'xls')", () => {
    expect(mixComBeb({ d: dia({ MAXO: s }) }, ['d'], PM)).toEqual({ com: 3_000, beb: 500 })
  })

  it('día del PoS → familia (SaloneroDay.com/.beb)', () => {
    expect(mixComBeb({ d: dia({ MAXO: s }, 'ndf 2026-10-05') }, ['d'], PM)).toEqual({ com: 1_000, beb: 1_000 })
  })
})
