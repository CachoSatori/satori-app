// ── monthly-report: quién puede pedir el reporte y con qué parámetros (SEC-02 / SEC-02b) ───────
//
// Módulo PURO (sin Deno, sin red): la decisión de acceso, la validación de parámetros y la forma
// de la respuesta. `index.ts` le inyecta lo que necesita de Supabase (`DepsAcceso`). Así la guarda
// se prueba con vitest (`acceso.test.ts`) y no depende de desplegar la función.
//
// Reglas (iguales a la v10 desplegada el 06/11 desde 9ac28b0):
//   · Authorization obligatorio: `Bearer <token>`. Sin token → 401.
//   · service_role (el cron, desde el Vault): igual a la clave del entorno, o validada por el
//     servidor (un endpoint de admin de GoTrue solo responde a una service_role real; sirve para la
//     clave JWT vieja y para las claves nuevas).
//   · Si no: el JWT de un usuario → tiene que ser OWNER ACTIVO (profiles.role = 'owner' and
//     is_active). Token inválido (incluida la anon key) → 401. Otro rol o inactivo → 403.
//   · Parámetros: month = YYYY-MM entre 2024-01 y el mes en curso (CR); tipo ∈ {ventas, propinas,
//     ambos}; dry_run booleano. Si no → 400.
//   · La respuesta NO trae montos ni nombres (van solo en el correo).

export type Tipo = 'ventas' | 'propinas' | 'ambos'

export interface DepsAcceso {
  /** La service_role del entorno (SUPABASE_SERVICE_ROLE_KEY). */
  serviceKey: string
  /** ¿El token es una service_role real? (endpoint de admin de GoTrue). */
  esServiceRole(token: string): Promise<boolean>
  /** El id del usuario dueño del token, o null si no es un JWT de usuario válido. */
  usuarioDeToken(token: string): Promise<string | null>
  /** ¿Ese usuario es owner activo? `'error'` si la consulta falló. */
  esOwnerActivo(userId: string): Promise<boolean | 'error'>
}

export type Acceso =
  | { ok: true; quien: string }
  | { ok: false; status: 401 | 403 | 500; code: string; error: string }

/** Comparación en tiempo constante (no corta en el primer byte distinto). */
export function igualConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

export async function decidirAcceso(authorization: string | null, deps: DepsAcceso): Promise<Acceso> {
  const auth = authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, code: 'sin_sesion', error: 'No autorizado' }

  const esService = (deps.serviceKey !== '' && igualConstante(token, deps.serviceKey))
    || await deps.esServiceRole(token).catch(() => false)
  if (esService) return { ok: true, quien: 'service_role' }

  const userId = await deps.usuarioDeToken(token).catch(() => null)
  if (!userId) return { ok: false, status: 401, code: 'sin_sesion', error: 'No autorizado' }
  const owner = await deps.esOwnerActivo(userId).catch(() => 'error' as const)
  if (owner === 'error') return { ok: false, status: 500, code: 'interno', error: 'No se pudo generar el reporte' }
  if (!owner) return { ok: false, status: 403, code: 'no_autorizado', error: 'Solo un owner activo puede pedir el reporte' }
  return { ok: true, quien: `owner:${userId}` }
}

/** `YYYY-MM` del mes en curso en Costa Rica. */
export function mesActualCR(ahora: Date = new Date()): string {
  const hoy = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }))
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
}

/** El mes anterior al en curso (CR): el default del cron del día 1. */
export function mesAnteriorCR(ahora: Date = new Date()): string {
  const now = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }))
  now.setMonth(now.getMonth() - 1)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** month: YYYY-MM entre 2024-01 y el mes en curso (CR). */
export function mesValido(ym: string, actual: string): boolean {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!m) return false
  return ym >= '2024-01' && ym <= actual
}

export type Parametros =
  | { ok: true; ym: string; tipo: Tipo; dry: boolean }
  | { ok: false; status: 400; code: string; error: string }

export function validarParametros(body: unknown, ahora: Date = new Date()): Parametros {
  if (body === null || typeof body !== 'object') return { ok: false, status: 400, code: 'entrada', error: 'Datos inválidos' }
  const b = body as { month?: unknown; tipo?: unknown; dry_run?: unknown }
  let ym: string
  if (b.month !== undefined && b.month !== null && b.month !== '') {
    if (typeof b.month !== 'string' || !mesValido(b.month, mesActualCR(ahora))) {
      return { ok: false, status: 400, code: 'mes', error: 'Mes inválido (YYYY-MM)' }
    }
    ym = b.month
  } else {
    ym = mesAnteriorCR(ahora)
  }
  const tipo = b.tipo === undefined || b.tipo === null || b.tipo === '' ? 'ambos' : b.tipo
  if (tipo !== 'ventas' && tipo !== 'propinas' && tipo !== 'ambos') {
    return { ok: false, status: 400, code: 'tipo', error: 'Tipo inválido (ventas, propinas o ambos)' }
  }
  if (b.dry_run !== undefined && typeof b.dry_run !== 'boolean') {
    return { ok: false, status: 400, code: 'dry_run', error: 'dry_run inválido' }
  }
  return { ok: true, ym, tipo, dry: b.dry_run === true }
}

/** El cuerpo 200: qué se envió y qué no tenía datos. Sin montos ni nombres. */
export function respuestaOk(mes: string, anio: number, dry: boolean, enviados: string[], sinDatos: string[]) {
  return { ok: true as const, month: `${mes} ${anio}`, dry_run: dry, enviados, sin_datos: sinDatos }
}

/** CORS: solo prod (GitHub Pages) y staging/previews de Cloudflare. */
export function origenPermitido(origin: string): boolean {
  return origin === 'https://cachosatori.github.io'
    || /^https:\/\/([a-z0-9-]+\.)?satori-staging\.pages\.dev$/.test(origin)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origin && origenPermitido(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
