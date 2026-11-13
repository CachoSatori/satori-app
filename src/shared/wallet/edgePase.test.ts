// B1: el flujo del Edge club-pase con una base simulada y una cuenta de servicio FALSA generada en memoria.
import { describe, it, expect, beforeAll } from 'vitest'
import { manejarPase, manejarSync, type EnvPase, type Rpc } from './edgePase'
import { armarClase, armarObjeto, configurarBaseClub, type PaseDatos } from './googlePase'
import { guardarEnGoogle } from './sincronizar'

const ISSUER = '3388000000012345678'
const CLAVE_WEB = 'k'.repeat(40)
const TOKEN = 'c'.repeat(64)
const MIEMBRO = '00000000-0000-4000-8000-00000000beef'

const datos = (over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1, miembro_id: MIEMBRO, version: 7, actualizado_en: '2026-11-08T08:00:00Z', nombre_pila: 'Beto', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: 'https://club.ejemplo.test/r/ABCD2345' }, socio: null,
  anfitrion: { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
               personas: 6, creditos: 1, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 6, creditos_ganados_mes: 1 },
  promociones: [], canjear_url: `https://club.ejemplo.test/w/${'d'.repeat(64)}`, ...over,
})

let env: EnvPase
beforeAll(async () => {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
  env = { CLUB_WEB_KEY: CLAVE_WEB, GOOGLE_WALLET_ISSUER_ID: ISSUER, CLUB_WEB_ORIGIN: 'https://club.ejemplo.test', WALLET_ENTORNO: 'prod',
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
/** (12-nov) Google simulado: token OK; la clase y el objeto responden lo que diga `resp` (por defecto, 200). */
function google(resp: { clase?: number; objeto?: number; patch?: number; token?: number } = {}) {
  const llamadas: Array<{ url: string; method: string; body?: string }> = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    llamadas.push({ url, method: init.method, body: init.body })
    let status = 200
    if (url.includes('oauth2')) status = resp.token ?? 200
    else if (url.endsWith('/genericClass')) status = resp.clase ?? 200
    else if (url.endsWith('/genericObject')) status = resp.objeto ?? 200
    else if (init.method === 'PATCH') status = resp.patch ?? 200
    return { status, json: async () => (url.includes('oauth2') ? { access_token: 'tok-falso' } : {}) }
  }
  return { fetch, llamadas }
}
const pedido = (cuerpo: unknown, headers: Record<string, string> = { 'x-club-web': CLAVE_WEB }, metodo = 'POST') =>
  new Request('https://edge.ejemplo/club-pase/google', { method: metodo, headers, body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined })

describe('club-pase (Edge)', () => {
  it('flujo completo: token → miembro → datos → JWT → registra el pase emitido', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, google().fetch)
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(j.object_id).toBe(`${ISSUER}.club-${MIEMBRO}`)
    expect(llamadas.map(l => l.fn)).toEqual(['club_pase_por_token', 'club_pase_datos', 'club_pase_emitido'])
    expect(llamadas[2].args).toEqual({ p_miembro: MIEMBRO, p_plataforma: 'google', p_object_id: `${ISSUER}.club-${MIEMBRO}` })
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('(12-nov) link CORTO: crea la clase y el objeto por la API y el JWT lleva solo los IDs', async () => {
    const { rpc } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const g = google()
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, g.fetch)
    expect(r.status).toBe(200)
    const { url } = await r.json() as { url: string }
    expect(url.length).toBeLessThan(1800)
    const claims = JSON.parse(Buffer.from(url.split('/').pop()!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(claims.payload).toEqual({ genericObjects: [{ id: `${ISSUER}.club-${MIEMBRO}`, classId: `${ISSUER}.club-satori` }] })
    expect(g.llamadas.map(l => `${l.method} ${l.url.replace(/^https:\/\/[^/]+/, '')}`)).toEqual([
      'POST /token', 'POST /walletobjects/v1/genericClass', 'POST /walletobjects/v1/genericObject'])
    expect(JSON.parse(g.llamadas[2].body!).header.defaultValue.value).toBe('Beto')   // el objeto completo va por la API
  })

  it('(12-nov) la clase ya existe (409) se deja; el objeto ya existe (409) → PATCH con los datos de ahora', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const g = google({ clase: 409, objeto: 409 })
    expect((await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, g.fetch)).status).toBe(200)
    expect(g.llamadas.map(l => l.method)).toEqual(['POST', 'POST', 'POST', 'PATCH'])
    expect(g.llamadas[3].url).toContain(encodeURIComponent(`${ISSUER}.club-${MIEMBRO}`))
    expect(llamadas.map(l => l.fn)).toContain('club_pase_emitido')
  })

  it('(12-nov) Google falla (token, clase, objeto o PATCH) → 502 «servicio», sin link y sin registrar el pase', async () => {
    for (const resp of [{ token: 401 }, { clase: 403 }, { objeto: 400 }, { objeto: 409, patch: 500 }]) {
      const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
      const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, google(resp).fetch)
      expect(r.status, JSON.stringify(resp)).toBe(502)
      expect(await r.json()).toEqual({ error: 'servicio' })
      expect(llamadas.map(l => l.fn)).not.toContain('club_pase_emitido')
    }
  })

  it('(12-nov) sin WALLET_ENTORNO o con un valor raro → 503 en /google, /actualizar y /sync; sin base y sin Google', async () => {
    const SYNC = 's'.repeat(40)
    for (const raro of [undefined, '', 'staging', 'PROD', 'produccion']) {
      const e = { ...env, WALLET_ENTORNO: raro, CLUB_PASE_SYNC_KEY: SYNC }
      const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
      const g = google()
      expect((await manejarPase(pedido({ token: TOKEN }), 'google', e, rpc, g.fetch)).status, String(raro)).toBe(503)
      expect((await manejarSync(pedido({ token: TOKEN }), 'actualizar', e, rpc, g.fetch)).status, String(raro)).toBe(503)
      const sync = new Request('https://edge.ejemplo/club-pase/sync', { method: 'POST', headers: { 'x-club-pase-sync': SYNC } })
      expect((await manejarSync(sync, 'sync', e, rpc, g.fetch)).status, String(raro)).toBe(503)
      expect(llamadas).toHaveLength(0)
      expect(g.llamadas).toHaveLength(0)
    }
  })

  it('(12-nov) WALLET_ENTORNO=stg: clase «club-satori-stg», objeto «club-stg-<miembro>», JWT y registro con esos IDs', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const g = google()
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, WALLET_ENTORNO: 'stg' }, rpc, g.fetch)
    expect(r.status).toBe(200)
    const j = await r.json() as { url: string; object_id: string }
    expect(j.object_id).toBe(`${ISSUER}.club-stg-${MIEMBRO}`)
    expect(JSON.parse(g.llamadas[1].body!).id).toBe(`${ISSUER}.club-satori-stg`)
    expect(JSON.parse(g.llamadas[2].body!)).toMatchObject({ id: `${ISSUER}.club-stg-${MIEMBRO}`, classId: `${ISSUER}.club-satori-stg` })
    const claims = JSON.parse(Buffer.from(j.url.split('/').pop()!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(claims.payload).toEqual({ genericObjects: [{ id: `${ISSUER}.club-stg-${MIEMBRO}`, classId: `${ISSUER}.club-satori-stg` }] })
    expect(llamadas.find(l => l.fn === 'club_pase_emitido')?.args.p_object_id).toBe(`${ISSUER}.club-stg-${MIEMBRO}`)
    // ninguna llamada nombra la clase o un objeto de prod
    expect(g.llamadas.some(l => (l.body ?? '').includes(`${ISSUER}.club-satori"`) || l.url.includes(encodeURIComponent(`${ISSUER}.club-${MIEMBRO}`)))).toBe(false)
  })

  it('(12-nov) la clase que ya existe (409) se deja como está: nunca PUT ni PATCH de la clase, en ningún ambiente', async () => {
    for (const ent of ['prod', 'stg']) {
      const { rpc } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
      const g = google({ clase: 409, objeto: 409 })
      expect((await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, WALLET_ENTORNO: ent }, rpc, g.fetch)).status).toBe(200)
      const aClase = g.llamadas.filter(l => l.url.includes('/genericClass'))
      expect(aClase.map(l => l.method)).toEqual(['POST'])
      expect(g.llamadas.filter(l => l.method === 'PATCH').map(l => decodeURIComponent(l.url.split('/').pop()!)))
        .toEqual([ent === 'stg' ? `${ISSUER}.club-stg-${MIEMBRO}` : `${ISSUER}.club-${MIEMBRO}`])
    }
  })

  it('(12-nov) guardarEnGoogle no escribe la clase ni el objeto de OTRO ambiente: error y ninguna llamada a Google', async () => {
    configurarBaseClub('https://club.ejemplo.test')
    const deProd = { clase: armarClase(ISSUER, 'prod'), objeto: armarObjeto(ISSUER, 'prod', datos()) as unknown as { id: string; classId: string } }
    const deStg = { clase: armarClase(ISSUER, 'stg'), objeto: armarObjeto(ISSUER, 'stg', datos()) as unknown as { id: string; classId: string } }
    const g = google()
    expect(await guardarEnGoogle(g.fetch, 't', ISSUER, 'stg', deProd.clase, deProd.objeto)).toBe('ids de otro ambiente')
    expect(await guardarEnGoogle(g.fetch, 't', ISSUER, 'prod', deStg.clase, deStg.objeto)).toBe('ids de otro ambiente')
    expect(await guardarEnGoogle(g.fetch, 't', ISSUER, 'stg', deStg.clase, deProd.objeto)).toBe('ids de otro ambiente')
    expect(g.llamadas).toHaveLength(0)
    expect(await guardarEnGoogle(g.fetch, 't', ISSUER, 'stg', deStg.clase, deStg.objeto)).toBe('ok')
  })

  it('(12-nov) «Actualizar mi pase» en stg: PATCH del objeto «club-stg-<miembro>», nunca del de prod', async () => {
    const { rpc } = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos(), error: null } })
    const g = google()
    const r = await manejarSync(pedido({ token: TOKEN }), 'actualizar', { ...env, WALLET_ENTORNO: 'stg' }, rpc, g.fetch)
    expect(await r.json()).toEqual({ resultado: 'actualizado' })
    const patch = g.llamadas.filter(l => l.method === 'PATCH')
    expect(patch.map(l => decodeURIComponent(l.url.split('/').pop()!))).toEqual([`${ISSUER}.club-stg-${MIEMBRO}`])
  })

  it('falla cerrada: sin algún secreto → 503 y no llama a la base', async () => {
    for (const falta of ['CLUB_WEB_KEY', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SA_KEY'] as const) {
      const { rpc, llamadas } = base({})
      const r = await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, [falta]: undefined }, rpc, google().fetch)
      expect(r.status).toBe(503)
      expect(llamadas).toHaveLength(0)
    }
    const { rpc, llamadas } = base({})
    expect((await manejarPase(pedido({ token: TOKEN }), 'google', { ...env, CLUB_WEB_KEY: 'corta' }, rpc, google().fetch)).status).toBe(503)
    expect(llamadas).toHaveLength(0)
  })

  it('sin el header x-club-web correcto → 401 y no llama a la base', async () => {
    const { rpc, llamadas } = base({})
    expect((await manejarPase(pedido({ token: TOKEN }, {}), 'google', env, rpc, google().fetch)).status).toBe(401)
    expect((await manejarPase(pedido({ token: TOKEN }, { 'x-club-web': 'x'.repeat(40) }), 'google', env, rpc, google().fetch)).status).toBe(401)
    expect(llamadas).toHaveLength(0)
  })

  it('token mal formado, desconocido o persona de baja → 404 «portal_invalido»; no registra nada', async () => {
    const a = base({})
    expect((await manejarPase(pedido({ token: 'xyz' }), 'google', env, a.rpc, google().fetch)).status).toBe(404)
    expect(a.llamadas).toHaveLength(0)
    const b = base({ club_pase_por_token: { data: null, error: null } })
    expect((await manejarPase(pedido({ token: TOKEN }), 'google', env, b.rpc, google().fetch)).status).toBe(404)
    const c = base({ club_pase_por_token: { data: MIEMBRO, error: null }, club_pase_datos: { data: datos({ estado: 'baja' }), error: null } })
    const rc = await manejarPase(pedido({ token: TOKEN }), 'google', env, c.rpc, google().fetch)
    expect(rc.status).toBe(404)
    expect(c.llamadas.map(l => l.fn)).not.toContain('club_pase_emitido')
  })

  it('datos fuera de contrato (p. ej. con un teléfono) → 502 «contrato», sin firmar ni registrar', async () => {
    const { rpc, llamadas } = base({ club_pase_por_token: { data: MIEMBRO, error: null },
                                     club_pase_datos: { data: datos({ nombre_pila: '+50688887777' }), error: null } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, google().fetch)
    expect(r.status).toBe(502)
    expect((await r.json()).error).toBe('contrato')
    expect(llamadas.map(l => l.fn)).not.toContain('club_pase_emitido')
  })

  it('error de la base → 502 sin el mensaje crudo; GET → 405; Apple → 404 (apagado)', async () => {
    const { rpc } = base({ club_pase_por_token: { data: null, error: { message: 'detalle interno de la base' } } })
    const r = await manejarPase(pedido({ token: TOKEN }), 'google', env, rpc, google().fetch)
    expect(r.status).toBe(502)
    expect(await r.text()).not.toMatch(/detalle interno/)
    expect((await manejarPase(pedido(null, { 'x-club-web': CLAVE_WEB }, 'GET'), 'google', env, rpc, google().fetch)).status).toBe(405)
    expect((await manejarPase(pedido({ token: TOKEN }), 'apple', env, rpc, google().fetch)).status).toBe(404)
  })

  it('(08-nov noche) sin CLUB_WEB_ORIGIN (el dominio del Club) → 503, falla cerrada, sin llamar a la base', async () => {
    const { CLUB_WEB_ORIGIN, ...sinDominio } = env; void CLUB_WEB_ORIGIN
    let llamadas = 0
    const r = await manejarPase(new Request('https://x/club-pase/google', { method: 'POST', headers: { 'x-club-web': CLAVE_WEB }, body: JSON.stringify({ token: 'a'.repeat(64) }) }),
      'google', sinDominio as EnvPase, async () => { llamadas++; return { data: null, error: null } }, google().fetch)
    expect(r.status).toBe(503)
    expect(llamadas).toBe(0)
  })

  it('cuerpo enorme o no JSON → 400', async () => {
    const { rpc } = base({})
    const grande = new Request('https://edge.ejemplo/club-pase/google', { method: 'POST', headers: { 'x-club-web': CLAVE_WEB }, body: 'x'.repeat(5000) })
    expect((await manejarPase(grande, 'google', env, rpc, google().fetch)).status).toBe(400)
    const roto = new Request('https://edge.ejemplo/club-pase/google', { method: 'POST', headers: { 'x-club-web': CLAVE_WEB }, body: '{roto' })
    expect((await manejarPase(roto, 'google', env, rpc, google().fetch)).status).toBe(400)
  })
})

