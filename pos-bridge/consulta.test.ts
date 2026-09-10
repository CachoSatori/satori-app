import { describe, it, expect } from 'vitest'

import {
  ESTADOS_CERRADAS, ESTADOS_PROVISIONALES, filtroEstado,
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
import { normalizarLinea } from '../src/shared/ndf/ingestNdf.ts'
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

  it('FechaCierra sale CRUDA y como texto estilo 120, igual que FechaRegistra', () => {
    const conCierre = resolverEsquema(new Map(Object.entries({
      fac_facturas: [
        'NumeroFactura', 'FechaRegistra', 'FechaCierra', 'Estado', 'Login', 'Efectivo',
        'Tarjeta', 'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto',
      ],
      fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
      fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
    })))
    const sql = sqlFacturas(conCierre)
    expect(sql).toContain('CONVERT(varchar(19), f.[FechaCierra], 120)')
    expect(sql).toContain('AS fecha_cierra')
    expect(() => assertSoloSelect(sql)).not.toThrow()
  })

  it('sin la columna FechaCierra la consulta sigue en pie (manda NULL)', () => {
    // `ESQUEMA` no la tiene: el bridge no puede exigirla en toda instalación.
    expect(sqlFacturas(ESQUEMA)).not.toContain('FechaCierra')
    expect(sqlFacturas(ESQUEMA)).toMatch(/NULL\s+AS fecha_cierra/)
  })

  it('el IVA sale de la columna `IV`, que es la real del PoS', () => {
    const conIV = resolverEsquema(new Map(Object.entries({
      fac_facturas: [
        'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
        'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto',
      ],
      fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'IV'],
      fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
    })))
    // Con `IV` presente el SELECT la trae; sin ninguna columna de IVA, manda 0 y NO se deriva.
    expect(sqlDetalle(conIV)).toContain('COALESCE(d.[IV], 0)')
    expect(sqlDetalle(conIV)).toContain('AS imp_venta')
    expect(sqlDetalle(ESQUEMA)).toContain('COALESCE(d.[ImpV], 0)')   // fixture viejo: sigue OK
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
  usuario_registra: null,
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

// ── La factura 110599 del 29-ago: el caso de aceptación del IVA ────────────────────────────
//
// Es la factura con la que se firmó el arreglo. Sus números salen del PoS y tienen que cerrar:
//   neta ₡48.142 + IVA ₡6.258 + servicio ₡4.814 = bruto ₡59.214, que es EXACTAMENTE la Tarjeta.
//
// El IVA sale de la columna `IV` línea por línea. Si el resolver vuelve a no encontrarla, este
// test cae con IVA 0 y el bruto ₡6.258 corto — que es justo el ~11% de brecha contra el XLS.

describe('factura 110599 (29-ago) — el IVA cierra el bruto contra la Tarjeta', () => {
  const ESQ_IV = resolverEsquema(new Map(Object.entries({
    fac_facturas: [
      'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
      'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto',
    ],
    fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
    fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'IV'],
    fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
  })))

  // Tres líneas de comida que suman la neta, con su IVA y su 10% tal como los da el PoS.
  const LINEAS: FilaDetalle[] = [
    { numero_factura: '110599', usuario_registra: null, codigo: '100', nombre: 'ROLL A', cantidad: 1, monto: 20000,
      imp_servicio: 2000, imp_venta: 2600, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null },
    { numero_factura: '110599', usuario_registra: null, codigo: '101', nombre: 'ROLL B', cantidad: 1, monto: 18142,
      imp_servicio: 1814, imp_venta: 2358, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null },
    { numero_factura: '110599', usuario_registra: null, codigo: '200', nombre: 'BEBIDA', cantidad: 1, monto: 10000,
      imp_servicio: 1000, imp_venta: 1300, familia: 5, familia_nombre: 'BEBIDAS', es_extra: 0, compuesto: null },
  ]
  const FACTURA = filaFactura({
    numero_factura: '110599',
    efectivo: 0, tarjeta: 59214, vuelto: 0,
  })

  it('el SELECT trae el IVA desde `IV`', () => {
    expect(sqlDetalle(ESQ_IV)).toContain('COALESCE(d.[IV], 0)')
  })

  it('el IVA del ticket es la Σ de las líneas — no el 13% derivado', () => {
    const { tickets } = armarTickets([FACTURA], LINEAS)
    expect(tickets[0].iva).toBe(6258)
    // La prueba de que NO se deriva: 48.142 × 0,13 ≈ 6.258 da parecido, pero el ticket usa la
    // Σ real. Con una línea exenta el derivado mentiría (subiría) y la Σ no se mueve.
    const conExenta = armarTickets([FACTURA], [
      ...LINEAS,
      { numero_factura: '110599', usuario_registra: null, codigo: '300', nombre: 'EXENTO', cantidad: 1, monto: 5000,
        imp_servicio: 0, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null },
    ])
    expect(conExenta.tickets[0].iva).toBe(6258)          // el IVA NO sube con la línea exenta
    expect(conExenta.tickets[0].valor_servido).toBe(53142)  // …pero la neta sí
  })

  it('neta + IVA + servicio = el bruto, y el bruto es la Tarjeta', () => {
    const t = armarTickets([FACTURA], LINEAS).tickets[0]
    expect(t.valor_servido).toBe(48142)
    expect(t.iva).toBe(6258)
    expect(t.imp_servicio).toBe(4814)

    const bruto = t.valor_servido + t.iva + t.imp_servicio
    expect(Math.round(bruto)).toBe(59214)
    expect(Math.round(bruto)).toBe(t.total)      // ← cierra contra el medio de pago
  })

  it('sin la columna de IVA el ticket queda en 0 y el bruto sale CORTO (el bug de antes)', () => {
    const sinIva = LINEAS.map(l => ({ ...l, imp_venta: 0 }))
    const t = armarTickets([FACTURA], sinIva).tickets[0]
    expect(t.iva).toBe(0)
    // ₡6.258 menos que la Tarjeta: la brecha del ~11% contra el XLS, exacta.
    expect(t.total - (t.valor_servido + t.iva + t.imp_servicio)).toBe(6258)
  })
})

// ── Saloneros por línea · el mesero que comandó cada línea ─────────────────────────────────
//
// `FAC_FacturasDet.UsuarioRegistra` → `pos_ndf_ticket_lines.usuario_registra`. Es lo que va a
// permitir atribuir la venta por mesero A NIVEL LÍNEA, en vez de acreditarle la factura entera
// a quien la abrió.
//
// El test recorre el pipeline ENTERO —SELECT → armarTickets → mapTicket → normalizarLinea—
// porque el dato tiene tres saltos donde se podía perder, y de hecho `mapTicket` reconstruye
// cada ítem desde cero: si no se lo lleva explícitamente, se cae ahí sin que nada falle.

describe('usuario_registra por línea (factura 110607)', () => {
  const ESQ = resolverEsquema(new Map(Object.entries({
    fac_facturas: [
      'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
      'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto',
    ],
    fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
    fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS', 'IV',
                      'UsuarioRegistra'],
    fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
  })))

  /** 5 líneas de '032' y 4 de '026' — los dos artículos 677 (pax) entre las de '026'. */
  const LINEAS_110607: FilaDetalle[] = [
    ...Array.from({ length: 5 }, (_, i) => filaDetalle({
      numero_factura: '110607', codigo: `10${i}`, usuario_registra: '032',
    })),
    ...Array.from({ length: 2 }, (_, i) => filaDetalle({
      numero_factura: '110607', codigo: `20${i}`, usuario_registra: '026',
    })),
    // Los dos 677: son el artículo PAX, y también los comandó '026'.
    ...Array.from({ length: 2 }, () => filaDetalle({
      numero_factura: '110607', codigo: '677', nombre: 'A PAX', familia: 19,
      familia_nombre: 'A PAX', usuario_registra: '026',
    })),
  ]

  it('el SELECT del detalle trae la columna', () => {
    expect(sqlDetalle(ESQ)).toContain('d.[UsuarioRegistra]')
    expect(sqlDetalle(ESQ)).toContain('AS usuario_registra')
  })

  it('sin la columna en la instalación, el SELECT manda NULL y NO rompe', () => {
    const sinColumna = resolverEsquema(new Map(Object.entries({
      fac_facturas: [
        'NumeroFactura', 'FechaRegistra', 'Estado', 'Efectivo', 'Tarjeta',
        'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'Vuelto',
      ],
      fac_pedidos:     ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
      fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
      fac_productos:   ['Codigo', 'Nombre', 'Clasificacion'],
    })))
    expect(sqlDetalle(sinColumna)).toMatch(/NULL\s+AS usuario_registra/)
    expect(() => assertSoloSelect(sqlDetalle(sinColumna))).not.toThrow()
  })

  it('EL PIPELINE ENTERO: la línea de «032» llega a LineaRow con «032»', () => {
    const { tickets } = armarTickets(
      [filaFactura({ numero_factura: '110607' })], LINEAS_110607)
    const filas = tickets[0].items.map(normalizarLinea)

    expect(filas).toHaveLength(9)
    expect(filas.filter(f => f?.usuario_registra === '032')).toHaveLength(5)
    expect(filas.filter(f => f?.usuario_registra === '026')).toHaveLength(4)
  })

  it('los dos 677 (artículo PAX) van con «026», su mesero', () => {
    const { tickets } = armarTickets(
      [filaFactura({ numero_factura: '110607' })], LINEAS_110607)
    const pax = tickets[0].items
      .filter(it => it.codigo === '677')
      .map(normalizarLinea)

    expect(pax).toHaveLength(2)
    expect(pax.every(f => f?.usuario_registra === '026')).toBe(true)
    expect(pax.every(f => f?.es_pax === true)).toBe(true)
  })

  it('una línea sin mesero queda en null, no en «» ni undefined', () => {
    const { tickets } = armarTickets([filaFactura()], [
      filaDetalle({ usuario_registra: null }),
      filaDetalle({ codigo: '999', usuario_registra: '  ' }),
    ])
    expect(tickets[0].items.map(normalizarLinea).map(f => f?.usuario_registra))
      .toEqual([null, null])
  })

  it('NO toca la plata de la línea: monto, IVA y servicio quedan igual', () => {
    const conMesero = armarTickets([filaFactura()], [filaDetalle({ usuario_registra: '032' })])
    const sinMesero = armarTickets([filaFactura()], [filaDetalle({ usuario_registra: null })])
    const plata = (t: typeof conMesero) => {
      const x = t.tickets[0]
      return { total: x.total, iva: x.iva, serv: x.imp_servicio, neto: x.valor_servido }
    }
    expect(plata(conMesero)).toEqual(plata(sinMesero))
  })
})

