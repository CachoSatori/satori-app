// Resumen de ventas de una jornada para el correo del cierre. Datos FICTICIOS (repo público).
import { describe, it, expect } from 'vitest'
import type { LineaNdfRow, TicketVentaRow } from '../../shared/api/posNdf'
import { MIN_MESAS, MIN_PERSONAS, resumenVentasDia } from './resumenCierrePuro'
import { ventaPorPersona, facturasDesdePos } from './indicadores'
import { getDayStats } from './ventasUtils'
import { armarDia } from './ventasEnVivoDatos'

const DIA = '2026-11-10'
let seq = 0

interface Mesa {
  login?: string | null
  canal?: 'salon' | 'delivery'
  pax?: number
  hora?: string           // hora CR de registro, «HH:MM»
  fechaReg?: string       // día CR de registro (por defecto DIA)
  caja?: '111' | '222' | null
  cierreCaja?: string     // instante de cierre del lote
  comida?: number
  bebidas?: number        // unidades de bebida (₡2.000 c/u)
  duenos?: number         // ₡ de familia 28
  total?: number
}

/** Una factura con sus líneas. Montos FICTICIOS. */
function mesa(m: Mesa): { t: TicketVentaRow; l: LineaNdfRow[] } {
  const id = `f${++seq}`
  const caja = m.caja === undefined ? (m.hora && m.hora >= '17:00' ? '222' : '111') : m.caja
  const reg = `${m.fechaReg ?? DIA}T${m.hora ?? '13:00'}:00-06:00`
  const cierre = m.cierreCaja ?? (caja === '222' ? `${DIA}T23:50:00-06:00` : `${DIA}T16:30:00-06:00`)
  const comida = m.comida ?? 10_000
  const beb = (m.bebidas ?? 0) * 2_000
  const neta = comida + beb + (m.duenos ?? 0)
  const l: LineaNdfRow[] = []
  if (comida) l.push({ ticket_id: id, codigo_producto: '100', nombre: 'ROLL FICTICIO', cantidad: 1, monto: comida, familia: 2, usuario_registra: m.login ?? null } as LineaNdfRow)
  if (beb) l.push({ ticket_id: id, codigo_producto: '200', nombre: 'BEBIDA FICTICIA', cantidad: m.bebidas!, monto: beb, familia: 5, usuario_registra: m.login ?? null } as LineaNdfRow)
  if (m.duenos) l.push({ ticket_id: id, codigo_producto: '300', nombre: 'CONSUMO DUENOS', cantidad: 1, monto: m.duenos, familia: 28, usuario_registra: m.login ?? null } as LineaNdfRow)
  const t = {
    id, numero_factura: id, estado: 'C', fecha_registra: reg, fecha_cierra: caja ? cierre : null,
    cajero_login: caja, canal: m.canal ?? 'salon', mesa: '1',
    salonero_login: m.login === undefined ? '901' : m.login,
    registrado_por: m.login === null ? 'caja' : 'salonero',
    servicio_crc: Math.round(neta * 0.1), iva_crc: Math.round(neta * 0.13),
    total_crc: m.total ?? Math.round(neta * 1.23), valor_servido_crc: neta, regalia_crc: 0,
    pax: m.pax ?? 0, pax_articulo: m.pax ?? 0,
  } as TicketVentaRow
  return { t, l }
}

function juntar(ms: { t: TicketVentaRow; l: LineaNdfRow[] }[]) {
  return { tickets: ms.map(x => x.t), lineas: ms.flatMap(x => x.l) }
}

