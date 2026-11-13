/**
 * Lógica HTTP del Edge `club-pase` (B1), separada para probarla con vitest: recibe el pedido y las dependencias
 * (variables de entorno y una función `rpc` con service_role). El Edge (supabase/functions/club-pase) solo conecta.
 *
 *   POST /club-pase/google   headers: x-club-web: <CLUB_WEB_KEY>   body: { "token": "<token del portal, 64 hex>" }
 *   → 200 { url: "https://pay.google.com/gp/v/save/<jwt>", object_id }
 *   (12-nov) Link CORTO: la clase y el objeto se crean o actualizan por la API de Wallet y el JWT lleva solo los IDs.
 *
 * Portón (CONTRATO-pase.md §5): solo club-web llama (header x-club-web, el mismo secreto que la base usa para las
 * funciones públicas); el tope por IP lo pone club-web (B2). Falla CERRADA: sin CLUB_WEB_KEY, GOOGLE_WALLET_ISSUER_ID
 * o GOOGLE_WALLET_SA_KEY, o sin un WALLET_ENTORNO válido (prod | stg), responde 503 y no llama a la base. Nunca devuelve mensajes crudos de la base ni de Google.
 */
import {
  armarClase, armarObjeto, firmarJwtFlaco, leerCuentaServicio, urlGuardar, validarDatos, idObjeto, DISENO_POR_DEFECTO, configurarBaseClub,
  entornoValido, type PaseDatos, type DisenoPase,
} from './googlePase.ts'
import { sincronizar, vencerBajas, actualizarUno, guardarEnGoogle, tokenGoogle, type Fetch } from './sincronizar.ts'

export interface EnvPase {
  CLUB_WEB_KEY?: string
  GOOGLE_WALLET_ISSUER_ID?: string
  GOOGLE_WALLET_SA_KEY?: string
  /** Dominio desde el que se ofrece el botón. Por defecto, el del Club. */
  CLUB_WEB_ORIGIN?: string
  /** JSON opcional { colorFondo, logoUrl } (lo aprueba el dueño). */
  WALLET_DISENO?: string
  /** B3: secreto del programador que llama a /club-pase/sync (header x-club-pase-sync). ≥ 32 caracteres. */
  CLUB_PASE_SYNC_KEY?: string
  /** (12-nov) `prod` o `stg` (staging y prod comparten el emisor de Google). Falta o es otro valor → 503. */
  WALLET_ENTORNO?: string
}
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

const RE_TOKEN = /^[0-9a-f]{64}$/

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

/** Comparación en tiempo constante (salvo el largo). */
export function igualSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let d = 0
  for (let i = 0; i < ea.length; i++) d |= ea[i] ^ eb[i]
  return d === 0
}

function diseno(env: EnvPase): DisenoPase {
  if (!env.WALLET_DISENO) return DISENO_POR_DEFECTO
  try {
    const x = JSON.parse(env.WALLET_DISENO) as Partial<DisenoPase>
    return {
      colorFondo: typeof x.colorFondo === 'string' && /^#[0-9a-fA-F]{6}$/.test(x.colorFondo) ? x.colorFondo : DISENO_POR_DEFECTO.colorFondo,
      logoUrl: typeof x.logoUrl === 'string' && x.logoUrl.startsWith('https://') ? x.logoUrl : null,
      heroUrl: typeof x.heroUrl === 'string' && x.heroUrl.startsWith('https://') ? x.heroUrl : null,
    }
  } catch { return DISENO_POR_DEFECTO }
}

/**
 * B3: rutas de sincronización.
 *   POST /club-pase/sync        x-club-pase-sync: <CLUB_PASE_SYNC_KEY>          → resumen del lote
 *   POST /club-pase/vencer      x-club-pase-sync: <CLUB_PASE_SYNC_KEY>          → (12-nov, piloto) solo vence las bajas
 *   POST /club-pase/actualizar  x-club-web: <CLUB_WEB_KEY>  { token del portal } → «Actualizar mi pase»
 * Fallan cerradas sin sus secretos. `fetchFn` es la red hacia Google (inyectada para las pruebas).
 */