// ── B · el estado es parámetro: cerradas byte-idénticas, provisionales con IN ──────────────

describe('filtroEstado', () => {
  it('un solo estado se renderiza como siempre (= \'C\'), para no mover el SQL probado', () => {
    expect(filtroEstado('f.[Estado]', ['C'])).toBe("f.[Estado] = 'C'")
  })

  it('varios estados van con IN', () => {
    expect(filtroEstado('f.[Estado]', ['R', 'X'])).toBe("f.[Estado] IN ('R', 'X')")
  })

  it('un estado inventado explota acá, nunca llega al PoS', () => {
    // @ts-expect-error — a propósito: se prueba el candado en runtime
    expect(() => filtroEstado('f.[Estado]', ['Z'])).toThrow(/desconocido/)
    expect(() => filtroEstado('f.[Estado]', [])).toThrow(/al menos un estado/)
  })
})

describe('sqlFacturas / sqlDetalle con estados', () => {
  it('sin parámetro = cerradas: el SQL es BYTE-IDÉNTICO al de antes', () => {
    expect(sqlFacturas(ESQUEMA)).toBe(sqlFacturas(ESQUEMA, false, ESTADOS_CERRADAS))
    expect(sqlDetalle(ESQUEMA)).toBe(sqlDetalle(ESQUEMA, false, ESTADOS_CERRADAS))
    expect(sqlFacturas(ESQUEMA, true)).toBe(sqlFacturas(ESQUEMA, true, ['C']))
  })

  it('provisionales: las TRES condiciones de estado pasan a IN (R, X)', () => {
    const f = sqlFacturas(ESQUEMA, false, ESTADOS_PROVISIONALES)
    const d = sqlDetalle(ESQUEMA, false, ESTADOS_PROVISIONALES)
    // facturas: el WHERE principal y el del subquery de pedidos
    expect(f.match(/\[Estado\] IN \('R', 'X'\)/g)).toHaveLength(2)
    expect(f).not.toContain("= 'C'")
    // detalle: su propio WHERE
    expect(d.match(/\[Estado\] IN \('R', 'X'\)/g)).toHaveLength(1)
    expect(d).not.toContain("= 'C'")
  })

  it('provisionales NO llevan cursor: sin @ultima, con ventana', () => {
    const f = sqlFacturas(ESQUEMA, false, ESTADOS_PROVISIONALES)
    expect(f).not.toContain('@ultima')
    expect(f).toContain('CONVERT(datetime, @desde, 120)')
  })

  it('las provisionales siguen pasando el candado read-only', () => {
    for (const sql of [sqlFacturas(ESQUEMA, false, ESTADOS_PROVISIONALES), sqlDetalle(ESQUEMA, false, ESTADOS_PROVISIONALES)]) {
      expect(() => assertSoloSelect(sql)).not.toThrow()
    }
  })
})
