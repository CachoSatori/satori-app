// Ventas · mesas internas (mig 193): la app y la base hablan del mismo número de mesa; las facturas internas son venta
// (decisión del dueño 18-nov 13:45) y solo salen de la alerta de mesas sin pax y del tiempo sentado. Datos ficticios.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { alertaMesasSinPax, estimadorPorNeta, ventaPorPersona, type FacturaIndicador } from './indicadores'
import { normalizarMesa, ordenarMesas } from './mesasInternas'
import { calcularPeriodo } from './periodos'
import { armarLectura, avisoCalidad, cifrasDelRango } from './resumenV2'
import { conInternas } from './resumenV2Datos'
import { datos } from './resumenV2.fixture'
import { porDiaSemana, porTurnoHoras, mapaHorasTodos } from './tiemposV2'
import { esFuncionAusente, marcarInternas, parsearInternas, parsearTiempos, type InternaRpc } from './tiemposV2Rpc'
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

describe('mesas internas = venta (decisión del dueño 18-nov 13:45): solo salen de la alerta de mesas sin pax', () => {
  const r = { desde: '2026-10-05', hasta: '2026-10-05' }
  const normal = [f({ id: 'a' }), f({ id: 'b', neta: 20_000, pax: 2, pax_articulo: 2 }), f({ id: 'c', pax: 0, pax_articulo: 0 })]
  const interna = f({ id: 'i', neta: 90_000, pax: 0, pax_articulo: 0 })

  it('la venta por persona D4 da lo mismo marcada o sin marcar (sigue adentro, con su regla de siempre)', () => {
    expect(ventaPorPersona([...normal, { ...interna, interna: true }], r)).toEqual(ventaPorPersona([...normal, interna], r))
    const conPax = f({ id: 'j', neta: 1_000_000, pax: 1, pax_articulo: 1 })
    const u = { dia: '2026-10-05', turno: 'noche' as const, inferido: false }
    expect(estimadorPorNeta([...normal, { ...conPax, interna: true }]).estimar(normal[2], u))
      .toBe(estimadorPorNeta([...normal, conPax]).estimar(normal[2], u))
  })
  it('la alerta de mesas sin pax no la mira y la cuenta aparte', () => {
    const sinMarcar = alertaMesasSinPax([...normal, interna], r)
    const marcada = alertaMesasSinPax([...normal, { ...interna, interna: true }], r)
    expect(sinMarcar.total).toEqual({ facturasSalon: 4, sinPax: 2, pct: 50 })
    expect(marcada.total).toEqual(alertaMesasSinPax(normal, r).total)
    expect(marcada.mesasInternas).toBe(1)
    expect(sinMarcar.mesasInternas).toBe(0)
  })
})

describe('Resumen: con mesas internas marcadas, las cifras son las mismas (= Contabilidad)', () => {
  const fx = datos('2026-09-01', 78)
  const lect = armarLectura(fx.tickets, fx.lineas)
  const oct = calcularPeriodo({ tipo: 'mes', dia: '2026-10-10', ancla: '2026-11-18' })
  const elegidas = lect.facturas.filter(x => x.canal === 'salon' && x.fecha_registra.startsWith('2026-10-0')).slice(0, 4)
  const internas: InternaRpc[] = elegidas.map(x => ({ id: x.id, dia: x.fecha_registra.slice(0, 10), hora: 20, canal: 'salon', netaCts: Math.round(x.neta * 100), pax: 0 }))
  const conInt = conInternas(lect, internas)

  it('venta neta, detalle, cuenta promedio y venta por persona: idénticos', () => {
    const a = cifrasDelRango(conInt, oct), b = cifrasDelRango(lect, oct)
    expect(a.totales).toEqual(b.totales)
    expect(a.dias).toEqual(b.dias)
    expect(a.cuentaPromedio).toBe(b.cuentaPromedio)
    expect(a.vpp).toEqual(b.vpp)
    expect(avisoCalidad(a)).toEqual(avisoCalidad(b))
  })
  it('la alerta de ayer las deja afuera', () => {
    const dia = internas[0].dia
    const marcadas = alertaMesasSinPax(conInt.facturas, { desde: dia, hasta: dia })
    expect(marcadas.mesasInternas).toBeGreaterThan(0)
    expect(marcadas.total.facturasSalon).toBe(alertaMesasSinPax(lect.facturas, { desde: dia, hasta: dia }).total.facturasSalon - marcadas.mesasInternas)
  })
  it('sin la 193 (internas null) no se marca nada', () => {
    expect(conInternas(lect, null).facturas.some(x => x.interna)).toBe(false)
  })
  it('marcar no toca las facturas que no son internas', () => {
    const m = marcarInternas(lect.facturas, internas)
    expect(m.filter(x => x.interna)).toHaveLength(4)
    expect(m.filter(x => !x.interna).every(x => lect.facturas.includes(x))).toBe(true)
  })
})

describe('Tiempos con la 193: horas de todos los canales = Contabilidad', () => {
  const dias = [
    { fecha: '2026-10-05', ventaBruta: 0, ventaNeta: 801, iva: 0, serv: 0, salon: 801, delivery: 0, pax: 10, promPax: 0 },
    { fecha: '2026-10-06', ventaBruta: 0, ventaNeta: 500, iva: 0, serv: 0, salon: 500, delivery: 0, pax: 4, promPax: 0 },
  ]
  const horas = [
    { dia: '2026-10-05', hora: 13, netaCts: 30_020, facturas: 1, pax: 2 },
    { dia: '2026-10-05', hora: 20, netaCts: 50_040, facturas: 1, pax: 5 },
    { dia: '2026-10-06', hora: 1, netaCts: 50_000, facturas: 1, pax: 4 },
  ]
  const vpp = { 'mañana': ventaPorPersona([], { desde: '2026-10-05', hasta: '2026-10-06' }), noche: ventaPorPersona([], { desde: '2026-10-05', hasta: '2026-10-06' }) }

  it('mediodía + noche = Σ días de semana = Contabilidad, al colón', () => {
    const semana = porDiaSemana(dias)
    const t = porTurnoHoras(dias, horas, vpp)
    expect(t.descuadres).toEqual([])
    expect(t.filas.map(x => x.neta)).toEqual([300, 1_001]) // 13 h → mediodía; 20 h y la 1 → noche
    expect(t.filas[0].neta + t.filas[1].neta).toBe(semana.reduce((s, x) => s + x.neta, 0))
    expect(semana.reduce((s, x) => s + x.neta, 0)).toBe(1_301)
  })
  it('si las horas no cuadran con la venta del día, lo avisa', () => {
    expect(porTurnoHoras(dias, horas.slice(0, 1), vpp).descuadres).toEqual(['2026-10-05', '2026-10-06'])
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