describe('club-pase: rutas de B3 (sync y actualizar)', () => {
  it('(12-nov) /vencer: misma clave que /sync (sin ella 503; otra 401); con la buena, el resumen de las bajas', async () => {
    const SYNC = 's'.repeat(40)
    const { rpc } = base({ club_pase_cursor_leer: { data: 7, error: null }, club_pase_eventos_leer: { data: [{ id: 8, miembro_id: MIEMBRO }], error: null },
                           club_pase_datos: { data: datos({ estado: 'baja' }), error: null },
                           club_pases_emitidos: { data: [{ miembro_id: MIEMBRO, object_id: 'x', emitido_en: '2026-11-12T19:20:00Z' }], error: null } })
    // (13-nov) Google devuelve el objeto guardado (ACTIVE y con QR) al GET; /vencer lo reemplaza con PUT sin código
    const llamadas: Array<{ url: string; method: string; body?: string }> = []
    const g = { llamadas, fetch: async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      llamadas.push({ url, method: init.method, body: init.body })
      if (url.includes('oauth2')) return { status: 200, json: async () => ({ access_token: 'tok-falso' }) }
      const obj = { id: `${ISSUER}.club-${MIEMBRO}`, classId: `${ISSUER}.club-satori`, state: 'ACTIVE', barcode: { type: 'QR_CODE', value: 'x' } }
      return { status: 200, json: async () => (init.method === 'GET' ? obj : JSON.parse(init.body!)) }
    } }
    const req = (h: Record<string, string>) => new Request('https://edge.ejemplo/club-pase/vencer', { method: 'POST', headers: h })
    expect((await manejarSync(req({ 'x-club-pase-sync': SYNC }), 'vencer', env, rpc, g.fetch)).status).toBe(503)
    expect((await manejarSync(req({ 'x-club-pase-sync': 'x'.repeat(40) }), 'vencer', { ...env, CLUB_PASE_SYNC_KEY: SYNC }, rpc, g.fetch)).status).toBe(401)
    expect(g.llamadas).toHaveLength(0)
    const r = await manejarSync(req({ 'x-club-pase-sync': SYNC }), 'vencer', { ...env, CLUB_PASE_SYNC_KEY: SYNC }, rpc, g.fetch)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ eventos: 1, con_pase: 1, vencidos: 1, cursor_antes: 7, cursor_despues: 8, cortado_por_tiempo: false })
    expect(g.llamadas.filter(l => l.method === 'PATCH')).toEqual([])
    const put = g.llamadas.filter(l => l.method === 'PUT').map(l => JSON.parse(l.body!))
    expect(put.map(b => b.state)).toEqual(['EXPIRED'])
    expect(put[0].barcode).toBeUndefined()
  })
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
