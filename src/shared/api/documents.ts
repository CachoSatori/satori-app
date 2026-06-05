import { supabase } from './supabase'
import { updateMovementStatus } from './cash'
import type { CashMovement } from '../types/database'

export interface DocExtract {
  tipo: 'factura' | 'comprobante_pago' | 'otro'
  proveedor: string
  fecha: string | null
  moneda: 'CRC' | 'USD'
  subtotal: number
  impuesto: number
  total: number
  items: Array<{ descripcion: string; cantidad: number; unidad: string; precio_unitario: number; total: number }>
  metodo_pago: 'Efectivo' | 'Transferencia' | 'SINPE' | 'Bitcoin' | null
  banco: string | null
  referencia: string | null
  clave_fe: string | null
  cuenta_qb_sugerida: string | null
  confianza: number
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

// Sube la imagen al bucket privado y crea la fila documents (estado 'nuevo')
export async function uploadDocument(file: Blob, createdBy: string, filename = 'doc.jpg'): Promise<{ doc: DocumentRow; sha: string }> {
  const sha = await sha256File(file)
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('documents').upload(path, file, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (upErr && !/exists/i.test(upErr.message)) throw new Error(upErr.message)
  const { data, error } = await supabase.from('documents')
    .insert({ image_path: path, sha256: sha, estado: 'nuevo', created_by: createdBy } as never)
    .select().single()
  if (error) throw new Error(error.message)
  return { doc: data as DocumentRow, sha }
}

// Llama a la Edge Function de visión y guarda el resultado en la fila
export async function extractDocument(doc: DocumentRow): Promise<DocExtract | null> {
  try {
    const { data, error } = await supabase.functions.invoke('extract-document', {
      body: { image_path: doc.image_path },
    })
    if (error) throw error
    const ex = data as DocExtract
    await supabase.from('documents').update({
      raw_json: ex as never, tipo: ex.tipo ?? 'otro', clave_fe: ex.clave_fe ?? null,
    } as never).eq('id', doc.id)
    return ex
  } catch {
    return null  // función no desplegada o sin key → el doc queda 'nuevo' para carga manual
  }
}

// Commit AUTOMÁTICO de un documento leído por la IA → genera el movimiento de
// caja (cuenta por pagar / pago) sin intervención. Si la IA no leyó lo
// suficiente (tipo 'otro', total 0, confianza baja) devuelve null y el doc
// queda 'nuevo' para carga manual. El encargado revisa todo en Caja → Movimientos.
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export async function autoCommitDocument(
  doc: DocumentRow, ex: DocExtract, createdBy: string, pendientes: CashMovement[], validAccountIds: Set<string>,
): Promise<{ movementId: string; reconciled: boolean } | null> {
  if (!ex || ex.tipo === 'otro') return null
  const total = N(ex.total)
  if (total <= 0 || N(ex.confianza) < 0.4) return null

  const metodo = ex.metodo_pago || 'Transferencia'
  const esTransfer = metodo === 'Transferencia' || metodo === 'SINPE' || metodo === 'Bitcoin'
  const prov = (ex.proveedor || '').trim()
  const fecha = ex.fecha || new Date().toISOString().slice(0, 10)
  const accId = ex.cuenta_qb_sugerida && validAccountIds.has(ex.cuenta_qb_sugerida) ? ex.cuenta_qb_sugerida : null

  // Comprobante: si hay un único pendiente que matchee → marcar pagado.
  if (ex.tipo === 'comprobante_pago') {
    const pn = prov.toLowerCase()
    const matches = pendientes.filter(m => {
      const okTotal = Math.abs(N(m.amount_crc) - total) <= total * 0.02
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

  // Factura o comprobante sin match único → egreso directo.
  const movementId = await insertInboxMovement({
    created_by: createdBy, movement_type: 'egreso_mercaderia', amount_crc: total,
    description: ex.referencia ? `${prov || 'Factura'} · ${ex.referencia}` : (prov || 'Factura'),
    subcategory: prov || '', supplier_name: prov || '', method: metodo,
    caja_origen: esTransfer ? 'Banco' : 'Caja Proveedores',
    status: ex.tipo === 'comprobante_pago' ? 'aprobado' : (esTransfer ? 'pendiente' : 'aprobado'),
    account_id: accId, fecha,
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

export async function countInbox(): Promise<number> {
  const { count } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('estado', 'nuevo')
  return count ?? 0
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export async function setDocEstado(id: string, estado: 'procesado' | 'descartado', linkedMovementId?: string): Promise<void> {
  const patch: Record<string, unknown> = { estado }
  if (linkedMovementId) patch.linked_movement_id = linkedMovementId
  const { error } = await supabase.from('documents').update(patch as never).eq('id', id)
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
  } as never).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}
