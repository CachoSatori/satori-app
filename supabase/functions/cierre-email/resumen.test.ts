// Guarda de 36 h, lecturas acotadas y fallas que no rompen el correo. Datos FICTICIOS.
import { describe, it, expect } from 'vitest'
import * as edge from './ventasPos.gen.js'
import { cierreReciente, resumenParaCierre, VENTANA_HORAS, type DepsResumen, type LogicaResumen } from './resumen.ts'
import { diaFicticio } from './pruebas.fixtures.ts'

const L = edge as unknown as LogicaResumen
// 10-nov 23:40 CR = 11-nov 05:40 UTC (de noche en CR, R10)
const AHORA = new Date('2026-11-11T05:40:00Z')
const CIERRE = { session_date: '2026-11-10', created_at: '2026-11-11T05:35:00Z', location_id: 'santa-teresa' }

function deps(over: Partial<DepsResumen> = {}) {
  const lecturas: string[] = []
  const pedidos: string[][] = []
  const d: DepsResumen = {
    logica: L,
    leerVentana: async (dia, local) => { lecturas.push(`${local}:${dia}`); return diaFicticio(dia, dia === '2026-11-10' ? 1.2 : 1) },
    leerNombres: async (logins) => { pedidos.push(logins); return { '901': 'NOMBRE FICTICIO UNO' } },
    ahora: AHORA,
    ...over,
  }
  return { d, lecturas, pedidos }
}

describe('cierreReciente (36 h)', () => {
  it('acepta el cierre recién creado de hoy y el de ayer creado de madrugada', () => {
    expect(VENTANA_HORAS).toBe(36)
    expect(cierreReciente(CIERRE, AHORA)).toBe(true)
    expect(cierreReciente({ ...CIERRE, created_at: '2026-11-10T20:00:00Z' }, AHORA)).toBe(true)
  })
  it('rechaza un cierre creado hace más de 36 h', () => {
    expect(cierreReciente({ ...CIERRE, created_at: '2026-11-09T17:00:00Z' }, AHORA)).toBe(false)
  })
  it('rechaza un cierre NUEVO con fecha de sesión vieja (no sirve para leer días viejos)', () => {
    expect(cierreReciente({ ...CIERRE, session_date: '2026-10-01' }, AHORA)).toBe(false)
    expect(cierreReciente({ ...CIERRE, session_date: '2026-11-08' }, AHORA)).toBe(false)
  })
  it('rechaza fecha futura, created_at futuro o ilegible', () => {
    expect(cierreReciente({ ...CIERRE, session_date: '2026-11-12' }, AHORA)).toBe(false)
    expect(cierreReciente({ ...CIERRE, created_at: '2026-11-12T05:00:00Z' }, AHORA)).toBe(false)
    expect(cierreReciente({ ...CIERRE, created_at: null }, AHORA)).toBe(false)
  })
})

describe('resumenParaCierre', () => {
  it('lee SOLO la jornada del cierre y la de −7, del local del cierre, y nombres solo de los destacados', async () => {
    const { d, lecturas, pedidos } = deps()
    const r = await resumenParaCierre(CIERRE, d)
    expect(r.motivo).toBeNull()
    expect(lecturas).toEqual(['santa-teresa:2026-11-10', 'santa-teresa:2026-11-03'])
    expect(pedidos).toEqual([['901', '902']])   // más vendió y mejor promedio, nadie más
    expect(r.resumen?.actual.dia).toBe('2026-11-10')
    expect(r.resumen?.anterior?.dia).toBe('2026-11-03')
    expect(r.resumen?.actual.masVendio?.nombre).toBe('NOMBRE FICTICIO UNO')
    expect(r.resumen?.actual.ventaNeta).toBeGreaterThan(r.resumen!.anterior!.ventaNeta)
  })

  it('cierre viejo → sin resumen y SIN ninguna lectura', async () => {
    const { d, lecturas, pedidos } = deps()
    const r = await resumenParaCierre({ ...CIERRE, created_at: '2026-11-01T05:00:00Z' }, d)
    expect(r).toEqual({ resumen: null, motivo: 'cierre_viejo' })
    expect(lecturas).toEqual([])
    expect(pedidos).toEqual([])
  })

  it('falla la lectura del día → sin resumen, motivo fijo (el correo sale igual)', async () => {
    const { d } = deps({ leerVentana: async () => { throw new Error('lectura pos_tickets: timeout ₡123456') } })
    expect(await resumenParaCierre(CIERRE, d)).toEqual({ resumen: null, motivo: 'error_lectura' })
  })

  it('falla solo la semana pasada → resumen del día sin comparación', async () => {
    const { d } = deps({ leerVentana: async (dia) => { if (dia !== '2026-11-10') throw new Error('x'); return diaFicticio(dia) } })
    const r = await resumenParaCierre(CIERRE, d)
    expect(r.resumen?.actual.facturas).toBeGreaterThan(0)
    expect(r.resumen?.anterior).toBeNull()
  })

  it('fallan los nombres → destacado sin nombre, resumen igual', async () => {
    const { d } = deps({ leerNombres: async () => { throw new Error('x') } })
    const r = await resumenParaCierre(CIERRE, d)
    expect(r.resumen?.actual.masVendio?.login).toBe('901')
    expect(r.resumen?.actual.masVendio?.nombre).toBeNull()
  })

  it('sin location_id → el local por defecto', async () => {
    const { d, lecturas } = deps()
    await resumenParaCierre({ ...CIERRE, location_id: null }, d)
    expect(lecturas[0]).toBe('santa-teresa:2026-11-10')
  })
})
