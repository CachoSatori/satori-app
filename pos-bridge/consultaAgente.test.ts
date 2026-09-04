import { describe, it, expect } from 'vitest'

import {
  aTicketIngest,
  leerAbiertas,
  leerCerradas,
  mapAbierta,
  puedeLeerAbiertas,
  sqlAbiertas,
  type FilaAbierta,
} from './consultaAgente.ts'
import { sqlDetalle, sqlFacturas, type FilaDetalle, type FilaFactura, type Queryable } from './consulta.ts'
import { resolverEsquema } from './esquema.ts'
import { assertSoloSelect } from './sqlGuard.ts'
import { mapTicket } from '../src/shared/ndf/mapTicket'

const COLUMNAS = {
  fac_facturas: [
    'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
    'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'DolaresEfectivo',
    'DolaresTarjeta', 'Vuelto',
  ],
  fac_pedidos:         ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area', 'NumeroPedido', 'Mesa', 'FechaRegistra'],
  fac_facturasdet:     ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
  fac_productos:       ['Codigo', 'Nombre', 'Clasificacion'],
  fac_clasificaciones: ['Codigo', 'Nombre'],
  fac_empleados:       ['Login', 'Nombre'],
}
const ESQUEMA = resolverEsquema(new Map(Object.entries(COLUMNAS)))

// ── El SQL incremental ─────────────────────────────────────────────────────────

describe('SQL incremental', () => {
  const cerradas = sqlFacturas(ESQUEMA, true)
  const detalle  = sqlDetalle(ESQUEMA, true)
  const abiertas = sqlAbiertas(ESQUEMA)

  it('las tres consultas del agente siguen pasando el candado read-only', () => {
    for (const sql of [cerradas, detalle, abiertas]) {
      expect(() => assertSoloSelect(sql)).not.toThrow()
      expect(sql).not.toMatch(/select\s+\*/i)
    }
  })

  it('el corte por cursor es NUMÉRICO, no de texto', () => {
    // Como string '9' > '10' y el agente se saltearía facturas para siempre.
    expect(cerradas).toContain('CAST(@ultima AS decimal(38,0))')
    expect(detalle).toContain('CAST(@ultima AS decimal(38,0))')
  })

  it('@ultima null = primera corrida: se lee la ventana entera', () => {
    expect(cerradas).toContain('@ultima IS NULL OR')
  })

  it('el dry-run de la Fase 1a NO lleva el corte (quiere el día entero)', () => {
    expect(sqlFacturas(ESQUEMA)).not.toContain('@ultima')
    expect(sqlDetalle(ESQUEMA)).not.toContain('@ultima')
  })

  it('las abiertas son los pedidos SIN factura, acotados por fecha', () => {
    expect(abiertas).toContain('[NumeroFactura] IS NULL')
    expect(abiertas).toContain('CONVERT(datetime, @desde, 120)')
  })

  it('el número de pedido sale como varchar (también es decimal)', () => {
    expect(abiertas).toContain('CAST(p.[NumeroPedido] AS varchar(40))')
    expect(cerradas).toContain('MIN(CAST(p.[NumeroPedido] AS varchar(40)))')
  })

  it('sin NumeroPedido no se puede leer el snapshot', () => {
    const sinPedidoId = resolverEsquema(new Map(Object.entries({
      ...COLUMNAS,
      fac_pedidos: ['NumeroFactura', 'UsuarioRegistra', 'Personas'],
    })))
    expect(puedeLeerAbiertas(sinPedidoId)).toBe(false)
    expect(puedeLeerAbiertas(ESQUEMA)).toBe(true)
  })
})

// ── Mapeo ──────────────────────────────────────────────────────────────────────

describe('aTicketIngest', () => {
  const t = mapTicket({
    numero_factura: '5001', fecha_hora: '2026-09-01 19:42:07', estado: 'C', tipo: 'M',
    area: 'SALON 1', login_cajero: '222', usuario_registra: '026', salonero_nombre: 'MAXO',
    personas: 0, imp_servicio: 1200, medios: { efectivo: 15000, vuelto: 3000 }, items: [],
  })

  it('le pone el offset de Costa Rica a la fecha naive del PoS', () => {
    expect(aTicketIngest(t).fecha_registra).toBe('2026-09-01T19:42:07-06:00')
  })

  it('pega mesa y numero_pedido sin tocar nada del mapeo', () => {
    const i = aTicketIngest(t, { mesa: ' 12 ', numero_pedido: '4477' })
    expect(i).toMatchObject({ mesa: '12', numero_pedido: '4477', total: 12000, canal: 'salon' })
  })

  it('sin esas columnas quedan en null', () => {
    expect(aTicketIngest(t)).toMatchObject({ mesa: null, numero_pedido: null })
  })
})

