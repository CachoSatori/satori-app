// ── pos-bridge · las dos lecturas del agente (A3) ──────────────────────────────
//
// Sin driver, igual que `consulta.ts`: recibe un `Queryable` y se prueba con filas a
// mano. Reusa el SQL y el armado de la Fase 1a — acá no se remapea nada.
//
// Dos flujos por ciclo:
//   · CERRADAS — `Estado='C'` con `NumeroFactura` mayor al cursor, dentro de la ventana
//     reciente. Es lo que se convierte en `pos_ndf_tickets`.
//   · ABIERTAS — `FAC_Pedidos` sin factura todavía. Es un SNAPSHOT: el Edge borra las
//     que no vienen, así que la mesa que se cerró desaparece sola.

import {
  COD_PAX_1,
  COD_PAX_2,
  esValorServido,
  mapCanal,
  mapPax,
  mapSalonero,
  texto,
  type TicketMapeado,
} from '../src/shared/ndf/mapTicket.ts'
import { conOffsetCR, type OpenIngest, type ProductoComandado, type TicketIngest } from '../src/shared/ndf/ingestNdf.ts'

import {
  armarTickets,
  DESDE,
  ESTADOS_CERRADAS,
  ESTADOS_PROVISIONALES,
  HASTA,
  sqlDetalle,
  sqlFacturas,
  type FilaDetalle,
  type FilaFactura,
  type Queryable,
} from './consulta.ts'
import type { EstadoFactura } from '../src/shared/ndf/mapTicket'
import { col, colOpt, q, type Esquema } from './esquema.ts'
import type { RangoLectura } from './ventana.ts'

export interface ParametrosLectura extends RangoLectura {
  /** El cursor: `null` = primera corrida, se lee toda la ventana. */
  ultima: string | null
}

/** Lo que produce `CONVERT(varchar(19), <datetime>, 120)`: el naive completo. */
const NAIVE_120 = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

/**
 * `FechaCierra` del PoS → el MISMO instante con la zona explícita, o `null`.
 *
 * No interpreta nada (el lote de cierre es P1): lo único que hace de más es exigir el
 * naive completo antes de ponerle el offset. Si la columna resultara ser un `date`, el
 * `CONVERT` daría `2026-09-02` y `conOffsetCR` armaría `2026-09-02-06:00`, que NO es un
 * instante — y el Edge, que exige zona, rechazaría el TICKET ENTERO. Perder una venta
 * por un campo informativo no es aceptable: acá se descarta el campo, no el ticket, y
 * `leerCerradas` lo avisa.
 */
export function cierreConZona(v: unknown): string | null {
  const s = texto(v)
  const m = s === null ? null : NAIVE_120.exec(s)
  if (m === null || s === null) return null

  // La FORMA no alcanza, por dos motivos distintos:
  //   · '0000-00-00 00:00:00' (centinela posible si la columna es varchar) matchea el regex
  //     y arma un instante que NADIE puede parsear → el Edge lo rechaza por "sin zona" y se
  //     lleva puesta LA VENTA ENTERA.
  //   · '2026-02-31 10:00:00' sí parsea, pero JS lo RUEDA callado al 3 de marzo: se guardaría
  //     un lote de cierre en un día que no existió.
  // Mismo chequeo de rodaje que `assertFecha` en `consulta.ts`: se rearma la fecha y se exige
  // que los seis campos vuelvan idénticos.
  const [y, mes, d, hh, mm, ss] = m.slice(1).map(Number)
  const dt = new Date(Date.UTC(y, mes - 1, d, hh, mm, ss))
  const rueda =
    dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d ||
    dt.getUTCHours() !== hh || dt.getUTCMinutes() !== mm || dt.getUTCSeconds() !== ss
  return rueda ? null : conOffsetCR(s)
}

/**
 * Lo que sale del SELECT pero NO pasa por el mapper: no cambia ni un monto, así que no es
 * dominio de `mapTicket`. Se pega al ticket indexado por el número de factura como STRING
 * (es decimal: `Number` pierde precisión arriba de 2^53).
 */
export interface ExtrasFactura {
  mesa?:          unknown
  numero_pedido?: unknown
  fecha_cierra?:  unknown
}

