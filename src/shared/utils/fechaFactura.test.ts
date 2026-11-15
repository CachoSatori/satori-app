import { describe, it, expect } from 'vitest'
import {
  normalizarFechaFactura, fechaDeClaveFE, invertirDiaMes, avisoFechaFactura, esFechaValida, fechaLarga,
  preguntaFechaAmbigua, msgFacturaVieja, MSG_FECHA_INVERTIDA, MSG_FECHA_FUTURA, DIAS_FACTURA_VIEJA,
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
  it('la clave FE manda sobre lo que leyó la IA (sin aviso si no es futura ni vieja)', () => {
    expect(normalizarFechaFactura('2026-09-11', clave('091126'), HOY))
      .toEqual({ fecha: '2026-11-09', origen: 'clave', aviso: null })
    // aunque la IA haya leído una fecha no ambigua distinta
    expect(normalizarFechaFactura('2026-10-25', clave('020126'), HOY).fecha).toBe('2026-01-02')
    // sin fecha de la IA, la clave la da
    expect(normalizarFechaFactura(null, clave('091126'), HOY).fecha).toBe('2026-11-09')
    // la clave manda aunque la lectura de la IA sea ambigua con las dos posibles: no se pregunta
    expect(normalizarFechaFactura('2026-10-11', clave('101126'), HOY))
      .toEqual({ fecha: '2026-11-10', origen: 'clave', aviso: null })
  })
  it('clave FE con fecha futura → avisa', () => {
    expect(normalizarFechaFactura(null, clave('201126'), HOY).aviso).toBe(MSG_FECHA_FUTURA)
  })
  it('fecha no ambigua (25/10) queda intacta; con 19 días avisa que es vieja', () => {
    expect(normalizarFechaFactura('2026-10-25', null, HOY))
      .toEqual({ fecha: '2026-10-25', origen: 'ia', aviso: msgFacturaVieja(19) })
  })
  it('ambigua con la invertida vieja: queda la leída (2026-11-02; 2-feb tiene 275 días)', () => {
    expect(normalizarFechaFactura('2026-11-02', null, HOY))
      .toEqual({ fecha: '2026-11-02', origen: 'ia', aviso: msgFacturaVieja(11) })
  })
  it('ambigua futura → se usa la invertida (12/3 leído 2026-12-03 → 2026-03-12), con aviso D/M y de vieja', () => {
    expect(normalizarFechaFactura('2026-12-03', null, HOY))
      .toEqual({ fecha: '2026-03-12', origen: 'invertida', aviso: `${MSG_FECHA_INVERTIDA} ${msgFacturaVieja(246)}` })
  })
  it('ambigua con las dos lecturas viejas → no adivina: pregunta (la más cercana primero)', () => {
    expect(normalizarFechaFactura('2026-03-05', null, HOY)).toEqual({
      fecha: null, origen: 'ambigua', opciones: ['2026-05-03', '2026-03-05'],
      aviso: '¿3 de mayo o 5 de marzo?',
    })
  })
  it('futura no ambigua (25/12) queda pero nunca sin aviso', () => {
    expect(normalizarFechaFactura('2026-12-25', null, HOY)).toEqual({ fecha: '2026-12-25', origen: 'ia', aviso: MSG_FECHA_FUTURA })
  })
  it('ambigua futura cuya invertida también es futura → queda con aviso de futuro', () => {
    // hoy 13-nov-2026; 2027-11-12 invertida = 2027-12-11, ambas futuras
    expect(normalizarFechaFactura('2027-11-12', null, HOY)).toEqual({ fecha: '2027-11-12', origen: 'ia', aviso: MSG_FECHA_FUTURA })
  })
  it('límite de la ventana: una lectura a 60 días es posible, a 61 no', () => {
    // leída 2026-01-03, invertida 2026-03-01
    expect(normalizarFechaFactura('2026-01-03', null, '2026-03-05').fecha).toBe('2026-03-01')   // leída a 61: solo la inv
    expect(normalizarFechaFactura('2026-01-03', null, '2026-03-04').origen).toBe('ambigua')     // leída a 60: las dos
    expect(normalizarFechaFactura('2026-01-03', null, '2026-04-30').fecha).toBe('2026-03-01')   // inv a 60 exactos
    expect(normalizarFechaFactura('2026-01-03', null, '2026-05-01').origen).toBe('ambigua')     // inv a 61: las dos viejas
  })
  it('basura de la IA → sin fecha', () => {
    expect(normalizarFechaFactura('9/11/2026', null, HOY)).toEqual({ fecha: null, origen: 'ninguna', aviso: null })
  })
})

