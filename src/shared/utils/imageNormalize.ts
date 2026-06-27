// Normaliza la foto de una factura ANTES de subirla. Una factura capturada con el teléfono sale
// pesada, a veces en HEIC (iOS) y con la orientación guardada en EXIF: Anthropic no la procesa →
// vuelve vacía → "sin leer". Acá la decodificamos respetando EXIF (createImageBitmap convierte
// HEIC→bitmap en iOS Safari), la reescalamos a un lado largo razonable y la re-exportamos como
// JPEG. Así la IA siempre recibe un JPEG válido y liviano, venga de la cámara, la galería o el
// share de WhatsApp. Si algo falla, devolvemos el blob ORIGINAL para no empeorar lo de hoy.

// Lado largo máximo que mandamos a la IA. Anthropic reescala internamente las imágenes a ~1568px
// de lado largo; mandar más grande no mejora la lectura y sí encarece/relentiza la subida móvil.
export const MAX_LONG_SIDE = 1568
const JPEG_QUALITY = 0.82

// Cálculo PURO de las dimensiones destino: escala para que el lado largo quede ≤ max, sin AGRANDAR
// si la imagen ya es más chica. Redondea a entero. Separado para poder testearlo sin canvas
// (createImageBitmap/canvas no corren en happy-dom).
export function targetDimensions(
  width: number,
  height: number,
  maxLongSide = MAX_LONG_SIDE,
): { width: number; height: number } {
  const longSide = Math.max(width, height)
  if (longSide <= 0 || longSide <= maxLongSide) return { width, height }
  const scale = maxLongSide / longSide
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

// Decodifica el blob a algo dibujable en canvas, respetando la orientación EXIF.
async function decodeImage(input: Blob): Promise<Decoded> {
  // Camino 1: createImageBitmap respeta EXIF (imageOrientation) y decodifica HEIC en iOS Safari.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* navegador sin soporte / formato no soportado → camino 2 */ }
  }
  // Camino 2: <img> + object URL (no convierte HEIC, pero cubre el resto).
  const url = URL.createObjectURL(input)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('no se pudo decodificar la imagen'))
      el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// Extensión coherente con los bytes del blob (solo para el fallback, donde NO recodificamos).
function extForBlob(b: Blob): string {
  switch ((b.type || '').toLowerCase()) {
    case 'image/png':  return 'png'
    case 'image/webp': return 'webp'
    case 'image/heic':
    case 'image/heif': return 'heic'
    default:           return 'jpg'   // jpeg o desconocido → jpg (igual que el default de uploadImage)
  }
}

// Devuelve un JPEG normalizado + un nombre estable terminado en .jpg. Ante cualquier fallo de
// decodificación/encode, devuelve el blob ORIGINAL (con extensión coherente) sin romper el flujo.
export async function normalizeInvoiceImage(input: Blob): Promise<{ blob: Blob; filename: string }> {
  try {
    const { source, width, height, release } = await decodeImage(input)
    try {
      if (!width || !height) throw new Error('imagen sin dimensiones')
      const { width: tw, height: th } = targetDimensions(width, height)
      const canvas = document.createElement('canvas')
      canvas.width = tw; canvas.height = th
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas sin contexto 2d')
      // Fondo blanco: el JPEG no tiene alfa; sin esto, un PNG con transparencia saldría con fondo negro.
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th)
      ctx.drawImage(source, 0, 0, tw, th)
      const blob = await canvasToJpeg(canvas, JPEG_QUALITY)
      if (!blob) throw new Error('canvas.toBlob devolvió null')
      return { blob, filename: `factura-${Date.now()}.jpg` }
    } finally {
      release()
    }
  } catch (e) {
    console.warn('[normalizeInvoiceImage] no se pudo normalizar; se sube el original:', e)
    return { blob: input, filename: `factura-${Date.now()}.${extForBlob(input)}` }
  }
}
