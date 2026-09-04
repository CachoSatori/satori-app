// ── pos-bridge · el SELECT del día ─────────────────────────────────────────────
//
// Este archivo NO conoce `mssql`: recibe un ejecutor de consultas (lo arma `db.ts`),
// igual que `tools/biotime-bridge/src/fetchPunches.ts`. Así el SQL, el armado de
// las facturas y el mapeo se prueban sin base de datos.
//
// READ-ONLY: tres `SELECT` y nada más. Sin `SELECT *`, sin blobs
// (`FacturaXML/PDF/XMLHacienda`) y sin PII de delivery
// (`Telefono/Direccion/NombreCliente/Lat/Long`).

import {
  entero,
  mapTicket,
  num,
  texto,
  type TicketCrudo,
  type TicketMapeado,
} from '../src/shared/ndf/mapTicket'
import { col, colOpt, q, type Esquema } from './esquema.ts'

/**
 * Los parámetros de fecha se convierten con estilo 120 (ODBC canónico,
 * `YYYY-MM-DD HH:MM:SS`) en vez de dejar la conversión implícita: así el filtro no
 * depende del `LANGUAGE`/`DATEFORMAT` de la sesión de SQL Server. Van sobre el
 * parámetro, nunca sobre la columna, para no perder el índice.
 */
export const DESDE = 'CONVERT(datetime, @desde, 120)'
export const HASTA = 'CONVERT(datetime, @hasta, 120)'

export interface Queryable {
  query<T>(sql: string, params?: Record<string, unknown>): Promise<{ rows: T[] }>
}

// ── Rango del día ──────────────────────────────────────────────────────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

