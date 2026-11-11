// Pruebas de la API de club-web (CLUB-AUD-06 y 14). Sin red: fetch y el binding se simulan.
//   npx vitest run club-web/functions/_lib/api.test.mjs   (desde la raíz del repo)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { manejar, limitar, prefijoRed } from './api.js'

const URL_SB = 'https://abcdefghijklmnopqrst.supabase.co'
const base = { SUPABASE_URL: URL_SB, SUPABASE_ANON_KEY: 'anon-de-prueba', CLUB_WEB_KEY: 'clave-de-prueba' }
const lim = exito => ({ limit: async () => ({ success: exito }) })
const conLimite = (exito = true) => ({ ...base, RL_CREAR: lim(exito), RL_LEER: lim(exito) })
const pedido = (ruta, metodo = 'GET', cuerpo) =>
  new Request(`https://club.ejemplo/api/${ruta}`, { method: metodo, headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: cuerpo })

// Grok 24: pedir un cupón exige Turnstile (como el alta): cuerpo con token y env con el secreto
const CUPON = JSON.stringify({ referente: 'ABCDEFGH', turnstile: 'token-de-prueba-123' })
const conTs = (exito = true) => ({ ...conLimite(exito), TURNSTILE_SECRET: 's' })
const tsOk = url => String(url).includes('turnstile') && new Response(JSON.stringify({ success: true }), { status: 200 })

let llamadas = []
globalThis.fetch = async (url, init) => {
  if (tsOk(url)) return tsOk(url)
  llamadas.push({ url, init })
  return new Response(JSON.stringify([{ codigo: 'ABCDEFGH23', vence_en: '2026-11-12T00:00:00Z' }]), { status: 200 })
}

test('14: sin binding RATE_LIMITER (fuera de dev) → 503, falla cerrada, y no llama a la base', async () => {
  llamadas = []
  const r = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), base, 'cupon')
  assert.equal(r.status, 503)
  assert.equal((await r.json()).error, 'servicio_no_disponible')
  assert.equal(llamadas.length, 0)
  assert.equal(await limitar(base, 'crear', 'x', 5, 60), null)
})

test('14: con el binding, respeta el tope (429) y deja pasar (200)', async () => {
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), conLimite(false), 'cupon/ABCDEFGH23')).status, 429)
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), conLimite(true), 'cupon/ABCDEFGH23')).status, 200)
})

test('14: el contador en memoria solo existe con CLUB_DEV=1 (servidor local)', async () => {
  const dev = { ...base, CLUB_DEV: '1' }
  for (let i = 0; i < 2; i++) assert.equal(await limitar(dev, 'crear', 'k-dev', 2, 600), true)
  assert.equal(await limitar(dev, 'crear', 'k-dev', 2, 600), false)
})

test('06: cada llamada a la base lleva el header x-club-web con CLUB_WEB_KEY', async () => {
  llamadas = []
  const r = await manejar(pedido('cupon', 'POST', CUPON), conTs(), 'cupon')
  assert.equal(r.status, 200)
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].init.headers['x-club-web'], 'clave-de-prueba')
})

test('06: sin CLUB_WEB_KEY → 503 y no llama a la base', async () => {
  llamadas = []
  const { CLUB_WEB_KEY, ...sinClave } = conLimite()
  void CLUB_WEB_KEY
  const r = await manejar(pedido('cupon/ABCDEFGH23'), sinClave, 'cupon/ABCDEFGH23')
  assert.equal(r.status, 503)
  assert.equal(llamadas.length, 0)
})

test('06: el tope global por minuto de la base se traduce a 429', async () => {
  globalThis.fetch = async url => tsOk(url) || new Response(JSON.stringify({ message: 'Demasiados cupones en este momento' }), { status: 400 })
  const r = await manejar(pedido('cupon', 'POST', CUPON), conTs(), 'cupon')
  assert.equal(r.status, 429)
  assert.equal((await r.json()).error, 'demasiados_pedidos')
})

test('R-01: POST /api/portal/:token/canje llama a club_canje_codigo_generar con el header; GET → 405; token malo → 404', async () => {
  llamadas = []
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init })
    return new Response(JSON.stringify([{ codigo: 'ABCDEF', vence_en: '2026-11-07T18:00:00Z', url: 'https://club.ejemplo/k/ABCDEF' }]), { status: 200 })
  }
  const tok = 'a'.repeat(64)
  const r = await manejar(pedido(`portal/${tok}/canje`, 'POST'), conLimite(), `portal/${tok}/canje`)
  assert.equal(r.status, 200)
  assert.equal(llamadas.length, 1)
  assert.match(llamadas[0].url, /\/rest\/v1\/rpc\/club_canje_codigo_generar$/)
  assert.equal(llamadas[0].init.headers['x-club-web'], 'clave-de-prueba')
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { p_token: tok })
  assert.equal((await manejar(pedido(`portal/${tok}/canje`), conLimite(), `portal/${tok}/canje`)).status, 405)
  assert.equal((await manejar(pedido('portal/xyz/canje', 'POST'), conLimite(), 'portal/xyz/canje')).status, 404)
})