describe('resumenVentasDia', () => {
  it('día con salón y delivery: totales = getDayStats de la app y promedio = ventaPorPersona D4', () => {
    const { tickets, lineas } = juntar([
      mesa({ login: '901', pax: 2, comida: 20_000, bebidas: 2 }),
      mesa({ login: '901', pax: 4, comida: 40_000, bebidas: 4, hora: '19:00' }),
      mesa({ login: '902', pax: 3, comida: 30_000, bebidas: 1, hora: '20:00' }),
      mesa({ login: null, canal: 'delivery', comida: 15_000 }),
    ])
    const r = resumenVentasDia(tickets, lineas, DIA, { '901': 'Salonero Uno', '902': 'Salonero Dos' })
    const st = getDayStats(armarDia(DIA, tickets, lineas, DIA).dia)
    expect(r.facturas).toBe(4)
    expect(r.ventaNeta).toBe(st.ventaNeta)
    expect(r.ventaBruta).toBe(st.ventaBruta)
    expect(r.ventaNeta).toBe(20_000 + 4_000 + 40_000 + 8_000 + 30_000 + 2_000 + 15_000)
    expect(r.delivery).toBe(15_000)
    expect(r.salon).toBe(r.ventaNeta - 15_000)
    expect(r.pax).toBe(9)
    const d4 = ventaPorPersona(facturasDesdePos(tickets, lineas), { desde: DIA, hasta: DIA })
    expect(r.promPax).toBe(d4.valor)
    expect(r.promPax).toBeCloseTo(r.salon / 9, 6)
    // Beb/PAX = unidades de bebida de meseros ÷ pax de meseros.
    expect(r.bebPax).toBeCloseTo(7 / 9, 6)
    expect(r.masVendio?.login).toBe('901')
    expect(r.masVendio?.nombre).toBe('Salonero Uno')
    expect(r.masVendio?.netaSalon).toBe(72_000)
  })

  it('mesas de dueños y regalías totales quedan fuera del promedio, pero sí en la neta', () => {
    const { tickets, lineas } = juntar([
      mesa({ login: '901', pax: 2, comida: 20_000 }),
      mesa({ login: '901', pax: 2, comida: 0, duenos: 50_000 }),
      mesa({ login: '901', pax: 2, comida: 0, total: 0 }),
    ])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.ventaNeta).toBe(70_000)
    expect(r.mesasDuenos).toBe(1)
    expect(r.regaliasTotales).toBe(1)
    expect(r.promPax).toBe(10_000)        // 20.000 ÷ 2, no 70.000 ÷ 6
  })

  it('mesa sin pax: estima con la referencia del mismo turno de la jornada', () => {
    const { tickets, lineas } = juntar([
      mesa({ login: '901', pax: 2, comida: 20_000 }),
      mesa({ login: '901', pax: 0, comida: 40_000 }),
    ])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.pax).toBe(2)                  // pax CARGADO del día
    // referencia del turno = 20.000 ÷ 2 = 10.000 → la mesa de 40.000 estima 4 personas
    expect(r.promPax).toBe(10_000)        // 60.000 ÷ (2 cargadas + 4 estimadas)
    expect(r.pctEstimado).toBeCloseTo(400 / 6, 6)
  })

  it('día sin pax: sin promedio, sin bebidas por pax, sin «mejor promedio»', () => {
    const { tickets, lineas } = juntar([mesa({ login: '901', pax: 0, bebidas: 3 }), mesa({ login: '902', pax: 0 })])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.pax).toBe(0)
    expect(r.promPax).toBeNull()
    expect(r.bebPax).toBeNull()
    expect(r.mejorPromPax).toBeNull()
    expect(r.masVendio?.login).toBe('901')
  })

  it('sin delivery: delivery 0 y salón = neta', () => {
    const { tickets, lineas } = juntar([mesa({ login: '901', pax: 2 })])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.delivery).toBe(0)
    expect(r.salon).toBe(r.ventaNeta)
  })

  it('día sin ventas: todo en cero y sin destacados', () => {
    const r = resumenVentasDia([], [], DIA)
    expect(r).toMatchObject({ facturas: 0, ventaNeta: 0, ventaBruta: 0, pax: 0, promPax: null, bebPax: null, masVendio: null, mejorPromPax: null })
  })

  it('sin salonero (todo por caja): sin destacados, pero con totales', () => {
    const { tickets, lineas } = juntar([mesa({ login: null, pax: 2 }), mesa({ login: null, canal: 'delivery' })])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.ventaNeta).toBe(20_000)
    expect(r.pax).toBe(2)
    expect(r.masVendio).toBeNull()
    expect(r.mejorPromPax).toBeNull()
  })

  it('«mejor promedio» exige el mínimo de mesas y personas; «más vendió» no', () => {
    expect([MIN_MESAS, MIN_PERSONAS]).toEqual([3, 6])
    const ms = [
      // 901: 3 mesas, 6 personas, ₡10.000 por persona
      ...[1, 2, 3].map(() => mesa({ login: '901', pax: 2, comida: 20_000 })),
      // 902: 1 mesa de 2 a ₡50.000 por persona (vende más, pero no llega al mínimo)
      mesa({ login: '902', pax: 2, comida: 100_000 }),
    ]
    const { tickets, lineas } = juntar(ms)
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.masVendio?.login).toBe('902')
    expect(r.mejorPromPax?.login).toBe('901')
    expect(r.mejorPromPax?.promPax).toBe(10_000)
    expect(r.mejorPromPax).toMatchObject({ mesas: 3, personas: 6 })
    // Con 2 mesas 901 tampoco llega: nadie.
    const dos = juntar(ms.slice(1))
    expect(resumenVentasDia(dos.tickets, dos.lineas, DIA).mejorPromPax).toBeNull()
  })

  it('día = jornada de la caja: la factura de las 00:30 de la caja de noche es del día del cierre', () => {
    const siguiente = '2026-11-11'
    const { tickets, lineas } = juntar([
      mesa({ login: '901', pax: 2, hora: '21:00', caja: '222', cierreCaja: `${siguiente}T01:10:00-06:00` }),
      mesa({ login: '901', pax: 2, hora: '00:30', caja: '222', fechaReg: siguiente, cierreCaja: `${siguiente}T01:10:00-06:00` }),
      // el almuerzo del día siguiente no entra
      mesa({ login: '901', pax: 5, hora: '12:00', fechaReg: siguiente, cierreCaja: `${siguiente}T16:30:00-06:00` }),
      // ni la cena del día anterior
      mesa({ login: '901', pax: 7, hora: '20:00', fechaReg: '2026-11-09', cierreCaja: '2026-11-09T23:40:00-06:00' }),
    ])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.facturas).toBe(2)
    expect(r.pax).toBe(4)
  })

  it('un login de sistema no compite como salonero', () => {
    const { tickets, lineas } = juntar([mesa({ login: '02', pax: 2, comida: 90_000 }), mesa({ login: '901', pax: 2 })])
    const r = resumenVentasDia(tickets, lineas, DIA)
    expect(r.masVendio?.login).toBe('901')
  })
})
