// F1 · parser de comprobantes de Hacienda (spec docs/inventario/SPEC-compras-stock-costos.md §4.4). Muestras FICTICIAS.
import { describe, it, expect } from 'vitest'
import { leerXml, textoDe } from './xmlMini'
import { margenSuma, parsearFe, partesClave, sumaDecimal } from './parseFe'
import { codigoHttp, decodificarB64, rutaXml, TOPE_XMLS_POR_PEDIDO, validarSobre } from './sobreFe'
import { b64, CEDULA_EMISOR, CEDULA_RECEPTOR, claveFicticia, mensajeHaciendaFicticio, xmlFicticio } from './fixturasFe.testutil'

const comp = (xml: string) => {
  const r = parsearFe(xml)
  if (r.clase !== 'comprobante') throw new Error(`esperaba comprobante, vino ${r.clase}: ${JSON.stringify(r)}`)
  return r
}

describe('xmlMini — lector sin DTD', () => {
  it('lee elementos, atributos, prefijos, CDATA, comentarios y entidades predefinidas', () => {
    const l = leerXml('﻿<?xml version="1.0"?><a:R x="1 &amp; 2"><!-- c --><B>uno &lt;2&gt; &#65;&#x42;</B><C><![CDATA[<no>]]></C><D/></a:R>')
    expect(l.ok).toBe(true)
    if (!l.ok) return
    expect(l.raiz.nombre).toBe('R')
    expect(l.raiz.atributos.x).toBe('1 & 2')
    expect(textoDe(l.raiz, 'B')).toBe('uno <2> AB')
    expect(textoDe(l.raiz, 'C')).toBe('<no>')
    expect(textoDe(l.raiz, 'D')).toBeNull()
  })
  it.each([
    ['DTD', '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>'],
    ['entidad desconocida', '<r>&x;</r>'],
    ['& suelto', '<r>a & b</r>'],
    ['sin cerrar', '<r><a></r>'],
    ['cierre cruzado', '<r><a></b></r>'],
    ['dos raíces', '<r/><s/>'],
    ['vacío', '   '],
    ['texto fuera', 'hola <r/>'],
    ['basura', '%PDF-1.4 binario'],
  ])('rechaza %s sin tirar', (_, x) => {
    expect(leerXml(x).ok).toBe(false)
  })
  it('DTD o ENTITY en cualquier lugar: se corta ANTES de leer, con motivo explícito (aunque venga después de la raíz)', () => {
    const l1 = leerXml('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>')
    const l2 = leerXml('<r><a/></r><!ENTITY x "y">')
    expect(l1.ok || l1.motivo).toMatch(/DTD/)
    expect(l2.ok || l2.motivo).toMatch(/DTD/)
  })
  it('tope de profundidad', () => {
    expect(leerXml('<a>'.repeat(70) + '</a>'.repeat(70)).ok).toBe(false)
  })
})

describe('parsearFe — factura v4.4', () => {
  const r = comp(xmlFicticio())
  it('cabecera', () => {
    expect(r.estado).toBe('ok')
    expect(r.motivos).toEqual([])
    const c = r.comprobante
    expect(c.clave).toBe(claveFicticia())
    expect(c.tipo).toBe('factura')
    expect(c.version).toBe('4.4')
    expect(c.consecutivo).toBe('00100001010000000001')
    expect(c.fecha_emision).toBe('2026-11-30T09:15:00-06:00')
    expect(c.emisor_cedula).toBe(CEDULA_EMISOR)
    expect(c.emisor_nombre).toBe('Proveedor de prueba 1')
    expect(c.receptor_cedula).toBe(CEDULA_RECEPTOR)
    expect(c.condicion_venta).toBe('02')
    expect(c.plazo_credito).toBe('30')
    expect(c.medio_pago).toBe('04')
    expect(c.moneda).toBe('CRC')
    expect(c.tipo_cambio).toBe('1.00000')
    expect(c.total_comprobante).toBe('10000.00000')
    expect(c.total_impuesto).toBe('650.00000')
    expect(c.ref_clave).toBeNull()
  })
  it('líneas: CABYS, código comercial (el de tipo 01), detalle, cantidad, unidad, precio, impuestos', () => {
    expect(r.lineas).toHaveLength(2)
    const [a, b] = r.lineas
    expect(a).toMatchObject({
      numero_linea: 1, cabys: '1234567890123', codigo_comercial_tipo: '01', codigo_comercial: 'ABC-24',
      detalle: 'Producto A caja 24 Ud & más', cantidad: '3.000', unidad: 'Unid', unidad_comercial: 'caja',
      precio_unitario: '1000.00000', monto_total: '3000.00000', descuento: '0.00000', subtotal: '3000.00000',
      impuesto_codigo: '01', impuesto_tarifa: '13.00', impuesto_monto: '650.00000', impuesto_neto: '650.00000',
      total_linea: '5650.00000',
    })
    expect(b.codigo_comercial).toBeNull()
    expect(b.impuesto_monto).toBeNull()
  })
  it('la firma ds:Signature y elementos nuevos (ProveedorSistemas) se ignoran', () => {
    expect(r.motivos).toEqual([])
  })
})

