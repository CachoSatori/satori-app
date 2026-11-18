// Mi evolución (pedido del dueño, 18-nov-2026): cada uno contra sí mismo, con la regla de días y redondeo de Ventas.
// Datos ficticios. «Hoy» fijo: miércoles 18-nov-2026 (ayer = martes 17).
import { describe, expect, it } from 'vitest'
import type { DiasMap, ProductMap, SaloneroDay } from '../../shared/types/ventas'
import {
  comparacionesPersonales, misIndicadores, semanasPersonales, tendenciaVentaPersona, variacionPct,
} from './evolucionPersonal'

const HOY = '2026-11-18'
const YO = 'PERSONA UNO'
const PM: ProductMap = {}

/** Un día mío: neta cruda en céntimos (para #288), delivery aparte, pax, ítems. */
function dia(netaCts: number, o: Partial<SaloneroDay> & { deliveryCts?: number } = {}): DiasMap[string] {
  const { deliveryCts = 0, ...resto } = o
  const total = Math.round(netaCts / 100)
  const delivery = Math.round(deliveryCts / 100)
  const s: SaloneroDay = {
    pax: 2, total, com: 0, beb: 0, iCom: 4, iBeb: 2, iva: 0, serv: 0, promPax: 0, promPlato: 0, promBebida: 0,
    ratioCB: 0, ratioU: 0, bebPax: 0, prods: [],
    ...(delivery ? { delivery } : {}),
    crudoCts: { neta: netaCts, iva: 0, serv: 0, delivery: deliveryCts },
    ...resto,
  }
  return { fileName: 'ndf', uploadedAt: HOY, saloneros: { [YO]: s, 'OTRA PERSONA': { ...s, total: 999999 } } }
}

describe('misIndicadores', () => {
  it('#288: la venta se redondea UNA vez sobre el crudo, no día por día', () => {
    // Dos días de ₡100,40 → cada día redondeado da 100 (suma 200); el crudo da 200,80 → 201.
    const dias: DiasMap = { '2026-11-16': dia(10040), '2026-11-17': dia(10040) }
    const m = misIndicadores(YO, Object.keys(dias), { desde: '2026-11-16', hasta: '2026-11-17' }, dias, PM)
    expect(m.ventas).toBe(201)
    expect(m.dias).toBe(2)
  })

  it('D4: venta por persona = neta de SALÓN (sin su delivery) ÷ sus personas', () => {
    const dias: DiasMap = { '2026-11-17': dia(1_000_000, { pax: 4, deliveryCts: 200_000 }) }
    const m = misIndicadores(YO, Object.keys(dias), { desde: '2026-11-17', hasta: '2026-11-17' }, dias, PM)
    expect(m.ventaPersona).toBe(2000)   // (10.000 − 2.000) / 4
    expect(m.ticketItem).toBeCloseTo(10000 / 6)
    expect(m.bebidasPax).toBe(0.5)
  })

  it('solo mis números: la otra persona del mismo día no entra', () => {
    const dias: DiasMap = { '2026-11-17': dia(500_000) }
    const m = misIndicadores(YO, Object.keys(dias), { desde: '2026-11-17', hasta: '2026-11-17' }, dias, PM)
    expect(m.ventas).toBe(5000)
  })

  it('ICP electrónico con MIS propinas del rango (crc + usd × TC)', () => {
    const dias: DiasMap = { '2026-11-17': dia(1_000_000) }
    const m = misIndicadores(YO, Object.keys(dias), { desde: '2026-11-17', hasta: '2026-11-17' }, dias, PM, [
      { session_date: '2026-11-17', tip_amount_crc: 200, tip_amount_usd: 1, exchange_rate: 100 },
      { session_date: '2026-11-10', tip_amount_crc: 9999, tip_amount_usd: 0, exchange_rate: 100 },   // fuera del rango
    ])
    expect(m.icp).toBeCloseTo(3)   // 300 / 10.000 × 100
  })

  it('sin días trabajados: todo null, nunca 0 engañoso', () => {
    const m = misIndicadores(YO, [], { desde: '2026-11-01', hasta: '2026-11-17' }, {}, PM)
    expect(m).toMatchObject({ dias: 0, ventaPersona: null, ticketItem: null, icp: null })
  })
})

