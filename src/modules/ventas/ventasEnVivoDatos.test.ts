import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import {
  armarDia, armarSnapshot, calidadPaxPorSalonero, claveSalonero, compararContra,
  etiquetaNoMesero, horaCRDe, jornadasComparables, ritmoPorHora,
} from './ventasEnVivoDatos'
import { businessDateDe, ventanaJornada } from '../../shared/api/posNdf'
import { mixPorCategoria, ticketsDelDia } from './ventasEnVivoTypes'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import type { DiaData, SaloneroDay } from '../../shared/types/ventas'

/** El día que arma esta capa solo tiene saloneros (nunca `CajeroDay`). */
const sal = (dia: DiaData, clave: string): SaloneroDay => dia.saloneros[clave] as SaloneroDay

const ticket = (over: Partial<TicketNdfConId> = {}): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', fecha_registra: '2026-09-01T19:42:07-06:00',
  canal: 'salon', salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 1200, total_crc: 13560, valor_servido_crc: 12000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

const linea = (over: Partial<LineaNdfRow> = {}): LineaNdfRow => ({
  ticket_id: 't1', codigo_producto: '100', nombre: 'ROLL SATORI',
  cantidad: 2, monto: 9000, familia: 2, ...over,
})

// ── La jornada 07:00 → 07:00 ───────────────────────────────────────────────────

describe('ventanaJornada / businessDateDe', () => {
  it('la jornada va de las 07:00 CR a las 07:00 CR del día siguiente', () => {
    expect(ventanaJornada('2026-09-01')).toEqual({
      desde: '2026-09-01T07:00:00-06:00', hasta: '2026-09-02T07:00:00-06:00',
    })
  })

  it('lo facturado a la 1 de la mañana pertenece al servicio de la noche ANTERIOR', () => {
    expect(businessDateDe('2026-09-02T01:30:00-06:00')).toBe('2026-09-01')
    expect(businessDateDe('2026-09-01T23:00:00-06:00')).toBe('2026-09-01')
  })

  it('a partir de las 07:00 ya es la jornada nueva', () => {
    expect(businessDateDe('2026-09-02T06:59:00-06:00')).toBe('2026-09-01')
    expect(businessDateDe('2026-09-02T07:00:00-06:00')).toBe('2026-09-02')
  })

  it('cruza fin de mes', () => {
    expect(ventanaJornada('2026-08-31').hasta).toBe('2026-09-01T07:00:00-06:00')
    expect(businessDateDe('2026-09-01T02:00:00-06:00')).toBe('2026-08-31')
  })
})

// ── El día ─────────────────────────────────────────────────────────────────────