/**
 * Filas crudas → extras por factura.
 *
 * Existe como función exportada para que los DOS caminos de escritura —el agente en vivo y
 * el backfill histórico— usen exactamente el mismo armado. Cuando solo lo tenía `leerCerradas`,
 * el backfill mandaba los tres campos en null y, como el Edge upsertea la fila ENTERA, cada
 * re-backfill BORRABA lo que el agente había escrito.
 */
export function extrasPorFactura(filas: FilaFactura[]): Map<string, ExtrasFactura> {
  const out = new Map<string, ExtrasFactura>()
  for (const f of filas) {
    out.set(String(f.numero_factura), {
      mesa:          f.mesa,
      numero_pedido: f.numero_pedido,
      fecha_cierra:  f.fecha_cierra,
    })
  }
  return out
}

/** Un ticket listo para el Edge: el `TicketMapeado` de la Fase 1a con lo que la base pide. */
export function aTicketIngest(
  t: TicketMapeado,
  extra: ExtrasFactura = {},
): TicketIngest {
  return {
    ...t,
    // El PoS guarda hora de pared de Costa Rica; acá se le pone el offset explícito.
    // El Edge RECHAZA cualquier instante sin zona (el desfase de 1 h de BioTime).
    fecha_registra: conOffsetCR(`${t.fecha} ${t.hora}`),
    // `FechaCierra` va CRUDA: se le pone la zona y nada más. Agrupar por
    // (Login, FechaCierra) para deducir la jornada es P1 y NO vive acá.
    fecha_cierra:   cierreConZona(extra.fecha_cierra),
    mesa:           texto(extra.mesa),
    numero_pedido:  texto(extra.numero_pedido),
  }
}

/**
 * La lectura común: facturas + detalle de unos estados, mapeadas y listas para mandar.
 *
 * `incremental` decide si viaja el corte por cursor. Cuando NO viaja, `@ultima` no existe en
 * el SQL y tampoco se manda en los parámetros — mismo contrato que el dry-run de la Fase 1a.
 */
async function leerFacturas(
  qy: Queryable,
  esq: Esquema,
  rango: RangoLectura,
  opciones: { incremental: boolean; ultima: string | null; estados: readonly EstadoFactura[] },
): Promise<{ tickets: TicketIngest[]; avisos: string[] }> {
  const params = opciones.incremental
    ? { desde: rango.desde, hasta: rango.hasta, ultima: opciones.ultima }
    : { desde: rango.desde, hasta: rango.hasta }

  const facturas = await qy.query<FilaFactura>(sqlFacturas(esq, opciones.incremental, opciones.estados), params)
  const detalle  = await qy.query<FilaDetalle>(sqlDetalle(esq, opciones.incremental, opciones.estados), params)

  const { tickets, avisos } = armarTickets(facturas.rows, detalle.rows)

  const extras = extrasPorFactura(facturas.rows)

  // Una FechaCierra que existe pero no se puede leer se pierde en silencio si nadie la
  // cuenta, y P1 se apoya en ella: mejor que salga en el log del ciclo.
  const cierreIlegible = facturas.rows.filter(
    (f) => texto(f.fecha_cierra) !== null && cierreConZona(f.fecha_cierra) === null,
  ).length
  if (cierreIlegible) {
    avisos.push(`${cierreIlegible} factura(s) con FechaCierra en un formato no esperado: van con fecha_cierra null.`)
  }

  return {
    tickets: tickets.map((t) => aTicketIngest(t, extras.get(t.numero_factura) ?? {})),
    avisos,
  }
}

/** Las facturas CERRADAS nuevas (`NumeroFactura > ultima`) de la ventana. Mueven el cursor. */
export async function leerCerradas(
  qy: Queryable,
  esq: Esquema,
  p: ParametrosLectura,
): Promise<{ tickets: TicketIngest[]; avisos: string[] }> {
  return leerFacturas(qy, esq, p, { incremental: true, ultima: p.ultima, estados: ESTADOS_CERRADAS })
}

