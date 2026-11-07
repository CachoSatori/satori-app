// Pruebas de la API de club-web (CLUB-AUD-06 y 14). Sin red: fetch y el binding se simulan.
//   npx vitest run club-web/functions/_lib/api.test.mjs   (desde la raíz del repo)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { manejar, limitar } from './api.js'

const URL_SB = 'https://abcdefghijklmnopqrst.supabase.co'
const base = { SUPABASE_URL: URL_SB, SUPABASE_ANON_KEY: 'anon-de-prueba', CLUB_WEB_KEY: 'clave-de-prueba' }
const conLimite = (exito = true) => ({ ...base, RATE_LIMITER: { limit: async () => ({ success: exito }) } })
const pedido = (ruta, metodo = 'GET', cuerpo) =>
  new Request(`https://club.ejemplo/api/${ruta}`, { method: metodo, headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: cuerpo })

let llamadas = []
globalThis.fetch = async (url, init) => {
  llamadas.push({ url, init })
  return new Response(JSON.stringify([{ codigo: 'ABCDEFGH23', vence_en: '2026-11-12T00:00:00Z' }]), { status: 200 })
}

test('14: sin binding RATE_LIMITER (fuera de dev) → 503, falla cerrada, y no llama a la base', async () => {
  llamadas = []
  const r = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), base, 'cupon')
  assert.equal(r.status, 503)
  assert.equal((await r.json()).error, 'servicio_no_disponible')
  assert.equal(llamadas.length, 0)
  assert.equal(await limitar(base, 'x', 5, 60), null)
})

test('14: con el binding, respeta el tope (429) y deja pasar (200)', async () => {
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), conLimite(false), 'cupon/ABCDEFGH23')).status, 429)
  assert.equal((await manejar(pedido('cupon/ABCDEFGH23'), conLimite(true), 'cupon/ABCDEFGH23')).status, 200)
})

test('14: el contador en memoria solo existe con CLUB_DEV=1 (servidor local)', async () => {
  const dev = { ...base, CLUB_DEV: '1' }
  for (let i = 0; i < 2; i++) assert.equal(await limitar(dev, 'k-dev', 2, 600), true)
  assert.equal(await limitar(dev, 'k-dev', 2, 600), false)
})

test('06: cada llamada a la base lleva el header x-club-web con CLUB_WEB_KEY', async () => {
  llamadas = []
  const r = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), conLimite(), 'cupon')
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
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Demasiados cupones en este momento' }), { status: 400 })
  const r = await manejar(pedido('cupon', 'POST', JSON.stringify({ referente: 'ABCDEFGH' })), conLimite(), 'cupon')
  assert.equal(r.status, 429)
  assert.equal((await r.json()).error, 'demasiados_pedidos')
})

test('R-01: POST /api/portal/:token/canje llama a club_canje_codigo_generar con el header; GET → 405; token malo → 404', async () => {
  llamadas = []
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init })
    return new Response(JSON.stringify([{ codigo: 'ABCDEF', vence_en: '2026-11-07T18:00:00Z', url: 'https://club.satoricostarica.com/k/ABCDEF' }]), { status: 200 })
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
