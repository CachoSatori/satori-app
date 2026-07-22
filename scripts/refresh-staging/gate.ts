// REGLA DE ORO DEL REFRESH — implementación única, todo pasa por acá.
//
//   · PROD es SOLO LECTURA, siempre. Se lee por el mismo canal firmado del T0-B
//     (prod-gate.ts): ref clavado + T0_PROD_FIRMADO + `read_only: true`, que Postgres
//     impone a nivel de transacción.
//   · TODA escritura va ÚNICAMENTE a STAGING, con el ref clavado ACÁ, en el código.
//
// El candado no es un comentario: `ejecutarEnStaging()` compara el ref contra la constante
// antes de armar la URL y aborta si no coincide. No hay forma de que una escritura salga
// hacia otro proyecto sin editar este archivo a mano.

import { mgmtToken, REF_PROD, REF_STAGING, type Env } from '../t0-reconciliacion-cajas/env.ts'

/** Ref de STAGING, clavado. Es el ÚNICO proyecto donde este directorio puede escribir. */
export const REF_STAGING_ESCRITURA: string = 'hwiatgicyyqyezqwldia'

/** Ref de PROD, clavado. Solo aparece en llamadas read-only. */
export const REF_PROD_LECTURA: string = 'yiczgdtirrkdvohdquzf'

const ENDPOINT = (ref: string) => `https://api.supabase.com/v1/projects/${ref}/database/query`

export function verificarRefs(): void {
  if (REF_STAGING_ESCRITURA !== REF_STAGING) {
    throw new Error(`El ref de escritura clavado (${REF_STAGING_ESCRITURA}) no es el de STAGING (${REF_STAGING}).`)
  }
  if (REF_PROD_LECTURA !== REF_PROD) {
    throw new Error(`El ref de lectura de prod clavado no coincide con REF_PROD (${REF_PROD}).`)
  }
  if (REF_STAGING_ESCRITURA === REF_PROD_LECTURA) {
    throw new Error('ABORTADO: el ref de escritura es el de PRODUCCIÓN.')
  }
}

export function token(env: Env): string {
  const t = mgmtToken(env)
  if (!t) throw new Error('Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI").')
  return t
}

async function ejecutar(ref: string, sql: string, tok: string, readOnly: boolean): Promise<unknown[]> {
  const res = await fetch(ENDPOINT(ref), {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query: sql, read_only: true } : { query: sql }),
  })
  if (!res.ok) {
    throw new Error(`[${ref}] HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
  }
  return (await res.json()) as unknown[]
}

/** LECTURA de PROD. Siempre read_only — no existe la variante de escritura. */
export async function leerDeProd(sql: string, tok: string): Promise<unknown[]> {
  verificarRefs()
  return ejecutar(REF_PROD_LECTURA, sql, tok, true)
}

/** LECTURA de staging. */
export async function leerDeStaging(sql: string, tok: string): Promise<unknown[]> {
  verificarRefs()
  return ejecutar(REF_STAGING_ESCRITURA, sql, tok, true)
}

/**
 * ESCRITURA — solo staging. El ref se toma de la constante clavada, NUNCA de un parámetro
 * ni del entorno: aunque alguien pase otro ref por error, no hay por dónde entre.
 */
export async function escribirEnStaging(sql: string, tok: string): Promise<unknown[]> {
  verificarRefs()
  return ejecutar(REF_STAGING_ESCRITURA, sql, tok, false)
}

/**
 * Comprueba que el canal de PROD sigue rechazando escrituras (25006) ANTES de empezar.
 * Es la misma sonda del T0-B: si pasara, se aborta todo sin tocar nada.
 */
export async function verificarProdEsSoloLectura(tok: string): Promise<string> {
  verificarRefs()
  const res = await fetch(ENDPOINT(REF_PROD_LECTURA), {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'create temp table refresh_smoke_debe_fallar (x int)', read_only: true }),
  })
  const cuerpo = (await res.text()).trim()
  if (res.ok) throw new Error('ABORTADO: el canal de PROD aceptó una escritura. read_only no se está aplicando.')
  if (!/read-only|25006/i.test(cuerpo)) throw new Error(`SMOKE AMBIGUO en prod: ${cuerpo.slice(0, 200)}`)
  return cuerpo.slice(0, 200)
}

// ── Alcance del refresh ──────────────────────────────────────────────────────
//
// Se copian los DATOS (no la estructura) del dominio CAJA + PROPINAS, que es lo que el
// dueño va a validar en piso. Todo lo demás queda como está, a propósito.

export const TABLAS_REFRESH = [
  'cash_movements',
  'cash_sessions',
  'cash_cierres_dia',
  'suppliers',
  'tip_sessions',
  'tip_entries',
  'role_tip_points',
  'employees',
  'exchange_rates',
  'movement_deletions',
  'documents',
] as const

/** Por qué NO se toca cada una de las excluidas — el detalle largo vive en PLAN.md. */
export const EXCLUIDAS: Record<string, string> = {
  profiles: 'AUTH: sus ids son los de auth.users de STAGING. Copiarlos rompería el login.',
  product_map: 'En staging tiene 8 columnas del PoS que prod no tiene; copiarlo las dejaría en default y rompería el PoS.',
  'pos_* / menu_* / salon_tables / fe_documentos / locations / modifier*': 'Solo existen en staging (PoS). Prod no las tiene.',
  'cash_movements_pre_migracion_2026_07 / suppliers_pre_migracion_2026_07': 'Backups viejos de staging. No se tocan.',
  'finance_* / ventas_* / accounting_entries': 'Fuera del alcance de la validación del cierre; refrescarlas agrega riesgo sin aportar.',
  'ingredients / ingredient_prices / recipes / recipe_ingredients / inventory_*': 'Dominio inventario, fuera del alcance.',
  'customers / customer_interactions / loyalty_* / sops / supplier_item_map': 'Fuera del alcance.',
}
