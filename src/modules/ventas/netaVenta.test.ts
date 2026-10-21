import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import {
  esLineaDeVenta, FAMILIAS_NO_VENTA, netaDelTicket, netaPorTicket, resumirAvisos,
  type AvisoCatalogo,
} from './netaVenta'
import {
  armarDia, armarSnapshot, lotesDeCierre, netaPorJornada, resumirProvisional, ventasPorCanal,
} from './ventasEnVivoDatos'
import { getDayStats } from './ventasUtils'
import { armarDiasMap } from './ventasDiasDesdePos'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'

const ticket = (over: Partial<TicketNdfConId> & { id: string }): TicketNdfConId => ({
  numero_factura: over.id, estado: 'C', fecha_registra: '2026-10-02T19:00:00-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 0,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 0, pax_articulo: 2, pax_alerta: 'falta_nativo', ...over,
})

const linea = (ticketId: string, familia: number | null, monto: number, nombre = `F${familia}`): LineaNdfRow => ({
  ticket_id: ticketId, codigo_producto: String(familia ?? 'x'), nombre,
  cantidad: 1, monto, familia, usuario_registra: null,
})

const NOMBRES = { '026': 'MAXO', '027': 'GUILLE' }
const netaDia = (dia: Parameters<typeof getDayStats>[0]) => getDayStats(dia).ventaNeta

describe('qué es venta', () => {
  it('fuera de la venta SOLO 6 PERSONAL, 17 X CORTESIAS y 20 Ingredientes (firmado)', () => {
    expect([...FAMILIAS_NO_VENTA]).toEqual([6, 17, 20])
    for (const f of FAMILIAS_NO_VENTA) expect(esLineaDeVenta(f)).toBe(false)
  })

  it('todo lo demás cuenta: gift 12, dueños 28, BOXING 19, merch, 11/15/22/25 y la comida', () => {
    for (const f of [2, 3, 4, 5, 13, 16, 29, 1, 9, 11, 12, 15, 19, 21, 22, 23, 24, 25, 26, 27, 28]) {
      expect(esLineaDeVenta(f)).toBe(true)
    }
  })

  it('la línea SIN familia cuenta (y se avisa)', () => {
    expect(esLineaDeVenta(null)).toBe(true)
    expect(esLineaDeVenta(undefined)).toBe(true)
  })
})

describe('netaDelTicket', () => {
  it('Σ monto de las líneas de venta; ignora valor_servido_crc cuando hay líneas', () => {
    const t = ticket({ id: 'a', valor_servido_crc: 10000 })
    const neta = netaDelTicket(t, [
      linea('a', 3, 10000), linea('a', 19, 884.94, 'BOXING'), linea('a', 21, 14000, 'REMERA'),
      linea('a', 17, 3000, 'EDAMAME CORTESIA'), linea('a', 6, 0, 'PINTO XX'), linea('a', 20, 500, 'SALSA'),
    ])
    expect(neta).toBeCloseTo(10000 + 884.94 + 14000, 6)
  })

  it('sin líneas guardadas cae al valor servido de la cabecera y lo avisa', () => {
    const avisos: AvisoCatalogo[] = []
    expect(netaDelTicket(ticket({ id: 'a', valor_servido_crc: 7000 }), [], avisos)).toBe(7000)
    expect(avisos.map(a => a.tipo)).toEqual(['sin_lineas'])
  })

  it('avisa la línea con plata sin familia o con familia fuera del catálogo; la cuenta igual', () => {
    const avisos: AvisoCatalogo[] = []
    const neta = netaDelTicket(ticket({ id: 'a' }), [
      linea('a', null, 1200, 'SIN FAMILIA'), linea('a', 99, 800, 'RARO'), linea('a', 2, 5000),
      linea('a', null, 0, 'CERO NO SE AVISA'),
    ], avisos)
    expect(neta).toBe(7000)
    expect(avisos.map(a => [a.tipo, a.nombre, a.monto])).toEqual([
      ['sin_familia', 'SIN FAMILIA', 1200], ['familia_desconocida', 'RARO', 800],
    ])
    expect(resumirAvisos(avisos)).toContain('sin_familia: 1')
  })
})

