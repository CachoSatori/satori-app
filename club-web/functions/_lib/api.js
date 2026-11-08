// Club Satori — API pública del mini-sitio (Pages Function). JS plano: lo usan la
// función de Cloudflare (functions/api/[[path]].js) y el servidor local (dev-server.mjs).
//
// · Llama a las RPC de Supabase con la anon key (variable de entorno, nunca en el repo).
// · Agrega el tope por IP (CF-Connecting-IP) con un binding por endpoint, RL_CREAR y RL_LEER (obligatorios: sin ellos, 503).
//   El tope por referente y por día y el global por minuto en SQL siguen siendo la red de seguridad.
// · Manda el header x-club-web con el secreto CLUB_WEB_KEY: la base solo responde con él (CLUB-AUD-06).
// · Nunca devuelve el mensaje crudo de la base: lo traduce a un código fijo.

const RE_REF = /^[A-HJ-NP-Z2-9]{8}$/
const RE_CUPON = /^[A-HJ-NP-Z2-9]{10}$/
const RE_TOKEN = /^[0-9a-f]{64}$/
const RE_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/

const memoria = new Map() // SOLO para el servidor local (CLUB_DEV=1)

/**
 * Tope por endpoint y por IP (CLUB-AUD-14 y 24, ronda 3). Un binding de Rate Limiting por tipo de pedido:
 *   · RL_CREAR: crear cupón, opt-in y código de canje → 5 por 60 s por IP.
 *   · RL_LEER:  ver cupón y portal → 60 por 60 s por IP.
 * Si el binding no está, devuelve `null` y la API responde 503 (falla cerrada). El contador en memoria existe
 * solo en el servidor local (`CLUB_DEV=1`). `RATE_LIMITER` (un solo binding de antes) ya no se usa.
 * @param {'crear'|'leer'} tipo
 * @returns {Promise<boolean|null>} true = pasa · false = tope · null = sin limitador (fallar cerrado)
 */
export async function limitar(env, tipo, clave, max, ventanaS) {
  const b = tipo === 'crear' ? env.RL_CREAR : env.RL_LEER
  if (b && typeof b.limit === 'function') {
    const { success } = await b.limit({ key: clave })
    if (!success) {
      // Alerta: queda en los logs de la función (Workers Logs). Se puede armar una notificación sobre este texto.
      console.warn(JSON.stringify({ alerta: 'club-web-tope', tipo, clave: clave.split(':')[0] }))
    }
    return success
  }
  if (env.CLUB_DEV !== '1') return null
  const k = `rl:${tipo}:${clave}:${Math.floor(Date.now() / 1000 / ventanaS)}`
  const n = memoria.get(k) || 0
  if (n >= max) return false
  memoria.set(k, n + 1)
  if (memoria.size > 5000) memoria.clear()
  return true
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

function traducirError(msg) {
  const m = String(msg || '')
  if (m === 'Código no válido') return [404, 'referente_invalido']
  if (m === 'No se pueden generar más cupones hoy') return [429, 'tope_referente']
  if (m === 'Demasiados cupones en este momento') return [429, 'demasiados_pedidos']
  if (m === 'Cupón no válido') return [404, 'cupon_invalido']
  if (m === 'Enlace no válido') return [404, 'portal_invalido']
  if (m === 'Demasiados códigos de canje') return [429, 'tope_canje']
  if (m === 'Todavía no te alcanza para canjear') return [409, 'sin_saldo_canje']
  if (m === 'Demasiadas altas hoy') return [429, 'tope_altas']
  if (/consentimiento|no válidos/i.test(m)) return [400, 'datos_invalidos']
  return [502, 'servicio']
}

async function rpc(env, fn, args) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '')
  // CLUB-AUD-06: sin la clave de club-web la base rechaza todo; sin ella, ni se intenta (falla cerrada).
  if (!RE_SUPABASE.test(url) || !env.SUPABASE_ANON_KEY || !env.CLUB_WEB_KEY) return json(503, { error: 'servicio_no_disponible' })
  let r
  try {
    r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'x-club-web': env.CLUB_WEB_KEY,
      },
      body: JSON.stringify(args),
    })
  } catch {
    return json(502, { error: 'servicio' })
  }
  let data = null
  try { data = await r.json() } catch { /* cuerpo vacío */ }
  if (!r.ok) {
    const [st, code] = traducirError(data && data.message)
    return json(st, { error: code })
  }
  return json(200, { data })
}

async function leerCuerpo(request) {
  const txt = await request.text()
  if (txt.length > 2048) return null
  try { return JSON.parse(txt || '{}') } catch { return null }
}

