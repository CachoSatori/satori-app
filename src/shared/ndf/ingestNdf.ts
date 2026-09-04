// ── Contrato de la ingesta del PoS "Nube de Fuego" (A2) ────────────────────────
//
// Módulo PURO: sin I/O, sin driver, sin cliente de Supabase, sin reloj. Lo importan
// los DOS extremos y ninguno lo reescribe:
//   · el Edge `supabase/functions/ingest-ndf` (Deno), que valida el lote y arma las
//     filas que va a persistir;
//   · el agente de la PC del PoS (A3), que arma el payload;
//   · los tests de vitest, que lo prueban entero sin base de datos.
//
// Todos los tipos DERIVAN de `mapTicket.ts` (la lógica de dominio de la Fase 1a): acá
// no se redefine ni un canal ni una alerta de pax. Los `Record<Union, true>` de abajo
// son el candado: si mañana `mapTicket` agrega un canal o un estado, este archivo NO
// compila hasta que se lo contemple.

import {
  mapTotalProvisorio,
  num,
  type Canal,
  type EstadoFactura,
  type ItemMapeado,
  type PaxAlerta,
  type RegistradoPor,
  type TicketMapeado,
  type Turno,
} from './mapTicket.ts'

// ── Vocabulario aceptado ───────────────────────────────────────────────────────

/** Slugs válidos = `public.locations.id` (los mismos de BioTime y del POS). */
export const LOCALES = new Set(['santa-teresa', 'nosara'])

const CANAL_OK: Record<Canal, true> = {
  salon: true, barra: true, delivery: true, llevar: true, otro: true,
}
const ESTADO_OK: Record<EstadoFactura, true> = { C: true, X: true, R: true }
const REGISTRADO_OK: Record<RegistradoPor, true> = {
  salonero: true, cajero: true, sistema: true, sin_pedido: true,
}
const PAX_ALERTA_OK: Record<PaxAlerta, true> = {
  ok: true, falta_nativo: true, falta_articulo: true, difiere: true, sin_pax: true,
}
/**
 * `mapTurno` solo emite mañana|noche. `tarde` existe en la base y acá porque el login
 * `022` figura como "cajero turno tarde" en el maestro del PoS y está SIN CONFIRMAR:
 * el día que se confirme, el turno entra sin migrar la tabla ni tocar este contrato.
 */
const TURNO_OK: Record<Turno | 'tarde', true> = { 'mañana': true, tarde: true, noche: true }

/** Topes de lote. Un poll normal trae decenas de tickets; esto solo frena un payload absurdo. */
export const MAX_TICKETS = 5_000
export const MAX_LINEAS_POR_TICKET = 500
export const MAX_OPEN = 500

/** Diferencia tolerada (₡) entre el total que manda el agente y el recalculado acá. */
export const TOLERANCIA_TOTAL = 0.5

// ── Zona horaria ───────────────────────────────────────────────────────────────

/** Costa Rica es UTC−6 FIJO: no tiene horario de verano. Es la única verdad de acá. */
export const CR_OFFSET = '-06:00'

const TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * `'2026-09-01 19:42:07'` (reloj de pared del PoS) → `'2026-09-01T19:42:07-06:00'`.
 * NO mueve la hora: solo dice en qué zona estaba leída, que es lo que falta en el dato
 * crudo. La usa el agente ANTES de mandar; el Edge exige el resultado.
 */
export function conOffsetCR(naive: string): string {
  return `${naive.trim().replace(' ', 'T')}${CR_OFFSET}`
}

/**
 * Instante CON zona explícita → ISO en UTC. Sin zona → `null`, y el ticket se descarta.
 *
 * Esto no es quisquillosidad: un naive lo interpreta el runtime en SU zona (UTC en Deno)
 * y la venta de las 19:42 quedaría guardada a las 13:42 — cae en otro día operativo y el
 * cuadre contra el Excel sale mal SIN QUE NADA FALLE. Es exactamente el desfase de 1 hora
 * que ya pasó con BioTime.
 */
export function instanteConZona(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!TZ_RE.test(s)) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Igual que `instanteConZona` pero acepta ausencia (columnas opcionales). */
export function instanteOpcional(v: unknown): { ok: true; valor: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, valor: null }
  const i = instanteConZona(v)
  return i === null ? { ok: false } : { ok: true, valor: i }
}

// ── Lo que manda el agente ─────────────────────────────────────────────────────

