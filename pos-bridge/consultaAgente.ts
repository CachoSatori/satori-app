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
  HASTA,
  sqlDetalle,
  sqlFacturas,
  type FilaDetalle,
  type FilaFactura,
  type Queryable,
} from './consulta.ts'
import { col, colOpt, q, type Esquema } from './esquema.ts'
import type { RangoLectura } from './ventana.ts'

export interface ParametrosLectura extends RangoLectura {
  /** El cursor: `null` = primera corrida, se lee toda la ventana. */
  ultima: string | null
}

/** Un ticket listo para el Edge: el `TicketMapeado` de la Fase 1a con lo que la base pide. */
export function aTicketIngest(
  t: TicketMapeado,
  extra: { mesa?: unknown; numero_pedido?: unknown } = {},
): TicketIngest {
  return {
    ...t,
    // El PoS guarda hora de pared de Costa Rica; acá se le pone el offset explícito.
    // El Edge RECHAZA cualquier instante sin zona (el desfase de 1 h de BioTime).
    fecha_registra: conOffsetCR(`${t.fecha} ${t.hora}`),
    mesa:           texto(extra.mesa),
    numero_pedido:  texto(extra.numero_pedido),
  }
}

/** Las facturas cerradas nuevas de la ventana, ya mapeadas y listas para mandar. */
export async function leerCerradas(
  qy: Queryable,
  esq: Esquema,
  p: ParametrosLectura,
): Promise<{ tickets: TicketIngest[]; avisos: string[] }> {
  const params = { desde: p.desde, hasta: p.hasta, ultima: p.ultima }

  const facturas = await qy.query<FilaFactura>(sqlFacturas(esq, true), params)
  const detalle  = await qy.query<FilaDetalle>(sqlDetalle(esq, true), params)

  const { tickets, avisos } = armarTickets(facturas.rows, detalle.rows)

  // `mesa` y `numero_pedido` no son del dominio del mapper (no cambian ni un monto):
  // salen del SELECT y se pegan acá, indexados por el número de factura como STRING.
  const extras = new Map<string, { mesa?: unknown; numero_pedido?: unknown }>()
  for (const f of facturas.rows) {
    extras.set(String(f.numero_factura), { mesa: f.mesa, numero_pedido: f.numero_pedido })
  }

  return {
    tickets: tickets.map((t) => aTicketIngest(t, extras.get(t.numero_factura) ?? {})),
    avisos,
  }
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
 * ¿Se puede leer el snapshot en esta instalación? Necesita el número de pedido, que es
 * la CLAVE de la mesa abierta. Sin él no hay identidad estable y el snapshot no cierra:
 * mejor no mandarlo (el Edge no toca `pos_ndf_open` si `open` viene ausente).
 */
export function puedeLeerAbiertas(esq: Esquema): boolean {
  return colOpt(esq, 'pedidos', 'numeropedido') !== null
}

/**
 * Los pedidos SIN factura = lo que está abierto ahora.
 *
 * Se acota por fecha cuando la columna existe: sin ese filtro, un `NumeroFactura IS NULL`
 * escanea `FAC_Pedidos` entero (24.054 filas y creciendo) en cada poll.
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
WHERE p.${cp('numerofactura')} IS NULL${
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
