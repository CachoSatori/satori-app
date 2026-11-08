// Auditoría A7 (08-nov): el lote que arma el AGENTE DE PROD de hoy (`4d3513a`) pasa por la validación y la
// normalización del Edge NUEVO (`e4678b3`) sin descartes. Es la prueba de humo del §6 del paquete, en seco.
//
// No se importa nada del árbol de trabajo: `correr.sh` extrae las dos versiones a una carpeta temporal
// (VIEJO = 4d3513a: pos-bridge + src/shared; NUEVO = e4678b3: src/shared) y corre este archivo ahí.
// Los datos son inventados con la forma real de las filas del PoS (las mismas columnas que lee el agente).
import { describe, expect, it } from 'vitest'

// @ts-nocheck — se resuelve en la carpeta temporal
import { ejecutarCiclo, type PuertosCiclo } from './VIEJO/pos-bridge/ciclo.ts'
import { leerAbiertas, leerCerradas, leerProvisionales } from './VIEJO/pos-bridge/consultaAgente.ts'
import type { FilaDetalle, FilaFactura, Queryable } from './VIEJO/pos-bridge/consulta.ts'
import { resolverEsquema } from './VIEJO/pos-bridge/esquema.ts'
import type { PayloadIngest } from './VIEJO/src/shared/ndf/ingestNdf.ts'
import { normalizarLote, validarPayload } from './NUEVO/src/shared/ndf/ingestNdf.ts'

const LOCAL = 'santa-teresa'
const COLUMNAS = {
  fac_facturas: ['NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta', 'MontoElectronico', 'Deposito',
    'Cheque', 'CuentaCobrar', 'DolaresEfectivo', 'DolaresTarjeta', 'Vuelto', 'FechaCierra'],
  fac_pedidos: ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area', 'NumeroPedido', 'Mesa', 'FechaRegistra', 'Estado'],
  fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
  fac_productos: ['Codigo', 'Nombre', 'Clasificacion'],
  fac_clasificaciones: ['Codigo', 'Nombre'],
  fac_empleados: ['Login', 'Nombre'],
}
const ESQUEMA = resolverEsquema(new Map(Object.entries(COLUMNAS)))

const fac = (o: Partial<FilaFactura>): FilaFactura => ({
  numero_factura: '5001', fecha_hora: '2026-11-07 19:42:07', estado: 'C', login_cajero: '222', tipo_factura: null,
  area_factura: null, usuario_registra: '026', usuario_max: '026', personas: 0, pedidos: 1, tipo_pedido: 'M',
  area_pedido: 'SALON 1', salonero_nombre: 'SALONERO PRUEBA', mesa: '12', numero_pedido: '4477',
  fecha_cierra: '2026-11-08 01:15:00', efectivo: 15000, tarjeta: 0, monto_electronico: 0, deposito: 0, cheque: 0,
  cuenta_cobrar: 0, dolares_efectivo: 0, dolares_tarjeta: 0, vuelto: 3000, ...o,
})
const det = (o: Partial<FilaDetalle>): FilaDetalle => ({
  numero_factura: '5001', usuario_registra: '026', codigo: '100', nombre: 'ROLL PRUEBA', cantidad: 2, monto: 12000,
  imp_servicio: 1200, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null, ...o,
})

// Un día con lo que el agente ve de verdad: salón con pax por artículo, dólares, tarjeta, delivery, barra cobrada por
// caja, una cortesía, un login de sistema, una en curso (R) y una anulada (X), y dos mesas abiertas.
const FACTURAS = [
  fac({}),
  fac({ numero_factura: '5002', efectivo: 0, tarjeta: 31_500, vuelto: 0, personas: 3, mesa: '7', numero_pedido: '4478' }),
  fac({ numero_factura: '5003', efectivo: 0, dolares_efectivo: 40, vuelto: 1200, tipo_pedido: 'D', area_pedido: null, mesa: null }),
  fac({ numero_factura: '5004', usuario_registra: '222', usuario_max: '222', login_cajero: '222', area_pedido: 'BARRA', mesa: null, numero_pedido: null, pedidos: 0 }),
  fac({ numero_factura: '5005', usuario_registra: '002', usuario_max: '002', salonero_nombre: null, efectivo: 0, monto_electronico: 8_400, vuelto: 0 }),
]
const PROVISIONALES = [
  fac({ numero_factura: '5006', estado: 'R', fecha_cierra: null, efectivo: 0, vuelto: 0, mesa: '3', numero_pedido: '4481' }),
  fac({ numero_factura: '5007', estado: 'X', fecha_cierra: null, efectivo: 0, vuelto: 0 }),
]
const DETALLE = [
  det({}),
  det({ codigo: '677', nombre: 'PAX', cantidad: 2, monto: 0, imp_servicio: 0, familia: 19, familia_nombre: 'PAX' }),
  det({ numero_factura: '5002', codigo: '200', nombre: 'RAMEN PRUEBA', cantidad: 3, monto: 25_500, imp_servicio: 2550, familia: 3 }),
  det({ numero_factura: '5002', codigo: '300', nombre: 'CERVEZA PRUEBA', cantidad: 2, monto: 3_000, imp_servicio: 300, familia: 10, familia_nombre: 'BEBIDAS' }),
  det({ numero_factura: '5002', codigo: '301', nombre: 'POSTRE CORTESIA', cantidad: 1, monto: 0, imp_servicio: 0, familia: 4, es_extra: 0 }),
  det({ numero_factura: '5003', codigo: '200', nombre: 'RAMEN PRUEBA', cantidad: 2, monto: 17_000, imp_servicio: 0, familia: 3 }),
  det({ numero_factura: '5004', usuario_registra: '222', codigo: '300', nombre: 'CERVEZA PRUEBA', cantidad: 4, monto: 6_000, imp_servicio: 600, familia: 10 }),
  det({ numero_factura: '5005', usuario_registra: '002', codigo: '100', nombre: 'ROLL PRUEBA', cantidad: 1, monto: 7_600, imp_servicio: 760 }),
  det({ numero_factura: '5006', codigo: '100', nombre: 'ROLL PRUEBA', cantidad: 1, monto: 6_000, imp_servicio: 600 }),
]
const ABIERTAS = [
  { id_pedido: '4490', usuario_registra: '026', personas: 4, tipo: 'M', area: 'SALON 1', mesa: '14', fecha_hora: '2026-11-07 20:05:00' },
  { id_pedido: '4491', usuario_registra: '028', personas: 2, tipo: 'M', area: 'TERRAZA', mesa: '2', fecha_hora: '2026-11-07 20:15:00' },
]

