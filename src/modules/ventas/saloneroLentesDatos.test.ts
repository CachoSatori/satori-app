// La capa de I/O de las lentes. Lo que se prueba es lo único que decide: qué facturas del
// superset entran al rango. El cálculo ya está probado en `saloneroLentes.test.ts`.
import { describe, it, expect, vi } from 'vitest'

// Este módulo importa la capa de lectura (y con ella el cliente de Supabase). Nada de lo que se
// prueba acá hace I/O: `filtrarPorJornada` y `armarLentes` son puras.
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import { armarLentes, filtrarPorJornada } from './saloneroLentesDatos'

const ticket = (over: Partial<TicketNdfConId> & { id: string }): TicketNdfConId => ({
  numero_factura: over.id, estado: 'C', fecha_registra: '2026-09-05T19:00:00-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 10_000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

const linea = (ticket_id: string, usuario_registra: string, monto: number): LineaNdfRow => ({
  ticket_id, codigo_producto: '100', nombre: 'ROLL', cantidad: 1, monto, familia: 2,
  usuario_registra,
})

describe('filtrarPorJornada — el lote decide, no la fecha de la factura', () => {
  // Un lote del 5-sep que cerró a las 00:40 del 6: la factura de la madrugada es del 5.
  const cierre = '2026-09-06T00:40:00-06:00'
  const lote5 = [
    ticket({ id: 'a', fecha_registra: '2026-09-05T20:00:00-06:00', fecha_cierra: cierre }),
    ticket({ id: 'b', fecha_registra: '2026-09-06T00:10:00-06:00', fecha_cierra: cierre }),
  ]

  it('la factura de la madrugada sigue siendo de la jornada que ABRIÓ', () => {
    expect(filtrarPorJornada(lote5, { desde: '2026-09-05', hasta: '2026-09-05' }).map(t => t.id))
      .toEqual(['a', 'b'])
  })

  it('y NO aparece en la jornada del día siguiente', () => {
    expect(filtrarPorJornada(lote5, { desde: '2026-09-06', hasta: '2026-09-06' })).toEqual([])
  })

  it('los lotes de afuera del rango se descartan enteros', () => {
    const otro = ticket({
      id: 'z', fecha_registra: '2026-09-01T20:00:00-06:00',
      fecha_cierra: '2026-09-01T23:00:00-06:00',
    })
    expect(filtrarPorJornada([...lote5, otro], { desde: '2026-09-05', hasta: '2026-09-05' })
      .map(t => t.id)).toEqual(['a', 'b'])
  })

  it('el rango es inclusivo de los dos lados', () => {
    const del1 = ticket({
      id: 'z', fecha_registra: '2026-09-01T20:00:00-06:00',
      fecha_cierra: '2026-09-01T23:00:00-06:00',
    })
    expect(filtrarPorJornada([...lote5, del1], { desde: '2026-09-01', hasta: '2026-09-05' }))
      .toHaveLength(3)
  })
})

describe('armarLentes — no cuenta líneas de facturas que quedaron afuera', () => {
  it('las líneas de los tickets del superset que no entran al rango no suman', () => {
    const dentro = ticket({
      id: 'in', fecha_registra: '2026-09-05T20:00:00-06:00',
      fecha_cierra: '2026-09-05T23:00:00-06:00', valor_servido_crc: 10_000,
    })
    const fuera = ticket({
      id: 'out', fecha_registra: '2026-09-04T20:00:00-06:00',
      fecha_cierra: '2026-09-04T23:00:00-06:00', valor_servido_crc: 99_000,
    })
    const r = armarLentes(
      [dentro, fuera],
      [linea('in', '032', 10_000), linea('out', '032', 99_000)],
      { desde: '2026-09-05', hasta: '2026-09-05' },
    )
    expect(r.tickets).toBe(1)
    expect(r.lentes.netaDiaCrc).toBe(10_000)
    // Los ₡99.000 del día de atrás vienen en el mismo arreglo de líneas (el superset trae ese
    // lote entero) y no se le pueden sumar a Gonza: su factura quedó afuera del rango.
    expect(r.lentes.ventaPropia.find(f => f.personaId === '032')?.netaCrc).toBe(10_000)
    expect(r.lentes.descuadreCrc).toBe(0)
  })

  it('sin facturas devuelve las dos lentes vacías', () => {
    const r = armarLentes([], [], { desde: '2026-09-05', hasta: '2026-09-05' })
    expect(r.tickets).toBe(0)
    expect(r.lentes.ventaPropia).toEqual([])
    expect(r.lentes.mesaPropia).toEqual([])
  })
})
