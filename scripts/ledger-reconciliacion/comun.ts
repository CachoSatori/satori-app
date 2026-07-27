// Núcleo compartido de los scripts de reconciliación del ledger.
//
// TODO acá es READ-ONLY: cada consulta pasa por `assertSoloSelect()` (candado del harness T0) y
// viaja con `read_only: true`, que Postgres impone a nivel de TRANSACCIÓN. Antes de leer un solo
// dato se manda a propósito un `create temp table` y se exige que el servidor lo rechace con
// `25006`. Si esa sonda pasara, se aborta sin consultar nada.
//
// Escribir en el ledger (`migration repair`, `UPDATE` de `version`) NO se hace desde acá: va con
// firma del dueño, a mano, con backup previo. Ver README.md.

import { mgmtToken, loadEnv, REF_STAGING, REF_PROD } from '../t0-reconciliacion-cajas/env.ts'
import { assertSoloSelect, verificarRechazoDeEscritura } from '../t0-reconciliacion-cajas/db.ts'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export type Entorno = 'staging' | 'prod'

/** Ref del CLI (`supabase/.temp/project-ref`), o null si no hay link. */
export function linkDelCli(): string | null {
  const p = resolve(REPO, 'supabase/.temp/project-ref')
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
}

/**
 * Resuelve el entorno del argv y aplica el candado.
 *
 * STAGING: libre (es el entorno de pruebas).
 * PROD: doble opt-in, igual que `prod-gate.ts` — el ref va CLAVADO acá (no sale del `.env`) y
 * además exige que `T0_PROD_FIRMADO` coincida con `T0_FIRMA_ESPERADA` (la fecha que el dueño
 * autorizó). Ninguna de las dos alcanza sola.
 */
export function abrir(argv: string[]): { entorno: Entorno; ref: string; token: string } {
  const entorno = (argv[2] || '').trim() as Entorno
  if (entorno !== 'staging' && entorno !== 'prod') {
    throw new Error('Uso: <script> <staging|prod>')
  }
  const ref = entorno === 'staging' ? REF_STAGING : REF_PROD

  if (entorno === 'prod') {
    if (ref !== 'yiczgdtirrkdvohdquzf') throw new Error(`Ref de prod inesperado: ${ref}`)
    const firma = (process.env.T0_PROD_FIRMADO || '').trim()
    const esperada = (process.env.T0_FIRMA_ESPERADA || '').trim()
    if (!esperada) throw new Error('Falta T0_FIRMA_ESPERADA (la fecha que el dueño autorizó).')
    if (firma !== esperada) {
      throw new Error(`FIRMA INVÁLIDA: T0_PROD_FIRMADO="${firma}" ≠ autorizada "${esperada}". PROD no se lee sin firma.`)
    }
  } else if (linkDelCli() !== REF_STAGING) {
    // Para staging exigimos además que el link del CLI apunte ahí: si alguien lo movió a prod,
    // cualquier comando de CLI que se corra al lado de este script iría al lugar equivocado.
    throw new Error(`ABORTADO: el link del CLI es "${linkDelCli()}", no staging.`)
  }

  const token = mgmtToken(loadEnv())
  if (!token) throw new Error('Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI").')
  return { entorno, ref, token }
}

/** SELECT read-only por Management API. Rechaza cualquier cosa que no sea un SELECT. */
export async function q(ref: string, token: string, sql: string): Promise<any[]> {
  assertSoloSelect(sql)
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as any[]
}

/** Prueba que el canal RECHAZA escrituras antes de leer nada. Devuelve el error del servidor. */
export async function smoke(ref: string, token: string): Promise<string> {
  const msg = await verificarRechazoDeEscritura(ref, token)
  console.log(`🔒 smoke read-only OK (${/25006/.test(msg) ? '25006' : 'rechazado'}) · ref ${ref}`)
  return msg
}

export const SQL_LEDGER =
  'select version, name from supabase_migrations.schema_migrations order by version'
