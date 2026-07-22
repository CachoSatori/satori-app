// T0 · Capa de lectura READ-ONLY.
//
// `abrirLector()` es el camino de STAGING y tiene el candado de entorno adentro.
// Para PROD existe `crearLectorMgmt()` con ref explícito: NO lleva candado propio a
// propósito — el doble opt-in vive en run-prod.ts, que es el único que lo llama.
//
// Dos transportes, misma salida (filas crudas de 3 tablas):
//   · postgrest — @supabase/supabase-js (el que ya usa la app). Necesita una key
//     que pueda LEER estas tablas. La anon key NO puede: RLS devuelve [] (HTTP 200).
//   · mgmt      — Management API `POST /v1/projects/<ref>/database/query`, el mismo
//     canal read-only que se usó para el diagnóstico de pendientes huérfanos
//     (HALLAZGOS.md). Token del entorno o del Keychain.
//
// Ninguno de los dos escribe. El transporte `mgmt` además pasa cada sentencia por
// `assertSoloSelect()` antes de mandarla.

import { createClient } from '@supabase/supabase-js'
import { assertStaging, mgmtToken, projectRefFromUrl, type Env } from './env.ts'

export type Backend = 'postgrest' | 'mgmt'

/** Único conjunto de tablas que este harness puede leer. */
export const TABLAS = ['cash_movements', 'cash_sessions', 'cash_cierres_dia'] as const
export type Tabla = (typeof TABLAS)[number]

export type Fila = Record<string, unknown>

const PAGINA = 1000

/** Columnas numéricas: la Management API las devuelve como string ("637115.00"). */
const NUMERICA = /(_crc|_usd|_rate|_cambio)$/

function coerce(fila: Fila): Fila {
  const out: Fila = {}
  for (const [k, v] of Object.entries(fila)) {
    out[k] = NUMERICA.test(k) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
  }
  return out
}

/**
 * Candado del transporte mgmt: solo SELECT, una sola sentencia, sin verbos de
 * escritura. Redundante con el hecho de que el SQL lo arma este archivo — a
 * propósito: es la última línea de defensa antes de la red.
 */
export function assertSoloSelect(sql: string): void {
  const s = sql.trim()
  if (!/^select\s/i.test(s)) throw new Error(`SQL rechazado (no empieza con SELECT): ${s.slice(0, 80)}`)
  if (s.replace(/;\s*$/, '').includes(';')) throw new Error('SQL rechazado (más de una sentencia)')
  const prohibido =
    /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|merge|call|do|vacuum|refresh|comment|set|reset|begin|commit|rollback)\b/i
  const hit = prohibido.exec(s)
  if (hit) throw new Error(`SQL rechazado (verbo de escritura "${hit[1]}")`)
}

export type Lector = {
  backend: Backend
  ref: string
  fetchAll(tabla: Tabla): Promise<Fila[]>
}

function lectorPostgrest(url: string, key: string, ref: string, etiqueta: string): Lector {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    backend: 'postgrest',
    ref,
    async fetchAll(tabla) {
      const filas: Fila[] = []
      for (let offset = 0; ; offset += PAGINA) {
        const { data, error } = await sb
          .from(tabla)
          .select('*')
          .order('id', { ascending: true })
          .range(offset, offset + PAGINA - 1)
        if (error) throw new Error(`[postgrest/${etiqueta}] ${tabla}: ${error.message}`)
        const lote = (data ?? []) as Fila[]
        filas.push(...lote.map(coerce))
        if (lote.length < PAGINA) return filas
      }
    },
  }
}

/**
 * SMOKE de seguridad: manda a propósito una sentencia de ESCRITURA con `read_only:true`
 * y exige que el servidor la RECHACE. Es la prueba de que el candado no es una promesa
 * del cliente sino una transacción read-only de Postgres.
 *
 * Se salta `assertSoloSelect()` adrede — mandar el write ES la prueba. La sentencia es
 * `create temp table`: aunque llegara a ejecutarse (no puede), muere con la sesión y no
 * toca ni un dato de usuario.
 *
 * Devuelve el mensaje de error del servidor. Si la sentencia PASA, tira — porque en ese
 * caso el canal no es read-only y no se puede seguir.
 */
