// ── Ventas v2 · Indicadores (SPEC-ventas-v2 §4; decisión D4 firmada el 17/11) ──────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Recibe facturas ya armadas y devuelve números.
// No redondea el resultado: se redondea al mostrar.
//
// ── VENTA POR PERSONA (D4) — UNA sola en toda la app ───────────────────────────────────────
//   venta por persona = neta de salón ÷ personas de salón
//   personas          = cargadas + estimadas
//   · cargadas  = artículo pax; si falta, `pax` del ticket (la regla de `paxDelTicket` y de la
//                 RPC 080; lo cuida una prueba de contrato).
//   · estimadas = solo para facturas de salón SIN pax. La v1 (`estimadorPorNeta`):
//                 max(1, round(neta de la factura ÷ referencia)), con referencia = venta por
//                 persona de las facturas de salón CON pax del mismo turno en la misma semana ISO;
//                 si no hay, el mismo turno en las 4 semanas ISO anteriores (juntas); si tampoco,
//                 no se estima y la factura queda «sin referencia».
//   La neta de TODAS las facturas de salón (con pax, estimadas y sin referencia) va al numerador:
//   la venta nunca cambia por la estimación, solo el denominador.
//   La v2 (por platos fuertes y bebidas, cuando exista el catálogo único D8) entra por la misma
//   interfaz `EstimadorPersonas`, sin tocar `ventaPorPersona`.
//
// ── DEFINICIONES QUE SE REUSAN (no se redefinen acá) ───────────────────────────────────────
// · Neta: `netaVenta.ts` (firmada). `facturasDesdePos` la arma con `netaPorTicket`.
// · Día: día CR de `fecha_registra`. Semana: ISO, lunes a domingo (`lunesDe`).
// · Turno: por la HORA CR de la factura, la de `ventasPromPaxExplicado.ts` y la RPC 080:
//   06–16 h mañana (mediodía), 17–23 h noche, 00–05 h madrugada = noche del mismo día.
// · Solo facturas cerradas (`estado = 'C'`) y de salón (`canal = 'salon'`).

import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import { netaPorTicket } from './netaVenta'
import { lunesDe, sumarDias, type Rango } from './periodosPromPax'
import { turnoDeFranja, type Franja, type TurnoPromPax } from './ventasPromPaxExplicado'

// ── Entrada ────────────────────────────────────────────────────────────────────────────────

/** Lo que el indicador necesita de una factura. `neta` ya viene de `netaVenta.ts`. */
export interface FacturaIndicador {
  id:             string
  /** Instante de la factura. Con zona (lo normal, timestamptz); sin zona se toma como hora CR. */
  fecha_registra: string
  /** Si viene, solo cuenta `'C'`. */
  estado?:        string | null
  canal:          string | null
  /** El salonero de la factura (lente «mesa»). `null` = sin pedido / caja / sistema. */
  salonero_login: string | null
  pax:            number | null
  pax_articulo:   number | null
  neta:           number
}

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const HORA_MS = 3_600_000
const CON_ZONA = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/** El instante, corrido a hora de pared CR (UTC−6 fijo). `NaN` si no se puede leer. */
function msParedCR(fecha: string): number {
  const iso = CON_ZONA.test(fecha.trim()) ? fecha.trim() : `${fecha.trim().replace(' ', 'T')}-06:00`
  return Date.parse(iso) - 6 * HORA_MS
}

/** Día CR (`YYYY-MM-DD`) de la factura. `''` si la fecha no se puede leer. */
export function diaCRDeFactura(fecha: string): string {
  const ms = msParedCR(fecha)
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0, 10)
}

/** Hora CR (0–23) de la factura. `-1` si la fecha no se puede leer. */
export function horaCRDeFactura(fecha: string): number {
  const ms = msParedCR(fecha)
  return Number.isNaN(ms) ? -1 : new Date(ms).getUTCHours()
}

/** La franja de la RPC 080 por hora CR: 06–16 mañana · 17–23 noche · 00–05 madrugada. */
export function franjaDeHora(h: number): Franja {
  if (h >= 6 && h <= 16) return 'mañana'
  if (h >= 17 && h <= 23) return 'noche'
  return 'madrugada'
}

/** Turno de la factura (madrugada = noche del mismo día, opción B del 06/11). */
export function turnoDeFactura(f: Pick<FacturaIndicador, 'fecha_registra'>): TurnoPromPax {
  return turnoDeFranja(franjaDeHora(horaCRDeFactura(f.fecha_registra)))
}

/** Personas CARGADAS: artículo pax si es > 0; si no, `pax` (null = 0). Igual que `paxDelTicket`. */
export function personasCargadas(f: Pick<FacturaIndicador, 'pax' | 'pax_articulo'>): number {
  const articulo = n(f.pax_articulo)
  return articulo > 0 ? articulo : n(f.pax)
}