describe('armarDia — la neta del día sale de las líneas; el valor servido queda igual', () => {
  const T = [
    ticket({ id: 'm1', valor_servido_crc: 20000 }),
    ticket({ id: 'd1', canal: 'delivery', valor_servido_crc: 8000 }),     // delivery de MESERO
    ticket({ id: 'c1', salonero_login: null, registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 5000 }),
  ]
  const L = [
    linea('m1', 3, 20000), linea('m1', 21, 14000, 'REMERA'),
    linea('d1', 3, 8000),  linea('d1', 19, 884.94, 'BOXING'),
    linea('c1', 16, 5000), linea('c1', 19, 884.94, 'BOXING'),
  ]

  it('la neta del día incluye merch y BOXING', () => {
    const a = armarDia('2026-10-02', T, L, 'sello', NOMBRES)
    const neta = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(neta).toBe(Math.round(34000) + Math.round(8884.94) + Math.round(5884.94))
    expect(netaDia(a.dia)).toBe(neta)
  })

  it('NO cambia valor_servido_crc ni el mix: comida + bebida = Σ valor servido de los meseros', () => {
    const a = armarDia('2026-10-02', T, L, 'sello', NOMBRES)
    const maxo = a.dia.saloneros['MAXO'] as { com: number; beb: number }
    expect(maxo.com + maxo.beb).toBe(20000 + 8000)
    expect(T.map(t => t.valor_servido_crc)).toEqual([20000, 8000, 5000])
  })

  it('Salón/Delivery: el delivery de un MESERO ya no se cuenta como salón', () => {
    const a = armarDia('2026-10-02', T, L, 'sello', NOMBRES)
    const s = getDayStats(a.dia)
    expect(s.delivery).toBe(Math.round(8884.94) + Math.round(5884.94))
    expect(s.salon).toBe(34000)
    expect(s.salon + s.delivery).toBe(s.ventaNeta)                       // no cambia el total
  })

  it('Salón/Delivery de getDayStats = ventasPorCanal con la misma neta', () => {
    const a = armarDia('2026-10-02', T, L, 'sello', NOMBRES)
    const netas = netaPorTicket(T, L)
    const canal = ventasPorCanal(T, t => netas.get(t.id) ?? 0)
    const s = getDayStats(a.dia)
    expect(Math.abs(s.salon - canal.salon)).toBeLessThanOrEqual(1)
    expect(Math.abs(s.delivery - canal.delivery)).toBeLessThanOrEqual(1)
    expect(a.canales).toEqual(canal)
  })

  it('solo estado C: una R con líneas no suma a la neta', () => {
    const a = armarDia('2026-10-02',
      [...T, ticket({ id: 'r1', estado: 'R', valor_servido_crc: 9000 })],
      [...L, linea('r1', 3, 9000)], 'sello', NOMBRES)
    const b = armarDia('2026-10-02', T, L, 'sello', NOMBRES)
    expect(netaDia(a.dia)).toBe(netaDia(b.dia))
  })

  it('«En vivo»: los turnos y el ritmo por hora suman la MISMA neta que el día', () => {
    const snap = armarSnapshot({
      local: 'santa-teresa', fecha: '2026-10-02', tickets: T, lineas: L, neto4Sem: {},
      ahora: new Date('2026-10-03T01:00:00Z'), enServicio: false, nombres: NOMBRES,
    })
    const neta = netaDia(snap.dia)
    const turnos = snap.turnos!
    const sumaTurnos = [...turnos.turnos, turnos.sinTurno].reduce((s, b) => s + b.neto, 0)
    expect(Math.abs(sumaTurnos - neta)).toBeLessThanOrEqual(2)
    expect(Math.abs(snap.porHora.reduce((s, h) => s + h.monto, 0) - neta)).toBeLessThanOrEqual(2)
  })
})

