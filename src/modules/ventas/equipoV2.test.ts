// Ventas v2 · 3.5.4 · «Equipo» — el cálculo puro (`equipoV2.ts`). Datos FICTICIOS.
import { describe, it, expect } from 'vitest'
import type { FacturaIndicador } from './indicadores'
import {
  icpPorNombre, normNombreIcp, ordenarEquipo, ventana12Semanas, vppPorSalonero, doceSemanas, evaluarEquipo,
  DIAS_PARA_TENDENCIA, MUESTRA_CHICA_SALONERO, armarEquipo, type FilaEquipo,
} from './equipoV2'
import type { DiasMap, Meta } from '../../shared/types/ventas'

/** Una factura de salón con pax, en la caja de la mañana (111) o de la noche (222) del día. */
const fac = (id: string, dia: string, login: string | null, neta: number, pax: number, turno: 'mañana' | 'noche'): FacturaIndicador => ({
  id, fecha_registra: `${dia}T${turno === 'mañana' ? '12' : '19'}:00:00-06:00`, estado: 'C', canal: 'salon',
  salonero_login: login, pax, pax_articulo: null, neta, cajero_login: turno === 'mañana' ? '111' : '222',
  fecha_cierra: `${dia}T${turno === 'mañana' ? '16' : '23'}:30:00-06:00`, total_crc: neta * 1.23, clase_ingreso: null,
})

const NOMBRES = { L1: 'PERSONA UNO', L2: 'PERSONA DOS' }
const DIA = '2026-11-10'

describe('vppPorSalonero · «contra el equipo de su turno»', () => {
  // Mañana: equipo a 5 000 por persona; noche: a 20 000. L1 trabaja solo de mañana a 6 000; L2 solo de noche a 18 000.
  const facturas = [
    fac('a', DIA, 'L1', 60_000, 10, 'mañana'),
    fac('b', DIA, 'X9', 40_000, 10, 'mañana'),   // otro salonero de la mañana (4 000)
    fac('c', DIA, 'L2', 180_000, 10, 'noche'),
    fac('d', DIA, 'X8', 220_000, 10, 'noche'),   // otro de la noche (22 000)
  ]
  const r = { desde: DIA, hasta: DIA }
  const { porNombre, equipo } = vppPorSalonero(facturas, NOMBRES, r)

  it('la del equipo es la D4 de todas las facturas', () => {
    expect(equipo.valor).toBe(500_000 / 40)
  })

  it('el de la mañana se compara con la mañana, no con el promedio del día', () => {
    // Equipo mañana = 100 000 / 20 = 5 000 → 6 000 es +20 %. Contra el día entero (12 500) daría −52 %.
    expect(porNombre.get('PERSONA UNO')!.vpp.valor).toBe(6_000)
    expect(porNombre.get('PERSONA UNO')!.vsTurno).toBeCloseTo(20, 6)
  })

  it('el de la noche se compara con la noche', () => {
    // Equipo noche = 400 000 / 20 = 20 000 → 18 000 es −10 %.
    expect(porNombre.get('PERSONA DOS')!.vsTurno).toBeCloseTo(-10, 6)
  })

  it('una persona que trabajó los dos turnos se pondera por SUS personas en cada uno', () => {
    const f2 = [...facturas, fac('e', DIA, 'L1', 30_000, 2, 'noche')]
    const { porNombre: p2 } = vppPorSalonero(f2, NOMBRES, r)
    const eqM = 100_000 / 20, eqN = 430_000 / 22
    const esperado = (10 * eqM + 2 * eqN) / 12
    expect(p2.get('PERSONA UNO')!.vsTurno).toBeCloseTo((90_000 / 12 / esperado - 1) * 100, 6)
  })

  it('una factura sin salonero no arma una fila', () => {
    const { porNombre: p3 } = vppPorSalonero([...facturas, fac('z', DIA, null, 10_000, 2, 'noche')], NOMBRES, r)
    expect([...p3.keys()].some(k => k.includes('null'))).toBe(false)
    expect(p3.size).toBe(4)
  })
})

describe('ordenarEquipo', () => {
  const f = (nombre: string, vpp: number | null, venta: number): FilaEquipo => ({
    nombre, venta, personas: 0, promPax: 0, bebPax: 0, ratioCB: 0, promPlato: 0, promBebida: 0, ticketItem: 0, dias: 1,
    pctDelEquipo: 0, muestraChica: false, productos: [],
    vpp: vpp === null ? null : { vpp: { valor: vpp } as never, vsTurno: null },
  })
  it('de mayor a menor; sin venta por persona, al final; a igual valor, por nombre', () => {
    const filas = [f('B', 10, 5), f('A', 10, 1), f('C', null, 9), f('D', 20, 2)]
    expect(ordenarEquipo(filas, 'vpp').map(x => x.nombre)).toEqual(['D', 'A', 'B', 'C'])
    expect(ordenarEquipo(filas, 'venta').map(x => x.nombre)).toEqual(['C', 'B', 'D', 'A'])
  })
})

