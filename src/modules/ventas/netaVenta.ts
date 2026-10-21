// ── La VENTA NETA del día, desde las líneas del PoS ────────────────────────────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Define qué plata de una factura es VENTA REAL,
// que es lo que tiene que cuadrar contra la "Venta Neta" del reporte del PoS.
//
// ── DOS MEDIDAS, NO UNA ────────────────────────────────────────────────────────────────────
//   · NETA (esto)          → Σ `pos_ndf_ticket_lines.monto` de TODAS las líneas menos las de
//                            `FAMILIAS_NO_VENTA`. Es la venta del día: la de Contabilidad, el
//                            export `satori_ventas_*`, el total de Hoy y de «En vivo».
//   · VALOR SERVIDO        → `pos_ndf_tickets.valor_servido_crc`, la whitelist angosta
//                            `FAMILIAS_VALOR_SERVIDO` (comida + bebida). Queda IGUAL: es la base
//                            del mix, del ratio comida/bebida y de la analítica por PAX.
// La diferencia entre las dos es real y medida (oct-2026: merch 21 y BOXING 19 = ₡122.703 en
// 19 días). No se recalcula `valor_servido_crc` ni se toca el agente: la neta se arma acá, en
// la app, con las líneas que la ingesta ya guarda completas (toda familia, con su monto).
//
// Firmado por el dueño (Ismael): fuera de la venta solo PERSONAL (6), X CORTESIAS (17) e
// Ingredientes (20). Todo lo demás cuenta — gift cards 12, dueños 28 (SIPP), BOXING 19, merch
// 21/23/24/26/27, 11, 15, 22, 25 — y también la línea sin familia o con una familia que el
// catálogo no conoce, que además se AVISA para poder cazar el hueco.

import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'

/** Las ÚNICAS familias cuya plata no es venta: 6 PERSONAL · 17 X CORTESIAS · 20 Ingredientes. */
export const FAMILIAS_NO_VENTA = [6, 17, 20] as const

/**
 * Las familias que el catálogo del PoS (`FAC_Clasificaciones`) tiene identificadas hoy. Solo
 * sirve para AVISAR: una línea con plata fuera de esta lista cuenta igual en la neta.
 */
export const FAMILIAS_CATALOGO: readonly number[] = [
  1, 2, 3, 4, 5, 6, 9, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
]

/**
 * Lo mínimo que hace falta de una línea. Estructural a propósito: sirve la fila de
 * `pos_ndf_ticket_lines` y también la `LineaLente` de las lentes de saloneros.
 */
export type LineaNeta = Pick<LineaNdfRow, 'familia' | 'monto' | 'codigo_producto'> & { nombre?: string | null }

/** Lo mínimo de una factura. `numero_factura` solo sirve para rotular los avisos. */
export type TicketNeta = Pick<TicketNdfConId, 'valor_servido_crc'> & { numero_factura?: string }

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** ¿La plata de esta línea es venta? `null` (sin familia) también: se cuenta y se avisa. */
export function esLineaDeVenta(familia: number | null | undefined): boolean {
  return familia === null || familia === undefined
    || !(FAMILIAS_NO_VENTA as readonly number[]).includes(familia)
}

/** Algo del catálogo que conviene mirar. La plata YA cuenta en la neta; esto no la cambia. */
export interface AvisoCatalogo {
  tipo:           'sin_familia' | 'familia_desconocida' | 'sin_lineas'
  numero_factura: string
  codigo:         string | null
  nombre:         string | null
  familia:        number | null
  monto:          number
}

/**
 * La neta de UN ticket: Σ `monto` de sus líneas de venta.
 *
 * Un ticket sin ninguna línea guardada cae a `valor_servido_crc` (que el agente calcula de las
 * MISMAS líneas, así que en ese caso también sería 0 o el dato del puente) y se avisa: es un
 * hueco de ingesta, no un ticket sin venta.
 */
export function netaDelTicket(
  t: TicketNeta,
  lineas: readonly LineaNeta[] | undefined,
  avisos?: AvisoCatalogo[],
): number {
  if (!lineas || lineas.length === 0) {
    const vs = n(t.valor_servido_crc)
    if (avisos && vs !== 0) {
      avisos.push({ tipo: 'sin_lineas', numero_factura: t.numero_factura ?? '?', codigo: null, nombre: null, familia: null, monto: vs })
    }
    return vs
  }
  let neta = 0
  for (const l of lineas) {
    if (!esLineaDeVenta(l.familia)) continue
    const monto = n(l.monto)
    neta += monto
    if (!avisos || monto === 0) continue
    const tipo = l.familia === null || l.familia === undefined ? 'sin_familia'
      : FAMILIAS_CATALOGO.includes(l.familia) ? null
      : 'familia_desconocida'
    if (tipo) {
      avisos.push({
        tipo, numero_factura: t.numero_factura ?? '?',
        codigo: l.codigo_producto, nombre: l.nombre ?? null, familia: l.familia ?? null, monto,
      })
    }
  }
  return neta
}

/**
 * La neta de cada ticket, indexada por `id`. Para los paneles de «En vivo» que suman por
 * ticket (turnos, ritmo por hora) y tienen que dar lo MISMO que el total de `armarDia`.
 */
export function netaPorTicket(
  tickets: readonly (TicketNeta & { id: string })[],
  lineas: readonly (LineaNeta & { ticket_id: string })[],
): Map<string, number> {
  const porTicket = new Map<string, LineaNeta[]>()
  for (const l of lineas) {
    const lista = porTicket.get(l.ticket_id)
    if (lista) lista.push(l)
    else porTicket.set(l.ticket_id, [l])
  }
  const out = new Map<string, number>()
  for (const t of tickets) out.set(t.id, netaDelTicket(t, porTicket.get(t.id)))
  return out
}

/** Resumen de una línea para el log: cuántos avisos de cada tipo y cuánta plata tocan. */
export function resumirAvisos(avisos: readonly AvisoCatalogo[]): string {
  const acc = new Map<string, { n: number; monto: number; ejemplos: Set<string> }>()
  for (const a of avisos) {
    const e = acc.get(a.tipo) ?? { n: 0, monto: 0, ejemplos: new Set<string>() }
    e.n += 1
    e.monto += a.monto
    if (e.ejemplos.size < 3) e.ejemplos.add(a.nombre ?? a.codigo ?? `factura ${a.numero_factura}`)
    acc.set(a.tipo, e)
  }
  return [...acc.entries()]
    .map(([tipo, e]) => `${tipo}: ${e.n} (₡${Math.round(e.monto)}; ej. ${[...e.ejemplos].join(', ')})`)
    .join(' · ')
}
