// Ventas · mesas internas (mig 193): la app y la base hablan del mismo número de mesa; las facturas internas salen de
// los indicadores de venta real y siguen en Contabilidad. Datos ficticios.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { alertaMesasSinPax, estimadorPorNeta, ventaPorPersona, type FacturaIndicador } from './indicadores'
import { normalizarMesa, ordenarMesas } from './mesasInternas'
import { calcularPeriodo } from './periodos'
import { armarLectura, avisoCalidad, cifrasDelRango } from './resumenV2'
import { conInternas } from './resumenV2Datos'
import { datos } from './resumenV2.fixture'
import { porDiaSemana, porTurnoHoras, mapaHorasTodos, ventaRealDelDia } from './tiemposV2'
import { esFuncionAusente, internasPorDia, marcarInternas, parsearInternas, parsearTiempos, type InternaRpc } from './tiemposV2Rpc'
import { juntarTiempos } from './tiemposV2Datos'

describe('normalizarMesa (igual que el CHECK de la 193)', () => {
  it('sin espacios ni ceros a la izquierda; vacío o raro → null', () => {
    expect(normalizarMesa(' 051 ')).toBe('51')
    expect(normalizarMesa('52')).toBe('52')
    expect(normalizarMesa('0')).toBeNull()
    expect(normalizarMesa('5 1')).toBeNull()
    expect(normalizarMesa('')).toBeNull()
    expect(normalizarMesa('12345678901')).toBeNull()
  })
  it('orden natural', () => expect(ordenarMesas(['53', '9', '51'])).toEqual(['9', '51', '53']))
})

const f = (o: Partial<FacturaIndicador> & { id: string }): FacturaIndicador => ({
  fecha_registra: '2026-10-05T20:00:00-06:00', estado: 'C', canal: 'salon', salonero_login: '026', pax: 2,
  pax_articulo: 2, neta: 10_000, cajero_login: '222', fecha_cierra: '2026-10-05T23:50:00-06:00', total_crc: 12_300, ...o,
})

describe('D4 y la alerta sin las mesas internas', () => {
  const r = { desde: '2026-10-05', hasta: '2026-10-05' }
  const normal = [f({ id: 'a' }), f({ id: 'b', neta: 20_000, pax: 2, pax_articulo: 2 }), f({ id: 'c', pax: 0, pax_articulo: 0 })]
  const interna = f({ id: 'i', neta: 90_000, pax: 0, pax_articulo: 0, interna: true })

  it('una mesa interna sale del numerador y del denominador, y se cuenta aparte', () => {
    const sin = ventaPorPersona(normal, r)
    const con = ventaPorPersona([...normal, interna], r)
    expect(con.valor).toBe(sin.valor)
    expect(con.netaSalon).toBe(sin.netaSalon)
    expect(con.facturasSinPax).toBe(sin.facturasSinPax)
    expect(con.mesasInternas).toBe(1)
    expect(con.netaMesasInternas).toBe(90_000)
    expect(con.facturasSalon).toBe(sin.facturasSalon + 1)
  })
  it('no entra en la referencia del estimador ni en la alerta de mesas sin pax', () => {
    const conPax = f({ id: 'j', neta: 1_000_000, pax: 1, pax_articulo: 1, interna: true })
    const e1 = estimadorPorNeta(normal), e2 = estimadorPorNeta([...normal, conPax])
    const u = { dia: '2026-10-05', turno: 'noche' as const, inferido: false }
    expect(e2.estimar(normal[2], u)).toBe(e1.estimar(normal[2], u))
    const a = alertaMesasSinPax([...normal, interna], r)
    expect(a.total).toEqual(alertaMesasSinPax(normal, r).total)
    expect(a.mesasInternas).toBe(1)
  })
})

describe('Resumen: Contabilidad igual, cuenta promedio sin internas', () => {
  const fx = datos('2026-09-01', 78)
  const lect = armarLectura(fx.tickets, fx.lineas)
  const oct = calcularPeriodo({ tipo: 'mes', dia: '2026-10-10', ancla: '2026-11-18' })
  const elegidas = lect.facturas.filter(x => x.canal === 'salon' && x.fecha_registra.startsWith('2026-10-0')).slice(0, 4)
  const internas: InternaRpc[] = elegidas.map(x => ({ id: x.id, dia: x.fecha_registra.slice(0, 10), hora: 20, canal: 'salon', netaCts: Math.round(x.neta * 100), pax: 2 }))
  const conInt = conInternas(lect, internas)

  it('venta neta, PAX y detalle por día NO cambian (venta fiscal)', () => {
    expect(cifrasDelRango(conInt, oct).totales).toEqual(cifrasDelRango(lect, oct).totales)
    expect(cifrasDelRango(conInt, oct).dias).toEqual(cifrasDelRango(lect, oct).dias)
  })
  it('cuenta promedio = (neta − internas) ÷ (facturas − internas); la venta por persona las saca', () => {
    const c = cifrasDelRango(conInt, oct)
    const netaInt = internas.reduce((s, i) => s + i.netaCts, 0) / 100
    expect(c.internas).toEqual({ facturas: 4, neta: netaInt })
    expect(c.cuentaPromedio).toBeCloseTo((c.totales.ventaNeta - netaInt) / (c.facturas - 4), 9)
    expect(c.vpp.mesasInternas).toBe(4)
    expect(c.vpp.netaSalon).toBeCloseTo(cifrasDelRango(lect, oct).vpp.netaSalon - netaInt, 6)
    expect(avisoCalidad(c).pctSinPax).toBeGreaterThanOrEqual(0)
  })
  it('sin la 193 (internas null): todo como antes', () => {
    const c = cifrasDelRango(conInternas(lect, null), oct)
    expect(c.internas).toEqual({ facturas: 0, neta: 0 })
    expect(c.cuentaPromedio).toBe(cifrasDelRango(lect, oct).cuentaPromedio)
  })
  it('marcar no toca las facturas que no son internas', () => {
    const m = marcarInternas(lect.facturas, internas)
    expect(m.filter(x => x.interna)).toHaveLength(4)
    expect(m.filter(x => !x.interna).every(x => lect.facturas.includes(x))).toBe(true)
  })
})

