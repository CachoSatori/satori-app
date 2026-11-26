// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ fe-ingesta — Compras F1: recibe los XML de factura electrónica del correo de proveedores ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// SPEC docs/inventario/SPEC-compras-stock-costos.md §4.3. La llama el script de Apps Script de cada cuenta de correo
// (scripts/apps-script/fe-correo/), que NO tiene JWT de Supabase: por eso verify_jwt = false (supabase/config.toml,
// ESTADO regla 2) y el portón es un secreto compartido en la cabecera `x-fe-secret`, como `ingest-ndf`.
//
// TODA la lógica vive en módulos PUROS y probados con vitest:
//   src/shared/fe/sobreFe.ts    (qué manda el script, topes, código HTTP)
//   src/shared/fe/parseFe.ts    (lector de XML sin DTD + parser de Hacienda v4.3/v4.4)
//   src/shared/fe/ingestaFe.ts  (qué se hace con cada XML)
// Acá solo: método, tamaño, secreto en tiempo constante, y las dependencias reales (supabase-js con service role).
//
// El LOCAL no lo decide el secreto: lo decide la base por la cédula del receptor (`fe_receptores`, mig 199). Un
// secreto por instalación; si algún día hace falta uno por cuenta, se agrega la lista (como POS_INGEST_SECRETS).
//
// ── ANTES DE USARLA (el dueño, con firma en prod) ──────────────────────────────────────────────
//   supabase secrets set FE_INGESTA_SECRET=<valor largo y aleatorio, ≥ 32> --project-ref <ref>
// El mismo valor va a las propiedades del script (nunca al código ni al repo). Sin el secreto cargado (o con menos de
// 32 caracteres) la función responde 401 a TODO (fail-closed). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone
// Supabase. Necesita la migración 199 aplicada ANTES.
//
// CONTRATO: POST /fe-ingesta · headers x-fe-secret, content-type: application/json
//   body: { fuente, lote, xmls: [{ b64 }] } | { fuente, lote, sin_xml: true } | { fuente, latido: true }
//   200 todo guardado (o duplicado / no comprobante) · 401 secreto · 413 muy grande · 400 sobre inválido
//   422 algún XML ilegible o rechazado por la base (lo bueno quedó guardado) · 500 reintentar
// Sin CORS a propósito: la llama un script, no un navegador.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { procesarSobre, subirIdempotente, type DepsIngesta } from '../../../src/shared/fe/ingestaFe.ts'
import { TOPE_CUERPO_BYTES, validarSobre } from '../../../src/shared/fe/sobreFe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FE_INGESTA_SECRET = Deno.env.get('FE_INGESTA_SECRET') ?? ''
const BUCKET = 'fe-xml'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Tiempo constante: solo el LARGO sale temprano (irrelevante para un secreto aleatorio largo). */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

    // FAIL-CLOSED: sin secreto (o uno corto) todo es 401; así un secreto vacío nunca deja la función abierta.
    if (FE_INGESTA_SECRET.length < 32) {
      console.error('fe-ingesta: FE_INGESTA_SECRET no cargado o corto — rechazando todo')
      return json({ ok: false, error: 'No autorizado' }, 401)
    }
    if (!safeEqual(req.headers.get('x-fe-secret') ?? '', FE_INGESTA_SECRET)) {
      return json({ ok: false, error: 'No autorizado' }, 401)
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Función mal configurada' }, 500)

    const largo = Number(req.headers.get('content-length') ?? '0')
    if (largo > TOPE_CUERPO_BYTES) return json({ ok: false, error: 'Pedido muy grande' }, 413)
    const texto = await req.text()
    if (texto.length > TOPE_CUERPO_BYTES) return json({ ok: false, error: 'Pedido muy grande' }, 413)
    let body: unknown = null
    try { body = JSON.parse(texto) } catch { body = null }
    const sobre = validarSobre(body)
    if (!sobre.ok) return json({ ok: false, error: sobre.error }, 400)

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const deps: DepsIngesta = {
      sha256,
      // Ya existe = el mismo comprobante llegó antes (reenvío): éxito idempotente, la base decide «duplicado».
      subirXml: (ruta, xml) => subirIdempotente(() =>
        sb.storage.from(BUCKET).upload(ruta, new Blob([xml], { type: 'application/xml' }), {
          contentType: 'application/xml', upsert: false,
        })),
      rpc: async (fn, args) => {
        const { data, error } = await sb.rpc(fn, args)
        return { data, error: error ? { code: error.code, message: error.message } : null }
      },
    }

    const r = await procesarSobre(sobre.valor, deps)
    if (r.status === 500) console.error(`fe-ingesta [${sobre.valor.fuente}] falla de base o Storage: se reintenta`)
    return json(r.cuerpo, r.status)
  } catch (e) {
    console.error('fe-ingesta: excepción', e instanceof Error ? e.message : String(e))
    return json({ ok: false, error: 'Error interno' }, 500)
  }
})
