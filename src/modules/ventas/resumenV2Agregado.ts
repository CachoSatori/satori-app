// ── Ventas v2 · «Resumen»: lo que devuelve `pos_ventas_resumen` (mig 190) — PURO ────────────
//
// La función de la base resume, por tramo, lo mismo que la app armaba desde las facturas y las
// líneas de la 067, sin bajar las líneas:
//   · `dias`     → por día CR de factura: neta, IVA, servicio y delivery en CÉNTIMOS crudos, PAX y
//                  facturas. El día se arma acá con `getDayStats` (un redondeo por día), el MISMO
//                  que usa Contabilidad: la regla del redondeo sigue viviendo en un solo lugar.
//   · `facturas` → las de salón, con lo que la venta por persona D4 necesita (neta, pax, parte de
//                  dueños, total, caja y cierre). «Mesa de dueños» la decide `esMesaDeDuenos`.
//   · `lotes`    → (caja, cierre, apertura) de TODAS las facturas del tramo. Entran como facturas
//                  «ancla» (sin canal, neta 0): no son de salón, así que no suman en ningún lado,
//                  pero hacen que `agruparEnLotes` vea la misma apertura de cada sesión de caja que
//                  con todas las facturas, y el día y el turno D4 salen iguales.
// La prueba de paridad del PR compara esto contra el camino de filas con datos reales de prod.

import type { CajeroDay, ContabilidadDay } from '../../shared/types/ventas'
import type { FacturaIndicador } from './indicadores'
import { getDayStats } from './ventasUtils'

/** Un día de la función: céntimos crudos (Σ por factura de round(₡ × 100)), PAX y facturas. */
export interface DiaAgregado {
  dia:          string
  netaCts:      number
  ivaCts:       number
  servCts:      number
  deliveryCts:  number
  pax:          number
  facturas:     number
}

/** Lo que devuelve la función para UN tramo, ya leído. */
export interface ParteAgregada {
  dias:     DiaAgregado[]
  /** Facturas de salón (en orden fecha_registra, id) seguidas de nada: las anclas van aparte. */
  facturas: FacturaIndicador[]
  /** Anclas de lote: una por (caja, cierre), con la apertura como `fecha_registra`. */
  anclas:   FacturaIndicador[]
}

type Crudo = unknown[]

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0)
const numONull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** El jsonb de `pos_ventas_resumen` → una parte. Tira si la forma no es la esperada. */
export function parsearResumenAgregado(json: unknown): ParteAgregada {
  const o = json as { dias?: Crudo[]; facturas?: Crudo[]; lotes?: Crudo[] } | null
  if (!o || !Array.isArray(o.dias) || !Array.isArray(o.facturas) || !Array.isArray(o.lotes)) {
    throw new Error('pos_ventas_resumen: respuesta con forma inesperada')
  }
  const dias = o.dias.map(([dia, neta, iva, serv, delivery, pax, facturas]) => ({
    dia: String(dia), netaCts: num(neta), ivaCts: num(iva), servCts: num(serv),
    deliveryCts: num(delivery), pax: num(pax), facturas: num(facturas),
  }))
  const facturas: FacturaIndicador[] = o.facturas.map(
    ([id, fecha, salonero, pax, paxArt, neta, netaDuenos, total, cajero, cierra]) => ({
      id: String(id), fecha_registra: String(fecha), estado: 'C', canal: 'salon',
      salonero_login: txt(salonero), pax: numONull(pax), pax_articulo: numONull(paxArt),
      neta: num(neta), cajero_login: txt(cajero), fecha_cierra: txt(cierra), total_crc: numONull(total),
      // La 067 tampoco trae `clase_ingreso`: con `neta_duenos` presente no hace falta (`esMesaDeDuenos`).
      clase_ingreso: null,
      ...(netaDuenos === null || netaDuenos === undefined ? {} : { neta_duenos: num(netaDuenos) }),
    }))
  const anclas: FacturaIndicador[] = o.lotes.map(([cajero, cierra, apertura], i) => ({
    id: `lote:${i}:${txt(cajero) ?? ''}:${txt(cierra) ?? ''}`, fecha_registra: String(apertura),
    estado: 'C', canal: null, salonero_login: null, pax: null, pax_articulo: null, neta: 0,
    cajero_login: txt(cajero), fecha_cierra: txt(cierra), total_crc: null, clase_ingreso: null,
  }))
  return { dias, facturas, anclas }
}

/**
 * Junta los tramos: días sin repetir (un tramo trae solo sus días: no se pisan), facturas sin
 * repetir (la ventana de un tramo se estira un día antes y dos después) en el orden en que llegan,
 * y las anclas de todos los tramos al PRINCIPIO, por apertura: la primera de cada lote es la de su
 * factura más vieja, la misma que tendría `agruparEnLotes` con todas las facturas.
 */
export function juntarAgregados(partes: readonly ParteAgregada[]): {
  dias: Map<string, DiaAgregado>
  facturas: FacturaIndicador[]
} {
  const dias = new Map<string, DiaAgregado>()
  const vistas = new Set<string>()
  const salon: FacturaIndicador[] = []
  const anclas: FacturaIndicador[] = []
  for (const p of partes) {
    for (const d of p.dias) if (!dias.has(d.dia)) dias.set(d.dia, d)
    for (const f of p.facturas) if (!vistas.has(f.id)) { vistas.add(f.id); salon.push(f) }
    anclas.push(...p.anclas)
  }
  const ms = (f: FacturaIndicador) => Date.parse(f.fecha_registra)
  anclas.sort((a, b) => ms(a) - ms(b))
  return { dias, facturas: [...anclas, ...salon] }
}

/**
 * Un día de la función → la fila de «Detalle por día», por `getDayStats`: un balde con los
 * céntimos crudos del día entero, así el redondeo es el mismo (uno por día) que con todos los baldes.
 */
export function contabilidadDayDeAgregado(d: DiaAgregado): ContabilidadDay {
  const balde: CajeroDay = {
    esCajero: true, pax: d.pax,
    total: d.netaCts / 100, delivery: d.deliveryCts / 100, salon: (d.netaCts - d.deliveryCts) / 100,
    iva: d.ivaCts / 100, serv: d.servCts / 100, ordenes: d.facturas, ticketProm: 0, prods: [],
    crudoCts: { neta: d.netaCts, iva: d.ivaCts, serv: d.servCts, delivery: d.deliveryCts },
  }
  const s = getDayStats({ fileName: `pos ${d.dia}`, uploadedAt: d.dia, saloneros: { '(día)': balde } })
  return {
    fecha: d.dia, ventaBruta: s.ventaBruta, ventaNeta: s.ventaNeta, iva: s.iva, serv: s.serv,
    salon: s.salon, delivery: s.delivery, pax: s.pax, promPax: s.promPax,
  }
}
