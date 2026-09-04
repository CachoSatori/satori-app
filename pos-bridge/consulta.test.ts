import { describe, it, expect } from 'vitest'

import {
  armarTickets,
  assertFecha,
  banderaVerdadera,
  leerDia,
  rangoDia,
  sqlConteoEstados,
  sqlDetalle,
  sqlFacturas,
  type FilaDetalle,
  type FilaFactura,
  type Queryable,
} from './consulta.ts'
import { resolverEsquema } from './esquema.ts'
import { assertSoloSelect } from './sqlGuard.ts'

const ESQUEMA = resolverEsquema(new Map(Object.entries({
  fac_facturas: [
    'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
    'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'DolaresEfectivo',
    'DolaresTarjeta', 'Vuelto', 'FacturaXML', 'XMLHacienda', 'Telefono', 'Direccion',
  ],
  fac_pedidos:         ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area'],
  fac_facturasdet:     ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'ImpV', 'EsExtra'],
  fac_productos:       ['Codigo', 'Nombre', 'Clasificacion'],
  fac_clasificaciones: ['Codigo', 'Nombre'],
  fac_empleados:       ['Login', 'Nombre'],
})))

const TODAS = [sqlConteoEstados(ESQUEMA), sqlFacturas(ESQUEMA), sqlDetalle(ESQUEMA)]

// ── Fecha ──────────────────────────────────────────────────────────────────────

describe('assertFecha / rangoDia', () => {
  it('acepta YYYY-MM-DD y rechaza cualquier otra cosa', () => {
    expect(assertFecha('2026-09-01')).toBe('2026-09-01')
    expect(() => assertFecha('01/09/2026')).toThrow(/Formato/)
    expect(() => assertFecha('2026-2-1')).toThrow()
    expect(() => assertFecha('2026-02-31')).toThrow(/inexistente/)
  })

  it('el rango es semiabierto y NO toca la zona horaria (naive = hora CR)', () => {
    expect(rangoDia('2026-09-01')).toEqual({ desde: '2026-09-01 00:00:00', hasta: '2026-09-02 00:00:00' })
  })

  it('cruza fin de mes y fin de año', () => {
    expect(rangoDia('2026-09-30').hasta).toBe('2026-10-01 00:00:00')
    expect(rangoDia('2026-12-31').hasta).toBe('2027-01-01 00:00:00')
    expect(rangoDia('2028-02-28').hasta).toBe('2028-02-29 00:00:00')   // bisiesto
  })
})

// ── El SQL ─────────────────────────────────────────────────────────────────────

describe('SQL generado', () => {
  it('las tres consultas pasan el candado read-only', () => {
    for (const sql of TODAS) expect(() => assertSoloSelect(sql)).not.toThrow()
  })

  it('nunca hace SELECT *', () => {
    for (const sql of TODAS) expect(sql).not.toMatch(/select\s+\*/i)
  })

  it('no drena blobs ni PII de delivery', () => {
    for (const sql of TODAS) {
      for (const prohibida of ['FacturaXML', 'FacturaPDF', 'XMLHacienda', 'Telefono', 'Direccion', 'NombreCliente']) {
        expect(sql).not.toContain(prohibida)
      }
    }
  })

  it('filtra por fecha con un rango sargable y convierte el parámetro con estilo 120', () => {
    for (const sql of TODAS) {
      expect(sql).toContain('CONVERT(datetime, @desde, 120)')
      expect(sql).toContain('CONVERT(datetime, @hasta, 120)')
    }
  })

  it('solo trae facturas cerradas (X y R quedan afuera del día)', () => {
    expect(sqlFacturas(ESQUEMA)).toContain("= 'C'")
    expect(sqlDetalle(ESQUEMA)).toContain("= 'C'")
    // El conteo por estado SÍ mira todos, para poder reportar las X y las R.
    expect(sqlConteoEstados(ESQUEMA)).toContain('GROUP BY')
  })

  it('NumeroFactura sale como varchar (decimal: Number pierde precisión)', () => {
    expect(sqlFacturas(ESQUEMA)).toContain('CAST(f.[NumeroFactura] AS varchar(40))')
    expect(sqlDetalle(ESQUEMA)).toContain('CAST(d.[NumeroFactura] AS varchar(40))')
  })

  it('la fecha viaja como texto, sin dejar que el driver la mueva de zona', () => {
    expect(sqlFacturas(ESQUEMA)).toContain('CONVERT(varchar(19), f.[FechaRegistra], 120)')
  })

  it('agrega los pedidos ANTES del join (una factura puede consolidar varias mesas)', () => {
    const sql = sqlFacturas(ESQUEMA)
    expect(sql).toContain('GROUP BY p.[NumeroFactura]')
    expect(sql).toContain('MIN(p.[UsuarioRegistra])')
    expect(sql).toContain('MAX(p.[UsuarioRegistra])')
  })

  it('el join del pedido es por NumeroFactura, nunca por NumeroPedido', () => {
    expect(sqlFacturas(ESQUEMA)).not.toContain('NumeroPedido')
  })

  it('se degrada si no están las tablas opcionales', () => {
    const sinCatalogos = new Map(Object.entries({
      fac_facturas: ['NumeroFactura', 'FechaRegistra', 'Estado', 'Efectivo', 'Tarjeta',
        'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto'],
      fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
      fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
    }))
    const esq = resolverEsquema(sinCatalogos)
    expect(sqlFacturas(esq)).not.toContain('FAC_Empleados')
    expect(sqlDetalle(esq)).not.toContain('FAC_Clasificaciones')
    expect(() => assertSoloSelect(sqlFacturas(esq))).not.toThrow()
  })
})

