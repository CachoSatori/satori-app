// (12-nov, opción c del dueño) La sincronización del piloto SOLO vence los pases de las bajas. Base y Google simulados.
import { describe, it, expect, beforeAll } from 'vitest'
import { vencerBajas, API_WALLET, URL_TOKEN, type Rpc, type Fetch } from './sincronizar'
import { configurarBaseClub, type CuentaServicio, type PaseDatos } from './googlePase'
configurarBaseClub('https://club.ejemplo.test')

const ISSUER = '3388000000012345678'
const A = '00000000-0000-4000-8000-0000000000aa'   // dado de baja (estado baja)
const B = '00000000-0000-4000-8000-0000000000bb'   // activo: un canje, no es baja
const C = '00000000-0000-4000-8000-0000000000cc'   // activo pero sin ningún rol vigente (el socio se dio de baja en el portal)
const D = '00000000-0000-4000-8000-0000000000dd'   // dado de baja

const base = (id: string, over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1, miembro_id: id, version: 9, actualizado_en: '2026-11-12T19:20:00Z', nombre_pila: 'Cami', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: 'https://club.ejemplo.test/r/ABCD2345' }, socio: null,
  anfitrion: { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
               personas: 6, creditos: 1, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 6, creditos_ganados_mes: 1 },
  promociones: [], canjear_url: null, ...over,
})
const DATOS: Record<string, PaseDatos> = {
  [A]: base(A, { estado: 'baja' }),
  [B]: base(B),
  [C]: base(C, { pestanas: [], anfitrion: null, codigo_barras: null,
                 socio: { estado: 'baja', desde: '2026-11-01', qr_url: 'https://club.ejemplo.test/s/ABCD2345K', beneficio: null, visitas_mes: 0, cortesias: [] } }),
  [D]: base(D, { estado: 'baja' }),
}

let sa: CuentaServicio
beforeAll(async () => {
  const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  sa = { client_email: 'bajas-prueba@proyecto-falso.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` }
})

function escenario(o: { cursor?: number; eventos: Array<{ id: number; miembro_id: string | null }>;
                        google?: (miembro: string) => number; token?: number; datosError?: string }) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
  const patch: Array<{ id: string; body: { state: string; id: string } }> = []
  const rpc: Rpc = async (fn, args) => {
    rpcs.push({ fn, args })
    if (fn === 'club_pase_cursor_leer') return { data: o.cursor ?? 10, error: null }
    if (fn === 'club_pase_eventos_leer') return { data: o.eventos, error: null }
    if (fn === 'club_pase_datos') {
      if (o.datosError === args.p_miembro) return { data: null, error: { message: 'x' } }
      return { data: DATOS[String(args.p_miembro)] ?? null, error: null }
    }
    return { data: null, error: null }
  }
  const fetchFn: Fetch = async (url, init) => {
    if (url === URL_TOKEN) return { status: o.token ?? 200, json: async () => ({ access_token: 'tok-falso' }) }
    expect(url.startsWith(`${API_WALLET}/genericObject/`)).toBe(true)
    const id = decodeURIComponent(url.split('/').pop()!)
    patch.push({ id, body: JSON.parse(init.body!) })
    return { status: o.google?.(id.split('club-').pop()!.replace(/^stg-/, '')) ?? 200, json: async () => ({}) }
  }
  const deps = (entorno: 'prod' | 'stg' = 'prod') => ({ rpc, fetch: fetchFn, sa, issuer: ISSUER, entorno })
  const cursorGuardado = () => rpcs.filter(r => r.fn === 'club_pase_cursor_guardar').map(r => r.args.p_id)
  return { deps, rpcs, patch, cursorGuardado }
}

describe('vencerBajas (opción c, piloto)', () => {
  it('vence en Google SOLO a los de baja o sin roles; los demás cambios no tocan Google; el cursor avanza al último evento', async () => {
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: B }, { id: 13, miembro_id: null },
                                    { id: 14, miembro_id: C }, { id: 15, miembro_id: A }] })
    const r = await vencerBajas(e.deps())
    expect(e.patch.map(p => p.id)).toEqual([`${ISSUER}.club-${A}`, `${ISSUER}.club-${C}`])
    expect(e.patch.every(p => p.body.state === 'EXPIRED')).toBe(true)
    expect(r).toMatchObject({ eventos: 5, miembros: 3, vencidos: 2, sin_cambio: 1, permanentes: 0, cursor_antes: 10, cursor_despues: 15, errores: [] })
    expect(e.cursorGuardado()).toEqual([15])
    expect(e.rpcs.filter(x => x.fn === 'club_pase_datos').map(x => x.args.p_miembro)).toEqual([A, B, C])   // una vez por miembro
  })

  it('en staging vence el objeto «club-stg-<miembro>», nunca el de prod', async () => {
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }] })
    await vencerBajas(e.deps('stg'))
    expect(e.patch.map(p => p.id)).toEqual([`${ISSUER}.club-stg-${A}`])
  })

  it('404 de Google (nunca guardó el pase) no es error; un 4xx permanente se anota y el cursor sigue', async () => {
    const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: D }],
                          google: m => (m === A ? 404 : 400) })
    const r = await vencerBajas(e.deps())
    expect(r).toMatchObject({ vencidos: 0, sin_pase: 1, permanentes: 1, cursor_despues: 12 })
    expect(r.errores.join()).toMatch(/permanente/)
  })

  it('un error transitorio (5xx o 429) deja el cursor JUSTO ANTES del primer evento de ese miembro; los demás se procesan', async () => {
    for (const st of [500, 503, 429]) {
      const e = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: D }, { id: 13, miembro_id: A }],
                            google: m => (m === D ? st : 200) })
      const r = await vencerBajas(e.deps())
      expect(r.vencidos, String(st)).toBe(1)
      expect(r.cursor_despues, String(st)).toBe(11)
      expect(e.cursorGuardado(), String(st)).toEqual([11])
    }
  })

  it('error de la base con un miembro → no avanza más allá de él; sin token de Google → no avanza y no sigue', async () => {
    const a = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: D }], datosError: A })
    const ra = await vencerBajas(a.deps())
    expect(ra.cursor_despues).toBe(10)
    expect(a.cursorGuardado()).toEqual([])
    expect(a.patch.map(p => p.id)).toEqual([`${ISSUER}.club-${D}`])
    const b = escenario({ eventos: [{ id: 11, miembro_id: A }, { id: 12, miembro_id: D }], token: 401 })
    const rb = await vencerBajas(b.deps())
    expect(rb.cursor_despues).toBe(10)
    expect(b.patch).toEqual([])
    expect(rb.errores.join()).toMatch(/token de Google/)
  })

  it('sin eventos nuevos no llama a Google ni mueve el cursor', async () => {
    const e = escenario({ eventos: [] })
    expect(await vencerBajas(e.deps())).toMatchObject({ eventos: 0, vencidos: 0, cursor_despues: 10 })
    expect(e.patch).toEqual([])
    expect(e.cursorGuardado()).toEqual([])
  })
})
