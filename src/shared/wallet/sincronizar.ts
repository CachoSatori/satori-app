/**
 * B3 (núcleo): sincronización del pase de Google Wallet con la base. Módulo PURO: la red (`fetch`) y la base
 * (`rpc` con service_role) se inyectan, así se prueba sin Google y sin Supabase.
 *
 * Contrato (CONTRATO-pase.md §3 y §4):
 *  · lee `club_pase_eventos` desde el cursor `google`; para cada miembro del lote relee `club_pase_datos` (los eventos
 *    no llevan datos) y hace PATCH del objeto. Un objeto que no existe en Google (404: la persona generó el link pero
 *    nunca tocó «Guardar») no es error.
 *  · eventos con `miembro_id` null (promociones): afectan a todos los pases emitidos. Se recorren con
 *    `club_pases_emitidos('google')` (paginada) y se actualiza cada objeto. Si esa lista falla, el cursor NO pasa del
 *    primer evento global (los miembros del lote igual se actualizan).
 *  · mensajes: `club_alertas_pendientes` → `addMessage` en el objeto → `club_alerta_enviada(id, 'google')`. Si el pase
 *    no existe (404), la alerta queda pendiente (sigue el link wa.me en caja).
 *  · (09-nov, Grok 75) un miembro con error NO traba el cursor: se lo saltea, se ANOTA para reintentar (miembro, evento,
 *    mensaje corto; nunca el teléfono ni datos del pase) con `club_pase_reintento_anotar`, y se sigue con el resto. El
 *    cursor avanza por encima de todo lo procesado. Al empezar, cada pasada suma los miembros anotados
 *    (`club_pase_reintentos_leer`, solo los que no llegaron al tope de intentos) y, si salen bien, los da por resueltos
 *    (`club_pase_reintento_resuelto`). Un error persistente no se pierde: queda anotado con sus intentos.
 *  · Si la anotación NO se puede guardar (la tabla de reintentos todavía no está en la base, o falla), se vuelve al modo
 *    conservador: el cursor frena justo antes del primer evento de ese miembro en el lote, así nada se pierde.
 *  · Los mensajes de canje que fallan no frenan el cursor: la alerta queda pendiente en la base y se reintenta sola.
 *    Si la lista de pases emitidos falla, el cursor no pasa del primer evento global (como antes). La base solo deja
 *    avanzar el cursor (CLUB-AUD-70); PATCH es idempotente.
 */
import { armarObjeto, idObjeto, idsDelAmbiente, importarClave, validarDatos, type CuentaServicio, type DisenoPase, type Entorno, type PaseDatos } from './googlePase.ts'

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>

export const API_WALLET = 'https://walletobjects.googleapis.com/walletobjects/v1'
export const SCOPE_WALLET = 'https://www.googleapis.com/auth/wallet_object.issuer'
export const URL_TOKEN = 'https://oauth2.googleapis.com/token'
/** Grok 75: después de este número de intentos fallidos, el miembro ya no se reintenta solo (queda anotado). */
export const TOPE_REINTENTOS = 10

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

/**
 * (12-nov, el dueño) Link de «Guardar» CORTO: la clase y el objeto se crean (o actualizan) por la API ANTES de firmar,
 * y el JWT lleva solo los IDs (`firmarJwtFlaco`). El JWT completo pasaba los 1.800 caracteres que recomienda Google.
 *  · clase: POST; 409 = ya existe → **se deja como está** (nunca PUT ni PATCH de la clase: no lleva diseño propio).
 *  · objeto: POST; 409 = ya existe → PATCH con los datos de ahora (la persona vuelve a pedir el pase).
 *  · (12-nov) antes de escribir nada, la clase y el objeto tienen que ser de ESTE ambiente (`idsDelAmbiente`): staging no
 *    toca la clase ni los objetos de prod, ni al revés.
 * Devuelve 'ok' o un error corto, sin el cuerpo de la respuesta de Google.
 */
export async function guardarEnGoogle(fetchFn: Fetch, token: string, issuer: string, entorno: Entorno,
                                      clase: { id: string }, objeto: { id: string; classId: string }): Promise<'ok' | string> {
  if (!idsDelAmbiente(issuer, entorno, clase, objeto)) return 'ids de otro ambiente'
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const c = await fetchFn(`${API_WALLET}/genericClass`, { method: 'POST', headers: h, body: JSON.stringify(clase) })
  if (c.status !== 200 && c.status !== 409) return `clase HTTP ${c.status}`
  const o = await fetchFn(`${API_WALLET}/genericObject`, { method: 'POST', headers: h, body: JSON.stringify(objeto) })
  if (o.status === 200) return 'ok'
  if (o.status !== 409) return `objeto HTTP ${o.status}`
  const p = await fetchFn(`${API_WALLET}/genericObject/${encodeURIComponent(objeto.id)}`, { method: 'PATCH', headers: h, body: JSON.stringify(objeto) })
  return p.status === 200 ? 'ok' : `objeto PATCH HTTP ${p.status}`
}

