/**
 * Club Satori — acceso a datos (mig 075). Las tablas `club_*` no están en
 * supabase.gen.ts: cast acotado de `supabase.from` / `supabase.rpc`.
 * TODA escritura va por funciones SECURITY DEFINER (la RLS bloquea el resto).
 */
import { supabase } from './supabase'

type PgError = { message: string; hint?: string | null; code?: string } | null
type RpcInvoke = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError }>
interface Q<T> extends PromiseLike<{ data: T[] | null; error: PgError }> {
  select(cols: string): Q<T>
  eq(col: string, v: unknown): Q<T>
  order(col: string, o?: { ascending?: boolean }): Q<T>
  limit(n: number): Q<T>
}
// `.bind(supabase)`: sin `this` supabase-js revienta (ver cash.ts). `?.`: tests que mockean parcial.
const rpc = supabase.rpc?.bind(supabase) as unknown as RpcInvoke
const from = supabase.from?.bind(supabase) as unknown as <T>(table: string) => Q<T>

// ── Tipos ────────────────────────────────────────────────────────────────────
export type TipoMiembro = 'referente' | 'concierge_pm' | 'equipo' | 'socio' | 'turista'
export type TipoNegocio = 'hotel' | 'tienda' | 'host' | 'delivery' | 'concierge' | 'otro'

export interface ClubMiembro {
  id: string; tipo: TipoMiembro; nombre: string; negocio_id: string | null
  estado: 'activo' | 'baja'; origen: string; created_at: string
}
export interface ClubSaldo {
  miembro_id: string; personas: number; creditos: number
  personas_proximo_credito: number; ultima_actividad: string | null
}
export interface ClubNegocio { id: string; nombre: string; tipo: TipoNegocio; activo: boolean; created_at: string }
export interface ClubMovimiento {
  id: string; tipo: 'tarjeta' | 'canje' | 'vencimiento' | 'ajuste' | 'restitucion'
  personas: number; creditos: number | null; factura_pos: string | null
  fecha_visita: string; nota: string | null; origen: string
}
export interface ClubContacto {
  miembro_id: string; telefono: string | null; email: string | null
  optin_whatsapp: boolean; optin_email: boolean
}
export interface ClubConfig {
  personas_por_credito: number; canje_min: number; canje_paso: number; max_creditos_por_visita: number
}

export interface ResolverCupon {
  tipo: 'cupon'
  datos: { codigo: string; estado: 'vigente' | 'usado' | 'vencido' | 'anulado'; vence_en: string
           usado_en: string | null; referente_id: string; referente: string; referente_estado: 'activo' | 'baja' }
}
export interface ResolverReferente {
  tipo: 'referente'
  datos: { id: string; nombre: string; tipo_miembro: TipoMiembro; negocio: string | null; estado: 'activo' | 'baja'
           personas: number; creditos: number; personas_proximo: number; personas_por_credito: number
           canjeado_hoy: number; canje_min: number; canje_paso: number; max_creditos_por_visita: number
           /** CLUB-AUD-26: tarjeta física habilitada en este local (staging sí, prod no). */
           tarjeta_manual_activa?: boolean }
}
/** R-01: el código de canje (/k/) del portal. Los mismos datos del referente, más el estado del código. */
export interface ResolverCanje {
  tipo: 'canje'
  datos: ResolverReferente['datos'] & { codigo_canje: string; codigo_estado: 'vigente' | 'vencido' | 'usado' | 'reemplazado'
                                         codigo_vence_en: string }
}
/** LC-A1: QR fijo del socio (/s/). Solo identifica (10 % y cortesía); nunca da créditos. */
export interface ResolverSocio {
  tipo: 'socio'
  datos: { id: string; nombre: string; persona_estado: 'activo' | 'baja'; estado: 'pendiente' | 'activo' | 'baja'
           desde: string; alta_por: string; provisional_hasta: string | null; es_anfitrion: boolean }
}
export type ResolverResultado = ResolverCupon | ResolverReferente | ResolverCanje | ResolverSocio | { tipo: 'desconocido'; datos: Record<string, never> }

export interface BusquedaFila {
  id: string; nombre: string; negocio: string | null; tipo: TipoMiembro; estado: 'activo' | 'baja'
  personas: number | null; creditos: number | null
}
export interface Saldo { personas: number; creditos: number }