/**
 * Las facturas PROVISIONALES de la ventana: `R` en curso y `X` anulada. Se releen ENTERAS
 * cada ciclo, sin cursor, porque cambian: una `R` se cobra y pasa a `C`, o se anula y pasa a
 * `X`. El Edge las pisa por `(local, numero_factura)`, así que releer no duplica.
 *
 * NUNCA mueven el cursor. Al contrario: lo topan (ver `ciclo.ts`), porque la lectura de
 * cerradas es `NumeroFactura > cursor` y una `R` que quedara por debajo no se leería nunca
 * cuando cierre.
 *
 * Es lo que hace que «En vivo» tenga plata DURANTE el servicio: en este PoS las facturas
 * quedan en `R` hasta que el cajero cierra el lote, y hasta entonces «cerradas» no trae nada.
 */
export async function leerProvisionales(
  qy: Queryable,
  esq: Esquema,
  rango: RangoLectura,
): Promise<{ tickets: TicketIngest[]; avisos: string[] }> {
  return leerFacturas(qy, esq, rango, { incremental: false, ultima: null, estados: ESTADOS_PROVISIONALES })
}

// ── Mesas abiertas ─────────────────────────────────────────────────────────────

/** Fila cruda de una mesa abierta (pedido sin factura). */
export interface FilaAbierta {
  id_pedido:        unknown
  usuario_registra: unknown
  personas:         unknown
  tipo:             unknown
  area:             unknown
  mesa:             unknown
  fecha_hora:       unknown
  /** Clave real del pedido (Frente C). `NULL` si la instalación no tiene las columnas. */
  periodo?:         unknown
  mes?:             unknown
  dia?:             unknown
}

/**
 * Una línea del pedido ABIERTO, ya enriquecida con el catálogo (Frente C v1).
 *
 * `precio` es el NETO de `FAC_Productos.PrecioVenta`: `FAC_PedidosDet` no trae monto de línea.
 * `familia` es la misma clasificación del producto que usa el neto de las cerradas.
 */
export interface FilaLineaAbierta {
  periodo:       unknown
  mes:           unknown
  dia:           unknown
  numero_pedido: unknown
  codigo:        unknown
  cantidad:      unknown
  estado:        unknown
  descuento:     unknown
  tipo_descuento: unknown
  precio:        unknown
  familia:       unknown
  /** `FAC_Productos.Nombre` (desplegable de productos, mig 065). `NULL` si el código no está en el catálogo. */
  nombre?:       unknown
}

/**
 * El código de `FAC_Pedidos.Estado` que significa MESA ABIERTA.
 *
 * La columna tiene solo tres valores en este PoS: `R` en curso, `F` facturada, `X` anulada
 * (verificado con DBeaver; el único pedido abierto en servicio salió `R` y los tres fantasma
 * eran `X`/`F`). Se filtra por whitelist y NUNCA por blacklist `NOT IN ('F','X')`: si un día
 * apareciera un código nuevo, una whitelist deja de mostrar mesas —visible, se reporta— y una
 * blacklist mostraría basura como si fuera actividad viva.
 */
export const ESTADO_PEDIDO_ABIERTO = 'R'

/**
 * ¿Se puede leer el snapshot en esta instalación? Necesita DOS columnas:
 *
 *   · `numeropedido` — la CLAVE de la mesa abierta. Sin ella no hay identidad estable.
 *   · `estado`       — la señal de abierto/cerrado. Sin ella no se puede distinguir una mesa
 *                      abierta de un pedido ya facturado o anulado.
 *
 * Sin cualquiera de las dos NO se manda el snapshot (el Edge no toca `pos_ndf_open` si `open`
 * viene ausente). Es FAIL-CLOSED a propósito: la alternativa —caer de vuelta a solo
 * `NumeroFactura IS NULL`— restauraría en silencio el bug de las mesas fantasma, y un feed que
 * miente sin avisar es peor que un feed que no reporta.
 */
export function puedeLeerAbiertas(esq: Esquema): boolean {
  return colOpt(esq, 'pedidos', 'numeropedido') !== null
      && colOpt(esq, 'pedidos', 'estado') !== null
}

/**
 * Los pedidos EN CURSO = lo que está abierto ahora.
 *
 * La condición que manda es `Estado = 'R'`. `NumeroFactura IS NULL` se conserva —acota igual y
 * un pedido abierto todavía no tiene factura— pero por sí solo NO define "abierto": el
 * back-link no se escribe en ~7% de los pedidos, y ahí uno ya facturado (`F`) o anulado (`X`)
 * se veía abierto para siempre. Ese era el bug de las mesas fantasma.
 *
 * Se acota por fecha cuando la columna existe: sin ese filtro se escanea `FAC_Pedidos` entero
 * (24.054 filas y creciendo) en cada poll.
 *
 * `col()` y no `colOpt()` para el estado: si la columna no está esto EXPLOTA en vez de emitir
 * la consulta vieja. No debería llegar acá —`puedeLeerAbiertas` corta antes— y si llega, un
 * error ruidoso es mejor que volver al bug en silencio.
 */