describe('parsearFe — versiones tolerantes', () => {
  it('v4.3: Codigo como CABYS, MedioPago en la cabecera, TipoDoc', () => {
    const r = comp(xmlFicticio({ version: '4.3', raiz: 'NotaCreditoElectronica', referencia: claveFicticia({ numero: 9 }) }))
    expect(r.estado).toBe('ok')
    expect(r.comprobante.version).toBe('4.3')
    expect(r.lineas[0].cabys).toBe('1234567890123')
    expect(r.comprobante.medio_pago).toBe('04')
    expect(r.comprobante.ref_tipo_doc).toBe('01')
  })
  it('versión desconocida → revisar, sin perder los datos', () => {
    const r = comp(xmlFicticio({ version: '9.9' }))
    expect(r.estado).toBe('revisar')
    expect(r.motivos.join()).toMatch(/versión no reconocida/)
    expect(r.lineas).toHaveLength(2)
  })
  it('sin moneda = colones (v4.3 la permitía ausente), sin revisión', () => {
    const r = comp(xmlFicticio({ moneda: null }))
    expect(r.comprobante.moneda).toBe('CRC')
    expect(r.comprobante.tipo_cambio).toBe('1')
    expect(r.estado).toBe('ok')
  })
  it('moneda ilegible → XXX y revisar (la base la acepta; no se pierde)', () => {
    const r = comp(xmlFicticio({ moneda: 'colones' }))
    expect(r.comprobante.moneda).toBe('XXX')
    expect(r.estado).toBe('revisar')
  })
  it('moneda no prevista → revisar', () => {
    expect(comp(xmlFicticio({ moneda: 'JPY' })).motivos.join()).toMatch(/moneda no prevista/)
  })
  it('raíz nueva con Clave (p. ej. un recibo de pago v4.4) → «otro», a revisar', () => {
    const r = comp(xmlFicticio({ raiz: 'ReciboElectronicoPago' }))
    expect(r.comprobante.tipo).toBe('otro')
    expect(r.estado).toBe('revisar')
  })
  it('elemento desconocido se ignora', () => {
    expect(comp(xmlFicticio({ extra: '<OtroNuevo><X>1</X></OtroNuevo>' })).estado).toBe('ok')
  })
})

describe('parsearFe — nota de crédito', () => {
  it('lleva la clave de la factura que corrige, el código y la razón', () => {
    const fac = claveFicticia({ numero: 7 })
    const r = comp(xmlFicticio({ raiz: 'NotaCreditoElectronica', clave: claveFicticia({ numero: 8, tipo: '03' }), referencia: fac }))
    expect(r.comprobante.tipo).toBe('nota_credito')
    expect(r.comprobante.ref_clave).toBe(fac)
    expect(r.comprobante.ref_codigo).toBe('01')
    expect(r.comprobante.ref_razon).toBe('Anula documento de prueba')
    expect(r.comprobante.ref_tipo_doc).toBe('01')
    expect(r.estado).toBe('ok')
  })
  it('nota sin referencia → revisar', () => {
    const r = comp(xmlFicticio({ raiz: 'NotaCreditoElectronica' }))
    expect(r.estado).toBe('revisar')
    expect(r.motivos.join()).toMatch(/InformacionReferencia/)
  })
})

