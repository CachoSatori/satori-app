import { describe, it, expect } from 'vitest'

import {
  aTicketIngest,
  leerAbiertas,
  leerCerradas,
  leerProvisionales,
  mapAbierta,
  puedeLeerAbiertas,
  sqlAbiertas,
  ESTADO_PEDIDO_ABIERTO,
  claveLineas,
  estimarPedido,
  puedeLeerLineasAbiertas,
  sqlLineasAbiertas,
  MULT_DELIVERY,
  MULT_SALON,
  type FilaAbierta,
  type FilaLineaAbierta,
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
  fac_pedidos:         ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area', 'NumeroPedido', 'Mesa', 'FechaRegistra', 'Estado'],
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

  it('«abierta» la define Estado = R, no la ausencia de factura', () => {
    // El candado del bug de las mesas fantasma. `NumeroFactura IS NULL` agarra los pedidos
    // facturados y anulados cuyo back-link nunca se escribió (~7%); el Estado no.
    expect(abiertas).toContain("[Estado] = 'R'")
    expect(ESTADO_PEDIDO_ABIERTO).toBe('R')
  })

  it('es WHITELIST, no blacklist: nunca `NOT IN`', () => {
    // Una blacklist mostraría cualquier código nuevo del PoS como actividad viva.
    expect(abiertas).not.toContain('NOT IN')
    expect(abiertas).not.toMatch(/Estado\]\s*(<>|!=)/)
  })

  it('el filtro de Estado NO se cuela en las CERRADAS (esas ya filtran por su propio C)', () => {
    expect(cerradas).toContain("= 'C'")
    expect(cerradas).not.toContain("= 'R'")
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

  it('FAIL-CLOSED: sin la columna Estado tampoco se manda el snapshot', () => {
    // La instalación tiene TODO menos `Estado`. Antes habría emitido la consulta vieja y
    // pintado pedidos cerrados como abiertos; ahora simplemente no reporta abiertas.
    const sinEstado = resolverEsquema(new Map(Object.entries({
      ...COLUMNAS,
      fac_pedidos: ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area',
                    'NumeroPedido', 'Mesa', 'FechaRegistra'],
    })))
    expect(puedeLeerAbiertas(sinEstado)).toBe(false)
  })

  it('sin la columna Estado, sqlAbiertas EXPLOTA en vez de emitir la consulta vieja', () => {
    // El candado estructural: aunque alguien saltee `puedeLeerAbiertas`, no hay forma de
    // llegar al SQL sin el filtro. Fallar ruidoso, nunca volver al bug en silencio.
    const sinEstado = resolverEsquema(new Map(Object.entries({
      ...COLUMNAS,
      fac_pedidos: ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area',
                    'NumeroPedido', 'Mesa', 'FechaRegistra'],
    })))
    expect(() => sqlAbiertas(sinEstado)).toThrow(/pedidos\.estado/)
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
    // La FORMA no alcanza: '0000-00-00 00:00:00' (centinela posible si la columna es
    // varchar) pasa el regex pero NO es un instante — y el Edge, que exige zona, rechazaría
    // la VENTA ENTERA por un campo informativo. Se comprueba las dos cosas: que el campo
    // quede en null Y que el ticket siga siendo válido para el Edge.
    const basuras = [
      '2026-09-02',                          // un `date`: al CONVERT le falta la hora
      '0000-00-00 00:00:00',                 // centinela: forma válida, instante imposible
      '2026-02-31 10:00:00',                 // día inexistente
      '2026-13-01 10:00:00',                 // mes inexistente
      '2026-09-02 25:61:61',                 // hora imposible
      '', '  ', 'null',
      'Wed Sep 02 2026 01:15:00 GMT-0600',   // un Date de JS convertido a string
    ]
    for (const basura of basuras) {
      const ticket = aTicketIngest(t, { fecha_cierra: basura })
      expect(ticket.fecha_cierra, `basura: ${JSON.stringify(basura)}`).toBeNull()
      // Lo que de verdad importa: la venta se ingesta igual.
      expect(normalizarTicket('santa-teresa', ticket), `basura: ${JSON.stringify(basura)}`)
        .toMatchObject({ ok: true })
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
      // Frente C: sin líneas, los tres provisionales van en null («sin total»), nunca en 0.
      monto_estimado_crc: null, pax_pedido: null, items_valor: null,
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
  numero_factura: '5001', usuario_registra: null, codigo: '100', nombre: 'ROLL SATORI', cantidad: 2, monto: 12000,
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

  it('la consulta que SALE lleva la whitelist de Estado', async () => {
    // El filtro vive en el SQL, así que un fake no puede "filtrar" filas: lo que se prueba es
    // que la consulta emitida contra el PoS trae la condición. Un pedido F o X nunca llega a
    // `mapAbierta` porque la base no lo devuelve.
    const visto: string[] = []
    const qy: Queryable = {
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        visto.push(sql)
        return { rows: [] as T[] }
      },
    }
    await leerAbiertas(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    expect(visto).toHaveLength(1)
    expect(visto[0]).toContain("[Estado] = 'R'")
  })

  it('sin mesas abiertas devuelve [] (que el Edge lee como "cerrá todas")', async () => {
    const { qy } = fake({})
    expect(await leerAbiertas(qy, ESQUEMA, { desde: 'a', hasta: 'b' })).toEqual([])
  })
})

// ── B · leerProvisionales: R/X de la ventana entera, sin cursor ───────────────────────────

describe('leerProvisionales', () => {
  const espiar = () => {
    const visto: { sql: string; params: Record<string, unknown> | undefined }[] = []
    const qy: Queryable = {
      async query<T>(sql: string, params?: Record<string, unknown>): Promise<{ rows: T[] }> {
        visto.push({ sql, params })
        return { rows: [] as T[] }
      },
    }
    return { qy, visto }
  }

  it('emite facturas + detalle con IN (R, X) y SIN corte por cursor', async () => {
    const { qy, visto } = espiar()
    await leerProvisionales(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    expect(visto).toHaveLength(2)
    for (const v of visto) {
      expect(v.sql).toContain("[Estado] IN ('R', 'X')")
      expect(v.sql).not.toContain('@ultima')
      expect(v.sql).not.toContain("= 'C'")
    }
  })

  it('los parámetros llevan solo la ventana: sin `ultima`, como el dry-run', async () => {
    const { qy, visto } = espiar()
    await leerProvisionales(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    for (const v of visto) {
      expect(v.params).toEqual({ desde: 'a', hasta: 'b' })
    }
  })

  it('leerCerradas sigue exactamente igual: = C, con @ultima y con `ultima` en params', async () => {
    const { qy, visto } = espiar()
    await leerCerradas(qy, ESQUEMA, { desde: 'a', hasta: 'b', ultima: '5000' })
    expect(visto).toHaveLength(2)
    for (const v of visto) {
      expect(v.sql).toContain("= 'C'")
      expect(v.sql).toContain('@ultima')
      expect(v.params).toEqual({ desde: 'a', hasta: 'b', ultima: '5000' })
    }
  })

  it('una R mapeada viaja con estado R y su neto (sale de las líneas), lista para el Edge', async () => {
    const factura: FilaFactura = {
      numero_factura: '7001', fecha_hora: '2026-09-09 21:10:00', estado: 'R', login_cajero: '222',
      tipo_factura: 'M', area_factura: 'SALON 1', usuario_registra: '026', usuario_max: '026',
      personas: 2, pedidos: 1, tipo_pedido: 'M', area_pedido: 'SALON 1', salonero_nombre: 'MAXO',
      efectivo: 0, tarjeta: 0, monto_electronico: 0, deposito: 0, cheque: 0, cuenta_cobrar: 0,
      dolares_efectivo: 0, dolares_tarjeta: 0, vuelto: 0,
    } as FilaFactura
    const detalle: FilaDetalle = {
      numero_factura: '7001', codigo: '25', nombre: 'ROLL', cantidad: 1, monto: 9000,
      imp_servicio: 0, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI',   // 2 ∈ FAMILIAS_VALOR_SERVIDO
      usuario_registra: '026', es_extra: null, compuesto: null,
    } as FilaDetalle
    const qy: Queryable = {
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        if (sql.includes('FROM [dbo].[FAC_FacturasDet] d')) return { rows: [detalle] as T[] }
        return { rows: [factura] as T[] }
      },
    }
    const { tickets } = await leerProvisionales(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    expect(tickets).toHaveLength(1)
    expect(tickets[0].estado).toBe('R')
    expect(tickets[0].numero_factura).toBe('7001')
    expect(tickets[0].valor_servido).toBe(9000)
  })
})

// ── Frente C v1 · monto estimado + pax de la mesa abierta ─────────────────────────────────

/** La instalación COMPLETA: detalle de pedido, clave real y precio de catálogo. */
const COLUMNAS_C = {
  ...COLUMNAS,
  fac_pedidos:    [...COLUMNAS.fac_pedidos, 'Periodo', 'Mes', 'Dia'],
  fac_pedidosdet: ['NumeroPedido', 'Periodo', 'Mes', 'Dia', 'CodigoProducto', 'Cantidad', 'Estado', 'Descuento', 'TipoDescuento'],
  fac_productos:  [...COLUMNAS.fac_productos, 'PrecioVenta'],
}
const ESQUEMA_C = resolverEsquema(new Map(Object.entries(COLUMNAS_C)))

const lin = (over: Partial<FilaLineaAbierta> = {}): FilaLineaAbierta => ({
  periodo: 2026, mes: 9, dia: 9, numero_pedido: '58', codigo: '25', cantidad: 1,
  estado: 'E', descuento: null, tipo_descuento: null, precio: 10_000, familia: 2, ...over,
})

describe('estimarPedido — la fórmula v1 en TS, una sola fuente', () => {
  it('cantidad × precio de catálogo, por el multiplicador del canal (salón 1,23)', () => {
    const r = estimarPedido([lin({ cantidad: 2, precio: 10_000 })], 'M')
    expect(r.monto_estimado_crc).toBe(24_600)
    expect(r.items_valor).toBe(1)
  })

  it('delivery y llevar solo llevan IVA (1,13); barra lleva servicio (1,23)', () => {
    expect(estimarPedido([lin()], 'D').monto_estimado_crc).toBe(11_300)
    expect(estimarPedido([lin()], 'L').monto_estimado_crc).toBe(11_300)
    expect(estimarPedido([lin()], 'B').monto_estimado_crc).toBe(12_300)
    expect(MULT_SALON).toBe(1.23); expect(MULT_DELIVERY).toBe(1.13)
  })

  it('Tipo vacío o desconocido = salón por defecto', () => {
    expect(estimarPedido([lin()], null).monto_estimado_crc).toBe(12_300)
    expect(estimarPedido([lin()], 'Z').monto_estimado_crc).toBe(12_300)
  })

  it('descuento P = porcentaje; M = monto; vacío o desconocido = 0', () => {
    expect(estimarPedido([lin({ descuento: 10, tipo_descuento: 'P' })], 'D').monto_estimado_crc).toBe(10_170)
    expect(estimarPedido([lin({ descuento: 1_000, tipo_descuento: 'M' })], 'D').monto_estimado_crc).toBe(10_170)
    expect(estimarPedido([lin({ descuento: 1_000, tipo_descuento: null })], 'D').monto_estimado_crc).toBe(11_300)
    expect(estimarPedido([lin({ descuento: 1_000, tipo_descuento: 'Q' })], 'D').monto_estimado_crc).toBe(11_300)
  })

  it('WHITELIST: solo familias de FAMILIAS_VALOR_SERVIDO suman — no es "excluir 4 códigos"', () => {
    const r = estimarPedido([
      lin({ codigo: '25',  familia: 2,  precio: 10_000 }),   // sushi: entra
      lin({ codigo: '677', familia: 19, precio: 0 }),        // pax: fuera
      lin({ codigo: '900', familia: 17, precio: 5_000 }),    // cortesía: fuera
      lin({ codigo: '901', familia: 21, precio: 8_000 }),    // merch: fuera
    ], 'D')
    expect(r.monto_estimado_crc).toBe(11_300)
    expect(r.items_valor).toBe(1)
  })

  it('la línea anulada (X) queda fuera; E y P van', () => {
    const r = estimarPedido([
      lin({ estado: 'X', precio: 99_999 }),
      lin({ estado: 'E' }),
      lin({ estado: 'P' }),
    ], 'D')
    expect(r.monto_estimado_crc).toBe(22_600)
    expect(r.items_valor).toBe(2)
  })

  it('FAIL-CLOSED: la línea sin precio de catálogo no suma ni cuenta como ítem', () => {
    const r = estimarPedido([lin({ precio: null }), lin({ precio: 'no' })], 'D')
    expect(r.monto_estimado_crc).toBeNull()
    expect(r.items_valor).toBeNull()
  })

  it('sin líneas → null («sin total»), NUNCA ₡0', () => {
    expect(estimarPedido([], 'M')).toMatchObject({ monto_estimado_crc: null, items_valor: null, pax_pedido: null })
  })

  it('cero REAL ≠ null: líneas con catálogo pero ninguna con valor servido (cortesía) → 0', () => {
    const r = estimarPedido([lin({ codigo: '900', familia: 17, precio: 5_000 })], 'M')
    expect(r.monto_estimado_crc).toBe(0)
    expect(r.items_valor).toBe(0)
  })

  it('pax por artículo con la MISMA regla que el ticket: 677 vale 1 y 678 vale 2', () => {
    const r = estimarPedido([
      lin({ codigo: '677', familia: 19, cantidad: 2, precio: 0 }),
      lin({ codigo: '678', familia: 19, cantidad: 1, precio: 0 }),
    ], 'M')
    expect(r.pax_pedido).toBe(4)
    expect(r.qty677).toBe(2); expect(r.qty678).toBe(1)
  })

  it('sin 677/678 el pax es null, no 0 — Personas no se usa', () => {
    expect(estimarPedido([lin()], 'M').pax_pedido).toBeNull()
  })
})

describe('puedeLeerLineasAbiertas — fail-closed por esquema', () => {
  it('con la instalación completa, sí', () => {
    expect(puedeLeerLineasAbiertas(ESQUEMA_C)).toBe(true)
  })

  it('sin la tabla de detalle, sin el precio o sin la clave real del pedido, NO (y el snapshot sale igual)', () => {
    expect(puedeLeerLineasAbiertas(ESQUEMA)).toBe(false)   // la instalación de siempre: sin detalle
    const sinPrecio = resolverEsquema(new Map(Object.entries({ ...COLUMNAS_C, fac_productos: COLUMNAS.fac_productos })))
    expect(puedeLeerLineasAbiertas(sinPrecio)).toBe(false)
    const sinClave = resolverEsquema(new Map(Object.entries({ ...COLUMNAS_C, fac_pedidos: COLUMNAS.fac_pedidos })))
    expect(puedeLeerLineasAbiertas(sinClave)).toBe(false)
    const detIncompleto = resolverEsquema(new Map(Object.entries({ ...COLUMNAS_C, fac_pedidosdet: ['NumeroPedido', 'CodigoProducto', 'Cantidad'] })))
    expect(puedeLeerLineasAbiertas(detIncompleto)).toBe(false)
  })

  it('una tabla de detalle presente pero incompleta NO aborta el agente: todo es opcional', () => {
    expect(() => resolverEsquema(new Map(Object.entries({ ...COLUMNAS_C, fac_pedidosdet: ['NumeroPedido'] })))).not.toThrow()
  })
})

describe('sqlLineasAbiertas', () => {
  const sql = sqlLineasAbiertas(ESQUEMA_C)

  it('pasa el candado read-only', () => {
    expect(() => assertSoloSelect(sql)).not.toThrow()
  })

  it('ata las líneas a la cabecera por la clave REAL: Periodo, Mes, Dia y NumeroPedido', () => {
    for (const c of ['Periodo', 'Mes', 'Dia', 'NumeroPedido']) expect(sql).toContain(`p.[${c}] = d.[${c}]`)
  })

  it('mismo filtro que la cabecera: Estado R, sin factura, ventana, sin cursor', () => {
    expect(sql).toContain("[Estado] = 'R'")
    expect(sql).toContain('[NumeroFactura] IS NULL')
    expect(sql).toContain('CONVERT(datetime, @desde, 120)')
    expect(sql).not.toContain('@ultima')
  })

  it('trae precio y familia del catálogo, y descuento con su tipo', () => {
    expect(sql).toContain('[PrecioVenta]')
    expect(sql).toContain('AS familia')
    expect(sql).toContain('AS tipo_descuento')
  })

  it('sqlAbiertas conserva su WHERE y solo suma la clave real al SELECT', () => {
    const cab = sqlAbiertas(ESQUEMA_C)
    expect(cab).toContain("[Estado] = 'R'")
    expect(cab).toContain('AS periodo')
    expect(sqlAbiertas(ESQUEMA)).toMatch(/NULL\s+AS periodo/)   // sin las columnas, la clave va en NULL
  })
})

describe('claveLineas', () => {
  it('normaliza decimales en cero y arma la clave', () => {
    expect(claveLineas({ periodo: 2026, mes: 9, dia: 9, numero: '58.00' })).toBe('2026|9|9|58')
  })
  it('sin alguna parte no hay clave', () => {
    expect(claveLineas({ periodo: null, mes: 9, dia: 9, numero: '58' })).toBeNull()
  })
})

describe('leerAbiertas con líneas (Frente C)', () => {
  const cabecera = (over: Partial<FilaAbierta> = {}): FilaAbierta => ({
    id_pedido: '58', usuario_registra: '026', personas: 0, tipo: 'M', area: 'SALON 1', mesa: '5',
    fecha_hora: '2026-09-09 20:05:00', periodo: 2026, mes: 9, dia: 9, ...over,
  })
  const espiar = (abiertas: FilaAbierta[], lineas: FilaLineaAbierta[]) => {
    const visto: string[] = []
    const qy: Queryable = {
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        visto.push(sql)
        if (sql.includes('FROM [dbo].[FAC_PedidosDet] d')) return { rows: lineas as T[] }
        return { rows: abiertas as T[] }
      },
    }
    return { qy, visto }
  }

  it('ata las líneas por la clave real: el 58 de OTRO día no se le pega al 58 de hoy', async () => {
    const { qy } = espiar([cabecera()], [
      lin({ numero_pedido: '58', dia: 9, precio: 10_000 }),
      lin({ numero_pedido: '58', dia: 8, precio: 99_999 }),   // ayer, mismo número: NO
    ])
    const [m] = await leerAbiertas(qy, ESQUEMA_C, { desde: 'a', hasta: 'b' })
    expect(m.monto_estimado_crc).toBe(12_300)
    expect(m.items_valor).toBe(1)
  })

  it('el pax por artículo entra a mapPax: la alerta deja de decir sin_pax', async () => {
    const { qy } = espiar([cabecera()], [lin({ codigo: '678', familia: 19, cantidad: 1, precio: 0 })])
    const [m] = await leerAbiertas(qy, ESQUEMA_C, { desde: 'a', hasta: 'b' })
    expect(m.pax_pedido).toBe(2)
    expect(m.pax).toBe(2)
    expect(m.pax_alerta).toBe('falta_nativo')
  })

  it('FAIL-CLOSED: con el esquema de siempre no se pide el detalle y la mesa sale sin monto', async () => {
    const { qy, visto } = espiar([cabecera()], [lin()])
    const [m] = await leerAbiertas(qy, ESQUEMA, { desde: 'a', hasta: 'b' })
    expect(visto).toHaveLength(1)
    expect(m).toMatchObject({ monto_estimado_crc: null, pax_pedido: null, items_valor: null })
  })

  it('sin mesas abiertas no se pide el detalle', async () => {
    const { qy, visto } = espiar([], [lin()])
    expect(await leerAbiertas(qy, ESQUEMA_C, { desde: 'a', hasta: 'b' })).toEqual([])
    expect(visto).toHaveLength(1)
  })
})