describe('ICP por salonero (regla 5)', () => {
  const r = { desde: '2026-11-01', hasta: '2026-11-15' }
  const emp = [
    { id: 'e1', role: 'salonero', full_name: 'Persona Uno' },
    { id: 'e2', role: 'barman', full_name: 'Persona Barra' },
    { id: 'e3', role: 'salonero', full_name: 'Persona Sin Turnos' },
  ]
  const claves = (e: { full_name?: string | null }) => [normNombreIcp(e.full_name ?? '')]
  const tips = [
    { session_date: '2026-11-03', employee_id: 'e1', tip_amount_crc: 10_000 },
    { session_date: '2026-11-04', employee_id: 'e1', tip_amount_crc: 2_000, tip_amount_usd: 4, exchange_rate: 500 },
    { session_date: '2026-11-20', employee_id: 'e1', tip_amount_crc: 99_000 },   // fuera del período
    { session_date: '2026-11-03', employee_id: 'e2', tip_amount_crc: 5_000 },
  ]
  const propina = (f: { tip_amount_crc?: number | null; tip_amount_usd?: number | null; exchange_rate?: number | null }) =>
    (f.tip_amount_crc ?? 0) + (f.tip_amount_usd ?? 0) * (f.exchange_rate ?? 0)
  const m = icpPorNombre(tips, emp, r, ['PERSONA UNO', 'PERSONA BARRA', 'PERSONA SIN TURNOS'], () => 100_000, claves, propina)

  it('propina electrónica del período ÷ neta de sus mesas × 100 (USD al TC de la sesión; lo de fuera del período no)', () => {
    const x = m.get('PERSONA UNO') as { icp: number; propina: number }
    expect(x.propina).toBe(14_000)
    expect(x.icp).toBeCloseTo(14, 9)
  })
  it('barra: no aplica', () => { expect(m.get('PERSONA BARRA')).toBe('barra') })
  it('sin turnos de propina: «—» (null), nunca 0 %', () => { expect(m.get('PERSONA SIN TURNOS')).toBeNull() })
})

describe('evaluarEquipo · tendencia solo con 14 días trabajados', () => {
  const metas = { restaurante: {}, margen: {}, global: { promPax: 1_000 }, salMetas: {} } as unknown as Meta
  const sd = (total: number, pax: number) => ({ total, com: total, beb: 0, pax, iCom: 1, iBeb: 0, prods: [] })
  const mkDias = (n: number): DiasMap => Object.fromEntries(Array.from({ length: n }, (_, i) => {
    const f = `2026-10-${String(i + 1).padStart(2, '0')}`
    // Los primeros 7 días a 1 000 por persona, después a 1 500.
    return [f, { saloneros: { 'PERSONA UNO': sd(i < n - 7 ? 10_000 : 15_000, 10) } }]
  })) as unknown as DiasMap

  it(`con ${DIAS_PARA_TENDENCIA - 1} días no hay tendencia; con ${DIAS_PARA_TENDENCIA}, +50 %`, () => {
    for (const n of [DIAS_PARA_TENDENCIA - 1, DIAS_PARA_TENDENCIA]) {
      const dias = mkDias(n)
      const ev = evaluarEquipo(['PERSONA UNO'], Object.keys(dias), dias, {}, metas).get('PERSONA UNO')!
      if (n < DIAS_PARA_TENDENCIA) expect(ev.tendencia).toBeNull()
      else expect(ev.tendencia).toBeCloseTo(50, 6)
      expect(ev.racha).toBe(n)            // todos los días ≥ la meta de 1 000
      expect(ev.consistencia).toBe(100)   // es el único: siempre igual al general
    }
  })
})

describe('armarEquipo · muestra chica', () => {
  it(`menos de ${MUESTRA_CHICA_SALONERO} personas en el período → gris`, () => {
    const dias = { '2026-10-01': { saloneros: {
      'PERSONA UNO': { total: 50_000, com: 50_000, beb: 0, pax: MUESTRA_CHICA_SALONERO - 1, iCom: 1, iBeb: 0, prods: [] },
      'PERSONA DOS': { total: 50_000, com: 50_000, beb: 0, pax: MUESTRA_CHICA_SALONERO, iCom: 1, iBeb: 0, prods: [] },
    } } } as unknown as DiasMap
    const e = armarEquipo(dias, {}, ['2026-10-01'], null)
    expect(Object.fromEntries(e.filas.map(f => [f.nombre, f.muestraChica]))).toEqual({ 'PERSONA UNO': true, 'PERSONA DOS': false })
  })
})

describe('ficha · 12 semanas', () => {
  it('la ventana son los 84 días que terminan el último día del período', () => {
    expect(ventana12Semanas('2026-11-17')).toEqual({ desde: '2026-08-26', hasta: '2026-11-17' })
  })
  it('12 semanas de 7 días, la última termina el último día; su venta por persona y la del equipo', () => {
    const facturas = [fac('a', '2026-11-17', 'L1', 30_000, 3, 'noche'), fac('b', '2026-11-17', 'X9', 10_000, 2, 'noche')]
    const s = doceSemanas(facturas, NOMBRES, 'PERSONA UNO', '2026-11-17')
    expect(s).toHaveLength(12)
    expect(s[11]).toEqual({ desde: '2026-11-11', hasta: '2026-11-17', suya: 10_000, equipo: 8_000 })
    expect(s[0].desde).toBe('2026-08-26')
    expect(s[0].suya).toBeNull()
  })
})
