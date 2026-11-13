import { supabase } from './supabase'
import { createDayMovement } from './cash'
import type { Json } from '../types/database'
import { documentoVigente, mismaFactura, normNumero, MSG_NO_VERIFICA } from '../utils/facturaDuplicada'
import { normalizarFechaFactura } from '../utils/fechaFactura'
import { todayCR } from '../utils'

export interface DocItem {
  codigo?: string | null; descripcion: string; cantidad?: number | null; unidad?: string | null
  precio_unitario?: number | null; descuento?: number | null; iva_pct?: number | null; total?: number | null
}
export interface DocExtract {
  tipo: 'factura' | 'proforma' | 'comprobante_pago' | 'propinas' | 'otro'
  proveedor: string | null
  proveedor_cedula?: string | null
  numero_documento?: string | null
  clave_fe: string | null
  fecha: string | null
  moneda: 'CRC' | 'USD'
  condicion_pago?: 'contado' | 'credito' | null
  plazo_dias?: number | null
  metodo_pago: 'Efectivo' | 'Transferencia' | 'SINPE' | 'Bitcoin' | null
  banco: string | null
  referencia: string | null
  concepto?: string | null
  subtotal: number | null
  descuento?: number | null
  impuesto_1pct?: number | null
  impuesto_13pct?: number | null
  impuesto_total?: number | null
  total: number | null
  items: DocItem[]
  cuenta_qb_sugerida: string | null
  confianza: number
  requiere_revision?: boolean
  error?: string
  // (13-nov) Puestos por el cliente, no por la IA (ver conFechaCR): la fecha tal como la leyó la IA, de dónde sale la
  // `fecha` final y el aviso para el usuario, si hay que revisarla.
  fecha_leida?: string | null
  fecha_origen?: 'clave' | 'invertida' | 'ia' | 'ninguna'
  aviso_fecha?: string | null
}

// (13-nov) Costa Rica escribe DÍA/MES: la IA a veces lee «9/11/2026» como 2026-09-11. Toda lectura pasa por acá antes de
// precargar nada: la clave FE manda; una fecha ambigua imposible (futura o vieja con la invertida reciente) se invierte
// con aviso. `hoy` = fecha de Costa Rica.
export function conFechaCR(ex: DocExtract, hoy: string = todayCR()): DocExtract {
  if (!ex || typeof ex !== 'object') return ex
  const n = normalizarFechaFactura(ex.fecha, ex.clave_fe, hoy)
  return { ...ex, fecha: n.fecha, fecha_leida: ex.fecha ?? null, fecha_origen: n.origen, aviso_fecha: n.aviso }
}

export interface DocumentRow {
  id: string
  image_path: string
  sha256: string | null
  clave_fe: string | null
  tipo: string | null
  raw_json: DocExtract | null
  estado: 'nuevo' | 'procesado' | 'descartado'
  linked_movement_id: string | null
  created_by: string | null
  created_at: string
}