// ── Armado ─────────────────────────────────────────────────────────────────────

const filaFactura = (over: Partial<FilaFactura> = {}): FilaFactura => ({
  numero_factura:    '5001',
  fecha_hora:        '2026-09-01 19:42:07',
  estado:            'C',
  login_cajero:      '222',
  tipo_factura:      null,
  area_factura:      null,
  usuario_registra:  '026',
  usuario_max:       '026',
  personas:          0,
  pedidos:           1,
  tipo_pedido:       'M',
  area_pedido:       'SALON 1',
  salonero_nombre:   'MAXO',
  efectivo:          10000,
  tarjeta:           0,
  monto_electronico: 0,
  deposito:          0,
  cheque:            0,
  cuenta_cobrar:     0,
  dolares_efectivo:  0,
  dolares_tarjeta:   0,
  vuelto:            0,
  ...over,
})

const filaDetalle = (over: Partial<FilaDetalle> = {}): FilaDetalle => ({
  numero_factura: '5001',
  codigo:         '100',
  nombre:         'ROLL SATORI',
  cantidad:       1,
  monto:          9000,
  imp_servicio:   900,
  imp_venta:      1170,
  familia:        2,
  familia_nombre: 'SUSHI',
  es_extra:       0,
  compuesto:      null,
  ...over,
})

