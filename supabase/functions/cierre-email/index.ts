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
 * leer el cierre. Resend (RESEND_API_KEY) manda el correo, igual que monthly-report.
 *
 * RESUMEN DE VENTAS DEL DÍA (pedido del dueño 18-nov; opción B firmada 18-nov 05:49 CR — CAMBIO DE PATRÓN):
 * el cierre lo confirma el CAJERO, que no lee el PoS (regla 6). Sin abrir permisos, el resumen se lee
 * con service_role, pero SOLO (a) después de releer el cierre con el JWT del usuario (si no lo ve, no se
 * lee nada), (b) si el cierre es de las últimas 36 h (resumen.ts), (c) para su jornada y la de −7, y
 * (d) como agregados que van SOLO dentro del correo a REPORT_TO_EMAIL: la respuesta HTTP no trae montos
 * ni nombres. Si el resumen falla, el correo sale igual con «Resumen de ventas no disponible».
 *
 * Deploy STAGING: supabase functions deploy cierre-email --project-ref hwiatgicyyqyezqwldia
 * (prod va en el pase, con firma — NO tocar prod acá.)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { destinatarioDe, remitenteDe } from './destinatario.ts'
import { procesarCierre, type CierreFila } from './proceso.ts'
import { resumenParaCierre, type LogicaResumen } from './resumen.ts'
import { leerNombres, leerVentanaJornada, logica } from './lecturaPos.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
// Solo para el resumen de ventas (opción B, ver cabecera). Nunca para leer el cierre.
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Mismo destinatario/config que monthly-report (en prod ya existe por ese reporte).
// Sin correo por defecto en el código (firma del dueño, 16-nov): sin REPORT_TO_EMAIL no se manda nada.
const TO_EMAIL       = destinatarioDe(Deno.env.get('REPORT_TO_EMAIL'))
// Remitente propio (dominio verificado en Resend): del secreto REMITENTE_CORREOS, no escrito en el repo.
const FROM_EMAIL     = remitenteDe(Deno.env.get('REMITENTE_CORREOS'))

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

// Plantilla del correo (estándar de reportes Satori adaptado a correo): ./plantilla.ts · flujo: ./proceso.ts

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1) Exigir el JWT del usuario (el cliente lo reenvía vía supabase.functions.invoke).
    const authHeader = req.headers.get('Authorization')
    const cuerpo = await req.json().catch(() => ({}))

    // 2) Cliente con el token del usuario → aplica RLS (NO service_role) para el cierre.
    const userClient = authHeader
      ? createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      : null

    const r = await procesarCierre(cuerpo, {
      hayToken: !!authHeader,
      // 3) Verificar que el token corresponde a un usuario real.
      usuarioValido: async () => !!(await userClient!.auth.getUser()).data?.user,
      hayResend: !!RESEND_API_KEY,
      hayDestinatario: !!TO_EMAIL,
      hayRemitente: !!FROM_EMAIL,
      // 4) Releer la fila del cierre CON el cliente del usuario → el RLS es el portón.
      //    Solo cierres COMPLETOS: un parcial no tiene resumen final que enviar.
      leerCierre: async (id) => {
        const { data, error } = await userClient!.from('cash_cierres_dia').select('*')
          .eq('id', id).eq('tipo', 'completo').maybeSingle()
        return { data: data as unknown as CierreFila | null, error }
      },
      // 5) Resumen de ventas (opción B): SOLO para el cierre que el usuario pudo leer, SOLO si es de las
      //    últimas 36 h y SOLO su jornada y la de −7, con service_role. Agregados; nada vuelve al cliente.
      resumen: (c) => {
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        return resumenParaCierre(c, {
          logica: logica as unknown as LogicaResumen,
          leerVentana: (dia, local) => leerVentanaJornada(admin, dia, local),
          leerNombres: (logins) => leerNombres(admin, logins),
          ahora: new Date(),
        })
      },
      enviar: async (subject, html) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) console.error(JSON.stringify({ etapa: 'resend', status: res.status }))
        return { ok: res.ok, id: (d as { id?: string })?.id ?? null }
      },
      log: (o) => console.log(JSON.stringify(o)),
    })
    return json(r.body, r.status)
  } catch (e) {
    console.error(JSON.stringify({ etapa: 'no_controlado', detalle: String(e).replace(/\d{4,}/g, '#') }))
    return json({ ok: false, error: 'No se pudo enviar el correo' }, 200)
  }
})