test('R-01: tope de códigos y sin saldo se traducen a códigos fijos', async () => {
  const tok = 'b'.repeat(64)
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Demasiados códigos de canje' }), { status: 400 })
  let r = await manejar(pedido(`portal/${tok}/canje`, 'POST'), conLimite(), `portal/${tok}/canje`)
  assert.equal(r.status, 429); assert.equal((await r.json()).error, 'tope_canje')
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Todavía no te alcanza para canjear' }), { status: 400 })
  r = await manejar(pedido(`portal/${tok}/canje`, 'POST'), conLimite(), `portal/${tok}/canje`)
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'sin_saldo_canje')
})

test('14/24: un binding por endpoint: crear usa RL_CREAR (5/60 s) y leer usa RL_LEER (60/60 s); falta uno → 503 solo ahí', async () => {
  const usados = []
  const env = { ...base, RL_CREAR: { limit: async ({ key }) => { usados.push(['crear', key]); return { success: false } } },
                         RL_LEER: { limit: async ({ key }) => { usados.push(['leer', key]); return { success: true } } } }
  globalThis.fetch = async () => new Response(JSON.stringify({ estado: 'vigente' }), { status: 200 })
  const r1 = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), env, 'cupon')
  assert.equal(r1.status, 429)
  assert.equal((await r1.json()).error, 'demasiados_pedidos')   // el sitio lo muestra amable («Esperá unos minutos…»)
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), env, 'cupon/ABCDEFGH23')).status, 200)
  assert.deepEqual(usados.map(u => u[0]), ['crear', 'leer'])
  const { RL_LEER, ...sinLeer } = env; void RL_LEER
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), sinLeer, 'cupon/ABCDEFGH23')).status, 503)
})

test('salud: dice qué está configurado, sin valores', async () => {
  const r = await manejar(pedido('salud'), conLimite(), 'salud')
  const j = await r.json()
  assert.deepEqual(j, { rl_crear: true, rl_leer: true, club_web_key: true, turnstile: false, supabase: true })
  assert.ok(!JSON.stringify(j).includes('clave-de-prueba'))
})

test('LC-DES-07: /api/alta sin TURNSTILE_SECRET → 503 y no llama a la base; Turnstile falla → 403', async () => {
  llamadas = []
  const cuerpo = JSON.stringify({ nombre: 'Ana Ficticia', whatsapp: '60000000', acepto: 'v1', turnstile: 'token-de-prueba-123' })
  assert.equal((await manejar(pedido('alta', 'POST', cuerpo), conLimite(), 'alta')).status, 503)
  assert.equal(llamadas.length, 0)
  const fetchViejo = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init })
    if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: false }), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  try {
    const r = await manejar(pedido('alta', 'POST', cuerpo), { ...conLimite(), TURNSTILE_SECRET: 's' }, 'alta')
    assert.equal(r.status, 403)
    assert.equal((await r.json()).error, 'verificacion')
    assert.ok(!llamadas.some(l => String(l.url).includes('/rest/v1/')))
  } finally { globalThis.fetch = fetchViejo }
})