describe('parsearFe — controles (lo dudoso va a revisar, nunca se descarta)', () => {
  it('la suma de líneas no calza', () => {
    const r = comp(xmlFicticio({ total: '10100.00000' }))
    expect(r.estado).toBe('revisar')
    expect(r.motivos).toContain('la suma de las líneas no calza con el total')
  })
  it('redondeo dentro del margen pasa', () => {
    expect(comp(xmlFicticio({ total: '10000.90000' })).estado).toBe('ok')
    expect(margenSuma(10000)).toBe(10)
    expect(margenSuma(100)).toBe(1)
  })
  it('fecha de la clave distinta de FechaEmision', () => {
    const r = comp(xmlFicticio({ fecha: '2026-12-01T09:15:00-06:00' }))
    expect(r.motivos).toContain('la fecha de la clave no coincide con FechaEmision')
  })
  it('sin receptor (tiquete) → revisar', () => {
    const r = comp(xmlFicticio({ raiz: 'TiqueteElectronico', receptor: null }))
    expect(r.comprobante.tipo).toBe('tiquete')
    expect(r.comprobante.receptor_cedula).toBeNull()
    expect(r.motivos).toContain('sin cédula del receptor')
  })
  it('número mal escrito → revisar con el campo', () => {
    const r = comp(xmlFicticio({ lineas: [{ total: '10.000,00' }], total: '10000.00000' }))
    expect(r.estado).toBe('revisar')
    expect(r.motivos.join()).toMatch(/MontoTotalLinea/)
  })
  it('sin líneas → revisar', () => {
    expect(comp(xmlFicticio({ lineas: [] })).motivos).toContain('sin líneas de detalle')
  })
  it('clave con letras (cédula alfanumérica, v4.4 nov-2026) entra a revisar, no se pierde', () => {
    const k = claveFicticia({ emisor: '3101A0000100' })
    const r = comp(xmlFicticio({ clave: k }))
    expect(r.comprobante.clave).toBe(k)
    expect(r.estado).toBe('revisar')
  })
  it('las partes de la clave', () => {
    const p = partesClave(claveFicticia())
    expect([p.pais, p.dia, p.mes, p.anio2, p.emisor, p.situacion]).toEqual(['506', '30', '11', '26', CEDULA_EMISOR, '1'])
  })
})

describe('parsearFe — XML roto o que no es comprobante', () => {
  it('XML roto → roto, con motivo', () => {
    const r = parsearFe(xmlFicticio().slice(0, 500))
    expect(r.clase).toBe('roto')
  })
  it('comprobante sin Clave → roto (sin clave no hay idempotencia)', () => {
    expect(parsearFe(xmlFicticio({ clave: null })).clase).toBe('roto')
  })
  it('Clave de largo equivocado → roto', () => {
    expect(parsearFe(xmlFicticio({ clave: '506123' })).clase).toBe('roto')
  })
  it('un XML cualquiera → no_comprobante', () => {
    expect(parsearFe('<?xml version="1.0"?><rss><channel/></rss>')).toEqual({ clase: 'no_comprobante', raiz: 'rss' })
  })
  it('MensajeReceptor (aceptación propia) → no_comprobante', () => {
    expect(parsearFe('<MensajeReceptor><NumeroCedulaEmisor>1</NumeroCedulaEmisor></MensajeReceptor>').clase).toBe('no_comprobante')
  })
  it('XML con DTD (XXE) → roto, sin leer la entidad', () => {
    const x = xmlFicticio().replace('<?xml version="1.0" encoding="utf-8"?>', '<?xml version="1.0"?><!DOCTYPE f [<!ENTITY e SYSTEM "file:///etc/passwd">]>')
    expect(parsearFe(x).clase).toBe('roto')
  })
})

