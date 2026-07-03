import { supabase } from './supabase'

// Fotos de facturas de proveedor — bucket privado 'facturas' (migración 026).
// El path queda vinculado al movimiento en cash_movements.attachments (jsonb []).
const BUCKET = 'facturas'

// Sube una foto → devuelve el path. Storage NO pasa por el outbox offline:
// requiere conexión; si falla, el caller registra el pago igual y avisa.
export async function uploadFacturaPhoto(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

// URL firmada (bucket privado) con caché en memoria: las miniaturas de la lista
// se re-renderizan seguido y no queremos pedir una firma por render.
const urlCache = new Map<string, { url: string; exp: number }>()
export async function getFacturaUrl(path: string): Promise<string> {
  const hit = urlCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo cargar la foto')
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3_300_000 })  // ~55 min < 1h de la firma
  return data.signedUrl
}

// attachments llega como jsonb — normaliza a string[] defensivamente.
export function movementAttachments(m: { attachments?: unknown }): string[] {
  return Array.isArray(m.attachments)
    ? (m.attachments as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
}
