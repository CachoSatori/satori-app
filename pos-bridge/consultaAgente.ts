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
  mapCanal,
  mapPax,
  mapSalonero,
  texto,
  type TicketMapeado,
} from '../src/shared/ndf/mapTicket.ts'
import { conOffsetCR, type OpenIngest, type TicketIngest } from '../src/shared/ndf/ingestNdf.ts'

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
  ${fecha ? `CONVERT(varchar(19), p.${q(fecha)}, 120)` : 'NULL'} AS fecha_hora
FROM ${P} p
WHERE p.${cp('numerofactura')} IS NULL
  AND p.${cp('estado')} = '${ESTADO_PEDIDO_ABIERTO}'${
  fecha ? `\n  AND p.${q(fecha)} >= ${DESDE} AND p.${q(fecha)} < ${HASTA}` : ''
}
ORDER BY p.${q(col(esq, 'pedidos', 'numeropedido'))}`
}

/**
 * Fila de pedido abierto → entrada del snapshot.
 *
 * `clave` = `pedido:<NumeroPedido>`, la identidad estable dentro del local. El pax sale
 * SOLO de `Personas`: el artículo 677/678 vive en el detalle de la FACTURA, que todavía
 * no existe — por eso la alerta casi siempre va a decir `sin_pax` mientras la mesa esté
 * abierta, y eso es la verdad, no un bug.
 */
export function mapAbierta(f: FilaAbierta): OpenIngest | null {
  const id = texto(f.id_pedido)
  if (id === null) return null

  const naive = texto(f.fecha_hora)
  const pax = mapPax({ personas: f.personas })

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
  }
}

export async function leerAbiertas(
  qy: Queryable,
  esq: Esquema,
  rango: RangoLectura,
): Promise<OpenIngest[]> {
  const { rows } = await qy.query<FilaAbierta>(sqlAbiertas(esq), { desde: rango.desde, hasta: rango.hasta })
  const out: OpenIngest[] = []
  for (const f of rows) {
    const m = mapAbierta(f)
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
