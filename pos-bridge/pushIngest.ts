// ── pos-bridge · empuje al Edge `ingest-ndf` (A3) ──────────────────────────────
//
// SALIDA-ONLY: el agente abre la conexión hacia Supabase; nadie entra a la PC del PoS.
// No hay puerto abierto, no hay que tocar el router.
//
// La función corre con `--no-verify-jwt`, así que el portón es el secreto compartido
// `x-ingest-secret` — igual que el agente BioTime contra `ingest-punches`, y por eso no
// hace falta anon key ni Authorization.

import type { CursorRow, PayloadIngest } from '../src/shared/ndf/ingestNdf.ts'

/** Respuesta 200 del Edge. `cursor` es la fila YA fusionada: de ahí sale por dónde seguir. */
export interface IngestNdfResult {
  ok:                boolean
  local:             string
  tickets_recibidos: number
  tickets_guardados: number
  lineas_guardadas:  number
  open_guardadas:    number
  open_borradas:     number
  invalid:           number
  recalculados:      number
  problemas:         string[]
  cursor:            CursorRow
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const TIMEOUT_MS = 30_000

/** Un reintento, y solo cuando puede ser transitorio: red caída o 5xx del lado del Edge. */
const REINTENTOS = 1
const ESPERA_REINTENTO_MS = 3_000

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function esResultado(v: unknown): v is IngestNdfResult {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

/**
 * Lo que reintentar NO va a arreglar: un 4xx (secreto equivocado, local inválido, body mal
 * armado) o una respuesta que no tiene la forma esperada. Reintentarlos gasta llamadas y,
 * peor, tapa el problema: que se vea en el primer ciclo.
 */
class ErrorDefinitivo extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDefinitivo'
  }
}

export interface DestinoIngest {
  ingestUrl:    string
  ingestSecret: string
}

/**
 * Manda el lote. Devuelve el resultado del Edge o TIRA — el que llama NO debe avanzar el
 * cursor si esto explota: el lote se vuelve a leer en el próximo ciclo y el
 * `(local, numero_factura)` de la base hace que reenviar nunca duplique.
 */
export async function pushIngest(
  destino: DestinoIngest,
  payload: PayloadIngest,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<IngestNdfResult> {
  const body = JSON.stringify(payload)
  let ultimoError: Error | null = null

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    if (intento > 0) await dormir(ESPERA_REINTENTO_MS)
    try {
      const res = await fetchImpl(destino.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // El secreto NUNCA se loguea, ni entero ni en pedazos.
          'x-ingest-secret': destino.ingestSecret,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.status >= 500) {
        // Del lado del Edge / Supabase: puede ser pasajero, se reintenta una vez.
        ultimoError = new Error(`ingest-ndf respondió ${res.status}`)
        continue
      }
      if (!res.ok) {
        const detalle = await res.text().catch(() => '')
        throw new ErrorDefinitivo(`ingest-ndf rechazó el lote (${res.status}): ${detalle.slice(0, 300)}`)
      }

      const json: unknown = await res.json()
      if (!esResultado(json) || !json.ok) {
        throw new ErrorDefinitivo(`Respuesta inesperada del Edge: ${JSON.stringify(json).slice(0, 300)}`)
      }
      return json
    } catch (e) {
      // AbortError (timeout) y fallos de red caen acá: transitorios, se reintenta.
      if (e instanceof ErrorDefinitivo) throw e
      ultimoError = e instanceof Error ? e : new Error(String(e))
    }
  }

  throw ultimoError ?? new Error('No se pudo empujar el lote')
}