export async function manejarSync(req: Request, ruta: 'sync' | 'vencer' | 'actualizar', env: EnvPase, rpc: Rpc, fetchFn: Fetch, ahora = new Date()): Promise<Response> {
  // (08-nov noche) el dominio del Club sale de CLUB_WEB_ORIGIN (= club_config_global.club_url); sin él, falla cerrada
  if (!configurarBaseClub(env.CLUB_WEB_ORIGIN)) return json(503, { error: 'servicio_no_disponible' })
  if (req.method !== 'POST') return json(405, { error: 'metodo' })
  if (!env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_WALLET_SA_KEY) return json(503, { error: 'servicio_no_disponible' })
  const entorno = entornoValido(env.WALLET_ENTORNO)
  if (!entorno) return json(503, { error: 'servicio_no_disponible' })   // (12-nov) sin ambiente no se toca nada
  let sa
  try { sa = leerCuentaServicio(env.GOOGLE_WALLET_SA_KEY) } catch { return json(503, { error: 'servicio_no_disponible' }) }
  const deps = { rpc, fetch: fetchFn, sa, issuer: env.GOOGLE_WALLET_ISSUER_ID, entorno, diseno: diseno(env), ahora }
  if (ruta === 'sync' || ruta === 'vencer') {
    // (12-nov) /vencer: el piloto solo vence los pases de las bajas (opción c del dueño); /sync es la completa (después).
    if (!env.CLUB_PASE_SYNC_KEY || env.CLUB_PASE_SYNC_KEY.length < 32) return json(503, { error: 'servicio_no_disponible' })
    if (!igualSeguro(req.headers.get('x-club-pase-sync') ?? '', env.CLUB_PASE_SYNC_KEY)) return json(401, { error: 'no_autorizado' })
    try { return json(200, ruta === 'vencer' ? await vencerBajas(deps) : await sincronizar(deps)) } catch { return json(502, { error: 'servicio' }) }
  }

  if (!env.CLUB_WEB_KEY || env.CLUB_WEB_KEY.length < 32) return json(503, { error: 'servicio_no_disponible' })
  if (!igualSeguro(req.headers.get('x-club-web') ?? '', env.CLUB_WEB_KEY)) return json(401, { error: 'no_autorizado' })
  let b: { token?: unknown }
  try {
    const txt = await req.text()
    if (txt.length > 1024) return json(400, { error: 'datos_invalidos' })
    b = JSON.parse(txt || '{}') as { token?: unknown }
  } catch { return json(400, { error: 'datos_invalidos' }) }
  const token = typeof b.token === 'string' ? b.token.trim().toLowerCase() : ''
  if (!RE_TOKEN.test(token)) return json(404, { error: 'portal_invalido' })
  const t = await rpc('club_pase_por_token', { p_token: token })
  if (t.error) return json(502, { error: 'servicio' })
  if (typeof t.data !== 'string') return json(404, { error: 'portal_invalido' })
  try {
    const r = await actualizarUno(deps, t.data)
    return r === 'error' ? json(502, { error: 'servicio' }) : json(200, { resultado: r })
  } catch { return json(502, { error: 'servicio' }) }
}

