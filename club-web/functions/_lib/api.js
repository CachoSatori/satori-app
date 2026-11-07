// Club Satori — API pública del mini-sitio (Pages Function). JS plano: lo usan la
// función de Cloudflare (functions/api/[[path]].js) y el servidor local (dev-server.mjs).
//
// · Llama a las RPC de Supabase con la anon key (variable de entorno, nunca en el repo).
// · Agrega el tope por IP (CF-Connecting-IP). El tope por referente y por día en SQL
//   sigue siendo la red de seguridad.
// · Nunca devuelve el mensaje crudo de la base: lo traduce a un código fijo.

const RE_REF = /^[A-HJ-NP-Z2-9]{8}$/
const RE_CUPON = /^[A-HJ-NP-Z2-9]{10}$/
const RE_TOKEN = /^[0-9a-f]{64}$/
const RE_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/

const memoria = new Map() // respaldo por instancia si no hay KV ni binding de rate limiting

/** Tope por clave en una ventana fija. Prioridad: binding de Workers → KV → memoria. */
export async function limitar(env, clave, max, ventanaS) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    const { success } = await env.RATE_LIMITER.limit({ key: clave })
    return success
  }
  const ventana = Math.floor(Date.now() / 1000 / ventanaS)
  const k = `rl:${clave}:${ventana}`
  if (env.CLUB_RL) {
    const n = parseInt((await env.CLUB_RL.get(k)) || '0', 10)
    if (n >= max) return false
    await env.CLUB_RL.put(k, String(n + 1), { expirationTtl: Math.max(60, ventanaS * 2) })
    return true
  }
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
  if (m === 'Cupón no válido') return [404, 'cupon_invalido']
  if (m === 'Enlace no válido') return [404, 'portal_invalido']
  if (/consentimiento|no válidos/i.test(m)) return [400, 'datos_invalidos']
  return [502, 'servicio']
}

async function rpc(env, fn, args) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '')
  if (!RE_SUPABASE.test(url) || !env.SUPABASE_ANON_KEY) return json(500, { error: 'config' })
  let r
  try {
    r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
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

/** Router de /api/*. `path` sin el prefijo /api/. */
export async function manejar(request, env, path) {
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip'
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  const crearMax = n(env.RL_CREAR_MAX, 5), crearVent = n(env.RL_CREAR_VENTANA_S, 600)
  const leerMax = n(env.RL_LECTURA_MAX, 60), leerVent = n(env.RL_LECTURA_VENTANA_S, 60)
  const partes = String(path || '').split('/').filter(Boolean)
  const metodo = request.method

  // POST /api/cupon  {referente, contacto?}
  if (partes.length === 1 && partes[0] === 'cupon') {
    if (metodo !== 'POST') return json(405, { error: 'metodo' })
    if (!(await limitar(env, `crear:${ip}`, crearMax, crearVent))) return json(429, { error: 'demasiados_pedidos' })
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
      if (!(await limitar(env, `leer:${ip}`, leerMax, leerVent))) return json(429, { error: 'demasiados_pedidos' })
      return rpc(env, 'club_cupon_ver', { p_codigo: cod })
    }
    if (partes.length === 3 && partes[2] === 'contacto') {
      if (metodo !== 'POST') return json(405, { error: 'metodo' })
      if (!(await limitar(env, `contacto:${ip}`, crearMax, crearVent))) return json(429, { error: 'demasiados_pedidos' })
      const b = await leerCuerpo(request)
      const c = limpiarContacto(b?.contacto)
      if (!c || !c.optin) return json(400, { error: 'datos_invalidos' })
      return rpc(env, 'club_cupon_contacto', { p_codigo: cod, p_contacto: c })
    }
  }

  // GET /api/portal/:token
  if (partes.length === 2 && partes[0] === 'portal') {
    if (metodo !== 'GET') return json(405, { error: 'metodo' })
    if (!(await limitar(env, `leer:${ip}`, leerMax, leerVent))) return json(429, { error: 'demasiados_pedidos' })
    const tok = String(partes[1]).toLowerCase()
    if (!RE_TOKEN.test(tok)) return json(404, { error: 'portal_invalido' })
    return rpc(env, 'club_portal', { p_token: tok })
  }

  return json(404, { error: 'no_encontrado' })
}
