// Plan B de club-web (10-nov): el Worker «satori-club-api». Sin red: el binding se simula y no se llama a Supabase.
//   npx vitest run club-web/worker/index.test.mjs   (desde la raíz del repo)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { rutaApi } from './index.js'
import { onRequest } from '../functions/api/[[path]].js'

const base = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'anon-de-prueba',
               CLUB_WEB_KEY: 'clave-de-prueba', TURNSTILE_SECRET: 'secreto-de-prueba' }
const lim = () => ({ limit: async () => ({ success: true }) })
const pedido = (ruta, metodo = 'GET') =>
  new Request(`https://club.ejemplo${ruta}`, { method: metodo, headers: { 'CF-Connecting-IP': '203.0.113.7' } })

test('worker: /api/salud con los dos topes → todo en true y «x-club-api: worker»', async () => {
  const r = await worker.fetch(pedido('/api/salud'), { ...base, RL_CREAR: lim(), RL_LEER: lim() })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-club-api'), 'worker')
  assert.deepEqual(await r.json(), { rl_crear: true, rl_leer: true, club_web_key: true, turnstile: true, supabase: true })
})

test('worker: sin los topes, /api/salud los marca en false y crear un cupón responde 503 (falla cerrada)', async () => {
  const s = await (await worker.fetch(pedido('/api/salud'), base)).json()
  assert.equal(s.rl_crear, false); assert.equal(s.rl_leer, false)
  const r = await worker.fetch(pedido('/api/cupon', 'POST'), base)
  assert.equal(r.status, 503)
  assert.equal(r.headers.get('x-club-api'), 'worker')
})

test('worker: fuera de /api/ responde 404 (el sitio lo sirve Pages)', async () => {
  for (const ruta of ['/', '/r/ABCDEFGH', '/api', '/apix/salud']) {
    const r = await worker.fetch(pedido(ruta), base)
    assert.equal(r.status, 404, ruta)
    assert.equal(r.headers.get('x-club-api'), 'worker')
  }
})

test('worker: la ruta llega igual que params.path de Pages (partes decodificadas)', () => {
  assert.equal(rutaApi('/api/salud'), 'salud')
  assert.equal(rutaApi('/api/cupon/ABCDEFGHJK/contacto'), 'cupon/ABCDEFGHJK/contacto')
  assert.equal(rutaApi('/api/cupon/%41BCDEFGHJK'), 'cupon/ABCDEFGHJK')
  assert.equal(rutaApi('/api/x/%E0%A4%A'), 'x/%E0%A4%A')   // mal codificado: se pasa tal cual (el router lo rechaza)
  assert.equal(rutaApi('/r/ABCDEFGH'), null)
})

test('pages: la Pages Function marca sus respuestas con «x-club-api: pages»', async () => {
  const r = await onRequest({ request: pedido('/api/salud'), env: { ...base, RL_CREAR: lim(), RL_LEER: lim() }, params: { path: ['salud'] } })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-club-api'), 'pages')
})

test('wrangler.toml del Worker: los mismos topes que Pages, sin URL *.workers.dev y sin borrar las variables del panel', () => {
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
  assert.doesNotMatch(w, /^\s*(routes|route|\[vars\])/m)   // la ruta va en el panel; las variables también
})