/** ¿Entra al indicador? Cerrada (si trae estado) y de salón. */
export function esFacturaDeSalon(f: Pick<FacturaIndicador, 'estado' | 'canal'>): boolean {
  return (f.estado === undefined || f.estado === null || f.estado === 'C') && f.canal === 'salon'
}

function enRango(dia: string, r: Rango): boolean {
  return dia !== '' && dia >= r.desde && dia <= r.hasta
}

/** Arma las facturas del indicador desde las filas del PoS, con la neta firmada. */
export function facturasDesdePos(
  tickets: readonly Pick<TicketNdfConId,
    'id' | 'numero_factura' | 'estado' | 'fecha_registra' | 'canal' | 'salonero_login'
    | 'pax' | 'pax_articulo' | 'valor_servido_crc'>[],
  lineas: readonly Pick<LineaNdfRow, 'ticket_id' | 'familia' | 'monto' | 'codigo_producto'>[],
): FacturaIndicador[] {
  const neta = netaPorTicket(tickets, lineas)
  return tickets.map(t => ({
    id: t.id, fecha_registra: t.fecha_registra, estado: t.estado, canal: t.canal,
    salonero_login: t.salonero_login, pax: t.pax, pax_articulo: t.pax_articulo,
    neta: neta.get(t.id) ?? 0,
  }))
}

/**
 * Desde qué día hay que LEER facturas para estimar bien un rango: el lunes de la semana de
 * `desde` menos 4 semanas (la referencia de respaldo). El resultado del indicador usa solo `r`.
 */
export function rangoDeLecturaParaEstimar(r: Rango): Rango {
  return { desde: sumarDias(lunesDe(r.desde), -28), hasta: r.hasta }
}

// ── Estimación de personas (interfaz v1 → v2) ──────────────────────────────────────────────

/**
 * Estima las personas de UNA factura de salón sin pax. Devuelve un entero ≥ 1, o `null` si no hay
 * con qué estimar («sin referencia»). La v2 (platos fuertes y bebidas, D8) implementa esto mismo.
 */
export interface EstimadorPersonas {
  readonly id: string
  estimar(f: FacturaIndicador): number | null
}

/** Semanas ISO hacia atrás que mira la v1 cuando la semana de la factura no tiene referencia. */
export const SEMANAS_RESPALDO = 4

/**
 * v1: por neta. La referencia sale de `historial` (todas las facturas que se pasen, aunque estén
 * fuera del rango pedido): Σ neta ÷ Σ personas cargadas de las facturas de salón CON pax, por
 * (semana ISO, turno). Primero la misma semana; si no hay, las 4 anteriores juntas.
 */
export function estimadorPorNeta(historial: readonly FacturaIndicador[]): EstimadorPersonas {
  const acc = new Map<string, { neta: number; personas: number }>()
  for (const f of historial) {
    if (!esFacturaDeSalon(f)) continue
    const p = personasCargadas(f)
    if (p <= 0) continue
    const dia = diaCRDeFactura(f.fecha_registra)
    if (!dia) continue
    const k = `${lunesDe(dia)}|${turnoDeFactura(f)}`
    const e = acc.get(k) ?? { neta: 0, personas: 0 }
    e.neta += n(f.neta)
    e.personas += p
    acc.set(k, e)
  }
  const referencia = (lunes: string, turno: TurnoPromPax): number | null => {
    const e = acc.get(`${lunes}|${turno}`)
    if (e && e.personas > 0 && e.neta > 0) return e.neta / e.personas
    let neta = 0, personas = 0
    for (let i = 1; i <= SEMANAS_RESPALDO; i++) {
      const r = acc.get(`${sumarDias(lunes, -7 * i)}|${turno}`)
      if (r) { neta += r.neta; personas += r.personas }
    }
    return personas > 0 && neta > 0 ? neta / personas : null
  }
  return {
    id: 'v1-neta',
    estimar(f) {
      const dia = diaCRDeFactura(f.fecha_registra)
      if (!dia) return null
      const ref = referencia(lunesDe(dia), turnoDeFactura(f))
      if (ref === null) return null
      return Math.max(1, Math.round(n(f.neta) / ref))
    },
  }
}

// ── Venta por persona ──────────────────────────────────────────────────────────────────────

export interface VentaPorPersona {
  /** Neta de salón ÷ (cargadas + estimadas). `null` si no hay ninguna persona. */
  valor:                 number | null
  /** Rotulada: neta ÷ personas, solo facturas de salón CON pax (para comparar saloneros). */
  valorSoloConPax:       number | null
  /** Toda la neta de salón del rango: con pax, estimadas y sin referencia. */
  netaSalon:             number
  personasCargadas:      number
  personasEstimadas:     number
  /** Estimadas ÷ (cargadas + estimadas), 0–100. Para el rótulo «incluye X % estimado». */
  pctEstimado:           number
  facturasSalon:         number
  facturasSinPax:        number
  /** Facturas sin pax que no se pudieron estimar: su neta está en el numerador, sus personas no. */
  facturasSinReferencia: number
  netaSinReferencia:     number
  estimador:             string
}

