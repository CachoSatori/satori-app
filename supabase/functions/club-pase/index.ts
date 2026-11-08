// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ club-pase — pase de Google Wallet del Club Satori (B1). «Save to Google Wallet».         ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Contrato con la base: docs/club-satori/CONTRATO-pase.md (v1). Toda la lógica está en módulos PUROS probados
// con vitest: src/shared/wallet/googlePase.ts (clase, objeto, JWT RS256) y src/shared/wallet/edgePase.ts
// (portón, flujo y errores). Este archivo solo conecta Deno.env y la base.
//
// ── POR QUÉ service_role ──────────────────────────────────────────────────────────────────
// Las funciones del contrato (club_pase_por_token, club_pase_datos, club_pase_emitido) son SOLO de service_role:
// ni anon ni authenticated las ejecutan. El que llama es club-web (servidor), no un usuario de la app. El portón es
// el header x-club-web (el mismo secreto CLUB_WEB_KEY de las funciones públicas) y el tope por IP de club-web (B2).
//
// ── SECRETOS (los carga Ismael; NUNCA por chat ni en el repo) ───────────────────────────────
//   CLUB_WEB_KEY             el mismo de club-web (Pages)
//   GOOGLE_WALLET_ISSUER_ID  número del emisor (Google Pay & Wallet Console)
//   GOOGLE_WALLET_SA_KEY     JSON de la cuenta de servicio con acceso al emisor
//   (opcionales) CLUB_WEB_ORIGIN, WALLET_DISENO = {"colorFondo":"#0d0d0d","logoUrl":"https://…"}
// Sin cualquiera de los tres primeros: 503 a todo (fail-closed), sin tocar la base.
//
// ── ESTADO ────────────────────────────────────────────────────────────────────────────────
// B1 (08-nov): NO desplegada. Se despliega en staging con firma de Ismael, cuando estén los secretos:
//   supabase functions deploy club-pase --no-verify-jwt --project-ref hwiatgicyyqyezqwldia
// (--no-verify-jwt: el que llama no tiene JWT de Supabase; el portón es x-club-web.) Prod: paso 7 del RUNBOOK.
//
//   POST /club-pase/google   x-club-web: <CLUB_WEB_KEY>   { "token": "<token del portal>" }
//   → 200 { url, object_id } · 401 · 404 portal_invalido · 503 servicio_no_disponible

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { manejarPase, type Rpc } from '../../../src/shared/wallet/edgePase.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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
    return await manejarPase(req, ruta, {
      CLUB_WEB_KEY: Deno.env.get('CLUB_WEB_KEY') ?? undefined,
      GOOGLE_WALLET_ISSUER_ID: Deno.env.get('GOOGLE_WALLET_ISSUER_ID') ?? undefined,
      GOOGLE_WALLET_SA_KEY: Deno.env.get('GOOGLE_WALLET_SA_KEY') ?? undefined,
      CLUB_WEB_ORIGIN: Deno.env.get('CLUB_WEB_ORIGIN') ?? undefined,
      WALLET_DISENO: Deno.env.get('WALLET_DISENO') ?? undefined,
    }, rpc)
  } catch (e) {
    console.error('club-pase: excepción', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ error: 'servicio' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
