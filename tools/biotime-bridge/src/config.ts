// ── Configuración del agente (F1c) ──────────────────────────────────────────────
// Sin dependencias a propósito: `index.ts` carga el `.env` (dotenv) ANTES de llamar acá,
// así este módulo queda puro y se puede probar sin tocar el disco ni el entorno real.
//
// Todo lo sensible (la clave de `satori_ro` y el `INGEST_SECRET`) vive SOLO en el `.env`
// de la PC del local. Nunca en el repo, nunca en los logs.

export const LOCALES = ['santa-teresa', 'nosara'] as const
export type Local = (typeof LOCALES)[number]

export interface BridgeConfig {
  local:           Local
  biotimeHost:     string
  biotimePort:     number
  biotimeDb:       string
  biotimeUser:     string
  biotimePassword: string
  ingestUrl:       string
  ingestSecret:    string
  pollIntervalMs:  number
  batchSize:       number
  stateFile:       string
}

export type Env = Record<string, string | undefined>

function requerido(env: Env, clave: string): string {
  const v = (env[clave] ?? '').trim()
  if (!v) throw new Error(`Falta ${clave} en el .env (copiá .env.example y completalo).`)
  return v
}

function entero(env: Env, clave: string, porDefecto: number, minimo: number): number {
  const crudo = (env[clave] ?? '').trim()
  if (!crudo) return porDefecto
  const n = Number(crudo)
  if (!Number.isInteger(n) || n < minimo) {
    throw new Error(`${clave} inválido: "${crudo}" (entero >= ${minimo}).`)
  }
  return n
}

function esLocal(v: string): v is Local {
  return (LOCALES as readonly string[]).includes(v)
}

export function loadConfig(env: Env): BridgeConfig {
  // El local NO se adivina: es el que separa las dos secuencias de `biotime_id` (cada
  // BioTime tiene la suya) y el que decide a qué local se le acreditan las horas.
  const local = requerido(env, 'LOCAL')
  if (!esLocal(local)) {
    throw new Error(`LOCAL inválido: "${local}". Tiene que ser uno de: ${LOCALES.join(' | ')}.`)
  }

  const ingestUrl = requerido(env, 'INGEST_URL')
  if (!/^https:\/\//i.test(ingestUrl)) {
    // El secreto compartido viaja en un header: sin TLS iría en claro por la red.
    throw new Error(`INGEST_URL tiene que ser https:// (llegó "${ingestUrl}").`)
  }

  return {
    local,
    biotimeHost:     (env.BIOTIME_HOST ?? '127.0.0.1').trim(),
    biotimePort:     entero(env, 'BIOTIME_PORT', 7496, 1),
    biotimeDb:       (env.BIOTIME_DB ?? 'Satori').trim(),
    biotimeUser:     (env.BIOTIME_USER ?? 'satori_ro').trim(),
    biotimePassword: requerido(env, 'BIOTIME_PASSWORD'),
    ingestUrl,
    ingestSecret:    requerido(env, 'INGEST_SECRET'),
    pollIntervalMs:  entero(env, 'POLL_INTERVAL_MS', 120_000, 5_000),
    batchSize:       entero(env, 'BATCH_SIZE', 200, 1),
    stateFile:       (env.STATE_FILE ?? './.bridge-state.json').trim(),
  }
}