describe('armarDia', () => {
  it('acredita el NETO al salonero, no el bruto', () => {
    const a = armarDia('2026-09-01', [ticket()], [linea()], '2026-09-01')
    expect(a.dia.saloneros['026'].total).toBe(12000)   // valor_servido_crc
    expect(a.bruto).toBe(13560)                        // total_crc, al lado
    expect(a.servicio).toBe(1200)
  })

  it('el bruto, el servicio, el IVA y la regalía viajan aparte', () => {
    const a = armarDia('2026-09-01', [
      ticket({ id: 't1', iva_crc: 0, regalia_crc: 0 }),
      ticket({ id: 't2', numero_factura: '5002', total_crc: 0, valor_servido_crc: 5000,
               regalia_crc: 5000, clase_ingreso: 'sin_cobro' }),
    ], [], '2026-09-01')
    expect(a.bruto).toBe(13560)
    expect(a.regalia).toBe(5000)
    expect(a.iva).toBe(0)                              // 2024/histórico: ImpV = 0, no derivado
  })

  it('las facturas del cajero cuentan en el día, en su propia línea', () => {
    const a = armarDia('2026-09-01', [
      ticket(),
      ticket({ id: 't2', numero_factura: '5002', salonero_login: null,
               registrado_por: 'cajero', valor_servido_crc: 8000 }),
    ], [], '2026-09-01')
    expect(Object.keys(a.dia.saloneros).sort()).toEqual(['(cajero de turno)', '026'])
    const total = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(total).toBe(20000)
  })

  it('el mix deja afuera el artículo pax y las familias que no son neto', () => {
    const a = armarDia('2026-09-01', [ticket()], [
      linea({ familia: 2, monto: 9000, cantidad: 2 }),
      linea({ familia: 5, monto: 3000, cantidad: 3, nombre: 'IMPERIAL', codigo_producto: '200' }),
      linea({ familia: 19, monto: 0, cantidad: 2, nombre: 'PAX', codigo_producto: '677' }),
      linea({ familia: 22, monto: 1500, cantidad: 1, nombre: 'EXTRA', codigo_producto: '300' }),
      linea({ familia: 17, monto: 2500, cantidad: 1, nombre: 'CORTESIA', codigo_producto: '400' }),
    ], '2026-09-01')

    const prods = sal(a.dia, '026').prods.map(p => p[0])
    expect(prods).toEqual(['ROLL SATORI', 'IMPERIAL'])
    expect(prods).not.toContain('PAX')
    expect(prods).not.toContain('EXTRA')
    expect(sal(a.dia, '026').com).toBe(9000)
    expect(sal(a.dia, '026').beb).toBe(3000)
  })

  it('la familia 29 (bentos) entra al mix como comida', () => {
    const a = armarDia('2026-09-01', [ticket()],
      [linea({ familia: 29, monto: 4500, cantidad: 1, nombre: 'BENTO' })], '2026-09-01')
    expect(sal(a.dia, '026').com).toBe(4500)
    expect(a.pm['BENTO'].clasificacion).toBe('COMIDA')
  })

  it('el mix por categoría usa el pm que sale del mismo snapshot', () => {
    const a = armarDia('2026-09-01', [ticket()], [
      linea({ familia: 2, monto: 9000, cantidad: 2 }),
      linea({ familia: 5, monto: 3000, cantidad: 3, nombre: 'IMPERIAL', codigo_producto: '200' }),
    ], '2026-09-01')
    const mix = mixPorCategoria(a.dia, a.pm)
    expect(mix.map(m => m.categoria)).toEqual(['COMIDA', 'BEBIDA'])
    expect(mix[0].monto).toBe(9000)
    expect(Math.round(mix[0].pctMix)).toBe(75)
  })

  it('un día sin ventas da un DiaData vacío, no explota', () => {
    const a = armarDia('2026-09-01', [], [], '2026-09-01')
    expect(a.dia.saloneros).toEqual({})
    expect(a.bruto).toBe(0)
  })

  it('tolera nulos en todos los montos', () => {
    const a = armarDia('2026-09-01', [ticket({
      total_crc: null, valor_servido_crc: null, servicio_crc: null, iva_crc: null,
      regalia_crc: null, pax: null,
    })], [linea({ monto: null, cantidad: null })], '2026-09-01')
    expect(a.dia.saloneros['026'].total).toBe(0)
    expect(sal(a.dia, '026').promPax).toBe(0)   // sin pax: 0, no NaN
  })
})

describe('claveSalonero / etiquetaNoMesero', () => {
  it('solo el mesero de verdad tiene clave', () => {
    expect(claveSalonero({ salonero_login: '026', registrado_por: 'salonero' })).toBe('026')
    expect(claveSalonero({ salonero_login: null, registrado_por: 'cajero' })).toBeNull()
    expect(claveSalonero({ salonero_login: null, registrado_por: 'sin_pedido' })).toBeNull()
  })

  it('cada tipo de no-mesero tiene su etiqueta', () => {
    expect(etiquetaNoMesero('cajero')).toBe('(cajero de turno)')
    expect(etiquetaNoMesero('sistema')).toBe('(sistema)')
    expect(etiquetaNoMesero('sin_pedido')).toBe('(sin salonero)')
  })
})

// ── Ritmo ──────────────────────────────────────────────────────────────────────

