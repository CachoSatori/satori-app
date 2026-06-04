/**
 * Supabase Edge Function — extract-document (Satori · Fase 2D-B)
 *
 * Recibe { image_path } (ruta en el bucket privado 'documents'), baja la imagen
 * con service role, la manda a la API de Anthropic (visión) y devuelve un JSON
 * ESTRICTO con los datos de la factura/comprobante. La API key vive SOLO en el
 * Vault de Supabase (ANTHROPIC_API_KEY) — nunca en el cliente.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (una vez)
 *   supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf
 *
 * Invocación (cliente): supabase.functions.invoke('extract-document', { body: { image_path } })
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Modelo de visión. Haiku 4.5 = el más barato. Cambialo a 'claude-sonnet-4-5'
// si querés más precisión (más caro). Override por env ANTHROPIC_MODEL.
const MODEL             = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMPTY = {
  tipo: 'otro', proveedor: '', fecha: null, moneda: 'CRC',
  subtotal: 0, impuesto: 0, total: 0, items: [],
  metodo_pago: null, banco: null, referencia: null, clave_fe: null,
  cuenta_qb_sugerida: null, confianza: 0,
}

const PROMPT = `Sos un asistente contable de un restaurante en Costa Rica. Analizá la imagen
(una factura, tiquete o comprobante de pago) y devolvé ÚNICAMENTE un objeto JSON válido,
sin texto antes ni después, con EXACTAMENTE estas claves:

{
  "tipo": "factura" | "comprobante_pago" | "otro",
  "proveedor": "nombre del proveedor o comercio",
  "fecha": "YYYY-MM-DD",
  "moneda": "CRC" | "USD",
  "subtotal": number,
  "impuesto": number,
  "total": number,
  "items": [{"descripcion": string, "cantidad": number, "unidad": string, "precio_unitario": number, "total": number}],
  "metodo_pago": "Efectivo" | "Transferencia" | "SINPE" | "Bitcoin" | null,
  "banco": "BAC" | "BN" | "Lafise" | string | null,
  "referencia": string | null,
  "clave_fe": "clave numérica de 50 dígitos si es Factura Electrónica CR, si no null",
  "cuenta_qb_sugerida": string | null,
  "confianza": number
}

Reglas:
- "factura" = documento que pide pago (factura electrónica CR, tiquete, factura física). "comprobante_pago" = captura de SINPE, transferencia BAC/BN/Lafise, recibo de pago ya hecho.
- Montos como números sin separadores de miles ni símbolo. Si no ves un dato, usá null o 0.
- "clave_fe": la clave numérica larga (50 dígitos) típica de la Factura Electrónica de Hacienda CR.
- "confianza": 0.0 a 1.0 según qué tan legible/seguro estás.
- Respondé SOLO el JSON.`

function mediaType(path: string): string {
  const p = path.toLowerCase()
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.webp')) return 'image/webp'
  if (p.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { image_path } = await req.json()
    if (!image_path) return json({ ...EMPTY }, 400)
    if (!ANTHROPIC_API_KEY) return json({ ...EMPTY, error: 'ANTHROPIC_API_KEY no configurada' }, 200)

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: file, error: dlErr } = await sb.storage.from('documents').download(image_path)
    if (dlErr || !file) return json({ ...EMPTY, error: 'No se pudo bajar la imagen' }, 200)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const b64 = toBase64(bytes)

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType(image_path), data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })

    if (!resp.ok) {
      const t = await resp.text()
      return json({ ...EMPTY, error: `Anthropic ${resp.status}: ${t.slice(0, 200)}` }, 200)
    }
    const data = await resp.json()
    const text: string = data?.content?.[0]?.text ?? ''
    const parsed = safeParse(text)
    return json(parsed, 200)
  } catch (e) {
    return json({ ...EMPTY, error: String(e) }, 200)
  }
})

function safeParse(text: string): Record<string, unknown> {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < 0) return { ...EMPTY }
    const obj = JSON.parse(text.slice(start, end + 1))
    return { ...EMPTY, ...obj }
  } catch { return { ...EMPTY } }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