describe('armarDiasMap — avisos de catálogo', () => {
  it('loguea una sola vez por carga, con el resumen, y la plata cuenta igual', () => {
    const avisar = vi.fn()
    const r = armarDiasMap(
      [ticket({ id: 'a' })], [linea('a', null, 1500, 'PRODUCTO NUEVO'), linea('a', 2, 5000)],
      { desde: '2026-10-02', hasta: '2026-10-02' }, { uploadedAt: 'sello', nombres: NOMBRES, avisar },
    )
    expect(netaDia(r.dias['2026-10-02'])).toBe(6500)
    expect(avisar).toHaveBeenCalledTimes(1)
    expect(avisar.mock.calls[0][0]).toContain('PRODUCTO NUEVO')
  })

  it('sin huecos de catálogo no loguea nada', () => {
    const avisar = vi.fn()
    armarDiasMap([ticket({ id: 'a' })], [linea('a', 2, 5000)],
      { desde: '2026-10-02', hasta: '2026-10-02' }, { uploadedAt: 'sello', avisar })
    expect(avisar).not.toHaveBeenCalled()
  })
})

describe('«En vivo» — comparativa, lotes y provisional en la MISMA neta', () => {
  it('netaPorJornada: la comparativa de 4 semanas suma la neta de las líneas, por jornada 07→07', () => {
    const tickets = [
      { id: 'a', numero_factura: 'a', fecha_registra: '2026-09-25T20:00:00-06:00', valor_servido_crc: 10000 },
      // 01:30 del 26 = jornada del 25 (07→07), igual que el día en curso de «En vivo».
      { id: 'b', numero_factura: 'b', fecha_registra: '2026-09-26T01:30:00-06:00', valor_servido_crc: 5000 },
      { id: 'c', numero_factura: 'c', fecha_registra: '2026-10-02T20:00:00-06:00', valor_servido_crc: 8000 },
    ]
    const lineas = [
      linea('a', 3, 10000), linea('a', 21, 14000, 'REMERA'),
      linea('b', 2, 5000),  linea('b', 19, 884.94, 'BOXING'),
      linea('c', 3, 8000),  linea('c', 17, 2000, 'CORTESIA'),
    ]
    const r = netaPorJornada(tickets, lineas, ['2026-09-25', '2026-10-02', '2026-09-18'])
    expect(Object.keys(r).sort()).toEqual(['2026-09-18', '2026-09-25', '2026-10-02'])
    expect(r['2026-09-25']).toBeCloseTo(10000 + 14000 + 5000 + 884.94, 6)
    expect(r['2026-10-02']).toBe(8000)
    expect(r['2026-09-18']).toBe(0)
  })

  it('lotesDeCierre con la neta: el lote suma lo mismo que sus tickets en el día', () => {
    const T = [
      ticket({ id: 'l1', fecha_cierra: '2026-10-02T22:00:00-06:00', valor_servido_crc: 1000 }),
      ticket({ id: 'l2', fecha_cierra: '2026-10-02T22:00:00-06:00', valor_servido_crc: 1000 }),
    ]
    const L = [linea('l1', 3, 1000), linea('l1', 21, 14000), linea('l2', 2, 1000)]
    const netas = netaPorTicket(T, L)
    const lotes = lotesDeCierre(T, t => netas.get(t.id) ?? 0)
    expect(lotes).toHaveLength(1)
    expect(lotes[0].neto).toBe(16000)
    expect(lotes[0].neto).toBe(netaDia(armarDia('2026-10-02', T, L, 'sello', NOMBRES).dia))
  })

  it('resumirProvisional con la neta: solo las R, medidas como la venta oficial', () => {
    const T = [
      ticket({ id: 'r1', estado: 'R', valor_servido_crc: 1000 }),
      ticket({ id: 'c1', estado: 'C', valor_servido_crc: 9999 }),
    ]
    const netas = netaPorTicket(T, [linea('r1', 3, 1000), linea('r1', 19, 884.94)])
    expect(resumirProvisional(T, t => netas.get(t.id) ?? 0)).toEqual({ monto: 1885, tickets: 1 })
  })
})