export async function manejarPase(req: Request, ruta: string, env: EnvPase, rpc: Rpc, fetchFn: Fetch, ahora = new Date()): Promise<Response> {
  // (08-nov noche) el dominio del Club sale de CLUB_WEB_ORIGIN (= club_config_global.club_url); sin él, falla cerrada
  if (!configurarBaseClub(env.CLUB_WEB_ORIGIN)) return json(503, { error: 'servicio_no_disponible' })
  if (req.method !== 'POST') return json(405, { error: 'metodo' })
  if (ruta !== 'google') return json(404, { error: 'no_encontrado' })   // Apple (B4) va apagado por flag
  // Falla cerrada: sin la configuración completa no se toca la base.
  if (!env.CLUB_WEB_KEY || env.CLUB_WEB_KEY.length < 32 || !env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_WALLET_SA_KEY) {
    return json(503, { error: 'servicio_no_disponible' })
  }
  // (12-nov) staging y prod comparten el emisor: sin un ambiente válido (prod | stg) no se toca la base ni Google
  const entorno = entornoValido(env.WALLET_ENTORNO)
  if (!entorno) return json(503, { error: 'servicio_no_disponible' })
  if (!igualSeguro(req.headers.get('x-club-web') ?? '', env.CLUB_WEB_KEY)) return json(401, { error: 'no_autorizado' })

  let cuerpo: { token?: unknown }
  try {
    const txt = await req.text()
    if (txt.length > 1024) return json(400, { error: 'datos_invalidos' })
    cuerpo = JSON.parse(txt || '{}')
  } catch { return json(400, { error: 'datos_invalidos' }) }
  const token = typeof cuerpo.token === 'string' ? cuerpo.token.trim().toLowerCase() : ''
  if (!RE_TOKEN.test(token)) return json(404, { error: 'portal_invalido' })

  let sa
  try { sa = leerCuentaServicio(env.GOOGLE_WALLET_SA_KEY) } catch { return json(503, { error: 'servicio_no_disponible' }) }

  // 1. token del portal → miembro (solo service_role; null si no existe, está de baja o no tiene rol)
  const t = await rpc('club_pase_por_token', { p_token: token })
  if (t.error) return json(502, { error: 'servicio' })
  if (typeof t.data !== 'string') return json(404, { error: 'portal_invalido' })
  const miembro = t.data

  // 2. datos del pase (contrato v1)
  const d = await rpc('club_pase_datos', { p_miembro: miembro })
  if (d.error) return json(502, { error: 'servicio' })
  if (validarDatos(d.data) !== null) return json(502, { error: 'contrato' })
  const datos = d.data as PaseDatos
  if (datos.estado === 'baja') return json(404, { error: 'portal_invalido' })

  // 3. clase + objeto armados (si algo no cierra con el contrato, no se llama a Google)
  const issuer = env.GOOGLE_WALLET_ISSUER_ID
  let clase: { id: string }, objeto: { id: string; classId: string }
  try {
    clase = armarClase(issuer, entorno)
    objeto = armarObjeto(issuer, entorno, datos, diseno(env)) as unknown as { id: string; classId: string }
  } catch { return json(503, { error: 'servicio_no_disponible' }) }

  // 4. (12-nov) se crean o actualizan en Google por la API, y recién ahí el JWT corto (solo los IDs)
  let jwt: string
  try {
    const tok = await tokenGoogle(sa, fetchFn, ahora)
    const g = await guardarEnGoogle(fetchFn, tok, issuer, entorno, clase, objeto)
    if (g !== 'ok') { console.error('club-pase: Google', g); return json(502, { error: 'servicio' }) }
    jwt = await firmarJwtFlaco(sa, objeto, [env.CLUB_WEB_ORIGIN as string], ahora)
  } catch (e) {
    console.error('club-pase: Google', e instanceof Error && /^token de Google/.test(e.message) ? e.message : 'excepción')
    return json(502, { error: 'servicio' })
  }

  // 5. registrar el pase emitido (para «Actualizar mi pase» y, después del piloto, la sincronización)
  const objectId = idObjeto(issuer, miembro, entorno)
  const e = await rpc('club_pase_emitido', { p_miembro: miembro, p_plataforma: 'google', p_object_id: objectId })
  if (e.error) return json(502, { error: 'servicio' })

  return json(200, { url: urlGuardar(jwt), object_id: objectId })
}