describe('mapAbierta', () => {
  const fila = (over: Partial<FilaAbierta> = {}): FilaAbierta => ({
    id_pedido: '4477', usuario_registra: '026', personas: 4,
    tipo: 'M', area: 'SALON 1', mesa: '12', fecha_hora: '2026-09-01 20:05:00',
    ...over,
  })

  it('arma la mesa abierta con clave estable y canal mapeado', () => {
    expect(mapAbierta(fila())).toEqual({
      clave: 'pedido:4477', numero_factura: null, id_pedido: '4477', mesa: '12',
      salonero_login: '026', canal: 'salon', pax: 4, pax_alerta: 'falta_articulo',
      updated_at: '2026-09-01T20:05:00-06:00',
    })
  })

  it('el pax de una mesa abierta sale SOLO de Personas (el 677 vive en la factura)', () => {
    expect(mapAbierta(fila({ personas: 0 }))).toMatchObject({ pax: 0, pax_alerta: 'sin_pax' })
  })

  it('la mesa que abrió un cajero de turno no se le acredita a ningún mesero', () => {
    expect(mapAbierta(fila({ usuario_registra: '222' }))?.salonero_login).toBeNull()
  })

  it('sin id de pedido no hay clave: se descarta', () => {
    expect(mapAbierta(fila({ id_pedido: null }))).toBeNull()
  })

  it('sin fecha no inventa un instante', () => {
    expect(mapAbierta(fila({ fecha_hora: null }))?.updated_at).toBeNull()
  })
})

// ── Lectura completa contra un Queryable falso ─────────────────────────────────

const filaFactura = (over: Partial<FilaFactura> = {}): FilaFactura => ({
  numero_factura: '5001', fecha_hora: '2026-09-01 19:42:07', estado: 'C', login_cajero: '222',
  tipo_factura: null, area_factura: null, usuario_registra: '026', usuario_max: '026',
  personas: 0, pedidos: 1, tipo_pedido: 'M', area_pedido: 'SALON 1', salonero_nombre: 'MAXO',
  mesa: '12', numero_pedido: '4477',
  efectivo: 15000, tarjeta: 0, monto_electronico: 0, deposito: 0, cheque: 0, cuenta_cobrar: 0,
  dolares_efectivo: 0, dolares_tarjeta: 0, vuelto: 3000,
  ...over,
})

const filaDetalle = (over: Partial<FilaDetalle> = {}): FilaDetalle => ({
  numero_factura: '5001', codigo: '100', nombre: 'ROLL SATORI', cantidad: 2, monto: 12000,
  imp_servicio: 1200, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null,
  ...over,
})

const fake = (filas: { facturas?: FilaFactura[]; detalle?: FilaDetalle[]; abiertas?: FilaAbierta[] }) => {
  const params: unknown[] = []
  const qy: Queryable = {
    async query<T>(sql: string, p?: Record<string, unknown>): Promise<{ rows: T[] }> {
      params.push(p)
      if (sql.includes('[NumeroFactura] IS NULL')) return { rows: (filas.abiertas ?? []) as T[] }
      if (sql.includes('FROM [dbo].[FAC_FacturasDet] d')) return { rows: (filas.detalle ?? []) as T[] }
      return { rows: (filas.facturas ?? []) as T[] }
    },
  }
  return { qy, params }
}

describe('leerCerradas', () => {
  it('devuelve tickets listos para el Edge, con el cursor como parámetro', async () => {
    const { qy, params } = fake({ facturas: [filaFactura()], detalle: [filaDetalle()] })
    const r = await leerCerradas(qy, ESQUEMA, {
      desde: '2026-08-31 08:00:00', hasta: '2026-09-01 22:00:00', ultima: '5000',
    })

    expect(r.tickets).toHaveLength(1)
    expect(r.tickets[0]).toMatchObject({
      numero_factura: '5001', fecha_registra: '2026-09-01T19:42:07-06:00',
      mesa: '12', numero_pedido: '4477', total: 12000, con_servicio: true,
    })
    expect(params.every((p) => (p as { ultima?: string }).ultima === '5000')).toBe(true)
  })

  it('la primera corrida manda ultima = null', async () => {
    const { qy, params } = fake({})
    await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })
    expect((params[0] as { ultima: unknown }).ultima).toBeNull()
  })
})

describe('leerAbiertas', () => {
  it('devuelve el snapshot y descarta las filas sin id', async () => {
    const { qy } = fake({
      abiertas: [
        { id_pedido: '4477', usuario_registra: '026', personas: 4, tipo: 'M', area: null, mesa: '12', fecha_hora: '2026-09-01 20:05:00' },
        { id_pedido: null, usuario_registra: '027', personas: 2, tipo: 'M', area: null, mesa: '3', fecha_hora: null },
      ],
    })
    const r = await leerAbiertas(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    expect(r).toHaveLength(1)
    expect(r[0].clave).toBe('pedido:4477')
  })

  it('sin mesas abiertas devuelve [] (que el Edge lee como "cerrá todas")', async () => {
    const { qy } = fake({})
    expect(await leerAbiertas(qy, ESQUEMA, { desde: 'a', hasta: 'b' })).toEqual([])
  })
})