// ── Errores ──────────────────────────────────────────────────────────────────
export const MSG_REFERENTE_INACTIVO = 'Referente dado de baja: seguí con la cuenta sin crédito'

/** Error de la API con bandera de red: si es de red, el p_op se reusa en el reintento. */
export class ClubError extends Error {
  readonly esRed: boolean
  readonly codigo: string | null
  constructor(message: string, esRed: boolean, codigo: string | null = null) {
    super(message); this.esRed = esRed; this.codigo = codigo
  }
}

const RE_RED = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|aborted/i

export function aClubError(e: unknown): ClubError {
  if (e instanceof ClubError) return e
  const msg = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? String(e)
  if (msg === 'REFERENTE_INACTIVO') return new ClubError(MSG_REFERENTE_INACTIVO, false, 'REFERENTE_INACTIVO')
  if (RE_RED.test(msg)) return new ClubError('Sin conexión. Reintentá: no se va a duplicar.', true)
  if (/permission denied|sin permiso/i.test(msg)) return new ClubError('Tu usuario no tiene permiso para esto: pedile a un manager.', false)
  return new ClubError(msg, false)
}

async function llamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: PgError }
  try {
    res = await rpc(fn, args)
  } catch (e) {
    throw aClubError(e)
  }
  if (res.error) throw aClubError(res.error)
  return res.data as T
}

async function leer<T>(q: Q<T>): Promise<T[]> {
  let res: { data: T[] | null; error: PgError }
  try { res = await q } catch (e) { throw aClubError(e) }
  if (res.error) throw aClubError(res.error)
  return res.data ?? []
}

const primero = <T>(d: T | T[]): T => (Array.isArray(d) ? d[0] : d)

// ── Caja ─────────────────────────────────────────────────────────────────────
export const resolverQR = (texto: string) => llamar<ResolverResultado>('club_resolver', { p_texto: texto })

/**
 * Referencia al PoS para el piloto (decisiones de Ismael, 06 y 07-nov): la clave de cruce es el PEDIDO.
 * La caja elige el pedido abierto del puente; el servidor guarda el pedido y la hora del escaneo, y el
 * cruce es la primera factura con ese pedido cerrada después del escaneo (tope 18 h).
 * Plan B, si el pedido ya se cerró: elegir la factura de la lista de las últimas 2 h (cruce exacto).
 */
export type PosRef =
  | { modo: 'pedido'; pedido: string; clave?: string | null; area?: string | null; mesa: string | null; total: number | null }
  | { modo: 'factura'; numero_factura: string; area?: string | null; mesa: string | null; total: number; hora: string }
/** La mesa es (área, mesa): la mesa 3 del área '3' no es la mesa 3 del área 'M'. */
export interface PedidoAbierto {
  /** CLUB-AUD-31: `pedido:<fecha>:<n>` (el número se reinicia cada día). */
  pedido: string; clave?: string | null; area?: string | null; mesa: string | null; salonero: string | null; total_crc: number | null; pax: number | null
  actualizado: string
}
export interface FacturaReciente {
  numero_factura: string; hora: string; total_crc: number; area?: string | null; mesa: string | null; pedido: string | null
  /** Consecutivo de la factura electrónica (20 dígitos, mig 081): el número del tiquete. */
  consecutivo_fe?: string | null
}
export const getPedidosAbiertos = (local = 'santa-teresa') => llamar<PedidoAbierto[]>('club_pedidos_abiertos', { p_location: local })
export const getFacturasRecientes = (local = 'santa-teresa') => llamar<FacturaReciente[]>('club_facturas_recientes', { p_location: local })

const colones = (n: number | null | undefined) => `₡${Math.round(Number(n ?? 0)).toLocaleString('de-DE')}`
const horaCR = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Costa_Rica' })

export const posDePedido = (p: PedidoAbierto): PosRef =>
  ({ modo: 'pedido', pedido: p.pedido, clave: p.clave ?? null, area: p.area ?? null, mesa: p.mesa, total: p.total_crc == null ? null : Number(p.total_crc) })
export const posDeFactura = (f: FacturaReciente): PosRef =>
  ({ modo: 'factura', numero_factura: f.numero_factura, area: f.area ?? null, mesa: f.mesa, total: Number(f.total_crc), hora: f.hora })