function limpiarContacto(c) {
  if (!c || typeof c !== 'object') return null
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
  return { nombre: s(c.nombre, 80), whatsapp: s(c.whatsapp, 32), email: s(c.email, 254), optin: c.optin === true }
}

/**
 * LC-DES-07: Turnstile (Cloudflare) en la autoalta. TURNSTILE_SECRET es secreto de Pages (en staging, la clave de
 * prueba de Cloudflare). Sin el secreto la autoalta responde 503 (falla cerrada). En el servidor local
 * (CLUB_DEV=1) se acepta el token «dev».
 * @returns {Promise<boolean|null>} true = humano · false = no · null = sin configurar
 */
export async function verificarTurnstile(env, token, ip) {
  if (env.CLUB_DEV === '1' && !env.TURNSTILE_SECRET) return token === 'dev'
  if (!env.TURNSTILE_SECRET) return null
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return false
  try {
    const f = new FormData()
    f.append('secret', env.TURNSTILE_SECRET); f.append('response', token)
    if (ip && ip !== 'sin-ip') f.append('remoteip', ip)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f })
    const j = await r.json()
    return j && j.success === true
  } catch {
    return false
  }
}

const RE_AVISO = /^v[0-9A-Za-z.-]{1,30}$/

/**
 * CLUB-AUD-74: prefijo de red de la IP, para un tope además del de la IP (rotar IPs dentro de la misma red no lo
 * esquiva). IPv4 → /24 ("203.0.113.0/24"); IPv6 → /64 (los 4 primeros grupos, con «::» expandido). Otra cosa → la IP.
 */
export function prefijoRed(ip) {
  const s = String(ip || '').trim().toLowerCase()
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`
  if (s.includes(':') && /^[0-9a-f:]+$/.test(s)) {
    const [izq, der] = s.split('::')
    const a = izq ? izq.split(':') : []
    const b = der !== undefined && der !== '' ? der.split(':') : []
    const grupos = der === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b]
    if (grupos.length === 8) return `${grupos.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
  }
  return s || 'sin-ip'
}

/**
 * B2: «Agregar a Google Wallet». club-web llama al Edge `club-pase` (B1) con el mismo `x-club-web`; el Edge firma el
 * JWT. Devuelve solo `{ url }` y solo si es un link de Google Wallet. Errores con código fijo.
 */
async function walletGoogle(env, token) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '')
  if (!RE_SUPABASE.test(url) || !env.SUPABASE_ANON_KEY || !env.CLUB_WEB_KEY) return json(503, { error: 'servicio_no_disponible' })
  let r
  try {
    r = await fetch(`${url}/functions/v1/club-pase/google`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'x-club-web': env.CLUB_WEB_KEY },
      body: JSON.stringify({ token }),
    })
  } catch {
    return json(502, { error: 'servicio' })
  }
  let data = null
  try { data = await r.json() } catch { /* cuerpo vacío */ }
  if (r.status === 404) return json(404, { error: 'portal_invalido' })
  if (!r.ok) return json(r.status === 503 ? 503 : 502, { error: r.status === 503 ? 'servicio_no_disponible' : 'servicio' })
  const link = data && typeof data.url === 'string' ? data.url : ''
  if (!link.startsWith('https://pay.google.com/gp/v/save/')) return json(502, { error: 'servicio' })
  return json(200, { data: { url: link } })
}

