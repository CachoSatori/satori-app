// Plan B de club-web (10-nov): el Worker «satori-club-api», al que la Pages Function le pasa /api por el service binding
// CLUB_API (sin zona del dominio en Cloudflare no hay Workers Routes). Sin red: los bindings se simulan.
//   npx vitest run club-web/worker/index.test.mjs   (desde la raíz del repo)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker from './index.js'
import { rutaApi } from './ruta.js'
import { HOST_INTERNO, ENCABEZADO_IP } from './interno.js'
import { onRequest } from '../functions/api/[[path]].js'

const base = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'anon-de-prueba',
               CLUB_WEB_KEY: 'clave-de-prueba', TURNSTILE_SECRET: 'secreto-de-prueba' }
/** Un tope que anota con qué clave se lo llamó (la clave lleva la IP o el prefijo de red). */
const tope = (claves = []) => ({ claves, limit: async ({ key }) => { claves.push(key); return { success: claves.length <= 100 } } })
const interno = (ruta, { metodo = 'GET', ip = '198.51.100.23', cuerpo } = {}) =>
  new Request(`https://${HOST_INTERNO}${ruta}`, { method: metodo, headers: ip ? { [ENCABEZADO_IP]: ip } : {}, body: cuerpo })

test('worker: /api/salud por el binding, con los dos topes → todo en true y «x-club-api: worker»', async () => {
  const r = await worker.fetch(interno('/api/salud'), { ...base, RL_CREAR: tope(), RL_LEER: tope() })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-club-api'), 'worker')
  assert.deepEqual(await r.json(), { rl_crear: true, rl_leer: true, club_web_key: true, turnstile: true, supabase: true })
})

test('worker: un pedido con otro host (no vino por el binding) → 404, aunque traiga x-club-ip', async () => {
  for (const url of ['https://club.ejemplo/api/salud', 'https://satori-club-api.ejemplo.workers.dev/api/salud']) {
    const r = await worker.fetch(new Request(url, { headers: { [ENCABEZADO_IP]: '198.51.100.23' } }), base)
    assert.equal(r.status, 404, url)
    assert.equal(r.headers.get('x-club-api'), 'worker')
  }
})

test('worker: sin la IP del cliente (o con una que no es IP) → 503: los topes por IP no funcionarían', async () => {
  for (const ip of ['', 'no-es-ip', '1.2.3.4; DROP']) {
    const r = await worker.fetch(interno('/api/salud', { ip }), { ...base, RL_CREAR: tope(), RL_LEER: tope() })
    assert.equal(r.status, 503, ip || '(vacía)')
  }
})

test('worker: el tope por IP y por prefijo usa la IP que mandó la Pages Function', async () => {
  const crear = tope()
  const r = await worker.fetch(interno('/api/cupon', { metodo: 'POST', ip: '198.51.100.23', cuerpo: JSON.stringify({ referente: 'ABCDEFGH' }) }),
                               { ...base, RL_CREAR: crear, RL_LEER: tope() })
  assert.notEqual(r.status, 503)
  assert.deepEqual(crear.claves, ['crear:198.51.100.23', 'crear-red:198.51.100.0/24'])
})

test('worker: sin los topes, /api/salud los marca en false y crear un cupón responde 503 (falla cerrada)', async () => {
  const s = await (await worker.fetch(interno('/api/salud'), base)).json()
  assert.equal(s.rl_crear, false); assert.equal(s.rl_leer, false)
  const r = await worker.fetch(interno('/api/cupon', { metodo: 'POST', cuerpo: '{}' }), base)
  assert.equal(r.status, 503)
})

test('worker: fuera de /api/ responde 404 (el sitio lo sirve Pages)', async () => {
  for (const ruta of ['/', '/r/ABCDEFGH', '/api', '/apix/salud']) assert.equal((await worker.fetch(interno(ruta), base)).status, 404, ruta)
})

test('worker: la ruta llega igual que params.path de Pages (partes decodificadas)', () => {
  assert.equal(rutaApi('/api/salud'), 'salud')
  assert.equal(rutaApi('/api/cupon/ABCDEFGHJK/contacto'), 'cupon/ABCDEFGHJK/contacto')
  assert.equal(rutaApi('/api/cupon/%41BCDEFGHJK'), 'cupon/ABCDEFGHJK')
  assert.equal(rutaApi('/api/x/%E0%A4%A'), 'x/%E0%A4%A')   // mal codificado: se pasa tal cual (el router lo rechaza)
  assert.equal(rutaApi('/r/ABCDEFGH'), null)
})

test('pages, plan A (sin binding CLUB_API): contesta la Pages Function, «x-club-api: pages»', async () => {
  const pedido = new Request('https://club.ejemplo/api/salud', { headers: { 'CF-Connecting-IP': '198.51.100.23' } })
  const r = await onRequest({ request: pedido, env: { ...base, RL_CREAR: tope(), RL_LEER: tope() }, params: { path: ['salud'] } })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-club-api'), 'pages')
})

test('pages, plan B: le pasa /api al Worker por el binding, con el host interno y la IP real (pisa un x-club-ip falso)', async () => {
  let visto
  const CLUB_API = { fetch: async (req) => { visto = req; return worker.fetch(req, { ...base, RL_CREAR: tope(), RL_LEER: tope() }) } }
  const pedido = new Request('https://club.ejemplo/api/cupon?x=1', { method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.23', [ENCABEZADO_IP]: '192.0.2.77', 'Content-Type': 'application/json' },
    body: JSON.stringify({ referente: 'ABCDEFGH' }) })
  const r = await onRequest({ request: pedido, env: { CLUB_API }, params: { path: ['cupon'] } })
  assert.equal(new URL(visto.url).hostname, HOST_INTERNO)
  assert.equal(new URL(visto.url).pathname + new URL(visto.url).search, '/api/cupon?x=1')
  assert.equal(visto.headers.get(ENCABEZADO_IP), '198.51.100.23')
  assert.equal(visto.method, 'POST')
  assert.equal(r.headers.get('x-club-api'), 'worker')
})

test('wrangler.toml del Worker: los mismos topes que Pages, sin URL *.workers.dev ni rutas, sin borrar variables', () => {
  const w = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8')
  const p = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
  const topes = t => [...t.matchAll(/name = "(RL_\w+)"\s*\ntype = "ratelimit"\s*\nnamespace_id = "\d+"\s*\nsimple = \{ limit = (\d+), period = (\d+) \}/g)]
    .map(m => `${m[1]} ${m[2]}/${m[3]}`)
  assert.deepEqual(topes(w), ['RL_CREAR 5/60', 'RL_LEER 60/60'])
  assert.deepEqual(topes(w), topes(p))
  assert.match(w, /^name = "satori-club-api"$/m)
  assert.match(w, /^main = "index\.js"$/m)
  assert.match(w, /^workers_dev = false/m)
  assert.match(w, /^keep_vars = true/m)
  assert.doesNotMatch(w, /^\s*(routes|route|\[vars\])/m)
})

test('wrangler.toml de Pages: el binding del plan B nombra al Worker (comentado hasta que /api/salud pida B)', () => {
  const p = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
  assert.match(p, /^# \[\[services\]\]\n# binding = "CLUB_API"\n# service = "satori-club-api"$/m)
})
