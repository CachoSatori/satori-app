import type { BridgeConfig } from './config.js'
import type { IngestPunch } from './fetchPunches.js'

// ── Empuje al edge `ingest-punches` ─────────────────────────────────────────────
// SALIDA-ONLY: el agente abre la conexión hacia Supabase; nadie entra a la PC del local.
// La función corre con `--no-verify-jwt`, así que el portón es el secreto compartido
// `x-ingest-secret` — no hace falta anon key ni Authorization.

/** Respuesta 200 del edge. La invariante: received = inserted + duplicates + unknown_state + invalid. */
export interface IngestResult {
  ok:            boolean
  local:         string
  received:      number
  inserted:      number
  duplicates:    number
  unmapped:      number
  unknown_state: number
  invalid:       number
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const TIMEOUT_MS = 30_000

/** Un reintento, y solo cuando puede ser transitorio: red caída o 5xx del lado del edge. */
const REINTENTOS = 1
const ESPERA_REINTENTO_MS = 3_000

const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function esResultado(v: unknown): v is IngestResult {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

/**
 * Manda el lote. Devuelve el resultado del edge o TIRA — el que llama NO debe avanzar el
 * `last_id` si esto explota: el lote se vuelve a leer en el próximo ciclo y el
 * `(local, biotime_id)` de la base hace que reenviar nunca duplique.
 */
export async function pushIngest(
  cfg: BridgeConfig,
  punches: IngestPunch[],
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<IngestResult> {
  const body = JSON.stringify({ local: cfg.local, punches })
  let ultimoError: Error | null = null

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    if (intento > 0) await dormir(ESPERA_REINTENTO_MS)
    try {
      const res = await fetchImpl(cfg.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type':    'application/json',
          // El secreto NUNCA se loguea, ni entero ni en pedazos.
          'x-ingest-secret': cfg.ingestSecret,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.status >= 500) {
        // Del lado del edge / Supabase: puede ser pasajero, se reintenta una vez.
        ultimoError = new Error(`ingest-punches respondió ${res.status}`)
        continue
      }
      if (!res.ok) {
        // 4xx = nosotros: secreto equivocado, local inválido, body mal armado. Reintentar
        // no lo arregla y taparía el problema; que se vea.
        const detalle = await res.text().catch(() => '')
        throw new Error(`ingest-punches rechazó el lote (${res.status}): ${detalle.slice(0, 300)}`)
      }

      const json: unknown = await res.json()
      if (!esResultado(json) || !json.ok) {
        throw new Error(`Respuesta inesperada del edge: ${JSON.stringify(json).slice(0, 300)}`)
      }
      return json
    } catch (e) {
      // AbortError (timeout) y fallos de red caen acá: transitorios, se reintenta.
      const err = e instanceof Error ? e : new Error(String(e))
      if (err.message.startsWith('ingest-punches rechazó el lote')) throw err
      ultimoError = err
    }
  }

  throw ultimoError ?? new Error('No se pudo empujar el lote')
}
