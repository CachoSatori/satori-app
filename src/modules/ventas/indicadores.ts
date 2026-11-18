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
// · Solo facturas cerradas (`estado = 'C'`) y de salón (`canal = 'salon'`).
//
// ── TURNO Y DÍA = LA SESIÓN DE CAJA (decisión del dueño, 17/11 ~10:45) ─────────────────────
// No se mira el reloj de la factura: manda la caja que estaba abierta. Se usa la definición
// compartida de `shared/ndf/jornada.ts`:
//   · turno   = la caja del lote (`cajero_login`: 111 → mañana · 222 → noche).
//   · día     = la jornada del lote (`cajero_login`, `fecha_cierra`) = día CR de su apertura.
//     Una factura de 00:30 cobrada por la caja de la noche es noche del día ANTERIOR.
//     Lote todavía ABIERTO (sin `fecha_cierra`, solo en vivo): jornada.ts lo agrupa por día CR
//     de la venta; acá, si es la caja de la noche y la hora CR es < 07:00, se pasa al día anterior.
//   · Si la caja no es 111/222 (o falta), se cae al criterio de hora (franja de la RPC 080:
//     06–16 mañana · 17–23 noche · 00–05 noche del mismo día) y la factura cuenta como
//     «turno inferido». La columna `pos_ndf_tickets.turno` NO se usa: para un cajero que no es
//     111/222 la ingesta la deriva del reloj (`mapTurno`, mapTicket.ts), así que no agrega nada.
//
// ── FUERA DE LA VENTA POR PERSONA (decisiones del dueño, 17/11) ────────────────────────────
// Dos tipos de factura de salón salen del indicador ENTERAS (numerador Y denominador), de la
// referencia del estimador y de la alerta de mesas sin pax, y se cuentan aparte:
//   · Mesas de dueños («no tienen que tener pax ni contabilizarse en el prom/pax»): `esMesaDeDuenos`.
//   · Regalías totales (total 0): `esRegaliaTotal`.
//   · Mesas internas (decisión del dueño 18-nov: 51, 52 y 53 en santa-teresa; configurable en Ajustes):
//     `interna` en la factura. También salen de la referencia del estimador.
// Siguen sumando en la venta total del local: `netaVenta.ts` (firmada) no cambia.

import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import { jornadaPorTicket } from '../../shared/ndf/jornada'
import { netaPorTicket } from './netaVenta'

/** Familia del PoS de los consumos de dueños (`FAMILIA_DUENOS` de mapTicket; contrato en la prueba). */
export const FAMILIA_DUENOS = 28
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
  /** La caja que cobró (`FAC_Facturas.Login`). Define el turno. */
  cajero_login?:  string | null
  /** Cierre de caja (con zona). Junto con el cajero forma el lote, que define el día. */
  fecha_cierra?:  string | null
  /** Total cobrado. Para reconocer una regalía total. */
  total_crc?:     number | null
  /** `cobrada | cortesia | duenos | sin_cobro | descuento | mixta` (mapClaseIngreso). */
  clase_ingreso?: string | null
  /** Parte de `neta` de la familia 28 (dueños). Si falta, se decide por `clase_ingreso`. */
  neta_duenos?:   number
  /**
   * Factura de una MESA INTERNA del local (decisión del dueño 18-nov: 51, 52 y 53 en santa-teresa; lista en
   * Ajustes → «Mesas internas», tabla `pos_mesas_internas`). La marca la lectura (`pos_ventas_internas`).
   * Sale ENTERA de los indicadores de venta real; sigue en Contabilidad (tiene IVA: es venta fiscal).
   */
  interna?:       boolean
}

