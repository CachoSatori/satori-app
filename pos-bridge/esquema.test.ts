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

  it('FechaCierra se resuelve sola y es OPCIONAL (la instalación puede no tenerla)', () => {
    // El lote de cierre (Login + FechaCierra) es la base de la jornada de P1: sin esta
    // columna el bridge sigue andando, pero manda `fecha_cierra` en null.
    expect(colOpt(resolverEsquema(mapa({
      fac_facturas: [...COLUMNAS_OK.fac_facturas, 'FechaCierra'],
    })), 'facturas', 'fechacierra')).toBe('FechaCierra')

    expect(colOpt(resolverEsquema(mapa()), 'facturas', 'fechacierra')).toBeNull()
  })

  it('EL IVA: `IV` es el nombre REAL de la instalación y gana sobre las variantes', () => {
    // El bug que esto fija: en `FAC_FacturasDet` la columna es `IV` (Tarifa 13,
    // CodigoImpuesto '01'). El resolver buscaba `ImpV/Imp/IVA/Impuesto`, no matcheaba ninguno,
    // y el IVA entraba en 0 en toda la analítica — la bruta del PoS quedaba ~11% por debajo
    // del XLS. `IV` va PRIMERO en la lista de candidatos.
    const conIV = resolverEsquema(mapa({
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'IV'],
    }))
    expect(colOpt(conIV, 'facturasdet', 'impv')).toBe('IV')

    // Y si la instalación tuviera las dos, gana `IV` por ser el primer candidato.
    const conAmbas = resolverEsquema(mapa({
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'ImpV', 'IV'],
    }))
    expect(colOpt(conAmbas, 'facturasdet', 'impv')).toBe('IV')
  })

  it('las variantes viejas del IVA siguen resolviendo (no se rompió ninguna instalación)', () => {
    for (const nombre of ['ImpV', 'Imp', 'IVA', 'Impuesto']) {
      const esq = resolverEsquema(mapa({
        fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', nombre],
      }))
      expect(colOpt(esq, 'facturasdet', 'impv'), nombre).toBe(nombre)
    }
  })

  it('sin ninguna columna de IVA sigue siendo opcional: null, y el bridge no aborta', () => {
    const sinIva = resolverEsquema(mapa({
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
    }))
    expect(colOpt(sinIva, 'facturasdet', 'impv')).toBeNull()
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