describe('parsearFe — respuesta de Hacienda', () => {
  it.each([['1', 'aceptado'], ['2', 'parcial'], ['3', 'rechazado'], ['9', 'desconocido']])('Mensaje %s → %s', (m, esperado) => {
    const r = parsearFe(mensajeHaciendaFicticio(claveFicticia(), m))
    expect(r.clase).toBe('respuesta')
    if (r.clase === 'respuesta') {
      expect(r.respuesta.mensaje).toBe(esperado)
      expect(r.respuesta.clave).toBe(claveFicticia())
      expect(r.respuesta.receptor_cedula).toBe(CEDULA_RECEPTOR)
    }
  })
})

describe('sumaDecimal — sin float', () => {
  it('suma exacta', () => {
    expect(sumaDecimal(['0.1', '0.2'])).toBe('0.3')
    expect(sumaDecimal(['650.00000', '-0.5'])).toBe('649.50000')
    expect(sumaDecimal(['-1', '0.25'])).toBe('-0.75')
  })
})

describe('sobreFe — lo que manda el script', () => {
  const xml = xmlFicticio()
  it('acepta un correo con XML y los decodifica (UTF-8 con tildes)', () => {
    const v = validarSobre({ fuente: 'santa-teresa', lote: 'lote-prueba-0001', xmls: [{ b64: b64(xml) }] })
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.valor.xmls[0]).toBe(xml)
  })
  it('latido sin XML', () => {
    expect(validarSobre({ fuente: 'santa-teresa', latido: true })).toMatchObject({ ok: true, valor: { latido: true } })
  })
  it('sin_xml: solo el conteo', () => {
    expect(validarSobre({ fuente: 'x1', lote: 'lote-prueba-0002', sin_xml: true })).toMatchObject({ ok: true, valor: { sin_xml: true, xmls: [] } })
  })
  it.each([
    ['sin fuente', { lote: 'lote-prueba-0003', xmls: [{ b64: b64(xml) }] }],
    ['fuente con mayúsculas', { fuente: 'Santa', lote: 'lote-prueba-0003', xmls: [{ b64: b64(xml) }] }],
    ['sin lote', { fuente: 'x', xmls: [{ b64: b64(xml) }] }],
    ['sin XML', { fuente: 'x', lote: 'lote-prueba-0003', xmls: [] }],
    ['sin_xml con XML', { fuente: 'x', lote: 'lote-prueba-0003', sin_xml: true, xmls: [{ b64: b64(xml) }] }],
    ['b64 inválido', { fuente: 'x', lote: 'lote-prueba-0003', xmls: [{ b64: '%%%%' }] }],
    ['demasiados', { fuente: 'x', lote: 'lote-prueba-0003', xmls: Array(TOPE_XMLS_POR_PEDIDO + 1).fill({ b64: b64(xml) }) }],
    ['XML de más de 1 MB', { fuente: 'x', lote: 'lote-prueba-0003', xmls: [{ b64: 'A'.repeat(1_500_000) }] }],
    ['no es objeto', [1, 2]],
  ])('rechaza %s', (_, body) => {
    expect(validarSobre(body).ok).toBe(false)
  })
  it('base64 de bytes que no son UTF-8 → null (no se «arregla» en silencio)', () => {
    expect(decodificarB64(btoa('\xff\xfe\xfa'))).toBeNull()
  })
  it('código HTTP: 200 todo guardado · 422 algún XML ilegible · 500 falla de base', () => {
    expect(codigoHttp(['nuevo', 'duplicado', 'no_comprobante', 'revisar'], false)).toBe(200)
    expect(codigoHttp(['nuevo', 'error'], false)).toBe(422)
    expect(codigoHttp(['nuevo'], true)).toBe(500)
  })
  it('ruta del XML por año y mes de la clave', () => {
    expect(rutaXml(claveFicticia())).toBe(`2026/11/${claveFicticia()}.xml`)
  })
})

