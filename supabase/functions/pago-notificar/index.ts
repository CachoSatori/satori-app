// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ pago-notificar — Etapa 1: comprobante de pago por EMAIL al proveedor (Resend).           ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Patrón de seguridad = extract-document / cierre-email (post-IDOR): EXIGE el JWT del usuario,
// NO usa service_role, RELEE movimiento+proveedor server-side con el token del usuario (el RLS es el
// portón) y ARMA el email server-side — el cliente NO manda contenido libre, solo el id del movimiento.
// Decide server-side: envía SOLO si el proveedor tiene notificar_pago='email' + email cargado.
// Fire-and-forget desde la app: si algo falla, el pago YA quedó pagado y `proveedor_notificado_at`
// queda NULL (→ la UI ofrece reintento). LA PLATA MANDA.
//
// Deploy STAGING:  supabase functions deploy pago-notificar --project-ref hwiatgicyyqyezqwldia
//   PROD va aparte, CON FIRMA y tras la tarea de DNS del remitente propio de Resend.
// Requiere el secret RESEND_API_KEY. Si falta → no-op 200 ("no enviado"), no rompe nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const FROM_EMAIL     = 'Satori App <onboarding@resend.dev>'

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

interface MovementRow {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  amount_crc: number
  amount_usd: number | null
  method: string | null
  description: string
  created_at: string
  status: string
}
interface SupplierRow {
  id: string
  name: string
  email: string | null
  notificar_pago: string | null
}

const crc = (n: number) => '₡' + Math.round(n).toLocaleString('es-CR')
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaCR = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', day: '2-digit', month: 'long', year: 'numeric' })
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function buildHtml(m: MovementRow, s: SupplierRow): string {
  const usdRow = (m.amount_usd && m.amount_usd > 0)
    ? `<tr><td style="padding:5px 0;color:#666">Monto (USD)</td><td style="padding:5px 0;text-align:right;font-weight:600">${usd(m.amount_usd)}</td></tr>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">
    <div style="max-width:520px;margin:0 auto;padding:24px">
      <div style="font-size:20px;font-weight:700;letter-spacing:.5px">Satori Sushi Bar</div>
      <div style="color:#888;font-size:13px;margin-bottom:16px">Comprobante de pago a proveedor</div>
      <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:18px">
        <div style="font-size:15px;font-weight:600;margin-bottom:10px">${esc(s.name)}</div>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:5px 0;color:#666">Fecha</td><td style="padding:5px 0;text-align:right">${fechaCR(m.created_at)}</td></tr>
          <tr><td style="padding:5px 0;color:#666">Monto (CRC)</td><td style="padding:5px 0;text-align:right;font-weight:600">${crc(m.amount_crc)}</td></tr>
          ${usdRow}
          <tr><td style="padding:5px 0;color:#666">Método</td><td style="padding:5px 0;text-align:right">${esc(m.method ?? 'Transferencia')}</td></tr>
          <tr><td style="padding:5px 0;color:#666">Detalle</td><td style="padding:5px 0;text-align:right">${esc(m.description ?? '')}</td></tr>
        </table>
      </div>
      <div style="color:#aaa;font-size:11px;margin-top:16px">Aviso automático de Satori. No respondas a este correo.</div>
    </div></body></html>`
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1) Exigir el JWT del usuario (lo reenvía supabase.functions.invoke).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'No autorizado' }, 401)

    const { movimiento_id } = await req.json().catch(() => ({}))
    if (!movimiento_id) return json({ ok: false, error: 'Falta movimiento_id' }, 400)

    // 2) Cliente con el token del usuario → aplica RLS (NO service_role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    // 3) Verificar que el token corresponde a un usuario real.
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'No autorizado' }, 401)

    if (!RESEND_API_KEY) return json({ ok: false, error: 'RESEND_API_KEY no configurada' }, 200)

    // 4) Releer el movimiento CON el cliente del usuario (RLS = portón, cierra el IDOR).
    const { data: mov, error: mErr } = await userClient
      .from('cash_movements')
      .select('id, supplier_id, supplier_name, amount_crc, amount_usd, method, description, created_at, status')
      .eq('id', movimiento_id)
      .maybeSingle()
    if (mErr) return json({ ok: false, error: 'Sin acceso al movimiento' }, 403)
    if (!mov) return json({ ok: false, error: 'Movimiento no encontrado' }, 404)
    const m = mov as unknown as MovementRow
    if (!m.supplier_id) return json({ ok: false, skipped: 'movimiento sin proveedor' }, 200)

    // 5) Releer el proveedor. Decisión server-side: SOLO si notificar_pago='email' + email cargado.
    const { data: sup, error: sErr } = await userClient
      .from('suppliers')
      .select('id, name, email, notificar_pago')
      .eq('id', m.supplier_id)
      .maybeSingle()
    if (sErr) return json({ ok: false, error: 'Sin acceso al proveedor' }, 403)
    const s = sup as unknown as SupplierRow | null
    if (!s || s.notificar_pago !== 'email' || !s.email) {
      return json({ ok: false, skipped: 'proveedor sin email / notificación desactivada' }, 200)
    }

    // 6) Enviar por Resend (contenido 100% armado server-side).
    const subject = `Comprobante de pago — Satori (${fechaCR(m.created_at)})`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [s.email], subject, html: buildHtml(m, s) }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return json({ ok: false, error: `Resend: ${JSON.stringify(d)}` }, 200)

    // 7) Sellar proveedor_notificado_at (SOLO esa columna). Si esto falla, el email ya se envió;
    //    no se revierte el pago. La columna no es sensible → no dispara la auditoría de ediciones (052).
    await userClient.from('cash_movements')
      .update({ proveedor_notificado_at: new Date().toISOString() })
      .eq('id', m.id)

    return json({ ok: true, id: (d as { id?: string })?.id ?? null, to: s.email }, 200)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200)
  }
})
