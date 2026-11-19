// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ pago-notificar — Etapa 1: comprobante de pago por EMAIL al proveedor (Resend).           ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Patrón de seguridad = extract-document / cierre-email (post-IDOR): EXIGE el JWT del usuario,
// NO usa service_role, RELEE movimiento+proveedor server-side con el token del usuario (el RLS es el
// portón) y ARMA el email server-side — el cliente NO manda contenido libre, solo los ids de los movimientos.
// Decide server-side: envía SOLO si el proveedor tiene notificar_pago='email' + email cargado.
// Fire-and-forget desde la app: si algo falla, el pago YA quedó pagado y `proveedor_notificado_at`
// queda NULL (→ la UI ofrece reintento). LA PLATA MANDA.
//
// Deploy STAGING:  supabase functions deploy pago-notificar --project-ref hwiatgicyyqyezqwldia
//   PROD va aparte, CON FIRMA y tras la tarea de DNS del remitente propio de Resend.
// Requiere el secret RESEND_API_KEY. Si falta → no-op 200 ("no enviado"), no rompe nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { asunto, buildHtml } from './plantilla.ts'
import { armarPago, idsDelCuerpo, validarLote, type AplicacionCredito, type EdicionMovimiento, type MovimientoPago } from './pago.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const FROM_EMAIL     = 'Satori <no-responder@satoricostarica.com>'

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

interface SupplierRow {
  id: string
  name: string
  email: string | null
  notificar_pago: string | null
}

// Plantilla del correo (estándar de reportes Satori adaptado a correo): ./plantilla.ts · armado puro: ./pago.ts

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // 1) Exigir el JWT del usuario (lo reenvía supabase.functions.invoke).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'No autorizado' }, 401)

    // (19-nov) `{ movimiento_ids: uuid[] }` = UN correo con todas las facturas del pago. Sigue aceptando
    // `{ movimiento_id }` (la app anterior, durante el pase) como lista de 1.
    const leidos = idsDelCuerpo(await req.json().catch(() => ({})))
    if ('error' in leidos) return json({ ok: false, error: leidos.error }, 400)
    const ids = leidos.ids

    // 2) Cliente con el token del usuario → aplica RLS (NO service_role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    // 3) Verificar que el token corresponde a un usuario real.
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'No autorizado' }, 401)

    if (!RESEND_API_KEY) return json({ ok: false, error: 'RESEND_API_KEY no configurada' }, 200)

    // 4) Releer los movimientos CON el cliente del usuario (RLS = portón, cierra el IDOR): tienen que estar todos,
    //    ser del MISMO proveedor y estar pagados ('aprobado'). Si no, no se manda nada.
    const { data: movs, error: mErr } = await userClient
      .from('cash_movements')
      .select('id, supplier_id, amount_crc, amount_usd, method, description, subcategory, created_at, status, session_id')
      .in('id', ids)
    if (mErr) return json({ ok: false, error: 'Sin acceso al movimiento' }, 403)
    const lote = (movs ?? []) as unknown as MovimientoPago[]
    const valido = validarLote(ids, lote)
    if (!valido.ok) {
      if (valido.error === 'Movimiento sin proveedor') return json({ ok: false, skipped: 'movimiento sin proveedor' }, 200)
      // 409: `pendientes` = ids que todavía no están pagados (cola offline) → la app puede reintentar después.
      return json({ ok: false, error: valido.error, ...(valido.pendientes ? { pendientes: valido.pendientes } : {}) }, valido.status)
    }

    // 5) Releer el proveedor. Decisión server-side: SOLO si notificar_pago='email' + email cargado.
    const { data: sup, error: sErr } = await userClient
      .from('suppliers')
      .select('id, name, email, notificar_pago')
      .eq('id', valido.supplierId)
      .maybeSingle()
    if (sErr) return json({ ok: false, error: 'Sin acceso al proveedor' }, 403)
    const s = sup as unknown as SupplierRow | null
    if (!s || s.notificar_pago !== 'email' || !s.email) {
      return json({ ok: false, skipped: 'proveedor sin email / notificación desactivada' }, 200)
    }

    // 6) Crédito a favor aplicado (no reversado). Sin poder leerlo NO se manda: mostraría lo facturado como pagado.
    const { data: apps, error: aErr } = await userClient
      .from('credit_applications')
      .select('applied_to_movement_id, amount_applied, reversed')
      .in('applied_to_movement_id', ids)
      .eq('reversed', false)
    if (aErr) return json({ ok: false, error: 'Sin acceso a los créditos aplicados' }, 403)

    // 7) Fecha del pago: la auditoría de ediciones (052) guarda el cambio a 'aprobado'. Su RLS la deja ver a
    //    owner/manager/contador; para otro rol (o un pago que nació pagado) vuelve vacía y se usa created_at del
    //    movimiento, como la v15. Nunca el envío rotulado como pago (ver pago.ts).
    const { data: edits } = await userClient
      .from('movement_edits')
      .select('movement_id, edited_at, changed')
      .in('movement_id', ids)

    // 8) Día de la factura = día de la sesión de caja (lo que ve el personal en Pendientes); si no se lee, created_at.
    const sesiones = [...new Set(lote.map((m) => m.session_id).filter((x): x is string => !!x))]
    const fechaFactura: Record<string, string> = {}
    if (sesiones.length) {
      const { data: ses } = await userClient.from('cash_sessions').select('id, session_date').in('id', sesiones)
      const dia = new Map(((ses ?? []) as { id: string; session_date: string | null }[]).map((x) => [x.id, x.session_date]))
      for (const m of lote) { const d = m.session_id ? dia.get(m.session_id) : null; if (d) fechaFactura[m.id] = d }
    }

    const ahora = new Date().toISOString()
    const pago = armarPago({
      movs: lote,
      aplicaciones: (apps ?? []) as unknown as AplicacionCredito[],
      edits: (edits ?? []) as unknown as EdicionMovimiento[],
      ahora,
      fechaFactura,
    })

    // 9) Enviar por Resend (contenido 100% armado server-side). UN correo para todo el lote.
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [s.email], subject: asunto(pago), html: buildHtml(pago, s) }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return json({ ok: false, error: `Resend: ${JSON.stringify(d)}` }, 200)

    // 10) Sellar proveedor_notificado_at (SOLO esa columna) en TODOS los movimientos del lote. Si esto falla, el
    //     email ya se envió; no se revierte el pago. La columna no es sensible → no dispara la auditoría (052).
    await userClient.from('cash_movements')
      .update({ proveedor_notificado_at: ahora })
      .in('id', ids)

    return json({
      ok: true, agrupado: true, id: (d as { id?: string })?.id ?? null, to: s.email,
      facturas: ids.length, fecha_fuente: pago.fuenteFecha,
    }, 200)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200)
  }
})