describe('ritmoPorHora', () => {
  it('agrupa por hora de reloj de Costa Rica', () => {
    const r = ritmoPorHora([
      ticket({ id: 'a', fecha_registra: '2026-09-01T19:10:00-06:00', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T19:50:00-06:00', valor_servido_crc: 5000 }),
      ticket({ id: 'c', fecha_registra: '2026-09-01T13:05:00-06:00', valor_servido_crc: 8000 }),
    ])
    expect(r).toEqual([
      { hora: 13, monto: 8000, tickets: 1 },
      { hora: 19, monto: 15000, tickets: 2 },
    ])
    expect(ticketsDelDia(r)).toBe(3)
  })

  it('la hora sale del instante con zona, no del reloj del navegador', () => {
    expect(horaCRDe('2026-09-02T01:42:07Z')).toBe(19)      // 01:42 UTC = 19:42 del día anterior CR
    expect(horaCRDe('2026-09-01T19:42:07-06:00')).toBe(19)
    expect(horaCRDe('no es una fecha')).toBeNull()
  })

  it('sin ventas, sin filas', () => {
    expect(ritmoPorHora([])).toEqual([])
  })
})

// ── Calidad del pax (§3.F) ─────────────────────────────────────────────────────

describe('calidadPaxPorSalonero', () => {
  it('mide el % de mesas con pax nativo y el match contra el artículo', () => {
    const c = calidadPaxPorSalonero([
      ticket({ id: 'a', pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok' }),
      ticket({ id: 'b', pax_nativo: 4, pax_articulo: 2, pax_alerta: 'difiere' }),
      ticket({ id: 'c', pax_nativo: 0, pax_articulo: 3, pax_alerta: 'falta_nativo' }),
      ticket({ id: 'd', pax_nativo: 0, pax_articulo: 0, pax_alerta: 'sin_pax' }),
    ])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ salonero: '026', mesas: 4 })
    expect(c[0].pctPaxNativoCargado).toBe(50)      // 2 de 4 mesas
    expect(c[0].matchArticuloVsNativo).toBe(50)    // de las 2 con ambos, 1 coincide
  })

  it('al cajero de turno no se le exige cargar comensales', () => {
    expect(calidadPaxPorSalonero([
      ticket({ salonero_login: null, registrado_por: 'cajero' }),
    ])).toEqual([])
  })

  it('ordena por cantidad de mesas', () => {
    const c = calidadPaxPorSalonero([
      ticket({ id: 'a', salonero_login: '026' }),
      ticket({ id: 'b', salonero_login: '027' }),
      ticket({ id: 'c', salonero_login: '027' }),
    ])
    expect(c.map(x => x.salonero)).toEqual(['027', '026'])
  })
})

// ── Comparativa ────────────────────────────────────────────────────────────────

describe('jornadasComparables / compararContra', () => {
  it('son los mismos días de semana, cuatro semanas hacia atrás', () => {
    expect(jornadasComparables('2026-09-01'))
      .toEqual(['2026-08-25', '2026-08-18', '2026-08-11', '2026-08-04'])
  })

  it('la semana pasada es el primero; el promedio, de los cuatro', () => {
    const h = compararContra(
      { '2026-08-25': 400000, '2026-08-18': 300000, '2026-08-11': 500000, '2026-08-04': 400000 },
      jornadasComparables('2026-09-01'),
    )
    expect(h.mismoDiaSemanaPasada).toBe(400000)
    expect(h.promedio4Semanas).toBe(400000)
  })

  it('un día cerrado NO hunde el promedio: se promedian los días que existieron', () => {
    const h = compararContra(
      { '2026-08-25': 400000, '2026-08-18': 0, '2026-08-11': 400000, '2026-08-04': 400000 },
      jornadasComparables('2026-09-01'),
    )
    expect(h.promedio4Semanas).toBe(400000)   // no 300.000
  })

  it('sin histórico devuelve 0, y la pantalla muestra «—»', () => {
    expect(compararContra({}, jornadasComparables('2026-09-01')))
      .toEqual({ mismoDiaSemanaPasada: 0, promedio4Semanas: 0 })
  })
})

// ── El snapshot completo ───────────────────────────────────────────────────────

describe('armarSnapshot', () => {
  const snap = armarSnapshot({
    local: 'santa-teresa', fecha: '2026-09-01',
    tickets: [
      ticket({ id: 'a', fecha_registra: '2026-09-01T13:00:00-06:00', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T20:00:00-06:00', valor_servido_crc: 15000,
               salonero_login: '027' }),
    ],
    lineas: [linea({ ticket_id: 'a', monto: 10000 })],
    neto4Sem: { '2026-08-25': 20000, '2026-08-18': 30000, '2026-08-11': 0, '2026-08-04': 40000 },
    ahora: new Date('2026-09-02T02:00:00Z'), enServicio: true,
  })

  it('cumple el contrato SnapshotEnVivo, con el día en forma DiaData', () => {
    expect(snap.local).toBe('santa-teresa')
    expect(snap.fecha).toBe('2026-09-01')
    expect(snap.servicioEnCurso).toBe(true)
    expect(snap.dia.fileName).toBe('ndf 2026-09-01')
    expect(Object.keys(snap.dia.saloneros).sort()).toEqual(['026', '027'])
  })

  it('el acumulado del día es la suma del neto de los saloneros', () => {
    const neto = Object.values(snap.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(neto).toBe(25000)
    expect(snap.proyeccionCierre).toBe(25000)
  })

  it('trae el ritmo, la comparativa y la calidad del pax', () => {
    expect(snap.porHora.map(h => h.hora)).toEqual([13, 20])
    expect(snap.historico.mismoDiaSemanaPasada).toBe(20000)
    expect(snap.historico.promedio4Semanas).toBe(30000)   // 20+30+40 / 3, el 0 no cuenta
    expect(snap.calidadPax.map(c => c.salonero).sort()).toEqual(['026', '027'])
  })

  it('bruto, servicio, IVA y regalía viajan al lado del neto', () => {
    expect(snap.bruto).toBe(27120)
    expect(snap.servicio).toBe(2400)
    expect(snap.iva).toBe(0)
  })
})
