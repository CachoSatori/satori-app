/**
 * Supabase Edge Function — ventas-dia-contador
 *
 * Correo APARTE (no el reporte quincenal) al correo del negocio, los días 1 y 16 a las 07:00 CR, con el
 * «Detalle por día» de la quincena CERRADA (el 16: del 1 al 15; el 1: del 16 al fin del mes anterior),
 * en Excel (.xlsx, con formato y fila TOTAL) y CSV. El dueño lo reenvía al contador. Pedido del dueño,
 * 17-nov-2026.
 *
 * Por qué una función nueva y no un modo de `monthly-report`: `monthly-report` es otro correo (resumen con
 * IRS, top de productos, propinas), se despliega desde su propia rama (#245, prod v23) y su código no está
 * en `main`; meterle adjuntos y otro período mezcla dos PRs en vuelo sobre la misma función de prod. Esta
 * reusa el MISMO patrón (paquete de la lógica de la app, lectura del PoS, auth SEC-02, REPORT_TO_EMAIL,
 * Resend) y se despliega y se vuelve atrás sola.
 *
 * Disparo:
 *   - pg_cron (mig 189) con Authorization: Bearer <service_role, desde Vault>, igual que los jobs 3 y 4.
 *   - Owner activo con su JWT (corrida manual).
 *   - body { "quincena"?: "YYYY-MM-1|2", "local"?: "santa-teresa", "dry_run"?: boolean }
 *     · sin quincena: la última cerrada en hora CR (quincena.ts).
 *     · dry_run: arma todo y NO manda; responde conteos, nombres de adjuntos, bytes y sha256.
 *
 * Seguridad (como monthly-report tras SEC-02): service_role u owner activo; CORS con allowlist; parámetros
 * validados; respuesta y log sin montos ni nombres; errores fijos con ref. Deploy A MANO con
 * verify_jwt = true (regla 2 / R04: ningún PR a main con supabase/functions/ hasta el ítem 11):
 *   supabase functions deploy ventas-dia-contador --project-ref <ref> --use-api
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { destinatarioDe, FALTA_DESTINATARIO } from './destinatario.ts'
import { diasDelPos, logica } from './lecturaPos.ts'
import { procesar } from './proceso.ts'
import type { Correo } from './correo.ts'
import type { LogicaApp } from './detalle.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
// El MISMO destino que los reportes automáticos. Sin correo por defecto en el código (repo público).
const TO_EMAIL       = destinatarioDe(Deno.env.get('REPORT_TO_EMAIL'))
const FROM_EMAIL     = 'Satori App <onboarding@resend.dev>'

async function send(c: Correo): Promise<void> {
  if (!TO_EMAIL) throw new Error(FALTA_DESTINATARIO)   // nunca manda sin destinatario
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL, to: [TO_EMAIL], subject: c.subject, html: c.html,
      attachments: c.attachments.map(a => ({ filename: a.filename, content: a.content })),
    }),
  })
  if (!res.ok) throw new Error(`Resend: HTTP ${res.status}`)
}

function origenPermitido(origin: string): boolean {
  return origin === 'https://cachosatori.github.io'
    || /^https:\/\/([a-z0-9-]+\.)?satori-staging\.pages\.dev$/.test(origin)
}
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origenPermitido(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
function igualConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const ref = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const responder = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const falla = (status: number, code: string, error: string) => responder(status, { ok: false, code, error, ref })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return falla(405, 'metodo', 'Método no permitido')

  try {
    // 1) Quién llama: service_role (cron) u owner activo. Nada más (mismo código que monthly-report).
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) return falla(401, 'sin_sesion', 'No autorizado')
    let quien = 'service_role'
    const esServiceRole = igualConstante(token, SUPABASE_KEY) || await (async () => {
      try {
        const c = createClient(SUPABASE_URL, token, { auth: { persistSession: false, autoRefreshToken: false } })
        const { error } = await c.auth.admin.listUsers({ page: 1, perPage: 1 })
        return !error
      } catch { return false }
    })()
    if (!esServiceRole) {
      const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: ud } = await comoUsuario.auth.getUser()
      if (!ud?.user) return falla(401, 'sin_sesion', 'No autorizado')
      const admin = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
      const { data: owner, error: oe } = await admin.from('profiles').select('id')
        .eq('id', ud.user.id).eq('role', 'owner').eq('is_active', true).maybeSingle()
      if (oe) { console.error(JSON.stringify({ ref, etapa: 'owner', detalle: oe.message })); return falla(500, 'interno', 'No se pudo generar el correo') }
      if (!owner) return falla(403, 'no_autorizado', 'Solo un owner activo puede pedir este correo')
      quien = `owner:${ud.user.id}`
    }

    // 2) Parámetros, datos, archivos y envío (proceso.ts, probado sin red).
    const body = await req.json().catch(() => ({}))
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const r = await procesar(body, {
      logica: logica as unknown as LogicaApp,
      leerDias: (rango, local) => diasDelPos(supabase, rango, local),
      enviar: send,
      hayDestinatario: !!TO_EMAIL,
      ahora: new Date(),
    })
    if (r.status !== 200) {
      if (r.body.code === 'falta_destinatario') console.error(JSON.stringify({ ref, etapa: FALTA_DESTINATARIO, secreto: 'REPORT_TO_EMAIL' }))
      return responder(r.status, { ...r.body, ref })
    }
    console.log(JSON.stringify({ ref, quien, ...r.body }))
    return responder(200, { ...r.body, ref })
  } catch (err) {
    console.error(JSON.stringify({ ref, etapa: 'no_controlado', detalle: String(err).replace(/\d{4,}/g, '#') }))
    return falla(500, 'interno', 'No se pudo generar el correo')
  }
})
