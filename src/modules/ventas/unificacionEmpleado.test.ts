// Un empleado = UNA fila en todas las vistas de ventas (firmado por Ismael, 2026-10-29).
//
// Los casos reales con dos códigos: NACHO (`266` histórico + `038` nuevo), ROSAURA (`01` salonera
// + `235` manager) y ESTEBAN (`023` + `555`). Se recorren las vistas que agrupan por persona:
// el ranking por factura (`armarDia` → clave por nombre, y `aggSalonero`/`allSaloneros` entre
// días), la calidad de pax, las mesas abiertas y las dos lentes por línea.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { armarDia, calidadPaxPorSalonero, nombreSalonero, resumirMesasAbiertas } from './ventasEnVivoDatos'
import { aggSalonero, allSaloneros } from './ventasUtils'
import { calcularLentes, type LineaLente, type TicketLente } from './saloneroLentes'
import type { LineaNdfRow, MesaAbiertaRow, TicketNdfConId } from '../../shared/api/posNdf'
import type { DiasMap } from '../../shared/types/ventas'

const ticket = (id: string, login: string, fecha = '2026-10-02'): TicketNdfConId => ({
  id, numero_factura: id, estado: 'C', fecha_registra: `${fecha}T19:00:00-06:00`, fecha_cierra: null,
  cajero_login: '222', canal: 'salon', mesa: id, salonero_login: login, registrado_por: 'salonero',
  turno: 'noche', con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 1000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok',
})
const linea = (ticketId: string, login: string, monto = 1000): LineaNdfRow => ({
  ticket_id: ticketId, codigo_producto: '100', nombre: 'ROLL', cantidad: 1, monto, familia: 3,
  usuario_registra: login,
})

/** Las dos situaciones reales: staging (sin `pos_login`) y prod (con el mapeo del 2026-10-29). */
const ENTORNOS: Record<string, Record<string, string>> = {
  staging: {},
  prod: { '038': 'NACHO', '235': 'ROSAURA M', '035': 'RODRI', '036': 'FRANCO', '037': 'VALENTINO' },
}

const PARES: [string, string, string][] = [
  ['NACHO', '266', '038'],
  ['ROSAURA', '01', '235'],
  ['ESTEBAN', '023', '555'],
]

describe.each(Object.entries(ENTORNOS))('entorno %s', (_entorno, nombres) => {
  it.each(PARES)('%s: los dos códigos dan el MISMO nombre (clave del ranking)', (_quien, a, b) => {
    expect(nombreSalonero(a, nombres)).toBe(nombreSalonero(b, nombres))
    expect(nombreSalonero(a, nombres)).not.toMatch(/sin asignar/)
  })

  it.each(PARES)('%s: ranking del día → una sola fila con la plata de los dos códigos', (_quien, a, b) => {
    const dia = armarDia('2026-10-02', [ticket('t1', a), ticket('t2', b)],
      [linea('t1', a), linea('t2', b, 3000)], 'sello', nombres).dia
    const filas = Object.keys(dia.saloneros)
    expect(filas).toHaveLength(1)
    expect(dia.saloneros[filas[0]].total).toBe(4000)
  })

  it.each(PARES)('%s: entre días (código viejo un día, nuevo otro) → una sola fila en ranking/ICP/metas', (_quien, a, b) => {
    const dias: DiasMap = {
      '2026-10-01': armarDia('2026-10-01', [ticket('t1', a, '2026-10-01')], [linea('t1', a)], 's', nombres).dia,
      '2026-10-02': armarDia('2026-10-02', [ticket('t2', b)], [linea('t2', b, 3000)], 's', nombres).dia,
    }
    const nombresRanking = allSaloneros(dias)
    expect(nombresRanking).toHaveLength(1)
    const agg = aggSalonero(nombresRanking[0], ['2026-10-01', '2026-10-02'], dias, {})
    expect(agg.total).toBe(4000)
    expect(agg.days).toBe(2)
  })

  it.each(PARES)('%s: calidad de pax y mesas abiertas → una sola fila', (_quien, a, b) => {
    expect(calidadPaxPorSalonero([ticket('t1', a), ticket('t2', b)], nombres)).toHaveLength(1)
    const mesa = (login: string): MesaAbiertaRow => ({
      clave: login, numero_factura: null, id_pedido: login, mesa: login, salonero_login: login,
      canal: 'salon', pax: 2, pax_alerta: 'ok', updated_at: '2026-10-02T19:00:00-06:00',
      monto_estimado_crc: null, pax_pedido: null, items_valor: null, detalle_productos: null,
    })
    expect(resumirMesasAbiertas([mesa(a), mesa(b)], nombres)).toHaveLength(1)
  })

  it.each(PARES)('%s: lentes por línea (venta propia y mesa propia) → una sola fila', (_quien, a, b) => {
    const t = (id: string): TicketLente => ({
      id, cajero_login: '222', valor_servido_crc: 0, iva_crc: 0, servicio_crc: 0, pax: 2, mesa: id,
    })
    const l = (tid: string, login: string): LineaLente => ({
      ticket_id: tid, codigo_producto: '100', cantidad: 1, monto: 1000, familia: 3, usuario_registra: login,
    })
    const r = calcularLentes([t('t1'), t('t2')], [l('t1', a), l('t2', b)])
    expect(r.ventaPropia).toHaveLength(1)
    expect(r.ventaPropia[0].netaCrc).toBe(2000)
    expect(r.mesaPropia).toHaveLength(1)
    expect(r.mesaPropia[0].tickets).toBe(2)
  })
})

describe('barmen 035, 036 y 037', () => {
  it('van al ranking de la lente por línea (no al balde «otro»)', () => {
    const r = calcularLentes(
      [{ id: 't1', cajero_login: '222', valor_servido_crc: 0, iva_crc: 0, servicio_crc: 0, pax: 0 }],
      ['035', '036', '037'].map(c => ({
        ticket_id: 't1', codigo_producto: '100', cantidad: 1, monto: 1000, familia: 3, usuario_registra: c,
      })),
    )
    expect(r.ventaPropia.map(f => f.rol)).toEqual(['mesero', 'mesero', 'mesero'])
  })

  it('tienen nombre propio en staging (roster) y en prod (employees)', () => {
    expect(nombreSalonero('036', {})).toBe('FRANCO')
    expect(nombreSalonero('037', {})).toBe('VALENTINO')
    expect(nombreSalonero('036', ENTORNOS.prod)).toBe('FRANCO')
  })
})