/** «Área 3 · Mesa 4» (o «Mesa 4» si no hay área; null si no hay mesa). */
export const describirMesa = (area: string | null | undefined, mesa: string | null | undefined) =>
  mesa ? [area ? `Área ${area}` : null, `Mesa ${mesa}`].filter(Boolean).join(' · ') : null
/** Lo que se manda al servidor: solo la clave. Mesa, total y hora los pone el servidor desde el puente. */
export const posParaServidor = (p: PosRef) =>
  p.modo === 'pedido' ? { modo: 'pedido', pedido: p.pedido, ...(p.clave ? { clave: p.clave } : {}) } : { modo: 'factura', numero_factura: p.numero_factura }
/** «Pedido 14 · Área 3 · Mesa 4 · ₡48.500» */
export const describirPedido = (p: Pick<PedidoAbierto, 'pedido' | 'mesa' | 'total_crc'> & { area?: string | null }) =>
  [`Pedido ${p.pedido}`, describirMesa(p.area, p.mesa), p.total_crc == null ? 'sin total' : colones(p.total_crc)]
    .filter(Boolean).join(' · ')
/** «19:21 · ₡48.500 · Mesa 20 · tiquete …6197» (los últimos 4 del consecutivo, si llegó) */
export const describirFactura = (f: Pick<FacturaReciente, 'hora' | 'total_crc' | 'mesa'> & { area?: string | null; consecutivo_fe?: string | null }) =>
  [horaCR(f.hora), colones(f.total_crc), describirMesa(f.area, f.mesa),
   f.consecutivo_fe ? `tiquete …${f.consecutivo_fe.slice(-4)}` : null].filter(Boolean).join(' · ')
export const describirPos = (p: PosRef) =>
  p.modo === 'pedido'
    ? describirPedido({ pedido: p.pedido, area: p.area, mesa: p.mesa, total_crc: p.total })
    : `factura de las ${describirFactura({ hora: p.hora, total_crc: p.total, area: p.area, mesa: p.mesa })}`

export const usarCupon = async (codigo: string, personas: number, pos: PosRef, op: string) =>
  primero(await llamar<Array<Saldo & { miembro_id: string }>>('club_cupon_usar',
    { p_codigo: codigo, p_personas: personas, p_factura: null, p_op: op, p_pos: posParaServidor(pos) }))

/** Resultado del canje. Un código equivocado no es un error de red: vuelve en `error` (queda anotado el intento). */
export interface ResultadoCanje extends Saldo { movimiento: string | null; error: string | null }
const sinError = (r: ResultadoCanje) => { if (r?.error) throw new ClubError(r.error, false); return r }

/** R-01: el canje exige el código de canje que el referente genera en su portal (10 min, un uso). */
export const canjear = async (miembro: string, codigoCanje: string, creditos: number, pos: PosRef, op: string) =>
  sinError(primero(await llamar<ResultadoCanje[]>('club_canje', { p_miembro: miembro, p_codigo_canje: codigoCanje, p_creditos: creditos,
                                                                  p_factura: null, p_op: op, p_pos: posParaServidor(pos) })))

/** Respaldo sin celular (solo owner o manager), con nota obligatoria. */
export const canjeAprobado = async (miembro: string, creditos: number, pos: PosRef, op: string, nota: string) =>
  sinError(primero(await llamar<ResultadoCanje[]>('club_canje_aprobado', { p_miembro: miembro, p_creditos: creditos, p_factura: null,
                                                                           p_op: op, p_pos: posParaServidor(pos), p_nota: nota })))

/** Aviso al referente del canje recién hecho: link de WhatsApp (null si no tiene teléfono). */
export const avisoCanje = async (movimiento: string): Promise<string | null> => {
  const r = await llamar<{ tel: string; texto: string } | null>('club_canje_aviso', { p_movimiento: movimiento })
  return r?.tel ? `https://wa.me/${r.tel}?text=${encodeURIComponent(r.texto)}` : null
}

/** «Buscar» → la ficha del referente (sin canje, igual que el /r/). La caja no lee el código (CLUB-AUD-30). */
export const resolverMiembro = (id: string) => llamar<ResolverResultado>('club_resolver_miembro', { p_id: id })
/** Código del QR público: solo owner y manager. */
export const codigoMiembro = (id: string) => llamar<string>('club_miembro_codigo', { p_id: id })

