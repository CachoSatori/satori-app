/**
 * B3 (núcleo): sincronización del pase de Google Wallet con la base. Módulo PURO: la red (`fetch`) y la base
 * (`rpc` con service_role) se inyectan, así se prueba sin Google y sin Supabase.
 *
 * Contrato (CONTRATO-pase.md §3 y §4):
 *  · lee `club_pase_eventos` desde el cursor `google`; para cada miembro del lote relee `club_pase_datos` (los eventos
 *    no llevan datos) y hace PATCH del objeto. Un objeto que no existe en Google (404: la persona generó el link pero
 *    nunca tocó «Guardar») no es error.
 *  · eventos con `miembro_id` null (promociones): afectan a todos los pases emitidos. Para recorrerlos hace falta una
 *    función de la base que liste `club_pases` (todavía no existe: la agrega A). Mientras tanto se informan en
 *    `globales_pendientes` y el cursor NO pasa de ellos (los miembros del lote igual se actualizan).
 *  · mensajes: `club_alertas_pendientes` → `addMessage` en el objeto → `club_alerta_enviada(id, 'google')`. Si el pase
 *    no existe (404), la alerta queda pendiente (sigue el link wa.me en caja).
 *  · el cursor se guarda solo si todo el lote salió bien (PATCH es idempotente: reintentar no rompe nada). La base
 *    solo deja avanzarlo (CLUB-AUD-70).
 */
import { armarObjeto, idObjeto, importarClave, validarDatos, type CuentaServicio, type DisenoPase, type PaseDatos } from './googlePase.ts'

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>

export const API_WALLET = 'https://walletobjects.googleapis.com/walletobjects/v1'
export const SCOPE_WALLET = 'https://www.googleapis.com/auth/wallet_object.issuer'
export const URL_TOKEN = 'https://oauth2.googleapis.com/token'

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlTexto = (t: string) => b64url(new TextEncoder().encode(t))