// SHA-256 de un archivo (anti-duplicado) — crypto.subtle nativo
export async function sha256File(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ¿Ya se procesó un documento igual? (sha256 o clave_fe). Devuelve el doc si existe.
// (13-nov) Solo cuentan los documentos VIGENTES (`documentoVigente`): un huérfano —su movimiento se borró— o un
// descartado no bloquean la recarga de la misma foto. La base ya excluye los descartados; los huérfanos se filtran acá
// (por eso trae hasta 20 candidatos y no 1).
// (13-nov, verificación) «Falla cerrada», igual que findDuplicateClave y findFacturaParecida: si la consulta falla (error
// de la base o sin red) se LANZA MSG_NO_VERIFICA y la pantalla no registra nada. Antes un error dejaba pasar la foto.
export async function findDuplicate(sha: string, claveFe: string | null): Promise<DocumentRow | null> {
  const data = await consultarVerificacion(() => {
    let q = supabase.from('documents').select('*').neq('estado', 'descartado')
    q = claveFe ? q.or(`sha256.eq.${sha},clave_fe.eq.${claveFe}`) : q.eq('sha256', sha)
    return q.order('created_at', { ascending: false }).limit(20)
  })
  return data.find(documentoVigente) ?? null
}

// (D11 = B) Todos los documentos VIGENTES de una misma foto (sha), para saber cuáles de sus facturas ya se cargaron.
// Falla cerrada como findDuplicate.
export async function findDocsPorSha(sha: string): Promise<DocumentRow[]> {
  const data = await consultarVerificacion(() => supabase.from('documents').select('*').neq('estado', 'descartado')
    .eq('sha256', sha).order('created_at', { ascending: true }).limit(50))
  return data.filter(documentoVigente)
}

// Corre una consulta de duplicados: error devuelto o excepción (red) → Error(MSG_NO_VERIFICA). Nunca «no hay duplicado».
async function consultarVerificacion(
  consulta: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<DocumentRow[]> {
  let res: { data: unknown; error: { message: string } | null }
  try { res = await consulta() } catch { throw new Error(MSG_NO_VERIFICA) }
  if (res.error) throw new Error(MSG_NO_VERIFICA)
  return (res.data ?? []) as DocumentRow[]
}

// Sube SOLO la imagen al bucket privado (sin crear fila todavía).
export async function uploadImage(file: Blob, filename = 'doc.jpg'): Promise<{ path: string; sha: string }> {
  const sha = await sha256File(file)
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('documents').upload(path, file, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (upErr && !/exists/i.test(upErr.message)) throw new Error(upErr.message)
  return { path, sha }
}

// Llama a la Edge Function de visión → lista de documentos detectados en la imagen.
export async function extractImage(imagePath: string): Promise<DocExtract[]> {
  try {
    const { data, error } = await supabase.functions.invoke('extract-document', { body: { image_path: imagePath } })
    if (error) throw error
    const docs = (data as { documentos?: DocExtract[] })?.documentos
    return Array.isArray(docs) ? docs.map(d => conFechaCR(d)) : []
  } catch {
    return []  // función no desplegada o sin key → se crea 1 fila vacía para carga manual
  }
}

// (13-nov) Como extractImage, pero distingue «la lectura FALLÓ» (la función dio error, no está desplegada o no hubo red)
// de «la IA no vio documentos» (respondió bien con una lista vacía). extractImage queda igual para las otras pantallas.
export async function extractImageDetalle(imagePath: string): Promise<{ documentos: DocExtract[]; fallo: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('extract-document', { body: { image_path: imagePath } })
    if (error) return { documentos: [], fallo: true }
    const docs = (data as { documentos?: DocExtract[] })?.documentos
    return Array.isArray(docs) ? { documentos: docs.map(d => conFechaCR(d)), fallo: false } : { documentos: [], fallo: true }
  } catch {
    return { documentos: [], fallo: true }
  }
}

// (13-nov) ¿Ya hay un documento vigente (no descartado) con esta clave FE? Bloquea, como la misma foto.
export async function findDuplicateClave(claveFe: string | null | undefined): Promise<DocumentRow | null> {
  const clave = String(claveFe ?? '').replace(/\D/g, '')
  if (clave.length < 20) return null   // sin una clave FE de verdad (50 dígitos) no se compara
  const data = await consultarVerificacion(() => supabase.from('documents').select('*').neq('estado', 'descartado')
    .eq('clave_fe', claveFe as string).order('created_at', { ascending: false }).limit(20))
  return data.find(documentoVigente) ?? null   // huérfanos fuera (ver findDuplicate)
}

// (13-nov) ¿Ya hay una factura vigente del mismo proveedor, con el mismo número y el mismo total (otra foto)? Solo avisa.
// Trae candidatos por número (ilike, para tolerar ceros a la izquierda y espacios) y decide con `mismaFactura`.
export async function findFacturaParecida(ex: DocExtract | null): Promise<DocumentRow | null> {
  const num = normNumero(ex?.numero_documento)
  if (!ex || !num) return null
  const filas = await consultarVerificacion(() => supabase.from('documents').select('*').neq('estado', 'descartado')
    .ilike('raw_json->>numero_documento', `%${num}%`).order('created_at', { ascending: false }).limit(20))
  return filas.find(d => documentoVigente(d) && d.raw_json && mismaFactura(ex, d.raw_json)) ?? null
}

// Crea una fila en documents para un documento detectado (o vacía si ex es null).
// `linkedMovementId` + `estado` permiten adjuntar una foto a un movimiento ya creado
// (p. ej. "Agregar foto" a un pago manual sin factura): se enlaza directo y queda
// 'procesado'. Por defecto (carga normal en la Bandeja) entra como 'nuevo' sin enlace.
export async function createDocumentRow(
  path: string,
  sha: string,
  ex: DocExtract | null,
  createdBy: string,
  linkedMovementId?: string | null,
  estado: 'nuevo' | 'procesado' = 'nuevo',
): Promise<DocumentRow> {
  const { data, error } = await supabase.from('documents')
    .insert({
      image_path: path, sha256: sha, estado, created_by: createdBy,
      raw_json: (ex ?? null) as unknown as Json, tipo: ex?.tipo ?? null, clave_fe: ex?.clave_fe ?? null,
      ...(linkedMovementId ? { linked_movement_id: linkedMovementId } : {}),
    })
    .select().single()
  if (error) throw new Error(error.message)
  return data as DocumentRow
}

// La IA solo PRECARGA: ningún movimiento se crea automáticamente (feat/bandeja-fusion).
// Todo documento leído queda 'nuevo' en la cola; el humano confirma monto + forma de
// pago en la Bandeja antes de generar el movimiento de caja. `cuadra` ayuda a marcar
// los que necesitan revisión humana (manuscrito / no cuadra).
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ¿La suma de ítems + impuestos − descuento cuadra con el total? (tolerancia 2%)
export function cuadra(ex: DocExtract): boolean {
  const total = N(ex.total)
  if (total <= 0 || !ex.items?.length) return true   // sin datos para cruzar → no bloquea
  const sumItems = ex.items.reduce((s, it) => s + N(it.total), 0)
  const imp = N(ex.impuesto_total) || (N(ex.impuesto_1pct) + N(ex.impuesto_13pct))
  const calc = sumItems + imp - N(ex.descuento)
  return Math.abs(calc - total) <= Math.max(total * 0.02, 50)
}

export async function listInbox(estado: 'nuevo' | 'procesado' | 'descartado' = 'nuevo'): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*')
    .eq('estado', estado).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as DocumentRow[]
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// La foto (documents) enlazada a un movimiento de caja — para el verificado de
// factura (FacturaVerify). Devuelve la más reciente o null si no hay factura cargada.
export async function getDocByMovement(movementId: string): Promise<DocumentRow | null> {
  const { data } = await supabase.from('documents').select('*')
    .eq('linked_movement_id', movementId).order('created_at', { ascending: false }).limit(1)
  return (data?.[0] as DocumentRow | undefined) ?? null
}

// Todas las facturas ya enlazadas a un movimiento (estado 'procesado') — para
// listar los gastos con foto en Finanzas / Caja sin una consulta por fila.
export async function listLinkedDocs(): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*')
    .eq('estado', 'procesado').not('linked_movement_id', 'is', null)
    .order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as DocumentRow[]
}

export async function setDocEstado(id: string, estado: 'procesado' | 'descartado', linkedMovementId?: string): Promise<void> {
  const { error } = await supabase.from('documents')
    .update({ estado, ...(linkedMovementId ? { linked_movement_id: linkedMovementId } : {}) })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Inserta un movimiento de caja a nivel día (sin turno) desde la Bandeja.
// Delega en createDayMovement (cash.ts) — misma lógica de inserción, una sola
// fuente, para que el alta manual y la auto-generada por la Bandeja no diverjan.
export async function insertInboxMovement(m: {
  created_by: string
  movement_type: string
  amount_crc: number
  amount_usd?: number
  description: string
  subcategory?: string
  supplier_id?: string | null
  supplier_name?: string
  method: string
  caja_origen: string
  status: 'aprobado' | 'pendiente'
  account_id?: string | null
  fecha?: string | null
  // Unificación Bandeja↔Caja (040-043): clasificación de mercadería → tarea de Revisión (pass-through).
  classification?: string
  suggested_classification?: string
  suggested_confidence?: number
}): Promise<string> {
  return createDayMovement(m)
}