/** Ajuste o restitución (solo owner, nota obligatoria). Idempotente con `op`. */
export const ajustarSaldo = (miembro: string, personas: number, tipo: 'ajuste' | 'restitucion', nota: string, op: string) =>
  llamar<unknown>('club_ajuste', { p_miembro: miembro, p_personas: personas, p_tipo: tipo, p_nota: nota, p_op: op })

export const tarjetaManual = async (miembro: string, personas: number, pos: PosRef, op: string) =>
  primero(await llamar<Saldo[]>('club_tarjeta_manual', { p_miembro: miembro, p_personas: personas, p_factura: null, p_op: op, p_pos: posParaServidor(pos) }))

export const buscar = (q: string) => llamar<BusquedaFila[]>('club_buscar', { p_q: q })

// ── Gestión (owner, manager) ─────────────────────────────────────────────────
export const guardarNegocio = (p: { id: string | null; nombre: string; tipo: TipoNegocio; activo: boolean }) =>
  llamar<string>('club_negocio_guardar', { p_id: p.id, p_nombre: p.nombre, p_tipo: p.tipo, p_activo: p.activo })

export const guardarMiembro = (p: {
  id: string | null; tipo: TipoMiembro; nombre: string; negocio_id: string | null; estado: 'activo' | 'baja'
  contacto: { telefono: string; email: string; optin_whatsapp: boolean; optin_email: boolean } | null
}) => llamar<string>('club_miembro_guardar', {
  p_id: p.id, p_tipo: p.tipo, p_nombre: p.nombre, p_negocio_id: p.negocio_id, p_estado: p.estado, p_contacto: p.contacto,
})

export const regenerarCodigo = async (id: string) =>
  primero(await llamar<Array<{ codigo: string; token_portal: string }>>('club_miembro_regenerar_codigo', { p_id: id }))

export const tokenPortal = (id: string) => llamar<string>('club_miembro_token', { p_id: id })

// ── Lecturas ─────────────────────────────────────────────────────────────────
const COLS_MIEMBRO = 'id,tipo,nombre,negocio_id,estado,origen,created_at'

export const getMiembros = () => leer(from<ClubMiembro>('club_miembros').select(COLS_MIEMBRO).order('nombre'))
export const getMiembro = async (id: string) =>
  (await leer(from<ClubMiembro>('club_miembros').select(COLS_MIEMBRO).eq('id', id).limit(1)))[0] ?? null
export const getSaldos = () =>
  leer(from<ClubSaldo>('club_saldos').select('miembro_id,personas,creditos,personas_proximo_credito,ultima_actividad'))
export const getNegocios = () => leer(from<ClubNegocio>('club_negocios').select('id,nombre,tipo,activo,created_at').order('nombre'))
export const getMovimientos = (miembro: string) =>
  leer(from<ClubMovimiento>('club_movimientos')
    .select('id,tipo,personas,creditos,factura_pos,fecha_visita,nota,origen')
    .eq('miembro_id', miembro).order('fecha_visita', { ascending: false }).limit(200))
export const getContacto = async (miembro: string) =>
  (await leer(from<ClubContacto>('club_miembros_contacto')
    .select('miembro_id,telefono,email,optin_whatsapp,optin_email').eq('miembro_id', miembro).limit(1)))[0] ?? null

/** Valores de canje habilitados por la config (1, 1,5, 2 con la de hoy). */
export function opcionesCanje(c: Pick<ClubConfig, 'canje_min' | 'canje_paso' | 'max_creditos_por_visita'>): number[] {
  const out: number[] = []
  const paso = Number(c.canje_paso), max = Number(c.max_creditos_por_visita)
  if (!(paso > 0)) return out
  for (let v = Number(c.canje_min); v <= max + 1e-9 && out.length < 20; v = Math.round((v + paso) * 10) / 10) out.push(v)
  return out
}

/** Un id de operación por intento (idempotencia en el servidor). */
export const nuevoOp = (): string =>
  (globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = (Math.random() * 16) | 0
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    }))

export const fmtCreditos = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