test('LC-DES-07: /api/alta con Turnstile OK llama a club_socio_autoalta con datos mínimos; tope diario → 429', async () => {
  const fetchViejo = globalThis.fetch
  let respuestaBase = { status: 200, body: { ok: true } }
  llamadas = []
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init })
    if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: true }), { status: 200 })
    return new Response(JSON.stringify(respuestaBase.body), { status: respuestaBase.status })
  }
  try {
    const env = { ...conLimite(), TURNSTILE_SECRET: 's' }
    const cuerpo = JSON.stringify({ nombre: ' Ana ', whatsapp: '60000000', acepto: 'v1', ref: 'abcdefgh', turnstile: 'token-de-prueba-123', cedula: '1' })
    const r = await manejar(pedido('alta', 'POST', cuerpo), env, 'alta')
    assert.equal(r.status, 200)
    const base = llamadas.find(l => String(l.url).endsWith('/rest/v1/rpc/club_socio_autoalta'))
    assert.ok(base)
    assert.equal(base.init.headers['x-club-web'], 'clave-de-prueba')
    assert.deepEqual(JSON.parse(base.init.body), { p_datos: { nombre: 'Ana', whatsapp: '60000000', acepto: 'v1', ref: 'ABCDEFGH' } })
    // LC-ML: el local viaja solo si es un id válido; con dos encendidos y sin local, la base pide elegir
    llamadas = []
    await manejar(pedido('alta', 'POST', JSON.stringify({ ...JSON.parse(cuerpo), local: 'local-prueba' })), env, 'alta')
    assert.equal(JSON.parse(llamadas.find(l => String(l.url).endsWith('/rest/v1/rpc/club_socio_autoalta')).init.body).p_datos.local, 'local-prueba')
    llamadas = []
    await manejar(pedido('alta', 'POST', JSON.stringify({ ...JSON.parse(cuerpo), local: 'Local; drop' })), env, 'alta')
    assert.equal(JSON.parse(llamadas.find(l => String(l.url).endsWith('/rest/v1/rpc/club_socio_autoalta')).init.body).p_datos.local, undefined)
    respuestaBase = { status: 400, body: { message: 'Hay más de un local con el Club activo: elegí el local' } }
    assert.equal((await manejar(pedido('alta', 'POST', cuerpo), env, 'alta')).status, 400)
    respuestaBase = { status: 400, body: { message: 'El Club no está activo en Local Prueba' } }
    assert.equal((await manejar(pedido('alta', 'POST', cuerpo), env, 'alta')).status, 409)
    respuestaBase = { status: 400, body: { message: 'Demasiadas altas hoy' } }
    assert.equal((await manejar(pedido('alta', 'POST', cuerpo), env, 'alta')).status, 429)
  } finally { globalThis.fetch = fetchViejo }
})

test('AUD-69: /api/pase/:token/canje usa el token de pase; /api/portal/:token/baja; tokens malos → 404', async () => {
  const tok = 'a'.repeat(64)
  llamadas = []
  globalThis.fetch = async (url, init) => { llamadas.push({ url, init }); return new Response('true', { status: 200 }) }
  assert.equal((await manejar(pedido(`pase/${tok}/canje`, 'POST'), conLimite(), `pase/${tok}/canje`)).status, 200)
  assert.ok(String(llamadas.at(-1).url).endsWith('/rpc/club_canje_codigo_generar_pase'))
  assert.deepEqual(JSON.parse(llamadas.at(-1).init.body), { p_token_pase: tok })
  assert.equal((await manejar(pedido(`portal/${tok}/baja`, 'POST'), conLimite(), `portal/${tok}/baja`)).status, 200)
  assert.ok(String(llamadas.at(-1).url).endsWith('/rpc/club_socio_baja_portal'))
  assert.equal((await manejar(pedido('pase/xyz/canje', 'POST'), conLimite(), 'pase/xyz/canje')).status, 404)
  assert.equal((await manejar(pedido(`pase/${tok}/canje`), conLimite(), `pase/${tok}/canje`)).status, 405)
})

test('CLAUDE-HALL-04: prefijo de red /24 (IPv4) y /64 (IPv6); /api/alta pide el tope por IP y por prefijo', async () => {
  assert.equal(prefijoRed('203.0.113.7'), '203.0.113.0/24')
  assert.equal(prefijoRed('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64')
  assert.equal(prefijoRed('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(prefijoRed('2001:DB8:0:0:ffff::9'), '2001:db8:0:0::/64')
  const claves = []
  const env = { ...base, RL_LEER: lim(true), RL_CREAR: { limit: async ({ key }) => { claves.push(key); return { success: !key.startsWith('alta-red:') } } } }
  const cuerpo = JSON.stringify({ nombre: 'Ana', whatsapp: '60000000', acepto: 'v1', turnstile: 'token-de-prueba-123' })
  const r = await manejar(pedido('alta', 'POST', cuerpo), env, 'alta')
  assert.equal(r.status, 429)
  assert.deepEqual(claves, ['alta:203.0.113.7', 'alta-red:203.0.113.0/24'])
})

test('Grok 24: /api/cupon sin TURNSTILE_SECRET → 503; sin token o Turnstile falla → 403; nunca llama a la base', async () => {
  const fetchViejo = globalThis.fetch
  llamadas = []
  let ts = true
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: ts }), { status: 200 })
    llamadas.push({ url, init }); return new Response('[]', { status: 200 })
  }
  try {
    assert.equal((await manejar(pedido('cupon', 'POST', CUPON), conLimite(), 'cupon')).status, 503)
    const sinToken = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), conTs(), 'cupon')
    assert.equal(sinToken.status, 403); assert.equal((await sinToken.json()).error, 'verificacion')
    ts = false
    assert.equal((await manejar(pedido('cupon', 'POST', CUPON), conTs(), 'cupon')).status, 403)
    assert.equal(llamadas.length, 0)
    ts = true
    assert.equal((await manejar(pedido('cupon', 'POST', CUPON), conTs(), 'cupon')).status, 200)
    assert.equal(llamadas.length, 1); assert.ok(String(llamadas[0].url).endsWith('/rpc/club_cupon_crear'))
  } finally { globalThis.fetch = fetchViejo }
})