const qy: Queryable = {
  async query<T>(sql: string, p?: Record<string, unknown>): Promise<{ rows: T[] }> {
    if (sql.includes('[NumeroFactura] IS NULL')) return { rows: ABIERTAS as T[] }
    const provisional = /'R'|'X'/.test(sql) && !/ultima/.test(JSON.stringify(p ?? {}))
    const facturas = sql.includes("'C'") ? FACTURAS : provisional ? PROVISIONALES : [...FACTURAS, ...PROVISIONALES]
    if (sql.includes('FROM [dbo].[FAC_FacturasDet] d')) {
      const nums = new Set(facturas.map((f) => f.numero_factura))
      return { rows: DETALLE.filter((d) => nums.has(String(d.numero_factura))) as T[] }
    }
    return { rows: facturas as T[] }
  },
}

describe('A7 · lote del agente de prod (4d3513a) → Edge nuevo (e4678b3)', () => {
  it('un ciclo real del agente viejo pasa validarPayload y normalizarLote del Edge nuevo sin descartes', async () => {
    const enviados: PayloadIngest[] = []
    const rango = { desde: '2026-11-06 08:00:00', hasta: '2026-11-07 22:00:00' }
    const puertos: PuertosCiclo = {
      leerCerradas: (ultima) => leerCerradas(qy, ESQUEMA, { ...rango, ultima }),
      leerProvisionales: () => leerProvisionales(qy, ESQUEMA, rango),
      leerAbiertas: () => leerAbiertas(qy, ESQUEMA, rango),
      async enviar(payload) {
        enviados.push(payload)
        return { ok: true, local: LOCAL, tickets_recibidos: payload.tickets.length, tickets_guardados: payload.tickets.length,
          lineas_guardadas: 0, open_guardadas: 0, open_borradas: 0, invalid: 0, recalculados: 0, problemas: [],
          cursor: { local: LOCAL, last_factura: '5000', last_fecha_registra: null, last_poll_at: null, last_error: null } }
      },
    } as PuertosCiclo
    await ejecutarCiclo(puertos, LOCAL, 36, { ultimaFactura: '5000', saludado: true, ultimoError: null },
      new Date('2026-11-08T04:00:00Z'))

    expect(enviados.length).toBeGreaterThan(0)
    const lote = enviados.at(-1)!
    expect(lote.tickets.length).toBe(7)           // 5 cerradas + R + X
    expect(lote.open?.length).toBe(2)
    expect(lote.cursor).toBeDefined()

    // El sobre viaja como JSON (igual que por HTTP).
    const body = JSON.parse(JSON.stringify(lote))
    const sobre = validarPayload(body)
    expect(sobre.ok, JSON.stringify(sobre)).toBe(true)
    if (!sobre.ok) return
    const n = normalizarLote(sobre.valor, '2026-11-08T04:00:00.000Z')
    expect(n.problemas, JSON.stringify(n.problemas)).toEqual([])
    expect(n.invalid).toBe(0)
    expect(n.tickets.length).toBe(7)
    expect(n.tickets.reduce((s, t) => s + t.lineas.length, 0)).toBe(DETALLE.length)
    expect(n.open?.length).toBe(2)
    expect(n.cursor).not.toBeNull()
    // Las columnas nuevas de la 081 llegan vacías con el agente viejo (lo esperado: no rompen nada).
    for (const t of n.tickets) {
      expect(t.fila.mesa_factura ?? null).toBeNull()
      expect(t.fila.consecutivo_fe ?? null).toBeNull()
    }
  })

  it('el saludo de arranque del agente viejo también pasa', () => {
    const sobre = validarPayload({ local: LOCAL, tickets: [] })
    expect(sobre.ok).toBe(true)
  })
})