export async function verificarRechazoDeEscritura(ref: string, token: string): Promise<string> {
  const sonda = 'create temp table t0_smoke_debe_fallar (x int)'
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sonda, read_only: true }),
  })
  const cuerpo = (await res.text()).trim()
  if (res.ok) {
    throw new Error(
      `SMOKE FALLIDO: el canal ACEPTÓ una escritura contra ${ref} (HTTP ${res.status}). ` +
        'read_only no se está aplicando — ABORTAR y no consultar nada más.',
    )
  }
  if (!/read-only|25006/i.test(cuerpo)) {
    throw new Error(
      `SMOKE AMBIGUO: la escritura falló contra ${ref}, pero no por ser read-only: ${cuerpo.slice(0, 200)}`,
    )
  }
  return cuerpo.slice(0, 200)
}

/** Lector por Management API con ref EXPLÍCITO. El candado de entorno es del llamador. */
export function crearLectorMgmt(ref: string, token: string): Lector {
  return lectorMgmt(ref, token)
}

function lectorMgmt(ref: string, token: string): Lector {
  return {
    backend: 'mgmt',
    ref,
    async fetchAll(tabla) {
      if (!(TABLAS as readonly string[]).includes(tabla)) throw new Error(`Tabla no permitida: ${tabla}`)
      const filas: Fila[] = []
      for (let offset = 0; ; offset += PAGINA) {
        const sql = `select * from public.${tabla} order by id limit ${PAGINA} offset ${offset}`
        assertSoloSelect(sql)
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql, read_only: true }),
        })
        if (!res.ok) {
          throw new Error(`[mgmt] ${tabla} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
        }
        const lote = (await res.json()) as Fila[]
        filas.push(...lote.map(coerce))
        if (lote.length < PAGINA) return filas
      }
    },
  }
}

/**
 * Elige transporte. Orden: override explícito → service_role (si está) → Management
 * API → anon (que casi seguro devuelve [] por RLS, y entonces run.ts aborta con un
 * mensaje que explica cómo arreglarlo).
 */
export function abrirLector(env: Env): Lector {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
  if (!url) throw new Error('Falta VITE_SUPABASE_URL (revisá .env.local).')
  const ref = projectRefFromUrl(url)
  assertStaging(ref) // ← candado: staging o nada

  const service = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || ''
  const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  const token = mgmtToken(env)
  const forzado = (env.T0_BACKEND || '').trim() as Backend | ''

  if (forzado === 'mgmt') {
    if (!token) throw new Error('T0_BACKEND=mgmt pero no hay token (SUPABASE_ACCESS_TOKEN / Keychain).')
    return lectorMgmt(ref, token)
  }
  if (forzado === 'postgrest') {
    const key = service || anon
    if (!key) throw new Error('T0_BACKEND=postgrest pero no hay key en el entorno.')
    return lectorPostgrest(url, key, ref, service ? 'service_role' : 'anon')
  }
  if (service) return lectorPostgrest(url, service, ref, 'service_role')
  if (token) return lectorMgmt(ref, token)
  if (anon) return lectorPostgrest(url, anon, ref, 'anon')
  throw new Error('Sin credenciales utilizables: ni service_role, ni token de Management API, ni anon key.')
}

export type Snapshot = {
  backend: Backend
  ref: string
  movements: Fila[]
  sessions: Fila[]
  cierres: Fila[]
}

export type Conteos = Record<Tabla, number>

/**
 * `count(*)` de las 3 tablas en UNA consulta. Se corre antes y después de la lectura
 * para dejar evidencia de que el harness no movió una sola fila.
 */
export async function contarFilas(ref: string, token: string): Promise<Conteos> {
  const sql =
    'select ' +
    TABLAS.map((t) => `(select count(*)::int from public.${t}) as ${t}`).join(', ')
  assertSoloSelect(sql)
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  })
  if (!res.ok) throw new Error(`[mgmt] conteos HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const [fila] = (await res.json()) as Record<string, number>[]
  return Object.fromEntries(TABLAS.map((t) => [t, Number(fila?.[t] ?? -1)])) as Conteos
}

export async function leerSnapshot(lector: Lector): Promise<Snapshot> {
  const [movements, sessions, cierres] = await Promise.all([
    lector.fetchAll('cash_movements'),
    lector.fetchAll('cash_sessions'),
    lector.fetchAll('cash_cierres_dia'),
  ])
  return { backend: lector.backend, ref: lector.ref, movements, sessions, cierres }
}
