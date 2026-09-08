// ── Types for SATORI VENTAS / DASHBOARD module ────────────────

export interface SaloneroDay {
  pax:         number
  total:       number
  com:         number
  beb:         number
  iCom:        number
  iBeb:        number
  iva:         number
  serv:        number
  promPax:     number
  promPlato:   number
  promBebida:  number
  ratioCB:     number
  ratioU:      number
  bebPax:      number
  prods:       [string, number, number][]  // [nombre, qty, monto]
}

export interface CajeroDay {
  esCajero:   true
  /**
   * Comensales de los tickets que cayeron en este bucket.
   *
   * OPCIONAL porque solo la fuente PoS lo llena: el `xlsParser` nunca calculó el pax de un
   * bucket de caja, así que sus días quedan exactamente como estaban (`?? 0`).
   *
   * Existe porque en el PoS hay tickets de SALÓN registrados bajo un login de caja
   * (`111`/`222`/`388`). Su plata siempre contó en el total del día; su pax se descartaba, y
   * eso hacía que el PAX del PoS saliera ~9% por debajo del xls en la Paridad aunque el crudo
   * (`pos_ndf_tickets.pax_articulo`) diera exactamente lo mismo.
   */
  pax?:       number
  total:      number
  salon:      number
  delivery:   number
  iva:        number
  serv:       number
  ordenes:    number
  ticketProm: number
  prods:      [string, number, number][]
}

export interface DiaData {
  fileName:   string
  uploadedAt: string
  saloneros:  Record<string, SaloneroDay | CajeroDay>
}

export type DiasMap = Record<string, DiaData>

export interface HistDay {
  ventaBruta: number
  ventaNeta:  number
  iva:        number
  serv:       number
  salon:      number
  delivery:   number
  pax:        number
  promPax:    number
  source:     'hist'
}

export type HistMap = Record<string, HistDay>

export interface ProductInfo {
  tipo:             string  // 'comida'|'bebida'|'cortesia'|'personal'|'nofood'|'desconocido'
  clasificacion:    string
  subclasificacion: string
  multiplicador:    number
  costo_unitario:   number  // costo de insumos por unidad vendida (food cost)
}

export type ProductMap = Record<string, ProductInfo>

export interface Meta {
  restaurante: Record<string, number>    // "YYYY-MM" → meta ₡
  margen:      Record<string, number>    // "YYYY-MM" → %
  global: {
    promPax:    number
    bebPax:     number
    ratioCB:    number
    ticketItem: number
    ventas:     number
  }
  salMetas: Record<string, {
    promPax?:    number
    bebPax?:     number
    ratioCB?:    number
    ticketItem?: number
    ventas?:     number
  }>
}

export interface Comp {
  id:     string
  nombre: string
  tipo:   'semanal' | 'mensual' | 'especial'
  inicio: string
  fin:    string
  premio: string
  prods:  { name: string; pts: number }[]
  parts:  string[]
}

// ── Aggregated results ────────────────────────────────────────

export interface AggSalonero {
  nombre:      string
  days:        number
  total:       number
  com:         number
  beb:         number
  pax:         number
  iCom:        number
  iBeb:        number
  promPax:     number
  promPlato:   number
  promBebida:  number
  ratioCB:     number
  ratioU:      number
  bebPax:      number
  promTicket:  number
  prods:       Record<string, { q: number; m: number }>
}

export interface AggGeneral {
  total:       number
  cajTotal:    number
  cajDelivery: number
  cajSalon:    number
  totalRest:   number
  salon:       number
  /** Comensales de TODO el día: los de los meseros MÁS los de los buckets de caja. */
  pax:         number
  /**
   * Solo los comensales de los MESEROS. Es el denominador de `promPax` y `bebPax`.
   *
   * No es lo mismo que `pax` a propósito: esos dos ratios son el BENCHMARK contra el que se
   * compara a un mesero (`aggSalonero`), y el numerador de los dos —`total`, `iBeb`— es de
   * meseros. Meter el pax de caja abajo y dejar la plata de caja afuera arriba desinflaría el
   * benchmark y movería las evaluaciones. `pax` sirve para "cuánta gente vino"; estos dos, para
   * "cómo vende un mesero".
   */
  paxSaloneros: number
  promPax:     number
  iCom:        number
  iBeb:        number
  ratioCB:     number
  ratioU:      number
  bebPax:      number
  promTicket:  number
  cortTotal:   number
  persTotal:   number
  prods:       Record<string, { q: number; m: number }>
}

export interface AggCajero {
  nombre:     string
  days:       number
  total:      number
  salon:      number
  delivery:   number
  ordenes:    number
  ticketProm: number
  prods:      Record<string, { q: number; m: number }>
}

export interface ContabilidadDay {
  fecha:      string
  ventaBruta: number
  ventaNeta:  number
  iva:        number
  serv:       number
  salon:      number
  delivery:   number
  pax:        number
  promPax:    number
}