// (14-nov) Regla del dueño: analizar por calendario. Hoy fijo = 14-nov-2026 (Costa Rica).
describe('fecha por calendario (hoy 14-nov-2026)', () => {
  const H = '2026-11-14'
  it('«11/10»: 11-oct (34 días) y 10-nov (4 días) son posibles → pregunta, 10-nov primero; lea como lea la IA', () => {
    const esperado = { fecha: null, origen: 'ambigua', opciones: ['2026-11-10', '2026-10-11'],
      aviso: '¿10 de noviembre o 11 de octubre?' }
    expect(normalizarFechaFactura('2026-10-11', null, H)).toEqual(esperado)
    expect(normalizarFechaFactura('2026-11-10', null, H)).toEqual(esperado)
  })
  it('«9/11» leído bien (2026-11-09): 11-sep tiene 64 días → queda 9-nov, sin aviso', () => {
    expect(normalizarFechaFactura('2026-11-09', null, H)).toEqual({ fecha: '2026-11-09', origen: 'ia', aviso: null })
  })
  it('«9/11» leído al revés (2026-09-11) → 9-nov con aviso D/M', () => {
    expect(normalizarFechaFactura('2026-09-11', null, H))
      .toEqual({ fecha: '2026-11-09', origen: 'invertida', aviso: MSG_FECHA_INVERTIDA })
  })
  it('«11/09» → la única posible es 9-nov (11-sep, 64 días, queda fuera de la ventana)', () => {
    expect(normalizarFechaFactura('2026-09-11', null, H).fecha).toBe('2026-11-09')
  })
  it('elige la más cercana sin futuro: leída futura (2026-12-11) → 2026-11-12', () => {
    expect(normalizarFechaFactura('2026-12-11', null, H))
      .toEqual({ fecha: '2026-11-12', origen: 'invertida', aviso: MSG_FECHA_INVERTIDA })
  })
  it('una fecha de MAÑANA (CR) no es posible: hoy 9-dic, leída 10-dic, invertida 12-oct (58 días) → la invertida', () => {
    expect(normalizarFechaFactura('2026-12-10', null, '2026-12-09'))
      .toEqual({ fecha: '2026-10-12', origen: 'invertida', aviso: `${MSG_FECHA_INVERTIDA} ${msgFacturaVieja(58)}` })
    // mañana tampoco gana contra una lectura vieja: hoy 1-oct, leída 2-oct (mañana), invertida 10-feb → la invertida
    expect(normalizarFechaFactura('2026-10-02', null, '2026-10-01'))
      .toEqual({ fecha: '2026-02-10', origen: 'invertida', aviso: `${MSG_FECHA_INVERTIDA} ${msgFacturaVieja(233)}` })
    // un día después (hoy 10-dic) el 10-dic ya es posible: las dos lo son → pregunta
    expect(normalizarFechaFactura('2026-12-10', null, '2026-12-10').origen).toBe('ambigua')
  })
  it('la invertida futura nunca se elige: leída 2026-11-12 (inv 2026-12-11) queda', () => {
    expect(normalizarFechaFactura('2026-11-12', null, H)).toEqual({ fecha: '2026-11-12', origen: 'ia', aviso: null })
  })
  it('clave FE manda también acá (sin pregunta)', () => {
    expect(normalizarFechaFactura('2026-10-11', clave('111026'), H))
      .toEqual({ fecha: '2026-10-11', origen: 'clave', aviso: msgFacturaVieja(34) })
  })
  it('año cambiado en enero: hoy 5-ene-2027', () => {
    const E = '2027-01-05'
    // «2/1/2027» leído 2027-02-01 (futuro) → 2-ene-2027
    expect(normalizarFechaFactura('2027-02-01', null, E))
      .toEqual({ fecha: '2027-01-02', origen: 'invertida', aviso: MSG_FECHA_INVERTIDA })
    // «11/12/2026»: 11-dic-2026 (25 días) y 12-nov-2026 (54 días) → pregunta, con el año porque no es el de hoy
    expect(normalizarFechaFactura('2026-11-12', null, E)).toEqual({
      fecha: null, origen: 'ambigua', opciones: ['2026-12-11', '2026-11-12'],
      aviso: '¿11 de diciembre de 2026 o 12 de noviembre de 2026?',
    })
    // clave FE de diciembre del año anterior: cuenta los días cruzando el año
    expect(normalizarFechaFactura(null, clave('301226'), E))
      .toEqual({ fecha: '2026-12-30', origen: 'clave', aviso: null })   // 6 días: no es vieja
    expect(avisoFechaFactura('2026-12-28', E)).toBe(msgFacturaVieja(8))
  })
})

describe('avisoFechaFactura (lo que escribe el usuario)', () => {
  it('avisa si queda en el futuro de Costa Rica', () => {
    expect(avisoFechaFactura('2026-11-14', HOY)).toBe(MSG_FECHA_FUTURA)
    expect(avisoFechaFactura('2026-11-13', HOY)).toBeNull()
    expect(avisoFechaFactura('', HOY)).toBeNull()
  })
  it(`factura vieja: a ${DIAS_FACTURA_VIEJA} días no avisa, a ${DIAS_FACTURA_VIEJA + 1} sí («Factura de hace X días»)`, () => {
    expect(DIAS_FACTURA_VIEJA).toBe(7)
    expect(avisoFechaFactura('2026-11-06', HOY)).toBeNull()
    expect(avisoFechaFactura('2026-11-05', HOY)).toBe('Factura de hace 8 días: revisá la fecha.')
  })
})

describe('preguntaFechaAmbigua / fechaLarga', () => {
  it('«¿9 de noviembre o 11 de septiembre?»', () => {
    expect(preguntaFechaAmbigua(['2026-11-09', '2026-09-11'], '2026-11-14')).toBe('¿9 de noviembre o 11 de septiembre?')
    expect(fechaLarga('2026-01-02', '2027-01-05')).toBe('2 de enero de 2026')
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
  it('ambigua: sin fecha precargada y con las dos opciones', () => {
    const r = conFechaCR({ ...base, fecha: '2026-10-11' }, '2026-11-14')
    expect(r.fecha).toBeNull()
    expect(r.fecha_origen).toBe('ambigua')
    expect(r.fecha_opciones).toEqual(['2026-11-10', '2026-10-11'])
    expect(r.fecha_leida).toBe('2026-10-11')
  })
})
