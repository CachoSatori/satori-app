import { describe, it, expect } from 'vitest'

import {
  agruparColumnas,
  assertIdentificador,
  col,
  colOpt,
  EsquemaError,
  q,
  resolverEsquema,
  SQL_ESQUEMA,
} from './esquema.ts'

// El esquema real de `ndf` no se puede consultar desde el repo (no hay red a
// SQLNUBE), así que se prueba contra un INFORMATION_SCHEMA sintético.
const COLUMNAS_OK: Record<string, string[]> = {
  fac_facturas: [
    'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
    'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'DolaresEfectivo',
    'DolaresTarjeta', 'Vuelto', 'FacturaXML', 'FacturaPDF',
  ],
  fac_pedidos:         ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area'],
  fac_facturasdet:     ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'ImpV', 'EsExtra'],
  fac_productos:       ['Codigo', 'Nombre', 'Clasificacion'],
  fac_clasificaciones: ['Codigo', 'Nombre'],
  fac_empleados:       ['Login', 'Nombre'],
}

const mapa = (over: Record<string, string[]> = {}): Map<string, string[]> =>
  new Map(Object.entries({ ...COLUMNAS_OK, ...over }))

describe('resolverEsquema', () => {
  it('resuelve cada campo lógico contra el primer candidato que exista', () => {
    const esq = resolverEsquema(mapa())
    expect(col(esq, 'facturas', 'numero')).toBe('NumeroFactura')
    expect(col(esq, 'facturasdet', 'imps')).toBe('ImpS')
    expect(col(esq, 'productos', 'clasificacion')).toBe('Clasificacion')
    expect(colOpt(esq, 'facturasdet', 'compuesto')).toBeNull()
  })

  it('acepta variantes de nombre (la instalación puede diferir)', () => {
    const esq = resolverEsquema(mapa({
      fac_facturasdet: ['NumeroFactura', 'Codigo', 'Cant', 'MontoTotal', 'ImpS'],
    }))
    expect(col(esq, 'facturasdet', 'producto')).toBe('Codigo')
    expect(col(esq, 'facturasdet', 'cantidad')).toBe('Cant')
    expect(col(esq, 'facturasdet', 'monto')).toBe('MontoTotal')
  })

  it('el .env puede forzar un nombre de columna', () => {
    const esq = resolverEsquema(mapa(), { 'facturasdet.monto': 'ImpV' })
    expect(col(esq, 'facturasdet', 'monto')).toBe('ImpV')
  })

  it('si el override apunta a una columna inexistente, avisa', () => {
    expect(() => resolverEsquema(mapa(), { 'facturasdet.monto': 'NoExiste' }))
      .toThrow(/NoExiste/)
  })

  it('falta una columna requerida → error accionable (qué falta, qué hay, cómo forzarlo)', () => {
    let error: Error | null = null
    try {
      resolverEsquema(mapa({ fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto'] }))
    } catch (e) { error = e as Error }

    expect(error).toBeInstanceOf(EsquemaError)
    expect(error?.message).toContain('FAC_FacturasDet.imps')
    expect(error?.message).toContain('POS_COL_FACTURASDET_IMPS=')
    expect(error?.message).toContain('columnas reales:')
  })

  it('falta una tabla requerida → aborta', () => {
    const sinPedidos = new Map(Object.entries(COLUMNAS_OK))
    sinPedidos.delete('fac_pedidos')
    expect(() => resolverEsquema(sinPedidos)).toThrow(/FAC_Pedidos/)
  })

  it('las tablas opcionales se degradan sin abortar (empleados, clasificaciones)', () => {
    const sinEmpleados = new Map(Object.entries(COLUMNAS_OK))
    sinEmpleados.delete('fac_empleados')
    const esq = resolverEsquema(sinEmpleados)
    expect(esq.empleados.presente).toBe(false)
    expect(esq.facturas.presente).toBe(true)
  })
})

describe('identificadores y catálogo', () => {
  it('rechaza cualquier identificador que no sea un nombre simple', () => {
    expect(() => assertIdentificador('Nombre]; DROP TABLE x --', 'test')).toThrow()
    expect(() => assertIdentificador('', 'test')).toThrow()
    expect(assertIdentificador('NumeroFactura', 'test')).toBe('NumeroFactura')
    expect(q('Estado')).toBe('[Estado]')
  })

  it('el SELECT del catálogo pide solo INFORMATION_SCHEMA', () => {
    expect(SQL_ESQUEMA).toContain('INFORMATION_SCHEMA.COLUMNS')
    expect(SQL_ESQUEMA).toContain("'FAC_Facturas'")
    expect(SQL_ESQUEMA).not.toContain('*')
  })

  it('agruparColumnas normaliza el nombre de la tabla a minúsculas', () => {
    const m = agruparColumnas([
      { tabla: 'FAC_Facturas', columna: 'Estado' },
      { tabla: 'FAC_Facturas', columna: 'Efectivo' },
    ])
    expect(m.get('fac_facturas')).toEqual(['Estado', 'Efectivo'])
  })
})
