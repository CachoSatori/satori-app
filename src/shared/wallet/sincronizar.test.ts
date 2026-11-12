// B3 (núcleo): sincronización con una base y un Google simulados. Cuenta de servicio FALSA generada en memoria.
import { describe, it, expect, beforeAll } from 'vitest'
import { sincronizar, mensajeCanje, tokenGoogle, API_WALLET, URL_TOKEN, TOPE_REINTENTOS, type Rpc, type Fetch } from './sincronizar'
import type { CuentaServicio, PaseDatos } from './googlePase'
import { configurarBaseClub } from './googlePase'
configurarBaseClub('https://club.ejemplo.test')   // (08-nov noche) el dominio es configuración

const ISSUER = '3388000000012345678'
const A = '00000000-0000-4000-8000-0000000000aa'
const B = '00000000-0000-4000-8000-0000000000bb'
const datos = (id: string, over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1, miembro_id: id, version: 9, actualizado_en: '2026-11-08T08:00:00Z', nombre_pila: 'Cami', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: 'https://club.ejemplo.test/r/ABCD2345' }, socio: null,
  anfitrion: { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
               personas: 6, creditos: 1, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 6, creditos_ganados_mes: 1 },
  promociones: [], canjear_url: null, ...over,
})

let sa: CuentaServicio
beforeAll(async () => {
  const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  sa = { client_email: 'sync-prueba@proyecto-falso.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` }
})

function escenario(o: { cursor?: number; eventos: Array<{ id: number; miembro_id: string | null }>; alertas?: unknown[];
                        google?: (url: string, metodo: string) => number; emitidos?: string[] | 'error';
                        reintentos?: string[] | 'error'; anotar?: 'error'; red?: (url: string) => boolean }) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
  const http: Array<{ url: string; metodo: string; body?: string }> = []
  const rpc: Rpc = async (fn, args) => {
    rpcs.push({ fn, args })
    if (fn === 'club_pase_cursor_leer') return { data: o.cursor ?? 10, error: null }
    if (fn === 'club_pase_eventos_leer') return { data: o.eventos, error: null }
    if (fn === 'club_pase_datos') return { data: datos(String(args.p_miembro)), error: null }
    if (fn === 'club_alertas_pendientes') return { data: o.alertas ?? [], error: null }
    if (fn === 'club_pase_reintentos_leer') {
      if (o.reintentos === 'error') return { data: null, error: { message: 'no existe' } }
      return { data: (o.reintentos ?? []).map(m => ({ miembro_id: m })), error: null }
    }
    if (fn === 'club_pase_reintento_anotar' && o.anotar === 'error') return { data: null, error: { message: 'no existe' } }
    if (fn === 'club_pases_emitidos') {
      if (o.emitidos === 'error') return { data: null, error: { message: 'x' } }
      return { data: (o.emitidos ?? []).filter(m => args.p_despues === null || m > String(args.p_despues)).map(m => ({ miembro_id: m })), error: null }
    }
    return { data: null, error: null }
  }
  const fetchFn: Fetch = async (url, init) => {
    http.push({ url, metodo: init.method, body: init.body })
    if (o.red?.(url)) throw new TypeError('fetch failed (simulado)')
    if (url === URL_TOKEN) return { status: 200, json: async () => ({ access_token: 'tok-falso', expires_in: 3600 }) }
    const st = o.google?.(url, init.method) ?? 200
    return { status: st, json: async () => ({}) }
  }
  return { rpc, fetchFn, rpcs, http }
}