/**
 * Un ticket del lote = el `TicketMapeado` de la Fase 1a MÁS lo que solo necesita la
 * base. Extiende el tipo en vez de copiarlo: si `mapTicket` cambia, esto cambia con él.
 */
export interface TicketIngest extends TicketMapeado {
  /** `fecha_registra` con zona EXPLÍCITA. El agente lo arma con `conOffsetCR`. */
  fecha_registra:  string
  /** Cierre del lote de caja (informativo). Con zona explícita o ausente. */
  fecha_cierra?:   string | null
  /** `Pedidos.Tipo` crudo (el canal ya viene mapeado en `canal`). */
  tipo?:           string | null
  mesa?:           string | null
  numero_pedido?:  string | null
  descuento?:      number | null
}

/** Una línea = el `ItemMapeado` de la Fase 1a más el precio unitario. */
export interface LineaIngest extends ItemMapeado {
  precio?: number | null
}

/** Una mesa abierta del snapshot. */
export interface OpenIngest {
  clave:           string
  numero_factura?: string | null
  id_pedido?:      string | null
  mesa?:           string | null
  salonero_login?: string | null
  canal?:          Canal | null
  pax?:            number | null
  pax_alerta?:     PaxAlerta | null
  updated_at?:     string | null
}

export interface CursorIngest {
  last_factura?:        string | null
  last_fecha_registra?: string | null
  last_poll_at?:        string | null
  last_error?:          string | null
}

export interface PayloadIngest {
  local:   string
  tickets: TicketIngest[]
  open?:   OpenIngest[]
  cursor?: CursorIngest
}

// ── Las filas que van a la base (espejo del DDL de la mig 062) ─────────────────

export interface TicketRow {
  local:            string
  numero_factura:   string
  fecha_registra:   string
  fecha_cierra:     string | null
  estado:           EstadoFactura
  tipo:             string | null
  area:             string | null
  canal:            Canal
  mesa:             string | null
  salonero_login:   string | null
  registrado_por:   RegistradoPor
  turno:            string | null
  cajero_login:     string | null
  numero_pedido:    string | null
  efectivo_crc:     number
  tarjeta_crc:      number
  electronico_crc:  number
  deposito_crc:     number
  cheque_crc:       number
  cxc_crc:          number
  dolares_efectivo: number
  dolares_tarjeta:  number
  vuelto_crc:       number
  descuento_crc:    number
  con_servicio:     boolean
  servicio_crc:     number
  pax_nativo:       number
  pax_articulo:     number
  pax:              number
  pax_alerta:       PaxAlerta
  total_crc:        number
  total_fuente:     string
}

export interface LineaRow {
  codigo_producto: string | null
  nombre:          string | null
  cantidad:        number
  precio:          number | null
  monto:           number
  familia:         number | null
  es_pax:          boolean
  es_extra:        boolean
  es_cortesia:     boolean
}

export interface OpenRow {
  local:          string
  clave:          string
  numero_factura: string | null
  id_pedido:      string | null
  mesa:           string | null
  salonero_login: string | null
  canal:          string | null
  pax:            number | null
  pax_alerta:     string | null
  updated_at:     string
}

export interface CursorRow {
  local:               string
  last_factura:        string | null
  last_fecha_registra: string | null
  last_poll_at:        string | null
  last_error:          string | null
}

/**
 * Lo que el agente dijo del cursor EN ESTE LOTE. Una clave ausente significa "no lo
 * toques", no "ponelo en null": el agente saluda al arrancar con un lote vacío para
 * leer hasta dónde llegó, y ese saludo NO puede borrarle el corte que ya tenía.
 * `last_error: null` explícito sí limpia (es como el agente avisa que se recuperó).
 */
export interface CursorParcial {
  local:                string
  last_poll_at:         string
  last_factura?:        string | null
  last_fecha_registra?: string | null
  last_error?:          string | null
}

/** Un ticket ya normalizado, con sus líneas al lado (la base las guarda en dos tablas). */
export interface TicketNormalizado {
  fila:   TicketRow
  lineas: LineaRow[]
  /** El total que mandó el agente no coincidía con el recalculado: se usó el recalculado. */
  totalRecalculado: boolean
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string }

// ── Normalización ──────────────────────────────────────────────────────────────

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const entero = (v: unknown): number => {
  const n = Math.round(num(v))
  return Number.isFinite(n) ? n : 0
}

const enUnion = <T extends string>(v: unknown, ok: Record<T, true>): T | null => {
  const s = texto(v)
  return s !== null && Object.prototype.hasOwnProperty.call(ok, s) ? (s as T) : null
}

