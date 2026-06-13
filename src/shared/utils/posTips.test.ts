import { describe, it, expect } from 'vitest'
import { sumPosTips, efectivoPoolConPos } from './posTips'

describe('sumPosTips — propinas del PoS al pool (P1)', () => {
  it('3 pagos con propina → suma exacta + atribución por salonero', () => {
    const r = sumPosTips([
      { tip_crc: 1000, tip_currency: 'CRC', salonero_id: 'ana' },
      { tip_crc: 1500, tip_currency: 'CRC', salonero_id: 'ana' },
      { tip_crc: 2000, tip_currency: 'USD', salonero_id: 'beto' },
    ])
    expect(r.total_crc).toBe(4500)
    expect(r.total_usd_crc).toBe(2000)         // solo el de tip_currency USD
    expect(r.por_salonero).toEqual({ ana: 2500, beto: 2000 })
  })
  it('ignora propinas en 0 y sin salonero cae a "sin-asignar"', () => {
    const r = sumPosTips([
      { tip_crc: 0, salonero_id: 'ana' },
      { tip_crc: 800 },
    ])
    expect(r.total_crc).toBe(800)
    expect(r.por_salonero).toEqual({ 'sin-asignar': 800 })
  })
  it('es función de los datos → re-llamar da el MISMO total (no acumula)', () => {
    const rows = [{ tip_crc: 1200, salonero_id: 'x' }]
    expect(sumPosTips(rows).total_crc).toBe(sumPosTips(rows).total_crc)
    expect(sumPosTips(rows).total_crc).toBe(1200)
  })
})

describe('efectivoPoolConPos — pool efectivo = manual + PoS (no cambia el reparto)', () => {
  it('suma manual + pool del PoS', () => {
    expect(efectivoPoolConPos(10000, 4500)).toBe(14500)
  })
  it('manual solo (sin PoS) = igual que hoy', () => {
    expect(efectivoPoolConPos(10000, 0)).toBe(10000)
  })
})