export function sqlAbiertas(esq: Esquema): string {
  const P = `${q('dbo')}.${q(esq.pedidos.tabla)}`
  const cp = (campo: string) => q(col(esq, 'pedidos', campo))
  const op = (campo: string) => {
    const real = colOpt(esq, 'pedidos', campo)
    return real ? `p.${q(real)}` : 'NULL'
  }
  const fecha = colOpt(esq, 'pedidos', 'fecha')

  return `SELECT
  CAST(p.${q(col(esq, 'pedidos', 'numeropedido'))} AS varchar(40)) AS id_pedido,
  p.${cp('usuarioregistra')}                        AS usuario_registra,
  COALESCE(p.${cp('personas')}, 0)                  AS personas,
  ${op('tipo')}                                     AS tipo,
  ${op('area')}                                     AS area,
  ${op('mesa')}                                     AS mesa,
  ${fecha ? `CONVERT(varchar(19), p.${q(fecha)}, 120)` : 'NULL'} AS fecha_hora,
  ${op('periodo')}                                  AS periodo,
  ${op('mes')}                                      AS mes,
  ${op('dia')}                                      AS dia
FROM ${P} p
WHERE p.${cp('numerofactura')} IS NULL
  AND p.${cp('estado')} = '${ESTADO_PEDIDO_ABIERTO}'${
  fecha ? `\n  AND p.${q(fecha)} >= ${DESDE} AND p.${q(fecha)} < ${HASTA}` : ''
}
ORDER BY p.${q(col(esq, 'pedidos', 'numeropedido'))}`
}

// ── Frente C v1: monto estimado + pax de la mesa abierta ──────────────────────

/**
 * ¿Se pueden leer las líneas de los pedidos abiertos en esta instalación?
 *
 * Hace falta la tabla de detalle con TODAS sus columnas de clave y de cálculo, el precio de
 * catálogo del producto, y la clave real del pedido en la cabecera. Sin cualquiera de esas
 * cosas NO se leen líneas: el snapshot sale exactamente como hoy, sin monto ni pax. Es
 * fail-closed a propósito — un estimado a medias sería un número inventado.
 */
export function puedeLeerLineasAbiertas(esq: Esquema): boolean {
  if (!esq.pedidosdet?.presente) return false
  const det = ['numeropedido', 'periodo', 'mes', 'dia', 'producto', 'cantidad']
  if (det.some((c) => colOpt(esq, 'pedidosdet', c) === null)) return false
  if (colOpt(esq, 'productos', 'precio') === null) return false
  return ['periodo', 'mes', 'dia', 'numeropedido'].every((c) => colOpt(esq, 'pedidos', c) !== null)
}

/**
 * Las líneas de los pedidos ABIERTOS de la ventana, enriquecidas con precio y familia.
 *
 * Mismo filtro que `sqlAbiertas` sobre la cabecera (`Estado = 'R'`, sin factura, ventana),
 * atado a las líneas por la clave REAL del pedido: `(Periodo, Mes, Dia, NumeroPedido)`.
 * `NumeroPedido` solo no alcanza — se reinicia cada día.
 *
 * Es una consulta APARTE y no un JOIN dentro de `sqlAbiertas`: un join multiplicaría la fila
 * del pedido por cada línea, y la cabecera ya tiene sus tests y su `WHERE` firmado.
 *
 * Solo se emite cuando `puedeLeerLineasAbiertas` dice que sí: acá `col()` explota si falta
 * algo, y eso es preferible a una consulta a medias.
 */