test('Grok 24: /api/cupon pide el tope por IP y por prefijo de red (/24 y /64), antes de Turnstile', async () => {
  const claves = []
  const env = { ...conTs(), RL_CREAR: { limit: async ({ key }) => { claves.push(key); return { success: !key.startsWith('crear-red:') } } } }
  const r = await manejar(pedido('cupon', 'POST', CUPON), env, 'cupon')
  assert.equal(r.status, 429)
  assert.deepEqual(claves, ['crear:203.0.113.7', 'crear-red:203.0.113.0/24'])
  claves.length = 0
  const p6 = new Request('https://club.ejemplo/api/cupon', { method: 'POST', headers: { 'CF-Connecting-IP': '2001:db8:abcd:12:1:2:3:4' }, body: CUPON })
  await manejar(p6, env, 'cupon')
  assert.deepEqual(claves, ['crear:2001:db8:abcd:12:1:2:3:4', 'crear-red:2001:db8:abcd:12::/64'])
})

test('Grok 63: el opt-in del turista exige la versión del aviso; la base la recibe', async () => {
  llamadas = []
  const sin = JSON.stringify({ contacto: { whatsapp: '60000000', optin: true } })
  const r1 = await manejar(pedido('cupon/ABCDEFGH23/contacto', 'POST', sin), conLimite(), 'cupon/ABCDEFGH23/contacto')
  assert.equal(r1.status, 400); assert.equal(llamadas.length, 0)
  const mal = JSON.stringify({ contacto: { whatsapp: '60000000', optin: true, acepto: 'uno' } })
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23/contacto', 'POST', mal), conLimite(), 'cupon/ABCDEFGH23/contacto')).status, 400)
  const con = JSON.stringify({ contacto: { whatsapp: '60000000', optin: true, acepto: 'v1', extra: 'x' } })
  const r2 = await manejar(pedido('cupon/ABCDEFGH23/contacto', 'POST', con), conLimite(), 'cupon/ABCDEFGH23/contacto')
  assert.equal(r2.status, 200)
  const args = JSON.parse(llamadas[0].init.body)
  assert.ok(String(llamadas[0].url).endsWith('/rpc/club_cupon_contacto'))
  assert.deepEqual(args.p_contacto, { nombre: '', whatsapp: '60000000', email: '', optin: true, acepto: 'v1' })
})

test('Grok 63 + 136 + 183: baja del turista → POST /api/baja con la llave en el CUERPO; en la ruta ya no; GET → 405; llave mala → 404; tope', async () => {
  llamadas = []
  const llave = '0123456789abcdef0123456789ABCDEF'
  const cuerpo = JSON.stringify({ llave })
  const r = await manejar(pedido('baja', 'POST', cuerpo), conLimite(), 'baja')
  assert.equal(r.status, 200)
  assert.ok(String(llamadas[0].url).endsWith('/rpc/club_cupon_contacto_baja'))
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { p_token: llave.toLowerCase() })
  assert.equal((await manejar(pedido('baja'), conLimite(), 'baja')).status, 405)
  assert.equal((await manejar(pedido('baja', 'POST', JSON.stringify({ llave: 'ABCDEFGH23' })), conLimite(), 'baja')).status, 404)   // un código de cupón no sirve
  assert.equal((await manejar(pedido('baja', 'POST', '{}'), conLimite(), 'baja')).status, 404)
  assert.equal((await manejar(pedido(`baja/${llave}`, 'POST', '{}'), conLimite(), `baja/${llave}`)).status, 404)   // 183: la ruta vieja con la llave
  assert.equal((await manejar(pedido('baja', 'POST', cuerpo), conLimite(false), 'baja')).status, 429)
  assert.equal(llamadas.length, 1)
})

test('136: la ruta vieja POST /api/cupon/:codigo/baja ya no existe (con el código del cupón no se da de baja a nadie)', async () => {
  llamadas = []
  const r = await manejar(pedido('cupon/ABCDEFGH23/baja', 'POST', '{}'), conLimite(), 'cupon/ABCDEFGH23/baja')
  assert.equal(r.status, 404)
  assert.equal(llamadas.length, 0)
})
