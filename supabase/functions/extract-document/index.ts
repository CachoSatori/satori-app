/**
 * Supabase Edge Function — extract-document (Satori · Fase 2D-B v2)
 *
 * Recibe { image_path }, baja la imagen del bucket privado 'documents', la manda
 * a Anthropic (visión) y devuelve { documentos: [...] } — una foto puede traer
 * varios documentos (facturas/tiquetes juntos). La key vive SOLO en el Vault.
 *
 * Seguridad: exige el JWT del usuario (Authorization) y baja la imagen con un
 * cliente con ESE token, de modo que el RLS de storage (mig 016: documents_storage_rw,
 * rol en owner/manager/contador/cajero) sea el portón. NO usa la service_role para
 * el download → cierra el IDOR. CORS por allowlist (prod + staging).
 *
 * Secretos de identidad del cliente: NEGOCIO_NOMBRE, NEGOCIO_RAZON_SOCIAL, NEGOCIO_CEDULA (ver
 * docs/pases/EDGE-extract-document-sin-datos.md).
 *
 * Deploy: supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { armarPrompt, leerNegocio } from './prompt.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
// Haiku 4.5 = más barato; cambiá a 'claude-sonnet-4-5' por env si querés más precisión.
const MODEL             = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5'
// Sonnet 4.5 se retira de la API el 30-nov-2026; el reemplazo es claude-sonnet-5-5.
// El tokenizer de 5.5 cuenta ~30 % más tokens para el mismo JSON: 3500 podía cortarlo.
const MAX_TOKENS        = 8000

// En Sonnet 5.5 el thinking viene encendido por defecto y `disabled` da 400: `between_tools` es
// "sin thinking" (como corría con 4.5). Esos campos dan 400 en Sonnet 4.5 / Haiku 4.5, por eso
// solo van si el secreto apunta a 5.5: el mismo código sirve antes y después del cambio de secreto.
function opcionesModelo(model: string): Record<string, unknown> {
  if (model.startsWith('claude-sonnet-5-5')) {
    return { thinking: { type: 'between_tools' }, output_config: { effort: 'high' } }
  }
  return {}
}

// Allowlist de orígenes web conocidos. El '*' anterior dejaba que cualquier sitio
// llamara la función desde el browser; ahora solo eco del Origin si está permitido.
const ALLOWED_ORIGINS = new Set([
  'https://cachosatori.github.io',    // prod — GitHub Pages (base /satori-app/)
  'https://satori-staging.pages.dev', // staging — Cloudflare Pages
])

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

const DOC_DEFAULTS = {
  tipo: 'otro', proveedor: null, proveedor_cedula: null, numero_documento: null,
  clave_fe: null, fecha: null, moneda: 'CRC', condicion_pago: null, plazo_dias: null,
  metodo_pago: null, banco: null, referencia: null, concepto: null,
  subtotal: null, descuento: null, impuesto_1pct: null, impuesto_13pct: null,
  impuesto_total: null, total: null, items: [],
  cuenta_qb_sugerida: null, confianza: 0, requiere_revision: true,
}

// La identidad del cliente sale de secretos de la Edge (D15 = A): el repo público no la tiene escrita.
// Si falta alguno, el prompt usa un texto genérico y se avisa UNA vez en el log (solo los nombres, nunca valores).
const { negocio: NEGOCIO, faltantes: NEGOCIO_FALTANTES } = leerNegocio((k) => Deno.env.get(k))
if (NEGOCIO_FALTANTES.length) {
  console.warn(`extract-document: faltan secretos ${NEGOCIO_FALTANTES.join(', ')}; el prompt usa un texto genérico del cliente`)
}
const PROMPT = armarPrompt(NEGOCIO)

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
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1) Exigir el JWT del usuario (el cliente lo reenvía vía supabase.functions.invoke).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ documentos: [], error: 'No autorizado' }, 401)

    const { image_path } = await req.json()
    if (!image_path) return json({ documentos: [] }, 400)
    if (!ANTHROPIC_API_KEY) return json({ documentos: [], error: 'ANTHROPIC_API_KEY no configurada' }, 200)

    // 2) Cliente con el token del usuario → aplica RLS (NO service_role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    // 3) Verificar que el token corresponde a un usuario real.
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ documentos: [], error: 'No autorizado' }, 401)

    // 4) Bajar la imagen CON el cliente del usuario → el RLS de storage (mig 016) es el portón.
    const { data: file, error: dlErr } = await userClient.storage.from('documents').download(image_path)
    if (dlErr || !file) return json({ documentos: [], error: 'Sin acceso al documento' }, 403)

    const b64 = toBase64(new Uint8Array(await file.arrayBuffer()))
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        ...opcionesModelo(MODEL),
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
      return json({ documentos: [], error: `Anthropic ${resp.status}: ${t.slice(0, 200)}` }, 200)
    }
    const data = await resp.json()
    // Sonnet 5.5 puede abrir la respuesta con un bloque `thinking`: leer los bloques por tipo, no content[0].
    const text: string = Array.isArray(data?.content)
      ? data.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text ?? '').join('')
      : ''
    if (data?.stop_reason === 'max_tokens') return json({ documentos: [], error: 'Respuesta cortada (max_tokens)' }, 200)
    if (data?.stop_reason === 'refusal') return json({ documentos: [], error: 'El modelo no leyó el documento (refusal)' }, 200)
    return json({ documentos: parseDocs(text) }, 200)
  } catch (e) {
    return json({ documentos: [], error: String(e) }, 200)
  }
})

function parseDocs(text: string): Record<string, unknown>[] {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < 0) return []
    const obj = JSON.parse(text.slice(start, end + 1))
    const arr = Array.isArray(obj?.documentos) ? obj.documentos
      : Array.isArray(obj) ? obj
      : (obj && typeof obj === 'object') ? [obj] : []
    return arr.map((d: Record<string, unknown>) => ({ ...DOC_DEFAULTS, ...d }))
  } catch { return [] }
}
