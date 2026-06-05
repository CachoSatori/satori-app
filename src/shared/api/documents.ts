import { supabase } from './supabase'
import { updateMovementStatus } from './cash'
import type { CashMovement, Json } from '../types/database'

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
export async function findDuplicate(sha: string, claveFe: string | null): Promise<DocumentRow | null> {
  let q = supabase.from('documents').select('*').neq('estado', 'descartado').limit(1)
  q = claveFe ? q.or(`sha256.eq.${sha},clave_fe.eq.${claveFe}`) : q.eq('sha256', sha)
  const { data } = await q
  return (data?.[0] as DocumentRow | undefined) ?? null
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
    return Array.isArray(docs) ? docs : []
  } catch {
    return []  // función no desplegada o sin key → se crea 1 fila vacía para carga manual
  }
}

// Crea una fila en documents para un documento detectado (o vacía si ex es null).
export async function createDocumentRow(path: string, sha: string, ex: DocExtract | null, createdBy: string): Promise<DocumentRow> {
  const { data, error } = await supabase.from('documents')
    .insert({
      image_path: path, sha256: sha, estado: 'nuevo', created_by: createdBy,
      raw_json: (ex ?? null) as unknown as Json, tipo: ex?.tipo ?? null, clave_fe: ex?.clave_fe ?? null,
    })
    .select().single()
  if (error) throw new Error(error.message)
  return data as DocumentRow
}

// Commit AUTOMÁTICO de un documento leído por la IA → genera el movimiento de
// caja (cuenta por pagar / pago) sin intervención. Si la IA no leyó lo
// suficiente (tipo 'otro', total 0, confianza baja) devuelve null y el doc
// queda 'nuevo' para carga manual. El encargado revisa todo en Caja → Movimientos.
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

// Auto-genera el movimiento si la IA leyó con confianza. Propinas/otro y los que
// requieren revisión NO se auto-generan (quedan para validación humana).
export async function autoCommitDocument(
  doc: DocumentRow, ex: DocExtract, createdBy: string, pendientes: CashMovement[], validAccountIds: Set<string>, tc: number,
): Promise<{ movementId: string; reconciled: boolean } | null> {
  if (!ex) return null
  const tipo = ex.tipo === 'proforma' ? 'factura' : ex.tipo
  if (tipo !== 'factura' && tipo !== 'comprobante_pago') return null   // propinas/otro → manual
  const total = N(ex.total)
  if (total <= 0 || N(ex.confianza) < 0.4) return null
  if (ex.requiere_revision || !cuadra(ex)) return null                 // necesita validación humana

  const metodo = ex.metodo_pago || 'Transferencia'
  const esTransfer = metodo === 'Transferencia' || metodo === 'SINPE' || metodo === 'Bitcoin'
  const esUSD = ex.moneda === 'USD'
  const prov = (ex.proveedor || '').trim()
  const fecha = ex.fecha || new Date().toISOString().slice(0, 10)
  const accId = ex.cuenta_qb_sugerida && validAccountIds.has(ex.cuenta_qb_sugerida) ? ex.cuenta_qb_sugerida : null
  const amountCRC = esUSD ? Math.round(total * (tc || 1)) : total
  const amountUSD = esUSD ? total : 0

  // Comprobante: si hay un único pendiente que matchee → marcar pagado.
  if (tipo === 'comprobante_pago') {
    const pn = prov.toLowerCase()
    const matches = pendientes.filter(m => {
      const okTotal = Math.abs(N(m.amount_crc) - amountCRC) <= amountCRC * 0.02
      const okProv = pn && (m.supplier_name || '').toLowerCase().includes(pn.slice(0, 4))
      const okFecha = Math.abs((new Date(fecha).getTime() - new Date(m.created_at.slice(0, 10)).getTime()) / 86400000) <= 7
      return okTotal && (okProv || !pn) && okFecha
    })
    if (matches.length === 1) {
      await updateMovementStatus(matches[0].id, 'aprobado')
      await setDocEstado(doc.id, 'procesado', matches[0].id)
      return { movementId: matches[0].id, reconciled: true }
    }
  }

  // condicion_pago manda el status: credito = cuenta por pagar (pendiente).
  const status: 'aprobado' | 'pendiente' =
    tipo === 'comprobante_pago' ? 'aprobado'
    : ex.condicion_pago === 'credito' ? 'pendiente'
    : ex.condicion_pago === 'contado' ? 'aprobado'
    : (esTransfer ? 'pendiente' : 'aprobado')

  const movementId = await insertInboxMovement({
    created_by: createdBy, movement_type: 'egreso_mercaderia', amount_crc: amountCRC, amount_usd: amountUSD,
    description: ex.referencia || ex.numero_documento ? `${prov || 'Factura'} · ${ex.referencia || ex.numero_documento}` : (prov || 'Factura'),
    subcategory: prov || '', supplier_name: prov || '', method: metodo,
    caja_origen: esTransfer || status === 'pendiente' ? 'Banco' : 'Caja Proveedores',
    status, account_id: accId, fecha,
  })
  await setDocEstado(doc.id, 'procesado', movementId)
  return { movementId, reconciled: false }
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

export async function setDocEstado(id: string, estado: 'procesado' | 'descartado', linkedMovementId?: string): Promise<void> {
  const { error } = await supabase.from('documents')
    .update({ estado, ...(linkedMovementId ? { linked_movement_id: linkedMovementId } : {}) })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Inserta un movimiento de caja a nivel día (sin turno) desde la Bandeja
export async function insertInboxMovement(m: {
  created_by: string
  movement_type: string
  amount_crc: number
  amount_usd?: number
  description: string
  subcategory?: string
  supplier_name?: string
  method: string
  caja_origen: string
  status: 'aprobado' | 'pendiente'
  account_id?: string | null
  fecha?: string | null
}): Promise<string> {
  const ts = m.fecha ? `${m.fecha}T12:00:00Z` : new Date().toISOString()
  const { data, error } = await supabase.from('cash_movements').insert({
    session_id: null, created_by: m.created_by, movement_type: m.movement_type,
    amount_crc: m.amount_crc, amount_usd: m.amount_usd ?? 0, currency: 'CRC',
    description: m.description, subcategory: m.subcategory ?? '', supplier_name: m.supplier_name ?? '',
    method: m.method, caja_origen: m.caja_origen, status: m.status,
    account_id: m.account_id ?? null, created_at: ts, updated_at: ts,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}
