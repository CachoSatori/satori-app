// B1: el flujo del Edge club-pase con una base simulada y una cuenta de servicio FALSA generada en memoria.
import { describe, it, expect, beforeAll } from 'vitest'
import { manejarPase, manejarSync, type EnvPase, type Rpc } from './edgePase'
import type { PaseDatos } from './googlePase'

const ISSUER = '3388000000012345678'
const CLAVE_WEB = 'k'.repeat(40)
const TOKEN = 'c'.repeat(64)
const MIEMBRO = '00000000-0000-4000-8000-00000000beef'

const datos = (over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1, miembro_id: MIEMBRO, version: 7, actualizado_en: '2026-11-08T08:00:00Z', nombre_pila: 'Beto', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: 'https://club.satoricostarica.com/r/ABCD2345' }, socio: null,
  anfitrion: { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.satoricostarica.com/r/ABCD2345',
               personas: 6, creditos: 1, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 6, creditos_ganados_mes: 1 },
  promociones: [], canjear_url: `https://club.satoricostarica.com/w/${'d'.repeat(64)}`, ...over,
})

let env: EnvPase
beforeAll(async () => {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
  env = { CLUB_WEB_KEY: CLAVE_WEB, GOOGLE_WALLET_ISSUER_ID: ISSUER,
          GOOGLE_WALLET_SA_KEY: JSON.stringify({ client_email: 'pase-prueba@proyecto-falso.iam.gserviceaccount.com', private_key: pem }) }
})

function base(respuestas: Partial<Record<string, { data: unknown; error: { message: string } | null }>>) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: Rpc = async (fn, args) => {
    llamadas.push({ fn, args })
    return respuestas[fn] ?? { data: null, error: null }
  }
  return { rpc, llamadas }
}
const pedido = (cuerpo: unknown, headers: Record<string, string> = { 'x-club-web': CLAVE_WEB }, metodo = 'POST') =>
  new Request('https://edge.ejemplo/club-pase/google', { method: metodo, headers, body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined })

describe('club-pase (Edge)', () => {
  it('flujo completo: token → miembro → datos → JWT → registra el pase emitido', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc)
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(j.object_id).toBe(`${ISSUER}.club-${MIEMBRO}`)
    expect(llamadas.map(l => l.fn)).toEqual(['club_pase_por_token', 'club_pase_datos', 'club_pase_emitido'])
    expect(llamadas[2].args).toEqual({ p_miembro: MIEMBRO, p_plataforma: 'google', p_object_id: `${ISSUER}.club-${MIEMBRO}` })
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('falla cerrada: sin algún secreto → 503 y no llama a la base', async () => {
    for (const falta of ['CLUB_WEB_KEY', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SA_KEY'] as const) {
      const { rpc, llamadas } = base({})
      const r = await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, [falta]: undefined }, rpc)
      expect(r.status).toBe(503)
      expect(llamadas).toHaveLength(0)
    }
    const { rpc, llamadas } = base({})
    expect((await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, CLUB_WEB_KEY: 'corta' }, rpc)).status).toBe(503)
    expect(llamadas).toHaveLength(0)
  })

  it('sin el header x-club-web correcto → 401 y no llama a la base', async () => {
    const { rpc, llamadas } = base({})
    expect((await manejarPase(pedido({ token: TOKEN }, {}), 'google', env, rpc)).status).toBe(401)
    expect((await manejarPase(pedido({ token: TOKEN }, { 'x-club-web': 'x'.repeat(40) }), 'google', env, rpc)).status).toBe(401)
    expect(llamadas).toHaveLength(0)
  })

  it('token mal formado, desconocido o persona de baja → 404 «portal_invalido»; no registra nada', async () => {
    const a = base({})
    expect((await manejarPase(pedido({ token: 'xyz' }), 'google', env, a.rpc)).status).toBe(404)
    expect(a.llamadas).toHaveLength(0)
    const b = base({ club_pase_por_token: { data: null, error: null } })
    expect((await manejarPase(pedido({ token: TOKEN }), 'google', env, b.rpc)).status).toBe(404)
    const c = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos({ estado: 'baja' }), error: null } })
    const rc = await manejarPase(pedido({ token: TOKEN }), 'google', env, c.rpc)
    expect(rc.status).toBe(404)
    expect(c.llamadas.map(l => l.fn)).not.toContain('club_pase_emitido')
  })

  it('datos fuera de contrato (p. ej. con un teléfono) → 502 «contrato», sin firmar ni registrar', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null },
                                     club_pase_datos: { data: datos({ nombre_pila: '+50688887777' }), error: null } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc)
    expect(r.status).toBe(502)
    expect((await r.json()).error).toBe('contrato')
    expect(llamadas.map(l => l.fn)).not.toContain('club_pase_emitido')
  })

  it('error de la base → 502 sin el mensaje crudo; GET → 405; Apple → 404 (apagado)', async () => {
    const { rpc } = base({ club_pase_por_token: { data: null, error: { message: 'detalle interno de la base' } } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc)
    expect(r.status).toBe(502)
    expect(await r.text()).not.toMatch(/detalle interno/)
    expect((await manejarPase(pedido(null, { 'x-club-web': CLAVE_WEB }, 'GET'), 'google', env, rpc)).status).toBe(405)
    expect((await manejarPase(pedido({ token: TOKEN }), 'apple', env, rpc)).status).toBe(404)
  })

  it('cuerpo enorme o no JSON → 400', async () => {
    const { rpc } = base({})
    const grande = new Request('https://edge.ejemplo/club-pase/google', { method: 'POST', headers: { 'x-club-web': CLAVE_WEB }, body: 'x'.repeat(5000) })
    expect((await manejarPase(grande, 'google', env, rpc)).status).toBe(400)
    const roto = new Request('https://edge.ejemplo/club-pase/google', { method: 'POST', headers: { 'x-club-web': CLAVE_WEB }, body: '{roto' })
    expect((await manejarPase(roto, 'google', env, rpc)).status).toBe(400)
  })
})

