// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ club-pase — pase de Google Wallet del Club Satori. «Save to Google Wallet».              ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Contrato con la base: docs/club-satori/CONTRATO-pase.md (v1). Toda la lógica está en módulos PUROS probados con
// vitest: src/shared/wallet/googlePase.ts (clase, objeto, JWT RS256), src/shared/wallet/sincronizar.ts (token OAuth,
// clase y objeto por la API REST) y src/shared/wallet/edgePase.ts (portón, flujo y errores). Este archivo solo conecta
// Deno.env, la base y la red hacia Google.
//
// ── DÓNDE VIVE (ESTADO, regla 2) ───────────────────────────────────────────────────────────
// Este archivo NO está en main hasta el ítem 11: vive en la rama claude/club-pase-edge y se despliega A MANO desde ahí.
// Cuando entre a main, supabase/config.toml tiene que decir verify_jwt = false para club-pase (club-web llama sin JWT
// de usuario; el portón es x-club-web). Importa módulos de fuera de supabase/functions: la CLI los empaqueta con
// --use-api (así salió ingest-ndf v3, CLI 2.122.0).
//
// ── POR QUÉ service_role ──────────────────────────────────────────────────────────────────
// Las funciones del contrato (club_pase_por_token, club_pase_datos, club_pase_emitido) son SOLO de service_role:
// ni anon ni authenticated las ejecutan. El que llama es club-web (servidor), no un usuario de la app. El portón es
// el header x-club-web (el mismo secreto CLUB_WEB_KEY de las funciones públicas) y el tope por IP de club-web.
//
// ── SECRETOS (los carga el dueño en el panel; NUNCA por chat ni en el repo) ─────────────────
//   CLUB_WEB_KEY             la de club-web de ESE proyecto
//   GOOGLE_WALLET_ISSUER_ID  número del emisor (Google Pay & Wallet Console)
//   GOOGLE_WALLET_SA_KEY     JSON de la cuenta de servicio con acceso al emisor (una clave por proyecto)
//   CLUB_WEB_ORIGIN          el dominio del Club = club_config_global.club_url (sin él, 503)
//   WALLET_DISENO            (opcional) {"colorFondo":"#0d0d0d","logoUrl":"https://…","heroUrl":"https://…"}
//   CLUB_PASE_SYNC_KEY       NO en el piloto (decisión del dueño, 12-nov): sin él, /sync responde 503
// Sin cualquiera de los obligatorios: 503 a todo (falla cerrada), sin tocar la base.
//
// ── DESPLIEGUE (el dueño; staging primero; docs/club-satori/WALLET-GOOGLE-ACTIVACION.md §2) ──────
//   supabase functions deploy club-pase --project-ref <ref> --no-verify-jwt --use-api
//
//   POST /club-pase/google      x-club-web   { "token": "<token del portal>" }
//        → crea la clase y crea o actualiza el objeto en Google, y devuelve el link CORTO (JWT con solo los IDs)
//        → 200 { url, object_id } · 401 · 404 portal_invalido · 502 servicio · 503 servicio_no_disponible
//   POST /club-pase/actualizar  x-club-web   { "token": "…" }   «Actualizar mi pase» → { resultado }
//   POST /club-pase/sync        x-club-pase-sync                  (después del piloto: sin su clave, 503)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { manejarPase, manejarSync, type Rpc } from '../../../src/shared/wallet/edgePase.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Red hacia Google: solo la API de Wallet y el token OAuth. Cualquier otro host es un error.
const fetchGoogle = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  if (!url.startsWith('https://walletobjects.googleapis.com/') && url !== 'https://oauth2.googleapis.com/token') {
    throw new Error('host no permitido')
  }
  return await fetch(url, init)
}

Deno.serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'servicio_no_disponible' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const rpc: Rpc = async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    }
    const ruta = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''
    const env = {
      CLUB_WEB_KEY: Deno.env.get('CLUB_WEB_KEY') ?? undefined,
      GOOGLE_WALLET_ISSUER_ID: Deno.env.get('GOOGLE_WALLET_ISSUER_ID') ?? undefined,
      GOOGLE_WALLET_SA_KEY: Deno.env.get('GOOGLE_WALLET_SA_KEY') ?? undefined,
      CLUB_WEB_ORIGIN: Deno.env.get('CLUB_WEB_ORIGIN') ?? undefined,
      WALLET_DISENO: Deno.env.get('WALLET_DISENO') ?? undefined,
      CLUB_PASE_SYNC_KEY: Deno.env.get('CLUB_PASE_SYNC_KEY') ?? undefined,
    }
    if (ruta === 'sync' || ruta === 'actualizar') return await manejarSync(req, ruta, env, rpc, fetchGoogle)
    return await manejarPase(req, ruta, env, rpc, fetchGoogle)
  } catch (e) {
    console.error('club-pase: excepción', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ error: 'servicio' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