describe('parsearFe — fecha', () => {
  it.each([
    ['2026-11-30T09:15:00', '2026-11-30T09:15:00-06:00', '2026-11-30T15:15:00.000Z'],
    ['2026-11-30T09:15:00.123', '2026-11-30T09:15:00.123-06:00', '2026-11-30T15:15:00.123Z'],
    ['2026-11-30T09:15', '2026-11-30T09:15-06:00', '2026-11-30T15:15:00.000Z'],
  ])('FechaEmision sin zona (%s) → hora de CR con -06:00, ok (v4.4 real la manda así)', (f, esperado, utc) => {
    const r = comp(xmlFicticio({ fecha: f }))
    expect(r.comprobante.fecha_emision).toBe(esperado)
    expect(r.estado).toBe('ok')
    expect(r.motivos).toEqual([])
    expect(new Date(r.comprobante.fecha_emision!).toISOString()).toBe(utc)   // 09:15 en CR = 15:15 UTC
  })
  it.each(['2026-11-30T09:15:00-06:00', '2026-11-30T15:15:00Z', '2026-11-30T09:15:00.5-06:00'])(
    'FechaEmision con zona (%s) → se guarda tal cual, ok', f => {
      const r = comp(xmlFicticio({ fecha: f }))
      expect(r.comprobante.fecha_emision).toBe(f)
      expect(r.estado).toBe('ok')
    })
  it.each(['30/11/2026 09:15', '2026-11-30 09:15:00', '2026-11-30', '2026-11-30T09:15:00-0600', '2026-11-30T09:15:00GMT'])(
    'FechaEmision con formato raro (%s) → revisar y sin fecha', f => {
      const r = comp(xmlFicticio({ fecha: f }))
      expect(r.estado).toBe('revisar')
      expect(r.comprobante.fecha_emision).toBeNull()
      expect(r.motivos).toContain('FechaEmision con formato desconocido')
    })
  it('sin zona igual controla la fecha de la clave', () => {
    const r = comp(xmlFicticio({ fecha: '2026-11-29T09:15:00' }))
    expect(r.comprobante.fecha_emision).toBe('2026-11-29T09:15:00-06:00')
    expect(r.motivos).toContain('la fecha de la clave no coincide con FechaEmision')
  })
  it('sin zona e imposible → revisar con fecha nula', () => {
    const r = comp(xmlFicticio({ fecha: '2026-11-31T09:15:00' }))
    expect(r.comprobante.fecha_emision).toBeNull()
    expect(r.motivos).toContain('FechaEmision imposible (mes, día u hora fuera de rango)')
  })
  it.each(['2026-13-30T09:15:00-06:00', '2026-11-32T09:15:00-06:00', '2026-02-29T09:15:00-06:00', '2026-11-00T09:15:00-06:00',
    '2026-11-30T25:15:00-06:00', '2026-11-30T09:61:00-06:00'])(
    'formato válido pero fecha imposible (%s) → revisar con fecha nula, no error', f => {
      const r = parsearFe(xmlFicticio({ fecha: f }))
      expect(r.clase).toBe('comprobante')
      if (r.clase !== 'comprobante') return
      expect(r.estado).toBe('revisar')
      expect(r.comprobante.fecha_emision).toBeNull()
      expect(r.motivos).toContain('FechaEmision imposible (mes, día u hora fuera de rango)')
    })
  it('29 de febrero bisiesto y 31 de diciembre siguen siendo válidos', () => {
    for (const f of ['2028-02-29T09:15:00-06:00', '2026-12-31T23:59:59Z']) {
      const r = parsearFe(xmlFicticio({ fecha: f }))
      if (r.clase !== 'comprobante') throw new Error('no es comprobante')
      expect(r.comprobante.fecha_emision).toBe(f)
      expect(r.motivos).not.toContain('FechaEmision imposible (mes, día u hora fuera de rango)')
    }
  })
})

describe('fixturas: la cédula del emisor no puede ser real (repo público)', () => {
  it('12 dígitos que empiezan con 9: ni física, ni jurídica (3-xxx), ni DIMEX (1…), ni NITE', () => {
    expect(CEDULA_EMISOR).toMatch(/^9\d{11}$/)
    const sinCeros = CEDULA_EMISOR.replace(/^0+/, '')
    expect(sinCeros).not.toMatch(/^3\d{9}$/)          // jurídica
    expect(sinCeros).not.toMatch(/^[1-9]\d{8}$/)      // física
    expect(sinCeros).not.toMatch(/^1\d{10,11}$/)      // DIMEX
    expect(sinCeros).not.toMatch(/^\d{10}$/)          // NITE
    expect(partesClave(claveFicticia()).emisor).toBe(CEDULA_EMISOR)
  })
})
