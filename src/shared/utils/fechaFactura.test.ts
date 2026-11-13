import { describe, it, expect } from 'vitest'
import {
  normalizarFechaFactura, fechaDeClaveFE, invertirDiaMes, avisoFechaFactura, esFechaValida,
  MSG_FECHA_INVERTIDA, MSG_FECHA_FUTURA,
} from './fechaFactura'
import { conFechaCR, type DocExtract } from '../api/documents'

const HOY = '2026-11-13'   // fecha de Costa Rica del caso real

// Clave FE ficticia: 506 + DDMMAA + 12 dígitos de cédula + 20 de consecutivo + 1 situación + 8 de seguridad = 50.
const clave = (ddmmaa: string) => `506${ddmmaa}${'0'.repeat(12)}${'1'.repeat(20)}1${'2'.repeat(8)}`

describe('fechaDeClaveFE', () => {
  it('lee DDMMAA de las posiciones 4–9', () => {
    expect(clave('091126')).toHaveLength(50)
    expect(fechaDeClaveFE(clave('091126'))).toBe('2026-11-09')
  })
  it('tolera espacios; sin 50 dígitos o con fecha imposible → null', () => {
    expect(fechaDeClaveFE(clave('091126').replace(/(\d{10})/g, '$1 '))).toBe('2026-11-09')
    expect(fechaDeClaveFE(clave('091126').slice(0, 49))).toBeNull()
    expect(fechaDeClaveFE(clave('310226'))).toBeNull()   // 31-feb
    expect(fechaDeClaveFE(null)).toBeNull()
  })
})

describe('invertirDiaMes / esFechaValida', () => {
  it('solo invierte si es ambigua (ambos ≤ 12 y distintos)', () => {
    expect(invertirDiaMes('2026-09-11')).toBe('2026-11-09')
    expect(invertirDiaMes('2026-10-25')).toBeNull()
    expect(invertirDiaMes('2026-05-05')).toBeNull()
  })
  it('valida fechas reales', () => {
    expect(esFechaValida('2026-02-30')).toBe(false)
    expect(esFechaValida('9/11/2026')).toBe(false)
    expect(esFechaValida('2026-11-09')).toBe(true)
  })
})

describe('normalizarFechaFactura', () => {
  it('caso de prod: «9/11/2026» leído 2026-09-11, hoy 13-nov → 2026-11-09 con aviso', () => {
    expect(normalizarFechaFactura('2026-09-11', null, HOY))
      .toEqual({ fecha: '2026-11-09', origen: 'invertida', aviso: MSG_FECHA_INVERTIDA })
  })
  it('la clave FE manda sobre lo que leyó la IA (sin aviso si no es futura)', () => {
    expect(normalizarFechaFactura('2026-09-11', clave('091126'), HOY))
      .toEqual({ fecha: '2026-11-09', origen: 'clave', aviso: null })
    // aunque la IA haya leído una fecha no ambigua distinta
    expect(normalizarFechaFactura('2026-10-25', clave('020126'), HOY).fecha).toBe('2026-01-02')
    // sin fecha de la IA, la clave la da
    expect(normalizarFechaFactura(null, clave('091126'), HOY).fecha).toBe('2026-11-09')
  })
  it('clave FE con fecha futura → avisa', () => {
    expect(normalizarFechaFactura(null, clave('201126'), HOY).aviso).toBe(MSG_FECHA_FUTURA)
  })
  it('fecha no ambigua (25/10) queda intacta y sin aviso', () => {
    expect(normalizarFechaFactura('2026-10-25', null, HOY)).toEqual({ fecha: '2026-10-25', origen: 'ia', aviso: null })
  })
  it('ambigua plausible (dentro de 60 días) no se toca: 2026-11-02', () => {
    expect(normalizarFechaFactura('2026-11-02', null, HOY)).toEqual({ fecha: '2026-11-02', origen: 'ia', aviso: null })
  })
  it('ambigua futura → se usa la invertida (12/3 leído 2026-12-03 → 2026-03-12) y se avisa', () => {
    expect(normalizarFechaFactura('2026-12-03', null, HOY))
      .toEqual({ fecha: '2026-03-12', origen: 'invertida', aviso: MSG_FECHA_INVERTIDA })
  })
  it('ambigua vieja con la invertida también fuera de la ventana → intacta', () => {
    expect(normalizarFechaFactura('2026-03-05', null, HOY)).toEqual({ fecha: '2026-03-05', origen: 'ia', aviso: null })
  })
  it('futura no ambigua (25/12) queda pero nunca sin aviso', () => {
    expect(normalizarFechaFactura('2026-12-25', null, HOY)).toEqual({ fecha: '2026-12-25', origen: 'ia', aviso: MSG_FECHA_FUTURA })
  })
  it('ambigua futura cuya invertida también es futura → queda con aviso de futuro', () => {
    // hoy 13-nov-2026; 2027-11-12 invertida = 2027-12-11, ambas futuras
    expect(normalizarFechaFactura('2027-11-12', null, HOY)).toEqual({ fecha: '2027-11-12', origen: 'ia', aviso: MSG_FECHA_FUTURA })
  })
  it('límite de la ventana: invertida a 60 días entra, a 61 no', () => {
    // leída 2026-01-03 (vieja), invertida 2026-03-01
    expect(normalizarFechaFactura('2026-01-03', null, '2026-03-05').fecha).toBe('2026-03-01')   // leída a 61 días, inv a 4
    expect(normalizarFechaFactura('2026-01-03', null, '2026-03-04').fecha).toBe('2026-01-03')   // leída a 60 días: no se toca
    expect(normalizarFechaFactura('2026-01-03', null, '2026-04-30').fecha).toBe('2026-03-01')   // 60 días exactos
    expect(normalizarFechaFactura('2026-01-03', null, '2026-05-01').fecha).toBe('2026-01-03')   // 61 días
  })
  it('basura de la IA → sin fecha', () => {
    expect(normalizarFechaFactura('9/11/2026', null, HOY)).toEqual({ fecha: null, origen: 'ninguna', aviso: null })
  })
})

describe('avisoFechaFactura (lo que escribe el usuario)', () => {
  it('solo avisa si queda en el futuro de Costa Rica', () => {
    expect(avisoFechaFactura('2026-11-14', HOY)).toBe(MSG_FECHA_FUTURA)
    expect(avisoFechaFactura('2026-11-13', HOY)).toBeNull()
    expect(avisoFechaFactura('', HOY)).toBeNull()
  })
})

describe('conFechaCR (lo que precarga la app)', () => {
  const base = { tipo: 'factura', proveedor: 'Proveedor Ficticio', clave_fe: null, fecha: '2026-09-11', moneda: 'CRC',
    metodo_pago: null, banco: null, referencia: null, subtotal: null, total: 1000, items: [], cuenta_qb_sugerida: null,
    confianza: 0.9 } as DocExtract
  it('corrige la fecha, guarda la leída y el aviso', () => {
    const r = conFechaCR(base, HOY)
    expect(r.fecha).toBe('2026-11-09')
    expect(r.fecha_leida).toBe('2026-09-11')
    expect(r.fecha_origen).toBe('invertida')
    expect(r.aviso_fecha).toBe(MSG_FECHA_INVERTIDA)
    expect(r.total).toBe(1000)
  })
  it('documento viejo de la Bandeja: se normaliza con el día en que se subió, no con hoy', () => {
    // una factura del 11-sep subida el 12-sep no se invierte por mirarla en noviembre
    expect(conFechaCR(base, '2026-09-12').fecha).toBe('2026-09-11')
  })
})