describe('comparacionesPersonales (regla de días de Ventas)', () => {
  const dias: DiasMap = {
    '2026-11-09': dia(1_000_000), '2026-11-10': dia(1_000_000), '2026-11-11': dia(9_000_000),   // semana pasada
    '2026-11-16': dia(1_200_000), '2026-11-17': dia(1_200_000), '2026-11-18': dia(9_000_000),   // esta (18 = hoy)
    '2026-10-05': dia(2_000_000),
  }
  const [semana, mes] = comparacionesPersonales(YO, Object.keys(dias), dias, PM, HOY)

  it('esta semana llega hasta AYER y se compara con los mismos días de la semana pasada', () => {
    expect(semana.ahora.dias).toBe(2)              // 16 y 17; hoy (18) no entra
    expect(semana.ahora.ventas).toBe(24000)
    expect(semana.antes?.dias).toBe(2)             // 9 y 10; el 11 queda afuera (mismos días)
    expect(semana.antes?.ventas).toBe(20000)
    expect(variacionPct(semana.ahora.ventas, semana.antes!.ventas)).toBeCloseTo(20)
  })

  it('este mes (1 → ayer) contra los mismos días del mes anterior (1 → 17 de octubre)', () => {
    expect(mes.ahora.dias).toBe(5)                 // 9, 10, 11, 16, 17
    expect(mes.antes?.dias).toBe(1)                // 5-oct
    expect(mes.rotuloBase).toMatch(/octubre/)
  })

  it('el lunes, «esta semana» es la semana pasada completa (no un período vacío)', () => {
    const [s] = comparacionesPersonales(YO, Object.keys(dias), dias, PM, '2026-11-16')
    expect(s.ahora.dias).toBe(3)                   // 9, 10 y 11
    expect(s.rotulo).toMatch(/9 al 15 de noviembre/)
  })
})

describe('semanasPersonales y tendencia', () => {
  it('12 semanas ISO, la más nueva primero, la en curso cortada a ayer', () => {
    const dias: DiasMap = { '2026-11-17': dia(100_000), '2026-11-18': dia(100_000) }
    const s = semanasPersonales(YO, Object.keys(dias), dias, PM, HOY)
    expect(s).toHaveLength(12)
    expect(s[0]).toMatchObject({ lunes: '2026-11-16', enCurso: true, dias: 1 })
    expect(s[0].rango.hasta).toBe('2026-11-17')
    expect(s[1]).toMatchObject({ lunes: '2026-11-09', enCurso: false, dias: 0 })
    expect(s[11].lunes).toBe('2026-08-31')
  })

  it('tendencia: últimas 4 semanas trabajadas contra las 4 anteriores; sin 8 semanas, null', () => {
    const dias: DiasMap = {}
    const lunes = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28']
    lunes.forEach((l, i) => {
      const d = new Date(`${l}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
      // pax 2: venta por persona = neta/2. Las 4 nuevas a ₡6.000, las 4 viejas a ₡5.000.
      dias[d.toISOString().slice(0, 10)] = dia(i < 4 ? 1_200_000 : 1_000_000)
    })
    const s = semanasPersonales(YO, Object.keys(dias), dias, PM, HOY)
    expect(tendenciaVentaPersona(s)).toBeCloseTo(20)
    expect(tendenciaVentaPersona(s.slice(0, 7))).toBeNull()
  })

  it('variación sin base: null, nunca −100 %', () => {
    expect(variacionPct(5, 0)).toBeNull()
    expect(variacionPct(5, null)).toBeNull()
    expect(variacionPct(null, 5)).toBeNull()
  })
})