export function normalizarLinea(l: unknown): LineaRow | null {
  if (!l || typeof l !== 'object') return null
  const x = l as Partial<LineaIngest>
  const familia = x.familia === null || x.familia === undefined ? null : entero(x.familia)
  return {
    codigo_producto: texto(x.codigo),
    nombre:          texto(x.nombre),
    cantidad:        num(x.cantidad),
    precio:          x.precio === null || x.precio === undefined ? null : num(x.precio),
    monto:           num(x.monto),
    familia,
    es_pax:          x.es_pax === true,
    es_extra:        x.es_extra === true,
    es_cortesia:     x.es_cortesia === true,
  }
}

/**
 * Un ticket del payload → las filas de `pos_ndf_tickets` + `pos_ndf_ticket_lines`.
 *
 * Rechaza (no rompe el lote, se cuenta) el ticket al que le falte la clave de
 * idempotencia, el instante con zona, o que traiga un valor fuera de los CHECK de la
 * migración: meterlo igual haría fallar el INSERT del lote ENTERO.
 */
export function normalizarTicket(local: string, t: unknown): Resultado<TicketNormalizado> {
  if (!t || typeof t !== 'object') return { ok: false, error: 'ticket no es un objeto' }
  const x = t as Partial<TicketIngest> & { medios?: Record<string, unknown> }

  const numero_factura = texto(x.numero_factura)
  if (numero_factura === null) return { ok: false, error: 'falta numero_factura' }

  const fecha_registra = instanteConZona(x.fecha_registra)
  if (fecha_registra === null) {
    return { ok: false, error: `factura ${numero_factura}: fecha_registra sin zona horaria explícita` }
  }
  const cierre = instanteOpcional(x.fecha_cierra)
  if (!cierre.ok) {
    return { ok: false, error: `factura ${numero_factura}: fecha_cierra sin zona horaria explícita` }
  }

  const estado = enUnion<EstadoFactura>(x.estado, ESTADO_OK)
  if (estado === null) return { ok: false, error: `factura ${numero_factura}: estado inválido` }

  const canal = enUnion<Canal>(x.canal, CANAL_OK)
  if (canal === null) return { ok: false, error: `factura ${numero_factura}: canal inválido` }

  const registrado_por = enUnion<RegistradoPor>(x.registrado_por, REGISTRADO_OK)
  if (registrado_por === null) {
    return { ok: false, error: `factura ${numero_factura}: registrado_por inválido` }
  }

  const pax_alerta = enUnion<PaxAlerta>(x.pax_alerta, PAX_ALERTA_OK)
  if (pax_alerta === null) return { ok: false, error: `factura ${numero_factura}: pax_alerta inválida` }

  // `turno` es nullable en la base: si viene basura se guarda null en vez de tumbar el
  // ticket — el turno es informativo y no mueve un colón.
  const turno = enUnion<Turno | 'tarde'>(x.turno, TURNO_OK)

  const crudos = x.items
  const items = Array.isArray(crudos) ? crudos : []
  if (items.length > MAX_LINEAS_POR_TICKET) {
    return { ok: false, error: `factura ${numero_factura}: demasiadas líneas (${items.length})` }
  }
  const lineas: LineaRow[] = []
  for (const l of items) {
    const fila = normalizarLinea(l)
    if (fila !== null) lineas.push(fila)
  }

  const m = (x.medios ?? {}) as Record<string, unknown>
  const efectivo_crc     = num(m.efectivo)
  const tarjeta_crc      = num(m.tarjeta)
  const electronico_crc  = num(m.monto_electronico)
  const deposito_crc     = num(m.deposito)
  const cheque_crc       = num(m.cheque)
  const cxc_crc          = num(m.cuenta_cobrar)
  const vuelto_crc       = num(m.vuelto)

  // El total se RECALCULA con la misma función que usó el extractor. No es desconfianza
  // del agente: es el único punto donde se puede detectar que las dos puntas quedaron en
  // versiones distintas de la regla (p. ej. una que todavía no resta el vuelto).
  const recalculado = mapTotalProvisorio({
    efectivo:         efectivo_crc,
    tarjeta:          tarjeta_crc,
    montoElectronico: electronico_crc,
    deposito:         deposito_crc,
    cheque:           cheque_crc,
    cuentaCobrar:     cxc_crc,
    vuelto:           vuelto_crc,
  })
  const declarado = num(x.total)
  const totalRecalculado = Math.abs(declarado - recalculado) > TOLERANCIA_TOTAL

  return {
    ok: true,
    valor: {
      fila: {
        local,
        numero_factura,
        fecha_registra,
        fecha_cierra:  cierre.valor,
        estado,
        tipo:          texto(x.tipo),
        area:          texto(x.area),
        canal,
        mesa:          texto(x.mesa),
        salonero_login: texto(x.salonero_login),
        registrado_por,
        turno,
        cajero_login:  texto(x.login_cajero),
        numero_pedido: texto(x.numero_pedido),
        efectivo_crc,
        tarjeta_crc,
        electronico_crc,
        deposito_crc,
        cheque_crc,
        cxc_crc,
        dolares_efectivo: num(m.dolares_efectivo),
        dolares_tarjeta:  num(m.dolares_tarjeta),
        vuelto_crc,
        descuento_crc:    num(x.descuento),
        con_servicio:     x.con_servicio === true,
        servicio_crc:     num(x.imp_servicio),
        pax_nativo:       entero(x.pax_nativo),
        pax_articulo:     entero(x.pax_articulo),
        pax:              entero(x.pax),
        pax_alerta,
        total_crc:        recalculado,
        total_fuente:     texto(x.total_fuente) ?? 'provisorio',
      },
      lineas,
      totalRecalculado,
    },
  }
}

