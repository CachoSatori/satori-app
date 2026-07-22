// T0 · Entorno y candados de seguridad.
//
// Este harness es READ-ONLY y SOLO puede hablar con STAGING. El ref del proyecto
// está clavado acá y no hay override por variable de entorno: si la URL del .env
// no es la de staging, el script aborta antes de abrir una sola conexión.

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Supabase project refs — ver ESTADO.md §(a). */
export const REF_STAGING = 'hwiatgicyyqyezqwldia'
export const REF_PROD = 'yiczgdtirrkdvohdquzf'

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')

/** Parser mínimo de .env (KEY=VALUE, sin expansión ni comillas anidadas). */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

export type Env = Record<string, string>

/** .env.local del repo, con process.env pisando (para CI o corridas puntuales). */
export function loadEnv(): Env {
  const files = ['.env.local', '.env'].map((f) => resolve(REPO_ROOT, f))
  const merged: Record<string, string> = {}
  for (const f of files) Object.assign(merged, parseEnvFile(f))
  for (const [k, v] of Object.entries(process.env)) if (v != null) merged[k] = v
  return merged
}

/** `https://<ref>.supabase.co` → `<ref>`. */
export function projectRefFromUrl(url: string): string {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(url.trim())
  if (!m) throw new Error(`URL de Supabase no reconocida: ${JSON.stringify(url)}`)
  return m[1]
}

/**
 * Candado duro. No admite override: este harness existe para medir staging y
 * nada más. Cualquier otro ref (incluido prod) aborta.
 */
export function assertStaging(ref: string): void {
  if (ref === REF_PROD) {
    throw new Error(
      `ABORTADO: la URL apunta a PRODUCCIÓN (${REF_PROD}). ` +
        'Este harness solo corre contra STAGING. Revisá .env.local / VITE_SUPABASE_URL.',
    )
  }
  if (ref !== REF_STAGING) {
    throw new Error(
      `ABORTADO: ref inesperado "${ref}". Solo se permite STAGING (${REF_STAGING}).`,
    )
  }
}

/**
 * Token de la Management API. Primero la variable de entorno; si no está, el
 * Keychain de macOS donde el CLI de Supabase deja su token (ver HALLAZGOS.md).
 * Nunca se imprime.
 */
export function mgmtToken(env: Env): string | null {
  const fromEnv = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_MGMT_TOKEN
  if (fromEnv) return fromEnv.trim()
  if (process.platform !== 'darwin') return null

  // Con `-a supabase` el ítem resuelve determinísticamente. Sin la cuenta, en contextos
  // headless el read puede QUEDARSE COLGADO esperando un diálogo de ACL que nunca aparece
  // (visto 2026-07-08, ver HALLAZGOS.md) — de ahí el timeout: preferimos quedarnos sin
  // token y avisar, antes que colgar el harness.
  const intentos = [
    ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
    ['find-generic-password', '-s', 'Supabase CLI', '-w'],
  ]
  for (const args of intentos) {
    try {
      const tok = execFileSync('security', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 12_000,
      }).trim()
      if (tok) return tok
    } catch {
      // ítem inexistente, ACL denegado o timeout → probamos la siguiente forma
    }
  }
  return null
}