/** Texto del mensaje de canje (CONTRATO §4), ES y EN. */
export function mensajeCanje(creditos: number, saldo: number) {
  const n = (x: number, coma: boolean) => { const s = (Math.round(x * 10) / 10).toString(); return coma ? s.replace('.', ',') : s }
  const cr = (x: number, es: boolean) => (x === 1 ? (es ? 'crédito' : 'credit') : (es ? 'créditos' : 'credits'))
  return {
    es: { header: 'Canje de créditos', body: `Se canjearon ${n(creditos, true)} ${cr(creditos, true)} de su cuenta. Le quedan ${n(saldo, true)}. ¿No fue usted? Avísenos.` },
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
  /** Grok 75: miembros que fallaron en esta pasada (salteados). */
  fallidos: number
  /** …de esos, cuántos quedaron anotados para reintentar. */
  anotados: number
  /** Miembros anotados de pasadas anteriores que se reintentaron, y cuántos salieron bien. */
  reintentados: number
  reintentos_resueltos: number
  errores: string[]
}

export interface DepsSync {
  rpc: Rpc
  fetch: Fetch
  sa: CuentaServicio
  issuer: string
  /** (12-nov) `prod` o `stg`: los IDs de la clase y de los objetos llevan el sufijo del ambiente. */
  entorno: Entorno
  diseno?: DisenoPase
  limite?: number
  ahora?: Date
}

export async function sincronizar(deps: DepsSync): Promise<ResultadoSync> {
  const { rpc, issuer } = deps
  const res: ResultadoSync = { eventos: 0, miembros: 0, actualizados: 0, sin_pase: 0, globales_pendientes: 0,
                               mensajes_enviados: 0, mensajes_sin_pase: 0, cursor_antes: 0, cursor_despues: 0,
                               fallidos: 0, anotados: 0, reintentados: 0, reintentos_resueltos: 0, errores: [] }
  const c = await rpc('club_pase_cursor_leer', { p_nombre: 'google' })
  if (c.error) throw new Error('no se pudo leer el cursor')
  res.cursor_antes = res.cursor_despues = Number(c.data ?? 0)

  const ev = await rpc('club_pase_eventos_leer', { p_despues: res.cursor_antes, p_limite: deps.limite ?? 500 })
  if (ev.error) throw new Error('no se pudieron leer los eventos')
  const eventos = (ev.data ?? []) as Array<{ id: number; miembro_id: string | null }>
  res.eventos = eventos.length

  // Eventos globales (promociones): todos los pases emitidos. Si no se pueden listar, el cursor llega solo hasta justo
  // antes del primer global (no se pierde el cambio) y los miembros del lote igual se actualizan (PATCH es idempotente).
  const primerGlobal = eventos.find(e => e.miembro_id === null)
  const set = new Set(eventos.map(e => e.miembro_id).filter((x): x is string => typeof x === 'string'))
  let globalesOk = true
  if (primerGlobal) {
    let despues: string | null = null
    for (let pagina = 0; pagina < 100; pagina++) {
      const p = await rpc('club_pases_emitidos', { p_plataforma: 'google', p_despues: despues, p_limite: 500 })
      if (p.error) { globalesOk = false; res.errores.push('pases emitidos'); break }
      const filas = (p.data ?? []) as Array<{ miembro_id: string }>
      for (const f of filas) set.add(f.miembro_id)
      if (filas.length < 500) break
      despues = filas[filas.length - 1].miembro_id
    }
  }
  res.globales_pendientes = globalesOk ? 0 : eventos.filter(e => e.miembro_id === null).length
  const procesables = primerGlobal && !globalesOk ? eventos.filter(e => e.id < primerGlobal.id) : eventos

  // Grok 75: los anotados de pasadas anteriores (bajo el tope) se suman a este lote.
  const reintentos = new Set<string>()
  const rr = await rpc('club_pase_reintentos_leer', { p_plataforma: 'google', p_tope: TOPE_REINTENTOS, p_limite: 200 })
  if (rr.error) res.errores.push('reintentos: lectura')
  else for (const f of ((rr.data ?? []) as Array<{ miembro_id: string }>)) { reintentos.add(f.miembro_id); set.add(f.miembro_id) }
  res.reintentados = reintentos.size
  const miembros = [...set]
  res.miembros = miembros.length
  // primer evento de cada miembro en el lote (para anotarlo y, sin anotación, para frenar el cursor antes)
  const primerEvento = new Map<string, number>()
  for (const e of eventos) if (e.miembro_id && !primerEvento.has(e.miembro_id)) primerEvento.set(e.miembro_id, e.id)
  const fallidos: Array<{ m: string; error: string }> = []
  const fallo = (m: string, error: string) => { fallidos.push({ m, error }); res.errores.push(`${error} de ${m.slice(0, 8)}`) }

  let token: string | null = null
  const auth = async () => (token ??= await tokenGoogle(deps.sa, deps.fetch, deps.ahora))

  for (const m of miembros) {
    // Grok 75: cualquier falla de UN miembro (base, contrato, red, Google) se anota y se sigue con el siguiente.
    let st: 'ok' | 'sin_pase' | 'nada'
    try {
      const d = await rpc('club_pase_datos', { p_miembro: m })
      if (d.error) { fallo(m, 'datos'); continue }
      if (d.data === null) st = 'nada'                    // el miembro ya no existe: nada que actualizar
      else if (validarDatos(d.data) !== null) { fallo(m, 'contrato'); continue }
      else {
        const objeto = armarObjeto(issuer, deps.entorno, d.data as PaseDatos, deps.diseno)
        const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(issuer, m, deps.entorno))}`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(objeto) })
        if (r.status === 200) { res.actualizados++; st = 'ok' }
        else if (r.status === 404) { res.sin_pase++; st = 'sin_pase' }
        else { fallo(m, `PATCH HTTP ${r.status}`); continue }
      }
    } catch (e) {
      fallo(m, e instanceof Error && /^token de Google/.test(e.message) ? e.message : 'excepción'); continue
    }
    if (reintentos.has(m) && st) {
      const z = await rpc('club_pase_reintento_resuelto', { p_miembro: m, p_plataforma: 'google' })
      if (z.error) res.errores.push(`reintento resuelto ${m.slice(0, 8)}`); else res.reintentos_resueltos++
    }
  }
  res.fallidos = fallidos.length
  // Anotar los fallidos (sin datos personales: id, evento y un mensaje corto). Los que no se pudieron anotar frenan el
  // cursor antes de su primer evento del lote (un fallido que vino solo por la lista de reintentos ya está anotado).
  let tope = Number.POSITIVE_INFINITY
  for (const f of fallidos) {
    const a = await rpc('club_pase_reintento_anotar', { p_miembro: f.m, p_plataforma: 'google',
                                                        p_evento: primerEvento.get(f.m) ?? null, p_error: f.error.slice(0, 120) })
    if (!a.error) { res.anotados++; continue }
    res.errores.push(`no se pudo anotar ${f.m.slice(0, 8)}`)
    const pe = primerEvento.get(f.m) ?? (reintentos.has(f.m) ? undefined : primerGlobal?.id)
    if (pe !== undefined) tope = Math.min(tope, pe - 1)
  }

  // Mensajes de canje
  const al = await rpc('club_alertas_pendientes', { p_limite: 100 })
  if (al.error) res.errores.push('alertas')
  for (const a of ((al.error ? [] : al.data ?? []) as Array<{ id: number; miembro_id: string; creditos: number; saldo_creditos: number }>)) {
    const t = mensajeCanje(Number(a.creditos), Number(a.saldo_creditos))
    const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(issuer, a.miembro_id, deps.entorno))}/addMessage`, {
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

  // Cursor (Grok 75): avanza por encima de lo procesado aunque algún miembro haya fallado (quedó anotado). Nunca más allá
  // del primer evento global si la lista de pases falló, ni del primer evento de un fallido que no se pudo anotar.
  const candidatos = procesables.filter(e => e.id <= tope)
  if (candidatos.length > 0) {
    const hasta = candidatos[candidatos.length - 1].id
    if (hasta > res.cursor_antes) {
      const g = await rpc('club_pase_cursor_guardar', { p_nombre: 'google', p_id: hasta })
      if (g.error) res.errores.push('cursor')
      else res.cursor_despues = hasta
    }
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
  const objeto = armarObjeto(deps.issuer, deps.entorno, datos, deps.diseno)
  const token = await tokenGoogle(deps.sa, deps.fetch, deps.ahora)
  const r = await deps.fetch(`${API_WALLET}/genericObject/${encodeURIComponent(idObjeto(deps.issuer, miembro, deps.entorno))}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(objeto) })
  if (r.status === 404) return 'sin_pase'
  if (r.status !== 200) return 'error'
  return datos.estado === 'baja' ? 'baja' : 'actualizado'
}