export function sqlLineasAbiertas(esq: Esquema): string {
  const P  = `${q('dbo')}.${q(esq.pedidos.tabla)}`
  const D  = `${q('dbo')}.${q(esq.pedidosdet.tabla)}`
  const PR = `${q('dbo')}.${q(esq.productos.tabla)}`
  const cp = (campo: string) => q(col(esq, 'pedidos', campo))
  const cd = (campo: string) => q(col(esq, 'pedidosdet', campo))
  const od = (campo: string) => {
    const real = colOpt(esq, 'pedidosdet', campo)
    return real ? `d.${q(real)}` : 'NULL'
  }
  const fecha = colOpt(esq, 'pedidos', 'fecha')

  return `SELECT
  d.${cd('periodo')}                                AS periodo,
  d.${cd('mes')}                                    AS mes,
  d.${cd('dia')}                                    AS dia,
  CAST(d.${cd('numeropedido')} AS varchar(40))      AS numero_pedido,
  d.${cd('producto')}                               AS codigo,
  COALESCE(d.${cd('cantidad')}, 0)                  AS cantidad,
  ${od('estado')}                                   AS estado,
  ${od('descuento')}                                AS descuento,
  ${od('tipodescuento')}                            AS tipo_descuento,
  pr.${q(col(esq, 'productos', 'precio'))}          AS precio,
  pr.${q(col(esq, 'productos', 'clasificacion'))}   AS familia,
  pr.${q(col(esq, 'productos', 'nombre'))}          AS nombre
FROM ${D} d
INNER JOIN ${P} p
  ON p.${cp('numeropedido')} = d.${cd('numeropedido')}
 AND p.${cp('periodo')} = d.${cd('periodo')}
 AND p.${cp('mes')} = d.${cd('mes')}
 AND p.${cp('dia')} = d.${cd('dia')}
LEFT JOIN ${PR} pr ON pr.${q(col(esq, 'productos', 'codigo'))} = d.${cd('producto')}
WHERE p.${cp('numerofactura')} IS NULL
  AND p.${cp('estado')} = '${ESTADO_PEDIDO_ABIERTO}'${
  fecha ? `\n  AND p.${q(fecha)} >= ${DESDE} AND p.${q(fecha)} < ${HASTA}` : ''
}
ORDER BY d.${cd('numeropedido')}`
}

/** La clave real del pedido como string, para atar cabecera y líneas. `null` si falta algo. */
export function claveLineas(f: { periodo: unknown; mes: unknown; dia: unknown; numero: unknown }): string | null {
  const partes = [f.periodo, f.mes, f.dia, f.numero].map((v) => {
    const t = texto(v)
    return t === null ? null : t.replace(/\.0*$/, '')
  })
  if (partes.some((p) => p === null)) return null
  return partes.join('|')
}

/** Multiplicador por canal: salón y barra llevan IVA 13 % + servicio 10 %; delivery y llevar solo IVA. */
export const MULT_SALON    = 1.23
export const MULT_DELIVERY = 1.13

/** Estado de línea que se descarta. El mismo código que anulada en facturas y pedidos. */
export const ESTADO_LINEA_ANULADA = 'X'

