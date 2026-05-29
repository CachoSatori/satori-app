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
  tipo:           string  // 'comida'|'bebida'|'cortesia'|'personal'|'nofood'|'desconocido'
  clasificacion:  string
  subclasificacion: string
  multiplicador:  number
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
  pax:         number
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