export function normalizarOpen(local: string, o: unknown, ahora: string): Resultado<OpenRow> {
  if (!o || typeof o !== 'object') return { ok: false, error: 'mesa abierta no es un objeto' }
  const x = o as Partial<OpenIngest>

  const clave = texto(x.clave)
  if (clave === null) return { ok: false, error: 'mesa abierta sin clave' }

  const upd = instanteOpcional(x.updated_at)
  if (!upd.ok) return { ok: false, error: `mesa ${clave}: updated_at sin zona horaria explícita` }

  return {
    ok: true,
    valor: {
      local,
      clave,
      numero_factura: texto(x.numero_factura),
      id_pedido:      texto(x.id_pedido),
      mesa:           texto(x.mesa),
      salonero_login: texto(x.salonero_login),
      canal:          enUnion<Canal>(x.canal, CANAL_OK),
      pax:            x.pax === null || x.pax === undefined ? null : entero(x.pax),
      pax_alerta:     enUnion<PaxAlerta>(x.pax_alerta, PAX_ALERTA_OK),
      // El snapshot SIEMPRE queda fechado: si el agente no lo dice, vale el momento del lote.
      updated_at:     upd.valor ?? ahora,
    },
  }
}

const tiene = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Solo las claves que el agente mandó de verdad. Ver `CursorParcial`. */
export function normalizarCursor(local: string, c: unknown, ahora: string): CursorParcial {
  const x = (c && typeof c === 'object' ? c : {}) as Partial<CursorIngest>
  const poll = instanteOpcional(x.last_poll_at)

  // El cursor se fecha con el lote aunque el agente no mande nada: es el latido.
  const out: CursorParcial = { local, last_poll_at: (poll.ok ? poll.valor : null) ?? ahora }

  if (tiene(x, 'last_factura')) out.last_factura = texto(x.last_factura)
  if (tiene(x, 'last_fecha_registra')) {
    const fecha = instanteOpcional(x.last_fecha_registra)
    out.last_fecha_registra = fecha.ok ? fecha.valor : null
  }
  if (tiene(x, 'last_error')) out.last_error = texto(x.last_error)
  return out
}

/**
 * El cursor guardado + lo que trajo el lote. Lo ausente se conserva; lo explícito pisa.
 *
 * Sin esto, un `upsert` con el objeto entero pondría en null lo que el agente no mandó
 * — y el saludo de arranque (lote vacío) le borraría `last_factura`, o sea que el
 * agente volvería a leer el día desde el principio en cada reinicio.
 */
export function fusionarCursor(actual: CursorRow | null, entrante: CursorParcial): CursorRow {
  return {
    local:               entrante.local,
    last_poll_at:        entrante.last_poll_at,
    last_factura:        tiene(entrante, 'last_factura')
      ? entrante.last_factura ?? null
      : actual?.last_factura ?? null,
    last_fecha_registra: tiene(entrante, 'last_fecha_registra')
      ? entrante.last_fecha_registra ?? null
      : actual?.last_fecha_registra ?? null,
    last_error:          tiene(entrante, 'last_error')
      ? entrante.last_error ?? null
      : actual?.last_error ?? null,
  }
}

// ── Validación del sobre ───────────────────────────────────────────────────────

