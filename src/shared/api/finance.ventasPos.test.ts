// P&L: los ingresos de salón y delivery salen del PoS por mes (16-nov). Datos ficticios.
import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { ingresosPorMes } from './finance'
import type { DiaData } from '../types/ventas'

const dia = (salon: number, delivMesero: number, cajaSalon: number, cajaDeliv: number): DiaData => ({
  fileName: 'pos', uploadedAt: '2026-11-05',
  saloneros: {
    M: { pax: 1, total: salon + delivMesero, delivery: delivMesero, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
      promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [] },
    C: { esCajero: true, total: cajaSalon + cajaDeliv, salon: cajaSalon, delivery: cajaDeliv, iva: 0, serv: 0,
      ordenes: 1, ticketProm: 0, prods: [] },
  },
})

describe('ingresosPorMes', () => {
  it('agrupa por mes con la suma del módulo Ventas (salón + delivery = neta)', () => {
    const r = ingresosPorMes({
      '2026-10-31': dia(100, 10, 20, 5),
      '2026-11-01': dia(200, 0, 0, 50),
      '2026-11-17': dia(300, 30, 40, 0),
    })
    expect(r[10]).toEqual({ salon: 120, delivery: 15 })
    expect(r[11]).toEqual({ salon: 540, delivery: 80 })
  })
})
