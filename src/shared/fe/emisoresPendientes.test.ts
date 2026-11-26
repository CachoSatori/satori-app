// Mig 203 — agrupar las facturas «para revisar» por emisor no conocido. Datos ficticios.
import { describe, expect, it } from 'vitest'
import { agruparPendientes, motivos, MOTIVO_EMISOR, type ComprobantePendiente } from './emisoresPendientes'

const OTRO_XML = 'misma clave con otro XML: revisar cuál es el real (quedan todas las versiones)'
const f = (n: number, o: Partial<ComprobantePendiente> = {}): ComprobantePendiente => ({
  clave: String(n).padStart(50, '0'), fecha_emision: '2026-11-30T15:15:00Z', emisor_cedula: '310100000331',
  emisor_nombre: 'Proveedor ficticio', emisor_nombre_comercial: null, total_comprobante: '1000.00000', moneda: 'CRC',
  estado_parseo: 'revisar', motivo: MOTIVO_EMISOR, ...o,
})

describe('agruparPendientes', () => {
  it('agrupa por cédula, más facturas primero, con los otros motivos aparte', () => {
    const g = agruparPendientes([
      f(1), f(2, { motivo: `${OTRO_XML} · ${MOTIVO_EMISOR}` }),
      f(3, { emisor_cedula: '310100000332', emisor_nombre: null, emisor_nombre_comercial: 'Comercial ficticio' }),
    ])
    expect(g.map(e => [e.cedula, e.nombre, e.comprobantes.length])).toEqual([
      ['310100000331', 'Proveedor ficticio', 2], ['310100000332', 'Comercial ficticio', 1]])
    expect(g[0].comprobantes[1].otros_motivos).toEqual([OTRO_XML])
    expect(g[0].comprobantes[0]).toMatchObject({ fin_clave: '0000000001', total: 1000, otros_motivos: [] })
  })
  it('deja afuera: sin cédula, «ok», sin el motivo, y un motivo que solo lo contiene como pedazo', () => {
    expect(agruparPendientes([
      f(1, { emisor_cedula: null, motivo: 'sin cédula del emisor' }), f(2, { estado_parseo: 'ok', motivo: null }),
      f(3, { motivo: OTRO_XML }), f(4, { motivo: `${MOTIVO_EMISOR} extra` }),
    ])).toEqual([])
  })
  it('receptor distinto también entra (el motivo de emisor se puede quitar igual)', () => {
    const g = agruparPendientes([f(1, { estado_parseo: 'receptor_distinto', motivo: `${MOTIVO_EMISOR} · cédula del receptor no configurada` })])
    expect(g[0].comprobantes[0].otros_motivos).toEqual(['cédula del receptor no configurada'])
  })
  it('motivos parte como fe_motivo_sumar', () => {
    expect(motivos(null)).toEqual([])
    expect(motivos(`a · ${MOTIVO_EMISOR} · b`)).toEqual(['a', MOTIVO_EMISOR, 'b'])
  })
})
