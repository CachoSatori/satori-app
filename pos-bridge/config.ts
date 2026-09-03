// ── pos-bridge · configuración y candados ──────────────────────────────────────
//
// Todo lo sensible vive SOLO en el `.env` de la PC del PoS (o del túnel). Nunca en
// el repo, nunca en un log, nunca en el output del dry-run.
//
// Mismo molde que `tools/biotime-bridge/src/config.ts`: el parseo del `.env` se
// hace acá y el resto del programa recibe un objeto ya validado.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIR_BRIDGE = dirname(fileURLToPath(import.meta.url))
export const RAIZ_REPO  = resolve(DIR_BRIDGE, '..')

export type Env = Record<string, string | undefined>

/** Parser mínimo de `.env` (KEY=VALUE, sin expansión). Igual al de scripts/. */
export function parseEnvFile(texto: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const crudo of texto.split('\n')) {
    const linea = crudo.trim()
    if (!linea || linea.startsWith('#')) continue
    const eq = linea.indexOf('=')
    if (eq < 0) continue
    const clave = linea.slice(0, eq).trim()
    let valor = linea.slice(eq + 1).trim()
    // Comentario al final de la línea, solo si el valor no está entre comillas.
    if (!valor.startsWith('"') && !valor.startsWith("'")) {
      const h = valor.indexOf(' #')
      if (h >= 0) valor = valor.slice(0, h).trim()
    }
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1)
    }
    out[clave] = valor
  }
  return out
}

/**
 * `.env` del bridge primero (es el de la PC del PoS), después los del repo, y por
 * último `process.env` (que pisa todo, para corridas puntuales).
 */
export function loadEnv(): Env {
  const archivos = [
    resolve(RAIZ_REPO, '.env'),
    resolve(RAIZ_REPO, '.env.local'),
    resolve(DIR_BRIDGE, '.env'),
  ]
  const mezcla: Record<string, string> = {}
  for (const f of archivos) {
    if (existsSync(f)) Object.assign(mezcla, parseEnvFile(readFileSync(f, 'utf8')))
  }
  for (const [k, v] of Object.entries(process.env)) if (v != null) mezcla[k] = v
  return mezcla
}

export interface PosConfig {
  /** Host del SQL Server, sin la instancia. */
  server:          string
  /** Instancia nombrada (`\SQLNUBE`), o `null` si se conecta por puerto. */
  instanceName:    string | null
  port:            number | null
  user:            string
  password:        string
  database:        string
  encrypt:                 boolean
  trustServerCertificate:  boolean
  connectTimeoutMs: number
  requestTimeoutMs: number
  /** Overrides de nombres de columna (`POS_COL_<TABLA>_<CAMPO>`). */
  columnas:        Record<string, string>
}

/**
 * El admin del PoS **no se usa jamás**: este extractor entra con `ClienteConsulta`
 * (read-only, `db_datareader`). El candado es duro y no admite override — si el
 * `.env` trae un usuario administrativo, el programa aborta antes de abrir el socket.
 */
export const USUARIOS_PROHIBIDOS = ['ciosa', 'sa']

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
  if (!crudo) return porDefecto
  if (['1', 'true', 'si', 'sí', 'yes'].includes(crudo)) return true
  if (['0', 'false', 'no'].includes(crudo)) return false
  throw new Error(`${clave} inválido: "${crudo}" (true/false).`)
}

/** `DESKTOP-25PRDR1\SQLNUBE` → `{ server, instanceName }`. */
export function partirHost(host: string): { server: string; instanceName: string | null } {
  const [server = '', instancia] = host.trim().split('\\')
  const inst = (instancia ?? '').trim()
  return { server: server.trim(), instanceName: inst === '' ? null : inst }
}

/** `POS_COL_FACTURAS_MONTO=Total` → `{ 'facturas.monto': 'Total' }`. */
export function overridesColumnas(env: Env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    const m = /^POS_COL_([A-Z0-9]+)_([A-Z0-9]+)$/.exec(k)
    if (!m || !v || !v.trim()) continue
    out[`${m[1].toLowerCase()}.${m[2].toLowerCase()}`] = v.trim()
  }
  return out
}

export function loadPosConfig(env: Env): PosConfig {
  const { server, instanceName } = partirHost(requerido(env, 'POS_DB_HOST'))
  if (!server) throw new Error('POS_DB_HOST vacío tras parsear el nombre del servidor.')

  const user = requerido(env, 'POS_DB_USER')
  if (USUARIOS_PROHIBIDOS.includes(user.toLowerCase())) {
    throw new Error(
      `ABORTADO: POS_DB_USER="${user}" es un usuario administrativo del PoS. ` +
      'Este extractor solo entra con el usuario de solo lectura (ClienteConsulta).',
    )
  }

  const puertoCrudo = (env.POS_DB_PORT ?? '').trim()
  const port = puertoCrudo ? entero(env, 'POS_DB_PORT', 1433, 1) : null

  return {
    server,
    // tedious NO acepta puerto e instancia a la vez. Si el .env trae puerto, manda
    // el puerto (es lo que se probó: 1433). Para descubrir la instancia por el SQL
    // Browser, dejar POS_DB_PORT vacío.
    instanceName: port === null ? instanceName : null,
    port,
    user,
    password: requerido(env, 'POS_DB_PASSWORD'),
    database: (env.POS_DB_DATABASE ?? 'ndf').trim(),
    // Instalación local del PoS: sin TLS y con certificado autofirmado.
    encrypt:                booleano(env, 'POS_DB_ENCRYPT', false),
    trustServerCertificate: booleano(env, 'POS_DB_TRUST_CERT', true),
    connectTimeoutMs: entero(env, 'POS_DB_CONNECT_TIMEOUT_MS', 15_000, 1_000),
    requestTimeoutMs: entero(env, 'POS_DB_REQUEST_TIMEOUT_MS', 60_000, 1_000),
    columnas: overridesColumnas(env),
  }
}

/** Una línea para el log. **Nunca** incluye la contraseña. */
export function describirConfig(cfg: PosConfig): string {
  const destino = cfg.instanceName ? `${cfg.server}\\${cfg.instanceName}` : `${cfg.server}:${cfg.port ?? 1433}`
  return `${destino}/${cfg.database} · usuario ${cfg.user} · encrypt=${cfg.encrypt} · trustCert=${cfg.trustServerCertificate}`
}