export interface PedidoEstimado {
  /** Bruto estimado. `null` = no se pudo calcular; `0` = cero real (nada con valor servido). */
  monto_estimado_crc: number | null
  /** 677 + 2×678. `null` = sin esas líneas. */
  pax_pedido:         number | null
  /** Líneas con valor servido. `null` = sin ninguna línea usable. */
  items_valor:        number | null
  /** Insumo para `mapPax`: unidades de 677 y 678. */
  qty677: number
  qty678: number
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/**
 * La fórmula v1, en TS y en UN solo lugar. Por línea del pedido abierto:
 *
 *   neto = Cantidad × PrecioVenta − descuento
 *     descuento = neto × Descuento/100   si TipoDescuento = 'P'
 *               = Descuento              si TipoDescuento = 'M'
 *               = 0                      si vacío o desconocido
 *   monto = Σ neto(líneas con valor servido) × multiplicador del canal
 *
 * Whitelist = INCLUIR solo familias de `FAMILIAS_VALOR_SERVIDO`, la misma del neto del día:
 * así pax (677/678), cortesías (17), dueños (28) y merch quedan fuera por definición, no por
 * una lista de códigos. Las líneas anuladas quedan fuera; `E` y `P` (enviada, preparando) van.
 *
 * Fail-closed, con dos ceros distintos:
 *   · Una línea sin precio de catálogo NO suma y no cuenta como ítem.
 *   · Sin NINGUNA línea usable (no vino detalle, o nada tiene catálogo) → `null`: «sin total».
 *   · Con líneas usables pero ninguna con valor servido (una cortesía) → `0`: cero REAL.
 *
 * El pax NO sale de `Personas` (0 hasta en facturadas): sale de 677 y 678 con la MISMA regla
 * que `mapPax` en el ticket, 678 vale dos personas. Así la mesa dice lo mismo antes y después
 * de cerrar.
 */
export function estimarPedido(lineas: readonly FilaLineaAbierta[], tipo: unknown): PedidoEstimado {
  const t = (texto(tipo) ?? '').toUpperCase()
  const mult = t === 'D' || t === 'L' ? MULT_DELIVERY : MULT_SALON

  let usables = 0, conValor = 0, neto = 0, qty677 = 0, qty678 = 0
  for (const l of lineas) {
    if ((texto(l.estado) ?? '').toUpperCase() === ESTADO_LINEA_ANULADA) continue
    const cantidad = numero(l.cantidad) ?? 0
    const codigo = texto(l.codigo)
    if (codigo === COD_PAX_1) qty677 += cantidad
    if (codigo === COD_PAX_2) qty678 += cantidad

    const precio = numero(l.precio)
    if (precio === null) continue          // sin catálogo: no suma, no cuenta
    usables += 1
    if (!esValorServido(l.familia)) continue
    conValor += 1

    const bruto = cantidad * precio
    const d = numero(l.descuento) ?? 0
    const td = (texto(l.tipo_descuento) ?? '').toUpperCase()
    const descuento = td === 'P' ? bruto * (d / 100) : td === 'M' ? d : 0
    neto += bruto - descuento
  }

  const pax = qty677 * 1 + qty678 * 2
  return {
    monto_estimado_crc: usables === 0 ? null : Math.round(neto * mult * 100) / 100,
    pax_pedido:         qty677 + qty678 > 0 ? pax : null,
    items_valor:        usables === 0 ? null : conValor,
    qty677, qty678,
  }
}

/**
 * Los productos comandados de la mesa abierta, AGRUPADOS por producto (desplegable de «En
 * vivo», mig 065). Informativo: nombre × cantidad total, sin ₡.
 *
 * Alcance firmado (Ismael, 2026-09-10): TODO lo comandado —cortesías, dueños, merch, lo que
 * sea— EXCEPTO los marcadores de pax (677 / 678), que no son algo que se sirva, y las líneas
 * anuladas. No pasa por la whitelist de valor servido a propósito: acá no se cuenta plata,
 * se lista lo que hay en la mesa.
 *
 * Se agrupa por CÓDIGO (la identidad del producto) y se muestra el nombre del catálogo. Orden:
 * cantidad desc, después nombre, así dos snapshots seguidos de la misma mesa listan igual.
 *
 * FAIL-CLOSED, todo o nada:
 *   · Sin líneas (o sin poder leerlas) → `null`: la fila no tiene desplegable.
 *   · Una línea sin nombre de catálogo → `null` para la mesa ENTERA. Una lista a medias se
 *     leería como «la mesa solo tiene esto», que es falso; mejor no mostrar nada y que se vea.
 *   · Una línea con cantidad ilegible o ≤ 0 se ignora (no es un producto en la mesa).
 *   · Si después de todo eso no queda nada → `null`, nunca `[]`.
 */
export function agruparProductos(lineas: readonly FilaLineaAbierta[]): ProductoComandado[] | null {
  const por = new Map<string, { nombre: string; cantidad: number }>()
  for (const l of lineas) {
    if ((texto(l.estado) ?? '').toUpperCase() === ESTADO_LINEA_ANULADA) continue
    const codigo = texto(l.codigo)
    if (codigo === null) continue
    if (codigo === COD_PAX_1 || codigo === COD_PAX_2) continue
    const cantidad = numero(l.cantidad)
    if (cantidad === null || cantidad <= 0) continue
    const nombre = texto(l.nombre)
    if (nombre === null) return null            // sin catálogo: no se lista a medias
    const acc = por.get(codigo)
    if (acc) acc.cantidad += cantidad
    else por.set(codigo, { nombre, cantidad })
  }
  if (por.size === 0) return null
  return [...por.values()]
    .map((p) => ({ nombre: p.nombre, cantidad: Math.round(p.cantidad * 100) / 100 }))
    .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Fila de pedido abierto → entrada del snapshot.
 *
 * `clave` = `pedido:<NumeroPedido>`, la identidad estable dentro del local. El pax sale
 * SOLO de `Personas`: el artículo 677/678 vive en el detalle de la FACTURA, que todavía
 * no existe — por eso la alerta casi siempre va a decir `sin_pax` mientras la mesa esté
 * abierta, y eso es la verdad, no un bug.
 */
export function mapAbierta(f: FilaAbierta, lineas: readonly FilaLineaAbierta[] = []): OpenIngest | null {
  const id = texto(f.id_pedido)
  if (id === null) return null

  const naive = texto(f.fecha_hora)
  // Frente C: con líneas, el pax por artículo entra a `mapPax` igual que en el ticket.
  const est = estimarPedido(lineas, f.tipo)
  const pax = mapPax({ personas: f.personas, qty677: est.qty677, qty678: est.qty678 })

  return {
    clave:          `pedido:${id}`,
    numero_factura: null,
    id_pedido:      id,
    mesa:           texto(f.mesa),
    salonero_login: mapSalonero(f.usuario_registra),
    canal:          mapCanal(texto(f.tipo), texto(f.area)),
    pax:            pax.pax,
    pax_alerta:     pax.pax_alerta,
    updated_at:     naive === null ? null : conOffsetCR(naive),
    // Provisionales. Sin líneas (o sin poder leerlas) van en null: «sin total», nunca ₡0.
    monto_estimado_crc: est.monto_estimado_crc,
    pax_pedido:         est.pax_pedido,
    items_valor:        est.items_valor,
    // Informativo (mig 065). Mismas líneas que el estimado, otra pregunta: qué hay en la mesa.
    detalle_productos:  agruparProductos(lineas),
  }
}

export async function leerAbiertas(
  qy: Queryable,
  esq: Esquema,
  rango: RangoLectura,
): Promise<OpenIngest[]> {
  const params = { desde: rango.desde, hasta: rango.hasta }
  const { rows } = await qy.query<FilaAbierta>(sqlAbiertas(esq), params)

  // Frente C: las líneas se leen SOLO si la instalación lo permite; si no, cada mesa sale sin
  // monto ni pax, exactamente como hasta hoy. Se atan a su cabecera por la clave REAL.
  const porPedido = new Map<string, FilaLineaAbierta[]>()
  if (rows.length > 0 && puedeLeerLineasAbiertas(esq)) {
    const lineas = await qy.query<FilaLineaAbierta>(sqlLineasAbiertas(esq), params)
    for (const l of lineas.rows) {
      const k = claveLineas({ periodo: l.periodo, mes: l.mes, dia: l.dia, numero: l.numero_pedido })
      if (k === null) continue
      const lista = porPedido.get(k)
      if (lista) lista.push(l)
      else porPedido.set(k, [l])
    }
  }

  const out: OpenIngest[] = []
  for (const f of rows) {
    const k = claveLineas({ periodo: f.periodo, mes: f.mes, dia: f.dia, numero: f.id_pedido })
    const m = mapAbierta(f, k === null ? [] : porPedido.get(k) ?? [])
    if (m !== null) out.push(m)
  }
  return out
}

// ── El primer día con ventas (modo `--todo` del backfill) ──────────────────────

/**
 * `min(FechaRegistra)` de las facturas CERRADAS. Es de dónde arranca el barrido
 * histórico cuando no se le da un `--desde`.
 *
 * Devuelve la FECHA sola (sin hora): el backfill trabaja por día.
 */
export function sqlPrimerDia(esq: Esquema): string {
  const F = `${q('dbo')}.${q(esq.facturas.tabla)}`
  const cf = (campo: string) => q(col(esq, 'facturas', campo))
  return `SELECT CONVERT(varchar(10), MIN(f.${cf('fecha')}), 120) AS primer_dia
FROM ${F} f
WHERE f.${cf('estado')} = 'C'`
}

export async function primerDiaConVentas(qy: Queryable, esq: Esquema): Promise<string | null> {
  const { rows } = await qy.query<{ primer_dia: unknown }>(sqlPrimerDia(esq))
  return texto(rows[0]?.primer_dia)
}
