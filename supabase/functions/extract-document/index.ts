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
 * Deploy: supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
// Haiku 4.5 = más barato; cambiá a 'claude-sonnet-4-5' por env si querés más precisión.
const MODEL             = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5'

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

const PROMPT = `Sos un asistente que extrae datos de documentos financieros de un restaurante en Costa Rica (Satori, razón social LCT Desarrollos Limitada, cédula 3-102-725602). Recibís UNA imagen que puede contener uno o varios documentos (es común que una foto traiga 2–3 facturas o tiquetes juntos). Devolvé SOLO un JSON válido, sin texto antes ni después y sin \`\`\`. Estructura: { "documentos": [ … ] }, un objeto por cada documento visible.

Quién es quién:
- El cliente siempre es Satori / LCT Desarrollos / cédula 3-102-725602. NUNCA pongas a Satori como proveedor.
- En una factura/proforma, el proveedor es el emisor (BELCA Food Service, Guayafrut, Distribuidora Isleña, Exportadora PMT, etc.).
- En un comprobante de transferencia/SINPE, el proveedor es el beneficiario/destino, NO el banco. Ej.: transferencia LAFISE a "GRUPO ASESOR ALVARADO / contadora maritza" → proveedor = la contadora; el banco va en banco.

tipo:
- factura: factura electrónica o tiquete de venta de un proveedor.
- proforma: Guayafrut emite "PROFORMA"; tratala como factura (es su comprobante de venta).
- comprobante_pago: captura o PDF de una transferencia/SINPE ya realizada ("Su transferencia ha sido realizada", "Número de referencia").
- propinas: recibo manual de propinas (dice "tips", "tips AM", "tips salón pm"). NO es una compra, no lleva ítems de inventario; dejá items vacío.
- otro: cualquier cosa que no calce.

Reglas de extracción (Costa Rica):
- clave_fe: la "Clave del Comprobante" / "Clave numérica" de 50 dígitos de las facturas electrónicas. Viene partida con espacios o en varias líneas → uní todo en 50 dígitos seguidos. Si no hay, null.
- IVA mezclado por línea: en CR los alimentos básicos llevan 1% y el resto 13%; una misma factura puede tener ambos. Capturá iva_pct por ítem y, si el documento los desglosa, impuesto_1pct e impuesto_13pct.
- Ítems en dos líneas: muchas facturas (BELCA, Guayafrut) ponen la descripción en una línea y en la siguiente el código + cantidad × precio_unitario + IVA + monto. Asocialos en un solo ítem.
- Cantidades decimales (3.2, 0.1, 5.54) y unidades: K/Kg (peso), UN (unidad), CJ (caja), PQ (paquete), GL/GAL (galón), LB (libra). Capturá unidad, precio_unitario y total por línea. Si hay descuento por línea, el total ya viene con el descuento aplicado.
- condicion_pago: contado o credito. Si dice "Quince días" / "8 días" / "15 días" → credito con plazo_dias. Crédito = cuenta por pagar.
- metodo_pago / banco / referencia: si el documento lo indica ("Cobrador: TRANSFERENCIA", "pagos por SINPE móvil", "CONTADO" = Efectivo; en comprobantes, el banco BAC/BN/BCR/Lafise y el número de referencia).
- moneda: CRC por defecto; USD si el documento está en dólares (ej. transferencias LAFISE en USD).
- concepto: en comprobantes de pago, el detalle ("Conta Febrero marzo mayo" = contabilidad).
- Números: sin separador de miles, punto decimal. "164,035.53" → 164035.53.
- Documentos manuscritos (facturas de mariscos a mano, recibos): hacé tu mejor esfuerzo, pero poné confianza baja (≤0.5) y requiere_revision: true. No inventes: si un número no se lee, dejalo null.
- cuenta_qb_sugerida: sugerí la cuenta del plan contable según el contenido (cervezas/licor → bebidas; pescado/carne/abarrotes → food cost; limpieza → limpieza; honorarios contables → honorarios profesionales). Si no estás seguro, null.
- confianza: 0–1 según legibilidad y completitud. requiere_revision: true siempre que sea manuscrito, esté borroso, o la suma de ítems no calce con el total.

Cada documento debe tener EXACTAMENTE estas claves:
{ "tipo", "proveedor", "proveedor_cedula", "numero_documento", "clave_fe", "fecha" (YYYY-MM-DD), "moneda", "condicion_pago", "plazo_dias", "metodo_pago", "banco", "referencia", "concepto", "subtotal", "descuento", "impuesto_1pct", "impuesto_13pct", "impuesto_total", "total", "items":[{"codigo","descripcion","cantidad","unidad","precio_unitario","descuento","iva_pct","total"}], "cuenta_qb_sugerida", "confianza", "requiere_revision" }

Devolvé únicamente el JSON.`

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
        max_tokens: 3500,
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
    const text: string = data?.content?.[0]?.text ?? ''
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