/** Dónde cae una factura: día y turno de su sesión de caja. */
export interface Ubicacion {
  dia:      string
  turno:    TurnoPromPax
  /** `true` = no había caja 111/222: día y turno salieron del reloj. */
  inferido: boolean
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

/** Turno por el RELOJ (solo el respaldo «inferido»): madrugada = noche del mismo día. */
export function turnoPorHora(f: Pick<FacturaIndicador, 'fecha_registra'>): TurnoPromPax {
  return turnoDeFranja(franjaDeHora(horaCRDeFactura(f.fecha_registra)))
}

/** Hora CR antes de la cual una venta de la caja de noche ABIERTA es de la jornada anterior. */
export const HORA_FIN_NOCHE = 7

/** Turno de jornada.ts (`manana`/`tarde`) → turno del indicador. Otro valor → `null`. */
function turnoDeCaja(t: string | null): TurnoPromPax | null {
  if (t === 'manana') return 'mañana'
  if (t === 'tarde') return 'noche'
  return null
}

/**
 * Día y turno de cada factura por su sesión de caja (ver cabecera). Necesita TODAS las facturas
 * juntas: la jornada es del lote, no de la factura suelta. Las que no tienen fecha legible no salen.
 */
export function ubicarFacturas(facturas: readonly FacturaIndicador[]): Map<FacturaIndicador, Ubicacion> {
  const out = new Map<FacturaIndicador, Ubicacion>()
  const lotes = jornadaPorTicket(facturas)
  for (const f of facturas) {
    const diaReloj = diaCRDeFactura(f.fecha_registra)
    if (!diaReloj) continue
    const l = lotes.get(f)
    const turno = turnoDeCaja(l?.turno ?? null)
    if (!l || !turno || !l.jornada) {
      out.set(f, { dia: diaReloj, turno: turnoPorHora(f), inferido: true })
      continue
    }
    let dia = l.jornada
    if (l.lote.abierto && turno === 'noche' && horaCRDeFactura(f.fecha_registra) < HORA_FIN_NOCHE) {
      dia = sumarDias(diaReloj, -1)
    }
    out.set(f, { dia, turno, inferido: false })
  }
  return out
}

/** Ubicación de UNA factura suelta (lote de una sola). Para pruebas y consultas puntuales. */
export function ubicarFactura(f: FacturaIndicador): Ubicacion | null {
  return ubicarFacturas([f]).get(f) ?? null
}

/**
 * ¿Mesa de DUEÑOS? Criterio:
 *   · Con las líneas (`neta_duenos` presente, lo arma `facturasDesdePos`): la familia 28 es MÁS
 *     de la mitad de la neta de la factura. Una cuenta cobrada con una línea de dueños es una
 *     mesa normal (mismo criterio que la cortesía parcial).
 *   · Sin líneas: `clase_ingreso = 'duenos'` (`mapClaseIngreso` la pone cuando hay familia 28 y
 *     ninguna otra condición; una `mixta` sin líneas no se puede saber y queda como mesa normal).
 */
export function esMesaDeDuenos(f: Pick<FacturaIndicador, 'clase_ingreso' | 'neta' | 'neta_duenos'>): boolean {
  if (typeof f.neta_duenos === 'number') return f.neta_duenos > 0 && f.neta_duenos * 2 > n(f.neta)
  return f.clase_ingreso === 'duenos'
}

/** ¿Sale ENTERA de la venta por persona y de la alerta? Mesa interna, mesa de dueños o regalía total. */
export function quedaFueraDelIndicador(
  f: Pick<FacturaIndicador, 'clase_ingreso' | 'neta' | 'neta_duenos' | 'total_crc' | 'interna'>,
): 'interna' | 'duenos' | 'regalia' | null {
  if (f.interna) return 'interna'
  if (esMesaDeDuenos(f)) return 'duenos'
  if (esRegaliaTotal(f)) return 'regalia'
  return null
}

/** Clases de ingreso que, con el total en 0, son regalo completo. */
export const CLASES_REGALIA_TOTAL = ['cortesia', 'duenos', 'sin_cobro'] as const

/**
 * ¿Regalada COMPLETA? `sin_cobro` siempre (por definición el total es 0). `cortesia` o `duenos`
 * solo con el total en 0: `mapClaseIngreso` marca `cortesia` aunque sea UNA línea de cortesía en
 * una cuenta cobrada, y esa mesa sí cuenta. Sin clase (la RPC 067 no la trae): neta 0 y total 0.
 */
export function esRegaliaTotal(f: Pick<FacturaIndicador, 'clase_ingreso' | 'total_crc' | 'neta'>): boolean {
  if (f.clase_ingreso === 'sin_cobro') return true
  const sinCobrar = typeof f.total_crc === 'number' && f.total_crc <= 0
  if (!sinCobrar) return false
  return (CLASES_REGALIA_TOTAL as readonly string[]).includes(f.clase_ingreso ?? '') || n(f.neta) === 0
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

/** Lo que hace falta de una fila de `pos_ndf_tickets` (la RPC 067 no trae `clase_ingreso`). */
export type TicketParaIndicador = Pick<TicketNdfConId,
  | 'id' | 'numero_factura' | 'estado' | 'fecha_registra' | 'canal' | 'salonero_login'
  | 'pax' | 'pax_articulo' | 'valor_servido_crc' | 'cajero_login' | 'fecha_cierra' | 'total_crc'>
  & { clase_ingreso?: string | null }

/** Arma las facturas del indicador desde las filas del PoS, con la neta firmada. */
export function facturasDesdePos(
  tickets: readonly TicketParaIndicador[],
  lineas: readonly Pick<LineaNdfRow, 'ticket_id' | 'familia' | 'monto' | 'codigo_producto'>[],
): FacturaIndicador[] {
  const neta = netaPorTicket(tickets, lineas)
  const duenos = new Map<string, number>()
  const conLineas = new Set<string>()
  for (const l of lineas) {
    conLineas.add(l.ticket_id)
    if (l.familia === FAMILIA_DUENOS) duenos.set(l.ticket_id, (duenos.get(l.ticket_id) ?? 0) + n(l.monto))
  }
  return tickets.map(t => ({
    id: t.id, fecha_registra: t.fecha_registra, estado: t.estado, canal: t.canal,
    salonero_login: t.salonero_login, pax: t.pax, pax_articulo: t.pax_articulo,
    neta: neta.get(t.id) ?? 0,
    cajero_login: t.cajero_login, fecha_cierra: t.fecha_cierra, total_crc: t.total_crc,
    clase_ingreso: t.clase_ingreso ?? null,
    ...(conLineas.has(t.id) ? { neta_duenos: duenos.get(t.id) ?? 0 } : {}),
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
 * Estima las personas de UNA factura de salón sin pax, ya ubicada (día y turno de su caja).
 * Devuelve un entero ≥ 1, o `null` si no hay con qué estimar («sin referencia»).
 * La v2 (platos fuertes y bebidas, D8) implementa esto mismo.
 */
export interface EstimadorPersonas {
  readonly id: string
  estimar(f: FacturaIndicador, u: Ubicacion): number | null
}

/** Semanas ISO hacia atrás que mira la v1 cuando la semana de la factura no tiene referencia. */
export const SEMANAS_RESPALDO = 4

/**
 * v1: por neta. La referencia sale de `historial` (todas las facturas que se pasen, aunque estén
 * fuera del rango pedido): Σ neta ÷ Σ personas cargadas de las facturas de salón CON pax y que
 * no son regalía total, por (semana ISO de la jornada, turno de caja). Primero la misma semana;
 * si no hay, las 4 anteriores juntas.
 */
export function estimadorPorNeta(historial: readonly FacturaIndicador[]): EstimadorPersonas {
  const ubic = ubicarFacturas(historial)
  const acc = new Map<string, { neta: number; personas: number }>()
  for (const f of historial) {
    if (!esFacturaDeSalon(f) || quedaFueraDelIndicador(f)) continue
    const p = personasCargadas(f)
    if (p <= 0) continue
    const u = ubic.get(f)
    if (!u) continue
    const k = `${lunesDe(u.dia)}|${u.turno}`
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
    estimar(f, u) {
      const ref = referencia(lunesDe(u.dia), u.turno)
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
  /** Neta de salón del INDICADOR (numerador): sin mesas de dueños ni regalías totales. */
  netaSalon:             number
  personasCargadas:      number
  personasEstimadas:     number
  /** Estimadas ÷ (cargadas + estimadas), 0–100. Para el rótulo «incluye X % estimado». */
  pctEstimado:           number
  /** TODAS las de salón del rango, incluidas mesas de dueños y regalías totales. */
  facturasSalon:         number
  /** Sin pax, entre las que cuentan (sin dueños ni regalías totales). */
  facturasSinPax:        number
  /** Facturas sin pax que no se pudieron estimar: su neta está en el numerador, sus personas no. */
  facturasSinReferencia: number
  netaSinReferencia:     number
  /** «Regalías totales: N». Fuera del numerador y del denominador. */
  regaliasTotales:       number
  netaRegaliasTotales:   number
  /** Mesas de dueños. Fuera del numerador y del denominador. */
  mesasDuenos:           number
  netaMesasDuenos:       number
  /** Facturas de mesas internas (Ajustes). Fuera del numerador y del denominador. */
  mesasInternas:         number
  netaMesasInternas:     number
  /** Facturas cuyo día y turno salieron del reloj (sin caja 111/222). */
  turnosInferidos:       number
  /** Facturas de salón sin salonero (sin pedido, caja o sistema). */
  facturasSinSalonero:   number
  estimador:             string
}

export interface OpcionesVentaPorPersona {
  /** Por defecto, la v1 con todas las `facturas` recibidas como historial. */
  estimador?: EstimadorPersonas
  /** Turno de CAJA (o inferido, si no hubo caja). */
  turno?:     TurnoPromPax
  /** Corte extra (salonero…). Se aplica después de salón + rango + turno. */
  filtro?:    (f: FacturaIndicador) => boolean
}

/**
 * LA venta por persona (D4). `facturas` puede traer días fuera de `r` (el historial para la
 * referencia, ver `rangoDeLecturaParaEstimar`); el resultado cuenta solo las de `r`, por la
 * jornada de su caja.
 */
export function ventaPorPersona(
  facturas: readonly FacturaIndicador[],
  r: Rango,
  opciones: OpcionesVentaPorPersona = {},
): VentaPorPersona {
  const estimador = opciones.estimador ?? estimadorPorNeta(facturas)
  const ubic = ubicarFacturas(facturas)
  let netaSalon = 0, netaConPax = 0, cargadas = 0, estimadas = 0
  let facturasSalon = 0, sinPax = 0, sinRef = 0, netaSinRef = 0
  let regalias = 0, netaRegalias = 0, duenos = 0, netaDuenos = 0, inferidos = 0, sinSalonero = 0
  let internas = 0, netaInternas = 0
  for (const f of facturas) {
    if (!esFacturaDeSalon(f)) continue
    const u = ubic.get(f)
    if (!u || !enRango(u.dia, r)) continue
    if (opciones.turno && u.turno !== opciones.turno) continue
    if (opciones.filtro && !opciones.filtro(f)) continue
    const neta = n(f.neta)
    facturasSalon += 1
    if (u.inferido) inferidos += 1
    if (!f.salonero_login) sinSalonero += 1
    const fuera = quedaFueraDelIndicador(f)
    if (fuera === 'interna') { internas += 1; netaInternas += neta; continue }
    if (fuera === 'duenos') { duenos += 1; netaDuenos += neta; continue }
    if (fuera === 'regalia') { regalias += 1; netaRegalias += neta; continue }
    netaSalon += neta
    const p = personasCargadas(f)
    if (p > 0) {
      cargadas += p
      netaConPax += neta
      continue
    }
    sinPax += 1
    const e = estimador.estimar(f, u)
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
    regaliasTotales:       regalias,
    netaRegaliasTotales:   netaRegalias,
    mesasDuenos:           duenos,
    netaMesasDuenos:       netaDuenos,
    mesasInternas:         internas,
    netaMesasInternas:     netaInternas,
    turnosInferidos:       inferidos,
    facturasSinSalonero:   sinSalonero,
    estimador:             estimador.id,
  }
}

/**
 * LA venta por persona (D4) cuando la pantalla solo tiene TOTALES ya sumados (el resumen por día
 * `DiaData`/`HistDay`, un mes, un salonero): neta de salón ÷ personas de salón. Es la misma
 * cuenta que `ventaPorPersona` con un estimador que no estima (lo cuida una prueba de contrato).
 *
 * Lo que el resumen por día NO permite, y queda para las pantallas que lean facturas (fase 2):
 * estimar las personas de mesas sin pax y sacar mesas de dueños y regalías totales. Por eso
 * estas pantallas muestran la venta por persona con personas CARGADAS.
 *
 * Una sola regla en toda la app: el numerador es la neta de SALÓN (nunca la neta total ni el
 * delivery) y el denominador, las personas de salón. `null` si no hay personas.
 */
export function ventaPorPersonaDeTotales(netaSalon: number, personas: number): number | null {
  const p = n(personas)
  return p > 0 ? n(netaSalon) / p : null
}

/**
 * La neta de SALÓN de un salonero en el resumen por día: su `total` sin su `delivery` (el
 * delivery que cargó un mesero no es salón; días del .xls sin el campo = todo salón).
 */
export function netaSalonDeSalonero(s: { total: number; delivery?: number | null }): number {
  return n(s.total) - n(s.delivery)
}

/**
 * Venta por persona por salonero (lente «mesa»), con el grupo SIN SALONERO aparte y nunca
 * repartido. La referencia del estimador es la del local entero (todas las `facturas`).
 */
export function ventaPorPersonaPorSalonero(
  facturas: readonly FacturaIndicador[],
  r: Rango,
  opciones: Omit<OpcionesVentaPorPersona, 'filtro'> = {},
): { porSalonero: (VentaPorPersona & { salonero_login: string })[]; sinSalonero: VentaPorPersona } {
  const op = { ...opciones, estimador: opciones.estimador ?? estimadorPorNeta(facturas) }
  const logins = [...new Set(facturas.map(f => f.salonero_login).filter((l): l is string => !!l))].sort()
  const porSalonero = logins
    .map(login => ({ salonero_login: login, ...ventaPorPersona(facturas, r, { ...op, filtro: f => f.salonero_login === login }) }))
    .filter(s => s.facturasSalon > 0)
  return { porSalonero, sinSalonero: ventaPorPersona(facturas, r, { ...op, filtro: f => !f.salonero_login }) }
}

// ── Alerta de mesas sin pax ────────────────────────────────────────────────────────────────

export interface ConteoSinPax {
  /** Facturas de salón que cuentan para la alerta (sin mesas de dueños ni regalías totales). */
  facturasSalon: number
  sinPax:        number
  /** sinPax ÷ facturasSalon, 0–100 (0 sin facturas). */
  pct:           number
}

export interface AlertaMesasSinPax {
  /** Por `salonero_login` de la factura. Orden: más sin pax primero, después % y login. */
  porSalonero:     (ConteoSinPax & { salonero_login: string })[]
  /**
   * SIN SALONERO (sin pedido, caja o sistema): grupo propio, siempre presente, nunca repartido
   * ni mezclado con un salonero. En prod es ~1 de cada 5 facturas de salón (medido 17/11).
   */
  sinSalonero:     ConteoSinPax
  total:           ConteoSinPax
  /** Regalías totales del rango: fuera de la alerta, contadas aparte. */
  regaliasTotales: number
  /** Mesas de dueños del rango: fuera de la alerta, contadas aparte. */
  mesasDuenos:     number
  /** Facturas de mesas internas del rango: fuera de la alerta, contadas aparte. */
  mesasInternas:   number
}

const conteo = (facturasSalon: number, sinPax: number): ConteoSinPax =>
  ({ facturasSalon, sinPax, pct: facturasSalon > 0 ? (sinPax / facturasSalon) * 100 : 0 })

/** Para un rango (normalmente ayer), cuántas facturas de salón quedaron sin pax, por salonero. */
export function alertaMesasSinPax(facturas: readonly FacturaIndicador[], r: Rango): AlertaMesasSinPax {
  const ubic = ubicarFacturas(facturas)
  const por = new Map<string, { t: number; s: number }>()
  let tSin = 0, sSin = 0, tTot = 0, sTot = 0, regalias = 0, duenos = 0, internas = 0
  for (const f of facturas) {
    if (!esFacturaDeSalon(f)) continue
    const u = ubic.get(f)
    if (!u || !enRango(u.dia, r)) continue
    const fuera = quedaFueraDelIndicador(f)
    if (fuera === 'interna') { internas += 1; continue }
    if (fuera === 'duenos') { duenos += 1; continue }
    if (fuera === 'regalia') { regalias += 1; continue }
    const falta = personasCargadas(f) <= 0 ? 1 : 0
    tTot += 1
    sTot += falta
    const login = f.salonero_login
    if (!login) {
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
  return { porSalonero, sinSalonero: conteo(tSin, sSin), total: conteo(tTot, sTot), regaliasTotales: regalias, mesasDuenos: duenos, mesasInternas: internas }
}

/** El rango de un solo día: ayer respecto de `hoy` (día CR, de `todayCR()`). */
export function rangoAyer(hoy: string): Rango {
  const ayer = sumarDias(hoy, -1)
  return { desde: ayer, hasta: ayer }
}