// ── F1f: excepciones del puente y reporte mensual (owner, manager) ───────────
export type TipoExcepcion = 'PROMO_SIN_CUPON' | 'CUPON_SIN_PROMO' | 'TARJETA_MANUAL' | 'CANJE_SIN_CODIGO' | 'CREDITOS_SIN_CANJE' | 'CANJE_MONTO_DISTINTO' | 'REGISTRO_SIN_FACTURA' | 'SIN_CRUCE'
  | 'VISITA_REPETIDA' | 'PERSONAS_SOBRE_PAX' | 'AMBIGUA'
export interface Excepcion {
  tipo: TipoExcepcion; ref: string; fecha: string; factura: string | null; certeza: 'exacta' | 'probable' | 'manual'
  detalle: Record<string, unknown>; resuelta: boolean; nota: string | null; resuelta_en: string | null
}

export const getExcepciones = (desde: string, hasta: string, local = 'santa-teresa') =>
  llamar<Excepcion[]>('club_excepciones', { p_desde: desde, p_hasta: hasta, p_location: local })
export const getExcepcionesAbiertas = (dias = 30, local = 'santa-teresa') =>
  llamar<number>('club_excepciones_abiertas', { p_dias: dias, p_location: local })
/** SIN_CRUCE: facturas sin pedido del día del escaneo, para que el manager elija. */
export interface FacturaCandidata {
  numero_factura: string; hora: string; total_crc: number; area: string | null; mesa: string | null; consecutivo_fe: string | null
  misma_mesa: boolean; asignada_a_otro: boolean
}
/** Sin `buscar`: las sin pedido de ese día. Con `buscar`: por los últimos dígitos del consecutivo (3 a 20). */
export const getCandidatasSinCruce = (movimiento: string, buscar?: string) =>
  llamar<FacturaCandidata[]>('club_sin_cruce_candidatas', { p_movimiento: movimiento, p_buscar: buscar?.trim() || null })
export const elegirFacturaSinCruce = (movimiento: string, numeroFactura: string, nota: string) =>
  llamar<string>('club_sin_cruce_elegir', { p_movimiento: movimiento, p_numero_factura: numeroFactura, p_nota: nota.trim() || null })
export const resolverExcepcion = (tipo: TipoExcepcion, ref: string, nota: string, local = 'santa-teresa') =>
  llamar<boolean>('club_excepcion_resolver', { p_tipo: tipo, p_ref: ref, p_nota: nota, p_location: local })

export interface FilaReporte {
  nombre: string; negocio: string | null; tipo: TipoMiembro
  personas?: number; tarjetas?: number; prom_3m?: number; nuevo_ritmo?: boolean
  creditos?: number; ultima_actividad?: string | null; vence_en?: string
}
export interface ReporteMes {
  mes: string; local: string; generado_en: string
  config: { valor_credito_crc: number; personas_por_credito: number; vencimiento_meses: number; pm_pausado: boolean }
  kpis: {
    tarjetas: number; personas: number; creditos_generados: number; canjes: number; creditos_canjeados: number
    valor_canjeado_crc: number; personas_vencidas: number; referentes_con_visitas: number
    cupones_generados: number; cupones_usados: number; saldo_creditos_al_cierre: number; cuentas_con_saldo: number
    anterior: { tarjetas: number; personas: number; canjes: number; creditos_canjeados: number }
  }
  ranking: FilaReporte[]; subiendo: FilaReporte[]; bajando: FilaReporte[]; a_contactar: FilaReporte[]
  dormidos: { cuentas: number; creditos: number; lista: FilaReporte[] }
  nuevos: { cuentas: number; lista: FilaReporte[] }
  equipo: { personas_mes: number; creditos: number; lista: FilaReporte[] }
  antiguedad: Array<{ tramo: string; cuentas: number; creditos: number; valor_crc: number }>
  pm: { pausado: boolean; nota: string | null; pendiente_crc: number; cargos_mes_crc: number; pagos_mes_crc: number }
  calidad: { abiertas: number; resueltas: number; por_tipo: Record<string, number>; promo_activa: boolean }
  /** CLUB-AUD-04: mes cerrado = reporte congelado (versión y sha256). */
  cerrado?: boolean; version?: number; sha256?: string; cerrado_en?: string; motivo?: string | null
}
export const getReporteMes = (mes: string, local = 'santa-teresa') =>
  llamar<ReporteMes>('club_reporte_mes', { p_mes: mes, p_location: local })
