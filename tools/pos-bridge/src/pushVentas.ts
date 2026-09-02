import type { PosConfig } from './config.js'
import type { VentaCruda } from './fetchVentas.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ESQUELETO · Empuje a la Edge Function `ingest-ventas`                                  ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ⚠ FASE A: la Edge Function TODAVÍA NO EXISTE. Este archivo espeja
//   `tools/biotime-bridge/src/pushIngest.ts` línea por línea, incluidas sus decisiones de
//   manejo de error — que son las que evitaron que un lote rechazado avanzara el corte.
//
// SALIDA-ONLY: el agente abre la conexión hacia Supabase; nadie entra a la PC del local. El
// portón es el secreto compartido `x-ingest-secret`, no un JWT: el que llama es un proceso
// headless sin sesión de usuario.

/** Respuesta 200 esperada del edge. Invariante: received = inserted + duplicates + invalid. */
export interface IngestResult {
  ok:         boolean
  local:      string
  received:   number
  inserted:   number
  duplicates: number
  /** Ventas cuyo `mesero_id` no matchea ningún empleado. Se guardan igual, para reconciliar. */
  unmapped:   number
  invalid:    number
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const TIMEOUT_MS = 30_000

/** Un reintento, y SOLO cuando puede ser transitorio: red caída o 5xx del lado del edge. */
const REINTENTOS = 1
const ESPERA_REINTENTO_MS = 3_000

const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function esResultado(v: unknown): v is IngestResult {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

/**
 * Manda el lote. Devuelve el resultado del edge o TIRA.
 *
 * ── LA REGLA QUE NO SE NEGOCIA ─────────────────────────────────────────────────────────────
 * El que llama NO debe avanzar el `last_id` si esto explota. El lote se vuelve a leer en el
 * próximo ciclo y la clave `(local, pos_id)` de la base hace que reenviar nunca duplique.
 *
 * Por eso los 4xx TIRAN en vez de devolver un resultado: un secreto equivocado o un body mal
 * armado no se arregla reintentando, y tragárselo dejaría avanzar el corte sobre ventas que
 * nunca se guardaron. En el biotime-bridge eso fue exactamente el modo de falla que costó
 * cuatro días de fichajes; acá nace cerrado.
 *
 * ⚠ FASE A: no se llama desde ningún lado (`index.ts` corta antes). Queda completo para que
 *   cablear sea apuntar `INGEST_URL` a la función real.
 */
export async function pushVentas(
  cfg: PosConfig,
  ventas: VentaCruda[],
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<IngestResult> {
  const body = JSON.stringify({ local: cfg.local, ventas })
  let ultimoError: Error | null = null

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    if (intento > 0) await dormir(ESPERA_REINTENTO_MS)
    try {
      const res = await fetchImpl(cfg.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // El secreto NUNCA se loguea, ni entero ni en pedazos.
          'x-ingest-secret': cfg.ingestSecret,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.status >= 500) {
        // Del lado del edge / Supabase: puede ser pasajero, se reintenta una vez.
        ultimoError = new Error(`ingest-ventas respondió ${res.status}`)
        continue
      }
      if (!res.ok) {
        // 4xx = nosotros: secreto equivocado, local inválido, body mal armado. Reintentar no lo
        // arregla y taparía el problema; que se vea.
        const detalle = await res.text().catch(() => '')
        throw new Error(`ingest-ventas rechazó el lote (${res.status}): ${detalle.slice(0, 300)}`)
      }

      const json: unknown = await res.json()
      if (!esResultado(json) || !json.ok) {
        throw new Error(`Respuesta inesperada del edge: ${JSON.stringify(json).slice(0, 300)}`)
      }
      return json
    } catch (e) {
      // AbortError (timeout) y fallos de red caen acá: transitorios, se reintenta.
      const err = e instanceof Error ? e : new Error(String(e))
      if (err.message.startsWith('ingest-ventas rechazó el lote')) throw err
      ultimoError = err
    }
  }

  throw ultimoError ?? new Error('No se pudo empujar el lote')
}