export interface PayloadValidado {
  local:   string
  tickets: unknown[]
  /** `undefined` = el agente no mandó snapshot; `[]` = mandó uno VACÍO (cerrar todas). */
  open:    unknown[] | undefined
  cursor:  unknown
  /**
   * ¿El sobre traía la clave `cursor`? Sin ella, la fila de `pos_ndf_cursor` NO se
   * escribe (ni siquiera el latido). Es lo que le permite al **backfill** correr en
   * paralelo con el agente en vivo sin pisarle nada: manda `{ local, tickets }` y el
   * cursor del agente queda intacto, `last_poll_at` incluido.
   */
  tieneCursor: boolean
}

/**
 * Revisa el sobre, no el contenido: local conocido, arrays y topes. Los tickets se
 * validan uno por uno después, porque uno corrupto NO puede tumbar el lote entero (si
 * devolviera 400, el agente reintentaría para siempre y el local dejaría de sincronizar).
 */
export function validarPayload(body: unknown): Resultado<PayloadValidado> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON inválido' }
  const b = body as { local?: unknown; tickets?: unknown; open?: unknown; cursor?: unknown }

  const local = typeof b.local === 'string' ? b.local.trim() : ''
  if (!LOCALES.has(local)) {
    return { ok: false, error: `local inválido (${[...LOCALES].join(' | ')})` }
  }
  if (!Array.isArray(b.tickets)) return { ok: false, error: 'tickets debe ser un array' }
  if (b.tickets.length > MAX_TICKETS) {
    return { ok: false, error: `Lote demasiado grande (máx ${MAX_TICKETS} tickets)` }
  }
  if (b.open !== undefined && b.open !== null && !Array.isArray(b.open)) {
    return { ok: false, error: 'open debe ser un array' }
  }
  const open = Array.isArray(b.open) ? b.open : undefined
  if (open && open.length > MAX_OPEN) {
    return { ok: false, error: `Snapshot demasiado grande (máx ${MAX_OPEN} mesas)` }
  }

  return {
    ok: true,
    valor: {
      local, tickets: b.tickets, open, cursor: b.cursor,
      tieneCursor: Object.prototype.hasOwnProperty.call(b, 'cursor') && b.cursor !== undefined,
    },
  }
}

// ── Lote listo para persistir ──────────────────────────────────────────────────

export interface LoteNormalizado {
  local:     string
  tickets:   TicketNormalizado[]
  open:      OpenRow[] | undefined
  /** `null` = el sobre no trajo `cursor`: la fila NO se escribe (la deja como está). */
  cursor:    CursorParcial | null
  invalid:   number
  /** Tickets cuyo total no coincidía con el recalculado (se guardó el recalculado). */
  recalculados: number
  /** Hasta 10, para el log y la respuesta. Nunca lleva datos de cliente. */
  problemas: string[]
}

/**
 * Payload validado → todo lo que hay que escribir. PURO: el Edge solo agrega las
 * llamadas a la base. Deduplica por `numero_factura` dentro del lote (si el agente
 * reenvía solapado, el último gana: es el más fresco).
 */
export function normalizarLote(p: PayloadValidado, ahora: string): LoteNormalizado {
  const problemas: string[] = []
  let invalid = 0
  let recalculados = 0

  const porFactura = new Map<string, TicketNormalizado>()
  for (const t of p.tickets) {
    const r = normalizarTicket(p.local, t)
    if (!r.ok) {
      invalid++
      if (problemas.length < 10) problemas.push(r.error)
      continue
    }
    if (r.valor.totalRecalculado) {
      recalculados++
      if (problemas.length < 10) {
        problemas.push(
          `factura ${r.valor.fila.numero_factura}: el total declarado no coincide con los medios de pago; se guardó el recalculado`,
        )
      }
    }
    porFactura.set(r.valor.fila.numero_factura, r.valor)
  }

  let open: OpenRow[] | undefined
  if (p.open !== undefined) {
    const porClave = new Map<string, OpenRow>()
    for (const o of p.open) {
      const r = normalizarOpen(p.local, o, ahora)
      if (!r.ok) {
        invalid++
        if (problemas.length < 10) problemas.push(r.error)
        continue
      }
      porClave.set(r.valor.clave, r.valor)
    }
    open = [...porClave.values()]
  }

  return {
    local:    p.local,
    tickets:  [...porFactura.values()],
    open,
    cursor:   p.tieneCursor ? normalizarCursor(p.local, p.cursor, ahora) : null,
    invalid,
    recalculados,
    problemas,
  }
}