describe('sincronizar (B3, núcleo)', () => {
  it('relee los datos de cada miembro (una vez aunque tenga varios eventos), PATCH y avanza el cursor al último', async () => {
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }, { id: 13, miembro_id: A }] })
    const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r).toMatchObject({ eventos: 3, miembros: 2, actualizados: 2, cursor_antes: 10, cursor_despues: 13, errores: [] })
    expect(e.rpcs.filter(x => x.fn === 'club_pase_datos')).toHaveLength(2)
    const patch = e.http.filter(h => h.metodo === 'PATCH')
    expect(patch.map(h => h.url)).toEqual([`${API_WALLET}/genericObject/${ISSUER}.club-${A}`, `${API_WALLET}/genericObject/${ISSUER}.club-${B}`])
    expect(JSON.parse(patch[0].body ?? '{}').id).toBe(`${ISSUER}.club-${A}`)
    expect(e.http.filter(h => h.url === URL_TOKEN)).toHaveLength(1)   // un token para todo el lote
    expect(e.rpcs.find(x => x.fn === 'club_pase_cursor_guardar')?.args).toEqual({ p_nombre: 'google', p_id: 13 })
  })

  it('objeto inexistente en Google (404) no es error; un 500 sí, pero se anota y el cursor avanza (Grok 75)', async () => {
    const ok = escenario({ eventos: [{ id: 11, miembro_id: A }], google: () => 404 })
    const r1 = await sincronizar({ rpc: ok.rpc, fetch: ok.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r1).toMatchObject({ sin_pase: 1, errores: [], cursor_despues: 11, fallidos: 0 })
    const mal = escenario({ eventos: [{ id: 11, miembro_id: A }], google: () => 500 })
    const r2 = await sincronizar({ rpc: mal.rpc, fetch: mal.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r2).toMatchObject({ fallidos: 1, anotados: 1, cursor_despues: 11 })
    expect(mal.rpcs.find(x => x.fn === 'club_pase_reintento_anotar')?.args).toEqual({ p_miembro: A, p_plataforma: 'google', p_evento: 11, p_error: 'PATCH HTTP 500' })
  })

  describe('Grok 75: un miembro con error no traba el cursor', () => {
    const C = '00000000-0000-4000-8000-0000000000cc'
    const fallaB = (url: string) => (url.includes(`club-${B}`) ? 500 : 200)

    it('un miembro que falla entre dos que andan: los dos se actualizan, el error queda anotado y el cursor avanza', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }, { id: 13, miembro_id: C }], google: fallaB })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ actualizados: 2, fallidos: 1, anotados: 1, cursor_despues: 13 })
      expect(e.http.filter(h => h.metodo === 'PATCH').map(h => h.url.slice(-2))).toEqual(['aa', 'bb', 'cc'])   // siguió después del error
      expect(e.rpcs.filter(x => x.fn === 'club_pase_reintento_anotar').map(x => x.args)).toEqual([
        { p_miembro: B, p_plataforma: 'google', p_evento: 12, p_error: 'PATCH HTTP 500' }])
      expect(e.rpcs.find(x => x.fn === 'club_pase_cursor_guardar')?.args).toEqual({ p_nombre: 'google', p_id: 13 })
    })

    it('la pasada siguiente reintenta al anotado (sin eventos nuevos) y, si sale bien, lo da por resuelto', async () => {
      const e = escenario({ eventos: [], reintentos: [B] })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ reintentados: 1, actualizados: 1, reintentos_resueltos: 1, fallidos: 0, cursor_despues: 10 })
      expect(e.rpcs.find(x => x.fn === 'club_pase_reintentos_leer')?.args).toEqual({ p_plataforma: 'google', p_tope: TOPE_REINTENTOS, p_limite: 200 })
      expect(e.rpcs.find(x => x.fn === 'club_pase_reintento_resuelto')?.args).toEqual({ p_miembro: B, p_plataforma: 'google' })
      expect(e.rpcs.find(x => x.fn === 'club_pase_cursor_guardar')).toBeUndefined()   // sin eventos, el cursor no se toca
    })

    it('si el reintento vuelve a fallar, se anota otra vez (la base cuenta el intento) y no se da por resuelto', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }], reintentos: [B], google: fallaB })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ actualizados: 1, fallidos: 1, anotados: 1, reintentos_resueltos: 0, cursor_despues: 11 })
      expect(e.rpcs.find(x => x.fn === 'club_pase_reintento_anotar')?.args).toMatchObject({ p_miembro: B, p_evento: null })
      expect(e.rpcs.find(x => x.fn === 'club_pase_reintento_resuelto')).toBeUndefined()
    })

    it('una caída de red con UN miembro (excepción) no corta la pasada', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }], red: (u) => u.includes(`club-${A}`) })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ actualizados: 1, fallidos: 1, anotados: 1, cursor_despues: 12 })
      expect(e.rpcs.find(x => x.fn === 'club_pase_reintento_anotar')?.args.p_error).toBe('excepción')
    })

    it('sin dónde anotar (la tabla de reintentos todavía no está): el cursor frena justo antes del primer evento del fallido', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }, { id: 13, miembro_id: C }, { id: 14, miembro_id: B }],
                            google: fallaB, reintentos: 'error', anotar: 'error' })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ actualizados: 2, fallidos: 1, anotados: 0, cursor_despues: 11 })
      expect(r.errores).toEqual(expect.arrayContaining(['reintentos: lectura', `no se pudo anotar ${B.slice(0, 8)}`]))
    })

    it('sin dónde anotar y el fallido vino por un evento global: el cursor no pasa ese global', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: null }], emitidos: [A, B], google: fallaB, anotar: 'error' })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ fallidos: 1, anotados: 0, cursor_despues: 11 })
    })

    it('lo anotado no lleva datos del pase ni teléfonos: solo id, evento y un mensaje corto', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }], google: () => 503 })
      await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      for (const x of e.rpcs.filter(y => y.fn === 'club_pase_reintento_anotar')) {
        expect(Object.keys(x.args).sort()).toEqual(['p_error', 'p_evento', 'p_miembro', 'p_plataforma'])
        expect(String(x.args.p_error)).toMatch(/^(datos|contrato|excepción|PATCH HTTP \d{3}|token de Google: HTTP \d{3})$/)
      }
    })

    it('un mensaje de canje que falla ya no traba el cursor (la alerta queda pendiente en la base)', async () => {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }], alertas: [{ id: 5, miembro_id: A, creditos: 1, saldo_creditos: 2 }],
                            google: (u, m) => (m === 'POST' && u.endsWith('/addMessage') ? 500 : 200) })
      const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
      expect(r).toMatchObject({ actualizados: 1, mensajes_enviados: 0, cursor_despues: 11 })
      expect(e.rpcs.find(x => x.fn === 'club_alerta_enviada')).toBeUndefined()
    })
  })

  it('un evento global (promociones) actualiza todos los pases emitidos y el cursor pasa', async () => {
    const C = '00000000-0000-4000-8000-0000000000cc'
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: null }], emitidos: [A, B, C] })
    const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r).toMatchObject({ miembros: 3, actualizados: 3, globales_pendientes: 0, cursor_despues: 12, errores: [] })
    expect(e.rpcs.find(x => x.fn === 'club_pases_emitidos')?.args).toEqual({ p_plataforma: 'google', p_despues: null, p_limite: 500 })
  })

  it('si la lista de pases falla: los del lote igual se actualizan y el cursor frena antes del global', async () => {
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: null }, { id: 13, miembro_id: B }], emitidos: 'error' })
    const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r).toMatchObject({ miembros: 2, actualizados: 2, globales_pendientes: 1, cursor_despues: 11 })
    const g = escenario({ eventos: [{ id: 11, miembro_id: null }, { id: 12, miembro_id: A }], emitidos: 'error' })
    const r2 = await sincronizar({ rpc: g.rpc, fetch: g.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r2).toMatchObject({ actualizados: 1, cursor_despues: 10 })
    expect(g.rpcs.find(x => x.fn === 'club_pase_cursor_guardar')).toBeUndefined()
  })


  it('mensajes de canje: addMessage en ES/EN y se marca enviada; sin pase (404) queda pendiente', async () => {
    const e = escenario({ eventos: [], alertas: [
      { id: 7, miembro_id: A, tipo: 'canje', creditos: 1.5, saldo_creditos: 2, fecha: '2026-11-08T08:00:00Z' },
      { id: 8, miembro_id: B, tipo: 'canje', creditos: 1, saldo_creditos: 0, fecha: '2026-11-08T08:00:00Z' }],
      google: url => (url.includes(B) ? 404 : 200) })
    const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r).toMatchObject({ mensajes_enviados: 1, mensajes_sin_pase: 1, errores: [] })
    const msg = JSON.parse(e.http.find(h => h.url.endsWith('/addMessage') && h.url.includes(A))?.body ?? '{}').message
    expect(msg.body).toBe('Se canjearon 1,5 créditos de tu cuenta. Te quedan 2. ¿No fuiste vos? Avisanos.')
    expect(msg.localizedBody.translatedValues[0].value).toBe('1.5 credits redeemed from your account. You have 2 left. Not you? Let us know.')
    expect(e.rpcs.filter(x => x.fn === 'club_alerta_enviada').map(x => x.args)).toEqual([{ p_id: 7, p_canal: 'google' }])
  })

  it('sin eventos ni alertas: no pide token ni mueve el cursor', async () => {
    const e = escenario({ eventos: [] })
    const r = await sincronizar({ rpc: e.rpc, fetch: e.fetchFn, sa, issuer: ISSUER, entorno: 'prod' as const })
    expect(r.cursor_despues).toBe(10)
    expect(e.http).toHaveLength(0)
  })

  it('mensajeCanje: singular y plural', () => {
    expect(mensajeCanje(1, 1).es.body).toBe('Se canjearon 1 crédito de tu cuenta. Te quedan 1. ¿No fuiste vos? Avisanos.')
    expect(mensajeCanje(2, 0).en.body).toBe('2 credits redeemed from your account. You have 0 left. Not you? Let us know.')
  })

  it('tokenGoogle: JWT bearer con el alcance del emisor; un error de Google no muestra el contenido', async () => {
    let cuerpo = ''
    const okFetch: Fetch = async (_u, init) => { cuerpo = init.body ?? ''; return { status: 200, json: async () => ({ access_token: 'abc' }) } }
    expect(await tokenGoogle(sa, okFetch)).toBe('abc')
    expect(cuerpo).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+$/)
    const claims = JSON.parse(Buffer.from(cuerpo.split('assertion=')[1].split('.')[1], 'base64url').toString())
    expect(claims).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: URL_TOKEN })
    const malFetch: Fetch = async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) })
    await expect(tokenGoogle(sa, malFetch)).rejects.toThrow('token de Google: HTTP 400')
  })
})