describe('Tiempos con la 193', () => {
  const dias = [
    { fecha: '2026-10-05', ventaBruta: 0, ventaNeta: 1_001, iva: 0, serv: 0, salon: 1_001, delivery: 0, pax: 10, promPax: 0 },
    { fecha: '2026-10-06', ventaBruta: 0, ventaNeta: 500, iva: 0, serv: 0, salon: 500, delivery: 0, pax: 4, promPax: 0 },
  ]
  const ints = internasPorDia([{ id: 'x', dia: '2026-10-05', hora: 20, canal: 'salon', netaCts: 20_040, pax: 3 }], '2026-10-01', '2026-10-31')
  const horas = [
    { dia: '2026-10-05', hora: 13, netaCts: 30_020, facturas: 1, pax: 2 },
    { dia: '2026-10-05', hora: 20, netaCts: 50_040, facturas: 1, pax: 5 },
    { dia: '2026-10-06', hora: 1, netaCts: 50_000, facturas: 1, pax: 4 },
  ]
  const vpp = { 'mañana': ventaPorPersona([], { desde: '2026-10-05', hasta: '2026-10-06' }), noche: ventaPorPersona([], { desde: '2026-10-05', hasta: '2026-10-06' }) }

  it('venta real = Contabilidad − internas (al colón); día de semana y turno dan lo mismo', () => {
    expect(ventaRealDelDia(dias[0], ints)).toBe(801)
    const semana = porDiaSemana(dias, ints)
    expect(semana[0].neta).toBe(801) // lunes
    expect(semana[0].personas).toBe(7)
    const t = porTurnoHoras(dias, horas, ints, vpp)
    expect(t.descuadres).toEqual([])
    expect(t.filas.map(x => x.neta)).toEqual([300, 1_001]) // 13 h → mediodía; 20 h y la 1 → noche
    expect(t.filas[0].neta + t.filas[1].neta).toBe(semana.reduce((s, x) => s + x.neta, 0))
  })
  it('si las horas no cuadran con la venta real, lo avisa', () => {
    expect(porTurnoHoras(dias, horas.slice(0, 1), ints, vpp).descuadres).toEqual(['2026-10-05', '2026-10-06'])
  })
  it('el mapa con todos los canales promedia por día abierto', () => {
    const m = mapaHorasTodos(horas, { desde: '2026-10-05', hasta: '2026-10-06' }, [1, 1, 0, 0, 0, 0, 0])
    expect(m.horas).toEqual([13, 20, 1])
    expect(m.celdas[0][20]).toBeCloseTo(500.4, 6)
    expect(m.celdas[1][1]).toBe(500)
  })
})

describe('lo que devuelve la base', () => {
  it('parsea internas y tiempos; forma rara → error', () => {
    expect(parsearInternas([['u1', '2026-10-05', 20, 'salon', '3000000', 2]])).toEqual([{ id: 'u1', dia: '2026-10-05', hora: 20, canal: 'salon', netaCts: 3_000_000, pax: 2 }])
    expect(() => parsearInternas({})).toThrow()
    const t = parsearTiempos({ horas: [['2026-10-05', 13, 2400035, 2, 5]], sentados: [['2', 2, 61.0, 61.0]], descartes: { sin_pedido: 1, internas: 1, sin_pax: 1, menos_de_5: 1, mas_de_240: 1 } })
    expect(t.horas[0]).toEqual({ dia: '2026-10-05', hora: 13, netaCts: 2_400_035, facturas: 2, pax: 5 })
    expect(t.sentados[0]).toEqual({ tamano: '2', n: 2, mediana: 61, promedio: 61 })
    expect(() => parsearTiempos({ horas: [] })).toThrow()
  })
  it('«no existe la función» por código o por mensaje; otro error no', () => {
    expect(esFuncionAusente({ code: 'PGRST202' }, 'pos_ventas_tiempos')).toBe(true)
    expect(esFuncionAusente({ message: 'function public.pos_ventas_tiempos(text) does not exist' }, 'pos_ventas_tiempos')).toBe(true)
    expect(esFuncionAusente({ code: '42501', message: 'No autorizado' }, 'pos_ventas_tiempos')).toBe(false)
  })
  it('juntar pedidos partidos: suma N y pondera el promedio; la mediana no se inventa', () => {
    const a = { horas: [], sentados: [{ tamano: '2' as const, n: 10, mediana: 60, promedio: 60 }], descartes: { sin_pedido: 1, internas: 0, sin_pax: 0, menos_de_5: 0, mas_de_240: 0 } }
    const b = { horas: [], sentados: [{ tamano: '2' as const, n: 30, mediana: 70, promedio: 80 }], descartes: { sin_pedido: 2, internas: 1, sin_pax: 0, menos_de_5: 0, mas_de_240: 0 } }
    const j = juntarTiempos([a, b])
    expect(j.sentados[0].n).toBe(40)
    expect(j.sentados[0].promedio).toBe(75)
    expect(Number.isNaN(j.sentados[0].mediana)).toBe(true)
    expect(j.descartes.sin_pedido).toBe(3)
    expect(juntarTiempos([a])).toBe(a)
  })
})