/** `2026-09-01` válida y real (no `2026-02-31`). */
export function assertFecha(fecha: string): string {
  if (!FECHA_RE.test(fecha)) {
    throw new Error(`Fecha inválida: ${JSON.stringify(fecha)}. Formato: YYYY-MM-DD.`)
  }
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Fecha inexistente: ${fecha}.`)
  }
  return fecha
}

/**
 * `2026-09-01` → `['2026-09-01 00:00:00', '2026-09-02 00:00:00')`.
 *
 * Rango semiabierto en vez de `CAST(FechaRegistra AS date) = @fecha`: es la MISMA
 * condición (el datetime del PoS es naive = hora de Costa Rica y no se convierte a
 * nada) pero sargable, así que usa el índice en vez de escanear la tabla entera.
 */
export function rangoDia(fecha: string): { desde: string; hasta: string } {
  assertFecha(fecha)
  const [y, m, d] = fecha.split('-').map(Number)
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1))
  const iso = siguiente.toISOString().slice(0, 10)
  return { desde: `${fecha} 00:00:00`, hasta: `${iso} 00:00:00` }
}

// ── SQL ────────────────────────────────────────────────────────────────────────

/** Cuántas facturas hay por estado en el día (para reportar X y R). */
export function sqlConteoEstados(esq: Esquema): string {
  const f = esq.facturas.tabla
  return `SELECT ${q(col(esq, 'facturas', 'estado'))} AS estado, COUNT(*) AS n
FROM ${q('dbo')}.${q(f)}
WHERE ${q(col(esq, 'facturas', 'fecha'))} >= ${DESDE} AND ${q(col(esq, 'facturas', 'fecha'))} < ${HASTA}
GROUP BY ${q(col(esq, 'facturas', 'estado'))}`
}

/**
 * Las facturas CERRADAS del día, con su pedido y su salonero.
 *
 * El pedido se agrega ANTES del join: una factura puede consolidar varios pedidos
 * (varias mesas) y un `LEFT JOIN` directo multiplicaría la fila de la factura →
 * los medios de pago se contarían dos veces y el total del día saldría inflado.
 */
export function sqlFacturas(esq: Esquema): string {
  const F = `${q('dbo')}.${q(esq.facturas.tabla)}`
  const P = `${q('dbo')}.${q(esq.pedidos.tabla)}`
  const cf = (campo: string) => q(col(esq, 'facturas', campo))
  const cp = (campo: string) => q(col(esq, 'pedidos', campo))
  const of_ = (campo: string) => {
    const real = colOpt(esq, 'facturas', campo)
    return real ? `f.${q(real)}` : 'NULL'
  }
  const op = (campo: string) => {
    const real = colOpt(esq, 'pedidos', campo)
    return real ? `MIN(p.${q(real)})` : 'NULL'
  }

  const emp = esq.empleados.presente
  const joinEmpleados = emp
    ? `\nLEFT JOIN ${q('dbo')}.${q(esq.empleados.tabla)} e ON e.${q(col(esq, 'empleados', 'login'))} = ped.usuario_registra`
    : ''
  const nombreEmpleado = emp ? `e.${q(col(esq, 'empleados', 'nombre'))}` : 'NULL'

  return `SELECT
  CAST(f.${cf('numero')} AS varchar(40))            AS numero_factura,
  CONVERT(varchar(19), f.${cf('fecha')}, 120)       AS fecha_hora,
  f.${cf('estado')}                                 AS estado,
  ${of_('login')}                                   AS login_cajero,
  ${of_('tipo')}                                    AS tipo_factura,
  ${of_('area')}                                    AS area_factura,
  ped.usuario_registra                              AS usuario_registra,
  ped.usuario_max                                   AS usuario_max,
  ped.personas                                      AS personas,
  ped.pedidos                                       AS pedidos,
  ped.tipo                                          AS tipo_pedido,
  ped.area                                          AS area_pedido,
  ${nombreEmpleado}                                 AS salonero_nombre,
  COALESCE(f.${cf('efectivo')}, 0)                  AS efectivo,
  COALESCE(f.${cf('tarjeta')}, 0)                   AS tarjeta,
  COALESCE(f.${cf('montoelectronico')}, 0)          AS monto_electronico,
  COALESCE(f.${cf('deposito')}, 0)                  AS deposito,
  COALESCE(f.${cf('cheque')}, 0)                    AS cheque,
  COALESCE(f.${cf('cuentacobrar')}, 0)              AS cuenta_cobrar,
  COALESCE(${of_('dolaresefectivo')}, 0)            AS dolares_efectivo,
  COALESCE(${of_('dolarestarjeta')}, 0)             AS dolares_tarjeta,
  COALESCE(f.${cf('vuelto')}, 0)                    AS vuelto
FROM ${F} f
LEFT JOIN (
  SELECT
    p.${cp('numerofactura')}                        AS numero_factura,
    COUNT(*)                                        AS pedidos,
    SUM(COALESCE(p.${cp('personas')}, 0))           AS personas,
    MIN(p.${cp('usuarioregistra')})                 AS usuario_registra,
    MAX(p.${cp('usuarioregistra')})                 AS usuario_max,
    ${op('tipo')}                                   AS tipo,
    ${op('area')}                                   AS area
  FROM ${P} p
  INNER JOIN ${F} fp ON fp.${cf('numero')} = p.${cp('numerofactura')}
  WHERE fp.${cf('estado')} = 'C'
    AND fp.${cf('fecha')} >= ${DESDE} AND fp.${cf('fecha')} < ${HASTA}
  GROUP BY p.${cp('numerofactura')}
) ped ON ped.numero_factura = f.${cf('numero')}${joinEmpleados}
WHERE f.${cf('estado')} = 'C'
  AND f.${cf('fecha')} >= ${DESDE} AND f.${cf('fecha')} < ${HASTA}
ORDER BY f.${cf('fecha')}, f.${cf('numero')}`
}

/** El detalle de esas mismas facturas, ya resuelto contra el catálogo de productos. */
export function sqlDetalle(esq: Esquema): string {
  const F = `${q('dbo')}.${q(esq.facturas.tabla)}`
  const D = `${q('dbo')}.${q(esq.facturasdet.tabla)}`
  const PR = `${q('dbo')}.${q(esq.productos.tabla)}`
  const cf = (campo: string) => q(col(esq, 'facturas', campo))
  const cd = (campo: string) => q(col(esq, 'facturasdet', campo))
  const od = (campo: string) => {
    const real = colOpt(esq, 'facturasdet', campo)
    return real ? `d.${q(real)}` : 'NULL'
  }

  const clas = esq.clasificaciones.presente
  const joinClas = clas
    ? `\nLEFT JOIN ${q('dbo')}.${q(esq.clasificaciones.tabla)} c ON c.${q(col(esq, 'clasificaciones', 'codigo'))} = pr.${q(col(esq, 'productos', 'clasificacion'))}`
    : ''
  const nombreFamilia = clas ? `c.${q(col(esq, 'clasificaciones', 'nombre'))}` : 'NULL'

  return `SELECT
  CAST(d.${cd('numerofactura')} AS varchar(40))     AS numero_factura,
  d.${cd('producto')}                               AS codigo,
  pr.${q(col(esq, 'productos', 'nombre'))}          AS nombre,
  COALESCE(d.${cd('cantidad')}, 0)                  AS cantidad,
  COALESCE(d.${cd('monto')}, 0)                     AS monto,
  COALESCE(d.${cd('imps')}, 0)                      AS imp_servicio,
  COALESCE(${od('impv')}, 0)                        AS imp_venta,
  pr.${q(col(esq, 'productos', 'clasificacion'))}   AS familia,
  ${nombreFamilia}                                  AS familia_nombre,
  ${od('esextra')}                                  AS es_extra,
  ${od('compuesto')}                                AS compuesto
FROM ${D} d
INNER JOIN ${F} f ON f.${cf('numero')} = d.${cd('numerofactura')}
LEFT JOIN ${PR} pr ON pr.${q(col(esq, 'productos', 'codigo'))} = d.${cd('producto')}${joinClas}
WHERE f.${cf('estado')} = 'C'
  AND f.${cf('fecha')} >= ${DESDE} AND f.${cf('fecha')} < ${HASTA}
ORDER BY d.${cd('numerofactura')}`
}

// ── Filas crudas ───────────────────────────────────────────────────────────────

export interface FilaFactura {
  numero_factura:    string
  fecha_hora:        string
  estado:            string | null
  login_cajero:      unknown
  tipo_factura:      unknown
  area_factura:      unknown
  usuario_registra:  unknown
  usuario_max:       unknown
  personas:          unknown
  pedidos:           unknown
  tipo_pedido:       unknown
  area_pedido:       unknown
  salonero_nombre:   unknown
  efectivo:          unknown
  tarjeta:           unknown
  monto_electronico: unknown
  deposito:          unknown
  cheque:            unknown
  cuenta_cobrar:     unknown
  dolares_efectivo:  unknown
  dolares_tarjeta:   unknown
  vuelto:            unknown
}

export interface FilaDetalle {
  numero_factura: string
  codigo:         unknown
  nombre:         unknown
  cantidad:       unknown
  monto:          unknown
  imp_servicio:   unknown
  imp_venta:      unknown
  familia:        unknown
  familia_nombre: unknown
  es_extra:       unknown
  compuesto:      unknown
}

export interface FilaEstado { estado: string | null; n: unknown }

/** `1`, `true`, `'S'`, `'SI'` → true. Los flags del PoS varían de instalación. */
export function banderaVerdadera(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v).trim().toUpperCase()
  return s === '1' || s === 'S' || s === 'SI' || s === 'SÍ' || s === 'TRUE' || s === 'Y'
}

// ── Armado ─────────────────────────────────────────────────────────────────────

export interface LecturaDia {
  fecha:           string
  tickets:         TicketMapeado[]
  /** Estado → cantidad de facturas del día (incluye X y R). */
  conteoEstados:   Record<string, number>
  avisos:          string[]
}

/**
 * Filas crudas → facturas mapeadas. PURA: se prueba con arrays a mano.
 *
 * El detalle se agrupa por `numero_factura` como STRING: `NumeroFactura` es decimal
 * y pasarlo por `Number` pierde precisión arriba de 2^53.
 */
export function armarTickets(
  facturas: FilaFactura[],
  detalle: FilaDetalle[],
): { tickets: TicketMapeado[]; avisos: string[] } {
  const avisos: string[] = []

  const porFactura = new Map<string, FilaDetalle[]>()
  for (const d of detalle) {
    const clave = String(d.numero_factura)
    const lista = porFactura.get(clave)
    if (lista) lista.push(d)
    else porFactura.set(clave, [d])
  }

  let sinDetalle = 0, sinPedido = 0, sinFamilia = 0, variosSaloneros = 0
  const tickets = facturas.map(f => {
    const clave = String(f.numero_factura)
    const lineas = porFactura.get(clave) ?? []
    if (lineas.length === 0) sinDetalle++
    if (texto(f.usuario_registra) === null) sinPedido++

    const registra = texto(f.usuario_registra)
    const saloneros_varios = registra !== null && texto(f.usuario_max) !== null && registra !== texto(f.usuario_max)
    if (saloneros_varios) variosSaloneros++

    const items = lineas.map(l => {
      if (l.familia === null || l.familia === undefined) sinFamilia++
      return {
        codigo:         l.codigo,
        nombre:         l.nombre,
        cantidad:       l.cantidad,
        monto:          l.monto,
        impS:           l.imp_servicio,
        familia:        l.familia,
        familia_nombre: l.familia_nombre,
        no_cuenta_unidad: banderaVerdadera(l.es_extra) || banderaVerdadera(l.compuesto),
      }
    })

    const crudo: TicketCrudo = {
      numero_factura:   clave,
      fecha_hora:       String(f.fecha_hora ?? ''),
      estado:           texto(f.estado),
      // El canal lo manda el pedido; la factura es el respaldo cuando no hay pedido.
      tipo:             texto(f.tipo_pedido) ?? texto(f.tipo_factura),
      area:             texto(f.area_pedido) ?? texto(f.area_factura),
      login_cajero:     f.login_cajero,
      usuario_registra: f.usuario_registra,
      salonero_nombre:  f.salonero_nombre,
      personas:         f.personas,
      imp_servicio:     lineas.reduce((s, l) => s + num(l.imp_servicio), 0),
      pedidos:          entero(f.pedidos),
      saloneros_varios,
      medios: {
        efectivo:         f.efectivo,
        tarjeta:          f.tarjeta,
        montoElectronico: f.monto_electronico,
        deposito:         f.deposito,
        cheque:           f.cheque,
        cuentaCobrar:     f.cuenta_cobrar,
        dolaresEfectivo:  f.dolares_efectivo,
        dolaresTarjeta:   f.dolares_tarjeta,
        vuelto:           f.vuelto,
      },
      items,
    }
    return mapTicket(crudo)
  })

  if (sinDetalle)       avisos.push(`${sinDetalle} factura(s) sin líneas de detalle: su mix y su 10% quedan en 0.`)
  if (sinPedido)        avisos.push(`${sinPedido} factura(s) sin pedido (histórico): salonero null y pax 0.`)
  if (variosSaloneros)  avisos.push(`${variosSaloneros} factura(s) consolidan pedidos de más de un usuario: se acredita el menor.`)
  if (sinFamilia)       avisos.push(`${sinFamilia} línea(s) sin familia: caen en la categoría "otro" del mix.`)

  return { tickets, avisos }
}

/** El día completo: tres consultas y el armado. Solo `SELECT`. */
export async function leerDia(qy: Queryable, esq: Esquema, fecha: string): Promise<LecturaDia> {
  const { desde, hasta } = rangoDia(fecha)
  const params = { desde, hasta }

  const estados = await qy.query<FilaEstado>(sqlConteoEstados(esq), params)
  const conteoEstados: Record<string, number> = {}
  for (const e of estados.rows) conteoEstados[texto(e.estado) ?? '(vacío)'] = num(e.n)

  const facturas = await qy.query<FilaFactura>(sqlFacturas(esq), params)
  const detalle  = await qy.query<FilaDetalle>(sqlDetalle(esq), params)

  const { tickets, avisos } = armarTickets(facturas.rows, detalle.rows)

  const desconocidos = Object.keys(conteoEstados).filter(e => !['C', 'X', 'R'].includes(e))
  if (desconocidos.length) {
    avisos.push(`Estados no previstos en el día: ${desconocidos.join(', ')} (solo se cuentan las C).`)
  }

  return { fecha, tickets, conteoEstados, avisos }
}
