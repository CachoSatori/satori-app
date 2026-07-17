/**
 * Supabase Edge Function — cierre-email (Satori · C3 quick-win)
 *
 * Envía por correo al owner el resumen del Cierre del Día COMPLETO (el mismo del
 * popup de confirmación). Se dispara fire-and-forget desde CashCierre al confirmarse
 * el cierre con éxito: si el email falla, el cierre NO se rompe (la plata manda, el
 * email es cortesía).
 *
 * SEGURIDAD (lección del hallazgo #2 — monthly-report NO exige auth, NO repetir):
 * esta función EXIGE Authorization (JWT del usuario, verificado con getUser) y RELEE
 * la fila del cierre con un cliente que lleva ESE token → el RLS de cash_cierres_dia
 * es el portón (mismo patrón que extract-document post-IDOR). NO usa service_role para
 * leer datos. Resend (RESEND_API_KEY) manda el correo, igual que monthly-report.
 *
 * Deploy STAGING: supabase functions deploy cierre-email --project-ref hwiatgicyyqyezqwldia
 * (prod va en el pase, con firma — NO tocar prod acá.)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
// Mismo destinatario/config que monthly-report (en prod ya existe por ese reporte).
const TO_EMAIL       = Deno.env.get('REPORT_TO_EMAIL') ?? 'cachorrogp@gmail.com'
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

const INK = '#0d0d0d', PAPER = '#f5f0e8', GOLD = '#c8a96e'
const GREEN = '#2a7a4a', RED = '#c23b22', PURPLE = '#8a5aa8', GOLDDK = '#8a6d1f'
const N = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const fi = (v: number) => '₡ ' + Math.round(N(v)).toLocaleString('es-CR')
const fu = (v: number) => '$ ' + N(v).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface CierreRow {
  session_date: string
  manager: string | null
  tipo: string
  vm_crc: number | null; vm_usd: number | null
  vn_crc: number | null; vn_usd: number | null
  propinas_m_crc: number | null; propinas_n_crc: number | null
  sep_diaria_crc: number | null; sep_diaria_usd: number | null
  sep_registradora_crc: number | null; sep_registradora_usd: number | null
  remanente_crc: number | null; remanente_usd: number | null
  diferencia_crc: number | null
  ajuste_tipo: string | null; ajuste_motivo: string | null
  notas: string | null; tipo_cambio: number | null
}

function row(label: string, crc: number, usd = 0, color = ''): string {
  const usdTxt = usd > 0 ? ` <span style="color:#999;font-size:11px">· ${fu(usd)}</span>` : ''
  return `<tr>
    <td style="padding:7px 0;color:#666;font-size:12px">${label}</td>
    <td style="padding:7px 0;font-size:13px;text-align:right;font-weight:600${color ? `;color:${color}` : ''}">${fi(crc)}${usdTxt}</td>
  </tr>`
}

function buildHtml(c: CierreRow): string {
  // propinas pagadas en el cierre = suma sellada de ambas piernas (mismo dato del popup).
  const propPagadas = N(c.propinas_m_crc) + N(c.propinas_n_crc)
  const totalCRC = N(c.sep_diaria_crc) + N(c.sep_registradora_crc) + N(c.remanente_crc)
  const totalUSD = N(c.sep_diaria_usd) + N(c.sep_registradora_usd) + N(c.remanente_usd)
  const dif = N(c.diferencia_crc)
  const cuadra = Math.abs(dif) < 500
  const tc = N(c.tipo_cambio)

  const difBlock = cuadra
    ? `<div style="margin:14px 0;padding:10px 14px;background:#eaf5ee;border-left:3px solid ${GREEN};font-size:13px;color:${GREEN};font-weight:600">✅ Cuadra — sin diferencia</div>`
    : `<div style="margin:14px 0;padding:10px 14px;background:#fbecea;border-left:3px solid ${RED};font-size:13px;color:${RED}">
        <div style="font-weight:700">⚠ Ajuste: ${(c.ajuste_tipo ?? '').trim() || (dif < 0 ? 'Faltante' : 'Sobrante')}${(c.ajuste_motivo ?? '').trim() ? ` — ${(c.ajuste_motivo ?? '').trim()}` : ''}</div>
        <div style="font-family:monospace;margin-top:4px">${dif >= 0 ? '+' : ''}${fi(dif)}</div>
      </div>`

  const notaBlock = (c.notas ?? '').trim()
    ? `<div style="margin-top:10px;font-size:11px;color:#888">📝 ${(c.notas ?? '').trim()}</div>` : ''

  return `<div style="max-width:520px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff">
    <div style="background:${INK};padding:22px 28px 18px">
      <div style="font-family:Georgia,serif;font-size:22px;color:${GOLD};letter-spacing:.08em;font-weight:700">里 SATORI</div>
      <div style="font-size:10px;color:#555;letter-spacing:.25em;text-transform:uppercase;margin-top:3px">Cierre del día · ${c.session_date}</div>
    </div>
    <div style="padding:20px 28px">
      <div style="font-size:11px;color:#999;margin-bottom:14px">
        Cerrado por ${c.manager ?? '—'} · TC ₡${tc.toLocaleString('es-CR')}
      </div>

      <div style="font-size:10px;color:#999;letter-spacing:.12em;text-transform:uppercase;margin-bottom:2px">Ventas y propinas</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        ${row('Ventas Mediodía', N(c.vm_crc), N(c.vm_usd))}
        ${row('Ventas Noche', N(c.vn_crc), N(c.vn_usd))}
        ${propPagadas > 0 ? `<tr><td style="padding:7px 0;color:#666;font-size:12px">Propinas pagadas en el cierre</td><td style="padding:7px 0;font-size:13px;text-align:right;font-weight:600;color:${PURPLE}">− ${fi(propPagadas)}</td></tr>` : ''}
      </table>

      <div style="font-size:10px;color:#999;letter-spacing:.12em;text-transform:uppercase;margin-bottom:2px">Distribución del conteo físico</div>
      <table style="width:100%;border-collapse:collapse">
        ${row('Caja Diaria mañana', N(c.sep_diaria_crc), N(c.sep_diaria_usd), GREEN)}
        ${row('Caja Registradora', N(c.sep_registradora_crc), N(c.sep_registradora_usd))}
        ${row('Remanente CF', N(c.remanente_crc), N(c.remanente_usd), GOLDDK)}
        <tr style="border-top:2px solid ${INK}">
          <td style="padding:9px 0;font-size:13px;font-weight:700">Total contado</td>
          <td style="padding:9px 0;font-size:14px;text-align:right;font-weight:700">${fi(totalCRC)}${totalUSD > 0 ? ` <span style="color:#999;font-size:11px">· ${fu(totalUSD)}</span>` : ''}</td>
        </tr>
      </table>

      ${difBlock}
      ${notaBlock}
    </div>
    <div style="padding:12px 28px;background:#f0ece4;border-top:1px solid #e0dbd2">
      <p style="font-size:10px;color:#aaa;margin:0">Resumen automático del cierre · Satori Sushi Bar · Santa Teresa, CR</p>
    </div>
  </div>`
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1) Exigir el JWT del usuario (el cliente lo reenvía vía supabase.functions.invoke).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'No autorizado' }, 401)

    const { cierre_id } = await req.json().catch(() => ({}))
    if (!cierre_id) return json({ ok: false, error: 'Falta cierre_id' }, 400)

    // 2) Cliente con el token del usuario → aplica RLS (NO service_role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    // 3) Verificar que el token corresponde a un usuario real.
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'No autorizado' }, 401)

    if (!RESEND_API_KEY) return json({ ok: false, error: 'RESEND_API_KEY no configurada' }, 200)

    // 4) Releer la fila del cierre CON el cliente del usuario → el RLS es el portón.
    //    Solo cierres COMPLETOS: un parcial no tiene resumen final que enviar.
    const { data, error } = await userClient
      .from('cash_cierres_dia')
      .select('*')
      .eq('id', cierre_id)
      .eq('tipo', 'completo')
      .maybeSingle()
    if (error) return json({ ok: false, error: 'Sin acceso al cierre' }, 403)
    if (!data) return json({ ok: false, error: 'Cierre no encontrado' }, 404)

    const c = data as unknown as CierreRow
    const subject = `🔒 Satori — Cierre del día ${c.session_date}`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html: buildHtml(c) }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return json({ ok: false, error: `Resend: ${JSON.stringify(d)}` }, 200)
    return json({ ok: true, id: (d as { id?: string })?.id ?? null }, 200)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200)
  }
})
