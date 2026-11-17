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
import { buildHtml } from './plantilla.ts'
import { destinatarioDe, FALTA_DESTINATARIO } from './destinatario.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
// Mismo destinatario/config que monthly-report (en prod ya existe por ese reporte).
// Sin correo por defecto en el código (firma del dueño, 16-nov): sin REPORT_TO_EMAIL no se manda nada.
const TO_EMAIL       = destinatarioDe(Deno.env.get('REPORT_TO_EMAIL'))
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

// Plantilla del correo (estándar de reportes Satori adaptado a correo): ./plantilla.ts

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
    // Sin destinatario no se manda nada (el cierre ya quedó hecho: el correo es cortesía).
    if (!TO_EMAIL) {
      console.error(JSON.stringify({ etapa: FALTA_DESTINATARIO, secreto: 'REPORT_TO_EMAIL' }))
      return json({ ok: false, code: 'falta_destinatario', error: 'Falta el destinatario del correo (secreto REPORT_TO_EMAIL)' }, 500)
    }

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
