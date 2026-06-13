import { supabase } from './supabase'

// Foto de producto — bucket PÚBLICO 'productos' (mig 030). photo_url en product_map
// guarda la URL pública directa: cacheable por el navegador/SW, sirve offline una vez
// vista, sin firmas que expiren.
const BUCKET = 'productos'
const MAX_DIM = 480          // lado máximo del thumbnail (las tablets no cargan imágenes pesadas)
const JPEG_QUALITY = 0.82

/** Redimensiona/comprime una imagen a un thumbnail JPEG antes de subir (canvas, puro
 *  cliente). Si algo falla, devuelve el archivo original (la subida igual funciona). */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
    return blob ?? file
  } catch {
    return file
  }
}

/** Sube la foto (comprimida) y devuelve la URL pública. */
export async function uploadProductPhoto(productName: string, file: File): Promise<string> {
  const blob = await compressImage(file)
  const slug = productName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40)
  const path = `${slug}-${crypto.randomUUID().slice(0, 8)}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Borra la foto del bucket por su URL pública (best-effort; no bloquea si falla). */
export async function deleteProductPhoto(photoUrl: string): Promise<void> {
  const marker = `/${BUCKET}/`
  const idx = photoUrl.indexOf(marker)
  if (idx < 0) return
  const path = photoUrl.slice(idx + marker.length).split('?')[0]
  await supabase.storage.from(BUCKET).remove([path]).catch(() => { /* best-effort */ })
}