export interface OpcionesVentaPorPersona {
  /** Por defecto, la v1 con todas las `facturas` recibidas como historial. */
  estimador?: EstimadorPersonas
  turno?:     TurnoPromPax
  /** Corte extra (salonero, día…). Se aplica después de salón + rango + turno. */
  filtro?:    (f: FacturaIndicador) => boolean
}

/**
 * LA venta por persona (D4). `facturas` puede traer días fuera de `r` (el historial para la
 * referencia, ver `rangoDeLecturaParaEstimar`); el resultado cuenta solo las de `r`.
 */
export function ventaPorPersona(
  facturas: readonly FacturaIndicador[],
  r: Rango,
  opciones: OpcionesVentaPorPersona = {},
): VentaPorPersona {
  const estimador = opciones.estimador ?? estimadorPorNeta(facturas)
  let netaSalon = 0, netaConPax = 0, cargadas = 0, estimadas = 0
  let facturasSalon = 0, sinPax = 0, sinRef = 0, netaSinRef = 0
  for (const f of facturas) {
    if (!esFacturaDeSalon(f)) continue
    if (!enRango(diaCRDeFactura(f.fecha_registra), r)) continue
    if (opciones.turno && turnoDeFactura(f) !== opciones.turno) continue
    if (opciones.filtro && !opciones.filtro(f)) continue
    const neta = n(f.neta)
    facturasSalon += 1
    netaSalon += neta
    const p = personasCargadas(f)
    if (p > 0) {
      cargadas += p
      netaConPax += neta
      continue
    }
    sinPax += 1
    const e = estimador.estimar(f)
    if (e === null) {
      sinRef += 1
      netaSinRef += neta
    } else {
      estimadas += e
    }
  }
  const personas = cargadas + estimadas
  return {
    valor:                 personas > 0 ? netaSalon / personas : null,
    valorSoloConPax:       cargadas > 0 ? netaConPax / cargadas : null,
    netaSalon,
    personasCargadas:      cargadas,
    personasEstimadas:     estimadas,
    pctEstimado:           personas > 0 ? (estimadas / personas) * 100 : 0,
    facturasSalon,
    facturasSinPax:        sinPax,
    facturasSinReferencia: sinRef,
    netaSinReferencia:     netaSinRef,
    estimador:             estimador.id,
  }
}

// ── Alerta de mesas sin pax ────────────────────────────────────────────────────────────────

export interface ConteoSinPax {
  facturasSalon: number
  sinPax:        number
  /** sinPax ÷ facturasSalon, 0–100 (0 sin facturas). */
  pct:           number
}

export interface AlertaMesasSinPax {
  /** Por `salonero_login` de la factura. Orden: más sin pax primero, después % y login. */
  porSalonero: (ConteoSinPax & { salonero_login: string })[]
  /** Facturas de salón sin salonero (sin pedido, caja o sistema): aparte, no se reparten. */
  sinSalonero: ConteoSinPax
  total:       ConteoSinPax
}

const conteo = (facturasSalon: number, sinPax: number): ConteoSinPax =>
  ({ facturasSalon, sinPax, pct: facturasSalon > 0 ? (sinPax / facturasSalon) * 100 : 0 })

/** Para un rango (normalmente ayer), cuántas facturas de salón quedaron sin pax, por salonero. */
export function alertaMesasSinPax(facturas: readonly FacturaIndicador[], r: Rango): AlertaMesasSinPax {
  const por = new Map<string, { t: number; s: number }>()
  let tSin = 0, sSin = 0, tTot = 0, sTot = 0
  for (const f of facturas) {
    if (!esFacturaDeSalon(f)) continue
    if (!enRango(diaCRDeFactura(f.fecha_registra), r)) continue
    const falta = personasCargadas(f) <= 0 ? 1 : 0
    tTot += 1
    sTot += falta
    const login = f.salonero_login
    if (login === null || login === '') {
      tSin += 1
      sSin += falta
      continue
    }
    const e = por.get(login) ?? { t: 0, s: 0 }
    e.t += 1
    e.s += falta
    por.set(login, e)
  }
  const porSalonero = [...por.entries()]
    .map(([salonero_login, e]) => ({ salonero_login, ...conteo(e.t, e.s) }))
    .sort((a, b) => b.sinPax - a.sinPax || b.pct - a.pct || a.salonero_login.localeCompare(b.salonero_login))
  return { porSalonero, sinSalonero: conteo(tSin, sSin), total: conteo(tTot, sTot) }
}

/** El rango de un solo día: ayer respecto de `hoy` (día CR, de `todayCR()`). */
export function rangoAyer(hoy: string): Rango {
  const ayer = sumarDias(hoy, -1)
  return { desde: ayer, hasta: ayer }
}