/** Vencimiento por inactividad (solo owner): primero simular, después confirmar con el total exacto. */
export interface CandidatoVencer {
  miembro_id: string; nombre: string; tipo: TipoMiembro; personas: number; creditos: number; ultima_actividad: string | null
}
export const simularVencimiento = (corte: string) => llamar<CandidatoVencer[]>('club_vencer_simular', { p_corte: corte })
export const confirmarVencimiento = (corte: string, total: number) =>
  llamar<number>('club_vencer', { p_corte: corte, p_confirmo_total: total })

/** Solo owner. Recerrar (versión nueva) exige motivo. */
export const cerrarMes = (mes: string, motivo: string, local = 'santa-teresa') =>
  llamar<ReporteMes>('club_reporte_cerrar', { p_mes: mes, p_motivo: motivo.trim() || null, p_location: local })
export const getLocalesClub = async () =>
  (await leer(from<{ location_id: string }>('club_config').select('location_id').order('location_id'))).map(r => r.location_id)

// ── Piloto en paralelo: comparación con la página vieja ──────────────────────
export interface FilaComparacion {
  semana: string; miembro_id: string; referente: string; negocio: string | null
  personas_staging: number; personas_vieja: number | null; diferencia: number
}
export const getComparacion = (desde: string, hasta: string, local = 'santa-teresa') =>
  llamar<FilaComparacion[]>('club_comparacion', { p_desde: desde, p_hasta: hasta, p_location: local })
export const cargarComparacion = (filas: Array<{ referente: string; semana: string; personas: number }>, local = 'santa-teresa') =>
  llamar<{ cargadas: number; no_encontrados: Array<{ referente: string | null; motivo: string }> }>('club_comparacion_cargar',
    { p_filas: filas, p_location: local })

// ── Local Club · A1: roles (una persona, un pase) ────────────────────────────
export type RolMiembro = 'referente' | 'concierge_pm' | 'equipo' | 'socio'
export interface ClubRol { miembro_id: string; rol: RolMiembro; estado: 'pendiente' | 'activo' | 'baja'; desde: string; alta_por: string }
export const getRoles = () => leer(from<ClubRol>('club_miembro_roles').select('miembro_id,rol,estado,desde,alta_por'))
/** Activar a un socio como anfitrión (solo owner o manager, con nota; queda en la auditoría). */
export const activarAnfitrion = (miembro: string, rol: 'referente' | 'concierge_pm' | 'equipo', nota: string) =>
  llamar<boolean>('club_rol_activar_anfitrion', { p_miembro: miembro, p_rol: rol, p_nota: nota })

// ── LC-A2: socios del Local Club ──────────────────────────────────────────────
export interface AltaSocio { miembro_id: string; estado: 'activo'; provisional_hasta: string }
/** Alta en caja (owner, manager, cajero): queda ACTIVO PROVISIONAL hasta que otro manager u owner la confirme. */
export const socioAltaCaja = (nombre: string, whatsapp: string, email: string | null, verificoResidencia: boolean) =>
  llamar<AltaSocio>('club_socio_alta_caja', { p_nombre: nombre, p_whatsapp: whatsapp, p_email: email, p_verifico_residencia: verificoResidencia })
/** Validar en caja una autoalta pendiente: pasa a activo provisional. */
export const socioValidar = (miembro: string, verificoResidencia: boolean) =>
  llamar<AltaSocio>('club_socio_validar', { p_miembro: miembro, p_verifico_residencia: verificoResidencia })
/** Confirmar un alta provisional (owner o manager distinto de quien la cargó). */
export const socioConfirmar = (miembro: string, nota: string) =>
  llamar<boolean>('club_socio_confirmar', { p_miembro: miembro, p_nota: nota })
export interface SocioPorConfirmar {
  miembro_id: string; nombre: string; alta_por: string; registrado_por: string; provisional_hasta: string; puedo_confirmar: boolean
}
export const getSociosPorConfirmar = () => llamar<SocioPorConfirmar[]>('club_socios_por_confirmar', {})
/** Token del botón «Canjear» del pase (CLUB-AUD-69): owner o manager. */
export const paseToken = (miembro: string, accion: 'regenerar' | 'revocar') =>
  llamar<boolean>('club_pase_token', { p_miembro: miembro, p_accion: accion })