/** Router de /api/*. `path` sin el prefijo /api/. */
export async function manejar(request, env, path) {
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip'
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  // Solo para el contador del servidor local; en Cloudflare los topes los fija cada binding (wrangler.toml).
  const crearMax = n(env.RL_CREAR_MAX, 5), crearVent = n(env.RL_CREAR_VENTANA_S, 60)
  const leerMax = n(env.RL_LECTURA_MAX, 60), leerVent = n(env.RL_LECTURA_VENTANA_S, 60)
  const partes = String(path || '').split('/').filter(Boolean)
  const metodo = request.method

  // GET /api/salud → qué está configurado (sin valores): sirve para verificar los bindings en Pages.
  if (partes.length === 1 && partes[0] === 'salud') {
    if (metodo !== 'GET') return json(405, { error: 'metodo' })
    const ok = b => !!(b && typeof b.limit === 'function')
    return json(200, { rl_crear: ok(env.RL_CREAR), rl_leer: ok(env.RL_LEER), club_web_key: !!env.CLUB_WEB_KEY,
                       turnstile: !!env.TURNSTILE_SECRET,
                       supabase: RE_SUPABASE.test(String(env.SUPABASE_URL || '').replace(/\/+$/, '')) && !!env.SUPABASE_ANON_KEY })
  }

  // POST /api/cupon  {referente, contacto?}
  if (partes.length === 1 && partes[0] === 'cupon') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `crear:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const b = await leerCuerpo(request)
    const ref = typeof b?.referente === 'string' ? b.referente.trim().toUpperCase() : ''
    if (!RE_REF.test(ref)) return json(404, { error: 'referente_invalido' })
    return rpc(env, 'club_cupon_crear', { p_codigo_referente: ref, p_contacto: null })
  }

  // GET /api/cupon/:codigo  ·  POST /api/cupon/:codigo/contacto
  if (partes[0] === 'cupon' && partes.length >= 2) {
    const cod = String(partes[1]).toUpperCase()
    if (!RE_CUPON.test(cod)) return json(404, { error: 'cupon_invalido' })
    if (partes.length === 2) {
      if (metodo !== 'GET') return json(405, { error: 'metodo' })
      { const ok = await limitar(env, 'leer', `leer:${ip}`, leerMax, leerVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
      return rpc(env, 'club_cupon_ver', { p_codigo: cod })
    }
    if (partes.length === 3 && partes[2] === 'contacto') {
      if (metodo !== 'POST') return json(405, { error: 'metodo' })
      { const ok = await limitar(env, 'crear', `contacto:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
      const b = await leerCuerpo(request)
      const c = limpiarContacto(b?.contacto)
      if (!c || !c.optin) return json(400, { error: 'datos_invalidos' })
      return rpc(env, 'club_cupon_contacto', { p_codigo: cod, p_contacto: c })
    }
  }

  // POST /api/portal/:token/canje  → código de canje de un solo uso (R-01), 10 minutos
  if (partes.length === 3 && partes[0] === 'portal' && partes[2] === 'canje') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `canje:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return rpc(env, 'club_canje_codigo_generar', { p_token: tok })
  }

  // POST /api/alta  {nombre, whatsapp, acepto, ref?, turnstile}  → autoalta de socio (pendiente), LC-DES-07
  if (partes.length === 1 && partes[0] === 'alta') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `alta:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    // CLUB-AUD-74: además, por prefijo de red (/24 o /64), con el mismo binding.
    { const ok = await limitar(env, 'crear', `alta-red:${prefijoRed(ip)}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const b = await leerCuerpo(request)
    if (!b || typeof b !== 'object') return json(400, { error: 'datos_invalidos' })
    const humano = await verificarTurnstile(env, b.turnstile, ip)
    if (humano === null) return json(503, { error: 'servicio_no_disponible' })
    if (!humano) return json(403, { error: 'verificacion' })
    const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
    const datos = { nombre: s(b.nombre, 80), whatsapp: s(b.whatsapp, 32), acepto: s(b.acepto, 32), ref: s(b.ref, 8).toUpperCase() }
    if (datos.nombre.length < 2 || !datos.whatsapp || !RE_AVISO.test(datos.acepto)) return json(400, { error: 'datos_invalidos' })
    if (datos.ref && !RE_REF.test(datos.ref)) datos.ref = ''
    return rpc(env, 'club_socio_autoalta', { p_datos: datos })
  }

  // POST /api/pase/:token/canje  → código de canje desde el botón «Canjear» del pase (token de pase, CLUB-AUD-69)
  if (partes.length === 3 && partes[0] === 'pase' && partes[2] === 'canje') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `canje:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return rpc(env, 'club_canje_codigo_generar_pase', { p_token_pase: tok })
  }

  // POST /api/portal/:token/baja  → baja del Local Club (link del aviso de privacidad)
  if (partes.length === 3 && partes[0] === 'portal' && partes[2] === 'baja') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `baja:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return rpc(env, 'club_socio_baja_portal', { p_token: tok })
  }

  // POST /api/portal/:token/wallet  → link «Save to Google Wallet» (B2). Tope de «crear» por IP.
  if (partes.length === 3 && partes[0] === 'portal' && partes[2] === 'wallet') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'crear', `wallet:${ip}`, crearMax, crearVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return walletGoogle(env, tok)
  }

  // GET /api/portal/:token
  if (partes.length === 2 && partes[0] === 'portal') {
    if (metodo !== 'GET') return json(405, { error: 'metodo' })
    { const ok = await limitar(env, 'leer', `leer:${ip}`, leerMax, leerVent); if (ok === null) return json(503, { error: 'servicio_no_disponible' }); if (!ok) return json(429, { error: 'demasiados_pedidos' }) }
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return rpc(env, 'club_portal', { p_token: tok })
  }

  return json(404, { error: 'no_encontrado' })
}
