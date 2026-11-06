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
  codigo: string; estado: 'activo' | 'baja'; origen: string; created_at: string
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
           canjeado_hoy: number; canje_min: number; canje_paso: number; max_creditos_por_visita: number }
}
export type ResolverResultado = ResolverCupon | ResolverReferente | { tipo: 'desconocido'; datos: Record<string, never> }

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
  if (/permission denied|sin permiso/i.test(msg)) return new ClubError('Tu usuario no tiene permiso para esto.', false)
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
 * Referencia al PoS para el piloto (decisión de Ismael, 06-nov): la caja elige la MESA ABIERTA del
 * puente; si la mesa ya se cerró o la lista no carga, plan B: mesa + últimos 4 dígitos del tiquete.
 * El cruce con la factura cerrada es «probable» hasta que el puente traiga el consecutivo (ítem 11).
 */
export type PosRef =
  | { modo: 'mesa'; dia: string; pedido: string; mesa: string; total: number; hora: string }
  | { modo: 'manual'; mesa: string; ultimos4: string }
export interface MesaAbierta {
  pedido: string; mesa: string; salonero: string | null; total_crc: number | null; pax: number | null
  actualizado: string; dia: string
}
export const getMesasAbiertas = (local = 'santa-teresa') => llamar<MesaAbierta[]>('club_mesas_abiertas', { p_location: local })
export const posDeMesa = (m: MesaAbierta): PosRef =>
  ({ modo: 'mesa', dia: m.dia, pedido: m.pedido, mesa: m.mesa, total: Number(m.total_crc ?? 0), hora: new Date().toISOString() })
export const describirPos = (p: PosRef) =>
  p.modo === 'mesa'
    ? `mesa ${p.mesa} · ₡${Math.round(p.total).toLocaleString('de-DE')}`
    : `mesa ${p.mesa} · tiquete …${p.ultimos4}`
/** Plan B válido: mesa (1–10 letras o números) y exactamente 4 números. */
export const planBValido = (mesa: string, ultimos4: string) => /^[0-9A-Za-z]{1,10}$/.test(mesa.trim()) && /^[0-9]{4}$/.test(ultimos4)

export const usarCupon = async (codigo: string, personas: number, pos: PosRef, op: string) =>
  primero(await llamar<Array<Saldo & { miembro_id: string }>>('club_cupon_usar',
    { p_codigo: codigo, p_personas: personas, p_factura: null, p_op: op, p_pos: pos }))

export const canjear = async (miembro: string, creditos: number, pos: PosRef, op: string) =>
  primero(await llamar<Saldo[]>('club_canje', { p_miembro: miembro, p_creditos: creditos, p_factura: null, p_op: op, p_pos: pos }))

export const tarjetaManual = async (miembro: string, personas: number, pos: PosRef, op: string) =>
  primero(await llamar<Saldo[]>('club_tarjeta_manual', { p_miembro: miembro, p_personas: personas, p_factura: null, p_op: op, p_pos: pos }))

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
const COLS_MIEMBRO = 'id,tipo,nombre,negocio_id,codigo,estado,origen,created_at'

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
export type TipoExcepcion = 'PROMO_SIN_CUPON' | 'CREDITOS_SIN_CANJE' | 'CANJE_MONTO_DISTINTO' | 'REGISTRO_SIN_FACTURA'
export interface Excepcion {
  tipo: TipoExcepcion; ref: string; fecha: string; factura: string | null; certeza: 'exacta' | 'probable'
  detalle: Record<string, unknown>; resuelta: boolean; nota: string | null; resuelta_en: string | null
}

export const getExcepciones = (desde: string, hasta: string, local = 'santa-teresa') =>
  llamar<Excepcion[]>('club_excepciones', { p_desde: desde, p_hasta: hasta, p_location: local })
export const getExcepcionesAbiertas = (dias = 30, local = 'santa-teresa') =>
  llamar<number>('club_excepciones_abiertas', { p_dias: dias, p_location: local })
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
}
export const getReporteMes = (mes: string, local = 'santa-teresa') =>
  llamar<ReporteMes>('club_reporte_mes', { p_mes: mes, p_location: local })
export const getLocalesClub = async () =>
  (await leer(from<{ location_id: string }>('club_config').select('location_id').order('location_id'))).map(r => r.location_id)
