// ── Configuración del agente PoS (esqueleto, Fase A) ────────────────────────────
// Espeja `tools/biotime-bridge/src/config.ts`: sin dependencias, para poder probarlo sin
// tocar el disco ni el entorno real. `index.ts` carga el `.env` (dotenv) ANTES de llamar acá.
//
// Todo lo sensible (la clave del usuario de solo lectura del PoS y el INGEST_SECRET) vive SOLO
// en el `.env` de la PC del local. Nunca en el repo, nunca en los logs.

export const LOCALES = ['santa-teresa', 'nosara'] as const
export type Local = (typeof LOCALES)[number]

export interface PosConfig {
  local:           Local
  posHost:         string
  posPort:         number
  posDb:           string
  posUser:         string
  posPassword:     string
  /** Certificado autofirmado: lo normal en una instancia local de SQL Server. */
  posTrustCert:    boolean
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

function booleano(env: Env, clave: string, porDefecto: boolean): boolean {
  const crudo = (env[clave] ?? '').trim().toLowerCase()
  if (crudo === '') return porDefecto
  return crudo === 'true' || crudo === '1' || crudo === 'yes'
}

function esLocal(v: string): v is Local {
  return (LOCALES as readonly string[]).includes(v)
}

export function loadConfig(env: Env): PosConfig {
  // El local NO se adivina: separa las secuencias de id (cada PoS tiene la suya) y decide a qué
  // local se le acreditan las ventas. Misma regla que el biotime-bridge.
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
    posHost:        (env.POS_HOST ?? '127.0.0.1').trim(),
    posPort:        entero(env, 'POS_PORT', 1433, 1),
    posDb:          (env.POS_DB ?? 'ndf').trim(),
    posUser:        (env.POS_USER ?? 'satori_ro').trim(),
    posPassword:    requerido(env, 'POS_PASSWORD'),
    posTrustCert:   booleano(env, 'POS_TRUST_SERVER_CERT', true),
    ingestUrl,
    ingestSecret:   requerido(env, 'INGEST_SECRET'),
    pollIntervalMs: entero(env, 'POLL_INTERVAL_MS', 120_000, 5_000),
    batchSize:      entero(env, 'BATCH_SIZE', 200, 1),
    stateFile:      (env.STATE_FILE ?? './.bridge-state.json').trim(),
  }
}
