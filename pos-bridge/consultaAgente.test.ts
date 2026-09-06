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
import { CR_OFFSET, normalizarTicket } from '../src/shared/ndf/ingestNdf.ts'

const COLUMNAS = {
  fac_facturas: [
    'NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta',
    'MontoElectronico', 'Deposito', 'Cheque', 'CuentaCobrar', 'DolaresEfectivo',
    'DolaresTarjeta', 'Vuelto', 'FechaCierra',
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
    expect(aTicketIngest(t)).toMatchObject({ mesa: null, numero_pedido: null, fecha_cierra: null })
  })

  it('la FechaCierra del PoS viaja CRUDA, con la zona explícita que el Edge exige', () => {
    // Naive del PoS (reloj de pared CR) → mismo instante, con offset. No se interpreta:
    // agrupar por (Login, FechaCierra) para deducir la jornada es P1.
    expect(aTicketIngest(t, { fecha_cierra: '2026-09-02 01:15:00' }).fecha_cierra)
      .toBe('2026-09-02T01:15:00-06:00')
  })

  it('el cierre de las 22:07 sale con hora de CR y NO se corre al día siguiente', () => {
    // El caso que rompe todo si alguien "normaliza" a UTC antes de mandar: 22:07:59 CR es
    // 04:07:59Z del día SIGUIENTE. Con 'Z' el lote del jueves aparecería como del viernes
    // y la jornada de P1 se partiría al medio. El bridge manda hora de pared + offset.
    const cierre = aTicketIngest(t, { fecha_cierra: '2026-09-04 22:07:59' }).fecha_cierra
    expect(cierre).toBe('2026-09-04T22:07:59-06:00')
    expect(cierre).not.toMatch(/Z$/)
    expect(cierre?.slice(0, 10)).toBe('2026-09-04')
  })

  it('el ticket abierto (FechaCierra NULL) va con fecha_cierra null, no con una fecha inventada', () => {
    for (const vacio of [null, undefined]) {
      expect(aTicketIngest(t, { fecha_cierra: vacio }).fecha_cierra).toBeNull()
    }
  })

  it('una FechaCierra ilegible se descarta SOLA: nunca se lleva puesto el ticket', () => {
    // Si la columna fuera un `date`, el CONVERT daría `2026-09-02` y con el offset
    // pegado NO sería un instante: el Edge rechazaría la venta entera por un campo
    // informativo.
    for (const basura of ['2026-09-02', '', '  ', 'null', 'Wed Sep 02 2026 01:15:00 GMT-0600']) {
      expect(aTicketIngest(t, { fecha_cierra: basura }).fecha_cierra).toBeNull()
    }
    expect(aTicketIngest(t, { fecha_cierra: '2026-09-02T01:15:00' }).fecha_cierra)
      .toBe('2026-09-02T01:15:00-06:00')
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
  mesa: '12', numero_pedido: '4477', fecha_cierra: '2026-09-02 01:15:00',
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

/**
 * Lo que hará P1 para cortar la jornada: instante guardado → reloj de pared de Costa Rica.
 * Vive acá y no en el bridge a propósito — el bridge NO interpreta la FechaCierra, solo la
 * manda. Está en el test para poder demostrar que el día no se corrió.
 */
const enHoraCR = (iso: string): string =>
  new Date(Date.parse(iso) + Number(CR_OFFSET.slice(0, 3)) * 3_600_000)
    .toISOString().slice(0, 19).replace('T', ' ')

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

  it('una factura con FechaCierra se ingesta con fecha_cierra no-null, y el Edge la acepta', async () => {
    const { qy } = fake({ facturas: [filaFactura()], detalle: [filaDetalle()] })
    const r = await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })

    // Lo que sale de la PC del PoS: hora de PARED de Costa Rica con el offset pegado.
    expect(r.tickets[0].fecha_cierra).toBe('2026-09-02T01:15:00-06:00')

    // El Edge RECHAZA cualquier instante sin zona: que pase acá es la prueba de que el
    // bridge no le está mandando el naive del PoS.
    const norm = normalizarTicket('santa-teresa', r.tickets[0])
    expect(norm).toMatchObject({ ok: true })
    if (!norm.ok) return
    // El Edge normaliza a ISO-UTC para escribir el `timestamptz`. Es el MISMO INSTANTE,
    // no una conversión de hora: se comprueba comparando instantes, no strings.
    expect(Date.parse(norm.valor.fila.fecha_cierra!))
      .toBe(Date.parse(r.tickets[0].fecha_cierra!))
  })

  it('el lote de las 22:07 llega al Edge como el MISMO instante, sin saltar de día en CR', async () => {
    // La regresión que se quiere clavar: 2026-09-04 22:07:59 CR = 2026-09-05T04:07:59Z.
    // El día natural en UTC ya es OTRO. Si el bridge mandara UTC en vez de la hora de
    // pared, el lote del jueves se leería como del viernes y la jornada se partiría.
    const { qy } = fake({
      facturas: [filaFactura({ fecha_hora: '2026-09-04 21:55:00', fecha_cierra: '2026-09-04 22:07:59' })],
      detalle: [filaDetalle()],
    })
    const r = await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })

    expect(r.tickets[0].fecha_cierra).toBe('2026-09-04T22:07:59-06:00')

    const norm = normalizarTicket('santa-teresa', r.tickets[0])
    expect(norm).toMatchObject({ ok: true })
    if (!norm.ok) return
    // Mismo instante...
    expect(Date.parse(norm.valor.fila.fecha_cierra!)).toBe(Date.parse('2026-09-04T22:07:59-06:00'))
    // ...y leído de vuelta en hora de Costa Rica sigue siendo el JUEVES 4, no el 5.
    expect(enHoraCR(norm.valor.fila.fecha_cierra!)).toBe('2026-09-04 22:07:59')
  })

  it('sin FechaCierra en la fila, el ticket va con fecha_cierra null (y sigue siendo válido)', async () => {
    const { qy } = fake({ facturas: [filaFactura({ fecha_cierra: null })], detalle: [filaDetalle()] })
    const r = await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })

    expect(r.tickets[0].fecha_cierra).toBeNull()
    expect(r.avisos.join(' ')).not.toContain('FechaCierra')
    expect(normalizarTicket('santa-teresa', r.tickets[0])).toMatchObject({ ok: true })
  })

  it('una FechaCierra ilegible avisa, deja el campo en null y el Edge igual acepta la venta', async () => {
    const { qy } = fake({ facturas: [filaFactura({ fecha_cierra: '2026-09-02' })], detalle: [filaDetalle()] })
    const r = await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })

    expect(r.tickets[0].fecha_cierra).toBeNull()
    expect(r.avisos.join(' ')).toContain('FechaCierra')
    expect(normalizarTicket('santa-teresa', r.tickets[0])).toMatchObject({ ok: true })
  })

  it('el lote de cierre queda consistente: mismo Login + misma FechaCierra → mismo instante', async () => {
    // Esto es el PREREQUISITO de la jornada por lote (P1): las facturas que el cajero 222
    // cerró de una pasada tienen que llegar con el MISMO `fecha_cierra`, aunque la venta
    // haya sido de días distintos (la del turno que cruza medianoche).
    const cierre = '2026-09-02 01:15:00'
    const { qy } = fake({
      facturas: [
        filaFactura({ numero_factura: '5001', fecha_hora: '2026-09-01 19:42:07', fecha_cierra: cierre }),
        filaFactura({ numero_factura: '5002', fecha_hora: '2026-09-01 23:58:00', fecha_cierra: cierre }),
        filaFactura({ numero_factura: '5003', fecha_hora: '2026-09-02 00:31:00', fecha_cierra: cierre }),
        // Otro lote: el cierre de la mañana siguiente, con el otro cajero.
        filaFactura({
          numero_factura: '5004', fecha_hora: '2026-09-02 12:10:00',
          login_cajero: '111', fecha_cierra: '2026-09-02 16:05:00',
        }),
      ],
      detalle: [],
    })
    const { tickets } = await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: null })

    const lote = (t: (typeof tickets)[number]) => `${t.login_cajero}|${t.fecha_cierra}`
    expect(tickets.map(lote)).toEqual([
      '222|2026-09-02T01:15:00-06:00',
      '222|2026-09-02T01:15:00-06:00',
      '222|2026-09-02T01:15:00-06:00',
      '111|2026-09-02T16:05:00-06:00',
    ])
    // El lote NO es la fecha de la venta: tres facturas de dos días naturales, un cierre.
    expect(new Set(tickets.slice(0, 3).map((t) => t.fecha))).toEqual(new Set(['2026-09-01', '2026-09-02']))
    expect(new Set(tickets.slice(0, 3).map(lote)).size).toBe(1)
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