describe('armarTickets', () => {
  it('pega el detalle a su factura usando el número como STRING', () => {
    const grande = '9007199254740993'
    const { tickets } = armarTickets(
      [filaFactura({ numero_factura: grande })],
      [filaDetalle({ numero_factura: grande })],
    )
    expect(tickets[0].numero_factura).toBe(grande)
    expect(tickets[0].items).toHaveLength(1)
    expect(tickets[0].comida).toBe(9000)
  })

  it('SUM(ImpS) del detalle decide con_servicio', () => {
    const { tickets } = armarTickets(
      [filaFactura(), filaFactura({ numero_factura: '5002' })],
      [
        filaDetalle({ imp_servicio: 500 }),
        filaDetalle({ imp_servicio: 400 }),
        filaDetalle({ numero_factura: '5002', imp_servicio: 0 }),
      ],
    )
    expect(tickets[0].imp_servicio).toBe(900)
    expect(tickets[0].con_servicio).toBe(true)
    expect(tickets[1].imp_servicio).toBe(0)
    expect(tickets[1].con_servicio).toBe(false)
  })

  it('EsExtra no infla las unidades', () => {
    const { tickets } = armarTickets(
      [filaFactura()],
      [filaDetalle(), filaDetalle({ codigo: '300', cantidad: 4, monto: 500, es_extra: 1 })],
    )
    expect(tickets[0].unidades_comida).toBe(1)
    expect(tickets[0].comida).toBe(9500)
  })

  it('factura sin pedido → salonero null, pax 0, y aviso', () => {
    const { tickets, avisos } = armarTickets(
      [filaFactura({ usuario_registra: null, usuario_max: null, salonero_nombre: null, personas: null, pedidos: 0 })],
      [filaDetalle()],
    )
    expect(tickets[0].salonero_login).toBeNull()
    expect(tickets[0].pax).toBe(0)
    expect(tickets[0].total).toBe(10000)
    expect(avisos.join(' ')).toContain('sin pedido')
  })

  it('factura sin detalle avisa (su 10% quedaría en 0)', () => {
    const { avisos } = armarTickets([filaFactura()], [])
    expect(avisos.join(' ')).toContain('sin líneas de detalle')
  })

  it('factura que consolida pedidos de dos usuarios avisa y acredita al menor', () => {
    const { tickets, avisos } = armarTickets(
      [filaFactura({ usuario_registra: '023', usuario_max: '026', pedidos: 2, personas: 6 })],
      [filaDetalle()],
    )
    expect(tickets[0].salonero_login).toBe('023')
    expect(tickets[0].saloneros_varios).toBe(true)
    expect(avisos.join(' ')).toContain('más de un usuario')
  })

  it('el canal sale del pedido; la factura es el respaldo', () => {
    const { tickets } = armarTickets(
      [filaFactura({ tipo_pedido: 'D' }), filaFactura({ numero_factura: '5002', tipo_pedido: null, tipo_factura: 'B' })],
      [],
    )
    expect(tickets[0].canal).toBe('delivery')
    expect(tickets[1].canal).toBe('barra')
  })
})

describe('banderaVerdadera', () => {
  it('acepta los formatos de bandera que usa el PoS', () => {
    for (const v of [1, true, 'S', 'si', 'SÍ', 'true', 'Y']) expect(banderaVerdadera(v)).toBe(true)
    for (const v of [0, false, 'N', '', null, undefined]) expect(banderaVerdadera(v)).toBe(false)
  })
})

// ── leerDia sobre un Queryable falso ───────────────────────────────────────────

describe('leerDia', () => {
  const fake = (): Queryable & { sqls: string[]; params: unknown[] } => {
    const sqls: string[] = []
    const params: unknown[] = []
    return {
      sqls, params,
      async query<T>(sql: string, p?: Record<string, unknown>): Promise<{ rows: T[] }> {
        sqls.push(sql)
        params.push(p)
        if (sql.includes('GROUP BY [Estado]')) {
          return { rows: [{ estado: 'C', n: 2 }, { estado: 'X', n: 1 }, { estado: 'R', n: 1 }] as T[] }
        }
        if (sql.includes('FROM [dbo].[FAC_FacturasDet] d')) {
          return { rows: [filaDetalle(), filaDetalle({ numero_factura: '5002', imp_servicio: 0, monto: 4000 })] as T[] }
        }
        return { rows: [filaFactura(), filaFactura({ numero_factura: '5002', efectivo: 4000 })] as T[] }
      },
    }
  }

  it('corre las tres consultas con el mismo rango y arma el día', async () => {
    const q = fake()
    const lectura = await leerDia(q, ESQUEMA, '2026-09-01')

    expect(q.sqls).toHaveLength(3)
    expect(q.params.every(p => JSON.stringify(p) === JSON.stringify({ desde: '2026-09-01 00:00:00', hasta: '2026-09-02 00:00:00' }))).toBe(true)
    expect(lectura.tickets).toHaveLength(2)
    expect(lectura.conteoEstados).toEqual({ C: 2, X: 1, R: 1 })
    expect(lectura.tickets[0].con_servicio).toBe(true)
    expect(lectura.tickets[1].con_servicio).toBe(false)
  })

  it('rechaza la fecha antes de tocar la base', async () => {
    const q = fake()
    await expect(leerDia(q, ESQUEMA, '2026-13-01')).rejects.toThrow()
    expect(q.sqls).toHaveLength(0)
  })
})