/** Token de acceso de la cuenta de servicio (OAuth 2.0, «JWT bearer»), con el alcance del emisor de Wallet. */
export async function tokenGoogle(sa: CuentaServicio, fetchFn: Fetch, ahora = new Date()): Promise<string> {
  const iat = Math.floor(ahora.getTime() / 1000)
  const entrada = `${b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlTexto(JSON.stringify({
    iss: sa.client_email, scope: SCOPE_WALLET, aud: URL_TOKEN, iat, exp: iat + 3600 }))}`
  const clave = await importarClave(sa.private_key)
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(entrada)))
  const r = await fetchFn(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${entrada}.${b64url(firma)}`,
  })
  const j = await r.json().catch(() => null) as { access_token?: unknown } | null
  if (r.status !== 200 || !j || typeof j.access_token !== 'string') throw new Error(`token de Google: HTTP ${r.status}`)
  return j.access_token
}

/** Texto del mensaje de canje (CONTRATO §4), ES y EN. */
export function mensajeCanje(creditos: number, saldo: number) {
  const n = (x: number, coma: boolean) => { const s = (Math.round(x * 10) / 10).toString(); return coma ? s.replace('.', ',') : s }
  const cr = (x: number, es: boolean) => (x === 1 ? (es ? 'crédito' : 'credit') : (es ? 'créditos' : 'credits'))
  return {
    es: { header: 'Canje de créditos', body: `Se canjearon ${n(creditos, true)} ${cr(creditos, true)} de tu cuenta. Te quedan ${n(saldo, true)}. ¿No fuiste vos? Avisanos.` },
    en: { header: 'Credits redeemed', body: `${n(creditos, false)} ${cr(creditos, false)} redeemed from your account. You have ${n(saldo, false)} left. Not you? Let us know.` },
  }
}

export interface ResultadoSync {
  eventos: number
  miembros: number
  actualizados: number
  sin_pase: number
  globales_pendientes: number
  mensajes_enviados: number
  mensajes_sin_pase: number
  cursor_antes: number
  cursor_despues: number
  errores: string[]
}

export interface DepsSync {
  rpc: Rpc
  fetch: Fetch
  sa: CuentaServicio
  issuer: string
  diseno?: DisenoPase
  limite?: number
  ahora?: Date
}

export async function sincronizar(deps: DepsSync): Promise<ResultadoSync> {
  const { rpc, issuer } = deps
  const res: ResultadoSync = { eventos: 0, miembros: 0, actualizados: 0, sin_pase: 0, globales_pendientes: 0,
                               mensajes_enviados: 0, mensajes_sin_pase: 0, cursor_antes: 0, cursor_despues: 0, errores: [] }
  const c = await rpc('club_pase_cursor_leer', { p_nombre: 'google' })
  if (c.error) throw new Error('no se pudo leer el cursor')
  res.cursor_antes = res.cursor_despues = Number(c.data ?? 0)

  const ev = await rpc('club_pase_eventos_leer', { p_despues: res.cursor_antes, p_limite: deps.limite ?? 500 })
  if (ev.error) throw new Error('no se pudieron leer los eventos')
  const eventos = (ev.data ?? []) as Array<{ id: number; miembro_id: string | null }>
  res.eventos = eventos.length

  // Todos los miembros del lote se actualizan (PATCH es idempotente), pero el cursor llega solo hasta justo antes del
  // primer evento global: así un cambio de promociones no se pierde, y tampoco frena las actualizaciones de cada miembro
  // mientras falte la función que lista los pases emitidos.
  const primerGlobal = eventos.find(e => e.miembro_id === null)
  res.globales_pendientes = eventos.filter(e => e.miembro_id === null).length
  const procesables = primerGlobal ? eventos.filter(e => e.id < primerGlobal.id) : eventos
  const miembros = [...new Set(eventos.map(e => e.miembro_id).filter((x): x is string => typeof x === 'string'))]
  res.miembros = miembros.length

  let token: string | null = null
  const auth = async () => (token ??= await tokenGoogle(deps.sa, deps.fetch, deps.ahora))

  for (const m of miembros) {
    const d = await rpc('club_pase_datos', { p_miembro: m })
    if (d.error) { res.errores.push(`datos de ${m.slice(0, 8)}`); continue }
    if (d.data === null) continue                       // el miembro ya no existe: nada que actualizar
    if (validarDatos(d.data) !== null) { res.errores.push(`contrato de ${m.slice(0, 8)}`); continue }
    const objeto = armarObjeto(issuer, d.data as PaseDatos, deps.diseno)
    const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(issuer, m))}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(objeto) })
    if (r.status === 200) res.actualizados++
    else if (r.status === 404) res.sin_pase++
    else res.errores.push(`PATCH ${m.slice(0, 8)}: HTTP ${r.status}`)
  }

  // Mensajes de canje
  const al = await rpc('club_alertas_pendientes', { p_limite: 100 })
  if (al.error) res.errores.push('alertas')
  for (const a of ((al.error ? [] : al.data ?? []) as Array<{ id: number; miembro_id: string; creditos: number; saldo_creditos: number }>)) {
    const t = mensajeCanje(Number(a.creditos), Number(a.saldo_creditos))
    const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(issuer, a.miembro_id))}/addMessage`, {
      method: 'POST', headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        id: `canje-${a.id}`, messageType: 'TEXT_AND_NOTIFY', header: t.es.header, body: t.es.body,
        localizedHeader: { defaultValue: { language: 'es', value: t.es.header }, translatedValues: [{ language: 'en', value: t.en.header }] },
        localizedBody: { defaultValue: { language: 'es', value: t.es.body }, translatedValues: [{ language: 'en', value: t.en.body }] },
      } }) })
    if (r.status === 200) {
      const e = await rpc('club_alerta_enviada', { p_id: a.id, p_canal: 'google' })
      if (e.error) res.errores.push(`alerta ${a.id}`); else res.mensajes_enviados++
    } else if (r.status === 404) res.mensajes_sin_pase++   // sin pase: queda pendiente (sigue el wa.me en caja)
    else res.errores.push(`mensaje ${a.id}: HTTP ${r.status}`)
  }

  // Cursor: solo si todo salió bien, y nunca más allá del primer evento global pendiente.
  if (res.errores.length === 0 && procesables.length > 0) {
    const hasta = procesables[procesables.length - 1].id
    const g = await rpc('club_pase_cursor_guardar', { p_nombre: 'google', p_id: hasta })
    if (g.error) res.errores.push('cursor')
    else res.cursor_despues = hasta
  }
  return res
}

/**
 * «Actualizar mi pase» (portal): PATCH del objeto de UNA persona, con sus datos de ahora. 404 = todavía no guardó el
 * pase (no es error). No mueve el cursor.
 */
export async function actualizarUno(deps: Omit<DepsSync, 'limite'>, miembro: string): Promise<'actualizado' | 'sin_pase' | 'baja' | 'error'> {
  const d = await deps.rpc('club_pase_datos', { p_miembro: miembro })
  if (d.error || d.data === null || validarDatos(d.data) !== null) return 'error'
  const datos = d.data as PaseDatos
  const objeto = armarObjeto(deps.issuer, datos, deps.diseno)
  const token = await tokenGoogle(deps.sa, deps.fetch, deps.ahora)
  const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(deps.issuer, miembro))}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(objeto) })
  if (r.status === 404) return 'sin_pase'
  if (r.status !== 200) return 'error'
  return datos.estado === 'baja' ? 'baja' : 'actualizado'
}