describe('club-pase: rutas de B3 (sync y actualizar)', () => {
  const SYNC = 's'.repeat(40)
  const googleOk = async (url: string) => ({ status: 200, json: async () => (url.includes('oauth2') ? { access_token: 't' } : {}) })
  it('sync: sin su secreto → 503; con otro → 401; con el bueno → resumen', async () => {
    const { rpc } = base({ club_pase_cursor_leer: { data: 5, error: null }, club_pase_eventos_leer: { data: [], error: null },
                           club_alertas_pendientes: { data: [], error: null } })
    const req = (h: Record<string, string>) => new Request('https://edge.ejemplo/club-pase/sync', { method: 'POST', headers: h })
    expect((await manejarSync(req({}), 'sync', env, rpc, googleOk)).status).toBe(503)
    expect((await manejarSync(req({ 'x-club-pase-sync': 'x'.repeat(40) }), 'sync', { ...env, CLUB_PASE_SYNC_KEY: SYNC }, rpc, googleOk)).status).toBe(401)
    const r = await manejarSync(req({ 'x-club-pase-sync': SYNC }), 'sync', { ...env, CLUB_PASE_SYNC_KEY: SYNC }, rpc, googleOk)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ eventos: 0, cursor_antes: 5, cursor_despues: 5, errores: [] })
  })
  it('actualizar: con x-club-web y el token del portal, PATCH de esa persona; sin pase → «sin_pase»', async () => {
    const { rpc } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const r = await manejarSync(pedido({ token: TOKEN }), 'actualizar', env, rpc, googleOk)
    expect(await r.json()).toEqual({ resultado: 'actualizado' })
    const sinPase = async (url: string) => ({ status: url.includes('oauth2') ? 200 : 404, json: async () => ({ access_token: 't' }) })
    expect(await (await manejarSync(pedido({ token: TOKEN }), 'actualizar', env, rpc, sinPase)).json()).toEqual({ resultado: 'sin_pase' })
    expect((await manejarSync(pedido({ token: TOKEN }, {}), 'actualizar', env, rpc, googleOk)).status).toBe(401)
    expect((await manejarSync(pedido({ token: 'x' }), 'actualizar', env, rpc, googleOk)).status).toBe(404)
  })
})
