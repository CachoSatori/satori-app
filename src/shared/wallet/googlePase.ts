/**
 * Pase de Google Wallet del Club Satori (B1). Módulo PURO: lo usan el Edge `club-pase` (Deno) y vitest (Node).
 * Sin red y sin secretos: recibe los datos del contrato y la cuenta de servicio, y devuelve la clase, el objeto y el
 * JWT firmado de «Save to Google Wallet».
 *
 * Contrato con la base: docs/club-satori/CONTRATO-pase.md (v1). La base da DATOS (`club_pase_datos`); los textos se
 * arman acá en ES y EN. El pase NUNCA lleva teléfono, email ni el token del portal (CLUB-AUD-69): el botón «Canjear»
 * usa `canjear_url` (token de PASE).
 *
 * Tipo de pase: genérico (`genericClass` / `genericObject`). Un pase por persona: el objectId es
 * `<issuerId>.club-<miembro_id>` y no cambia aunque se regenere el QR o el token.
 */

// ── Contrato v1 (lo que devuelve club_pase_datos) ───────────────────────────────
export interface PaseDatos {
  contrato: 1
  miembro_id: string
  version: number
  actualizado_en: string
  nombre_pila: string
  estado: 'activo' | 'baja'
  local: { id: string; nombre: string }
  pestanas: Array<'mi_club' | 'anfitrion'>
  codigo_barras: { tipo: 'socio' | 'cupones'; valor: string } | null
  socio: null | {
    estado: 'pendiente' | 'activo' | 'baja'
    desde: string
    qr_url: string
    beneficio: string | null
    visitas_mes: number
    cortesias: Array<{ sorpresa: boolean; cantidad: number; motivo: string; vence_en: string | null }>
  }
  anfitrion: null | {
    activo: boolean
    tipo: string
    codigo_publico: string
    qr_url: string
    personas: number
    creditos: number
    personas_proximo_medio: number
    valor_credito_crc: number
    referidos_mes: number
    creditos_ganados_mes: number
  }
  promociones: Array<{
    id: string; nombre: string; nombre_en: string | null; beneficio: string; para: string[]
    vigente_hasta: string | null; dias: number[]; horario: { desde: string; hasta: string } | null
  }>
  canjear_url: string | null
}

export const BASE_CLUB = 'https://club.satoricostarica.com'
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RE_ISSUER = /^\d{10,25}$/

/** Revisa la forma del JSON de la base antes de armar nada. Devuelve el error o null. */
export function validarDatos(d: unknown): string | null {
  if (!d || typeof d !== 'object') return 'sin datos'
  const x = d as Partial<PaseDatos>
  if (x.contrato !== 1) return 'contrato distinto de 1'
  if (typeof x.miembro_id !== 'string' || !RE_UUID.test(x.miembro_id)) return 'miembro_id no válido'
  if (typeof x.version !== 'number') return 'falta version'
  if (x.estado !== 'activo' && x.estado !== 'baja') return 'estado no válido'
  if (!Array.isArray(x.pestanas)) return 'faltan pestañas'
  if (x.codigo_barras && !String(x.codigo_barras.valor ?? '').startsWith(BASE_CLUB + '/')) return 'código de barras fuera del dominio del Club'
  if (x.canjear_url && !x.canjear_url.startsWith(BASE_CLUB + '/w/')) return 'canjear_url no es un token de pase'
  const txt = JSON.stringify(d)
  if (txt.includes('@') || /\+506/.test(txt)) return 'el pase no puede llevar datos de contacto'
  if (/\/p\/[0-9a-f]{64}/.test(txt)) return 'el pase no puede llevar el token del portal'
  return null
}

// ── Textos (ES por defecto, EN traducido) ─────────────────────────────────────────
type Txt = { es: string; en: string }
export interface LocalizedString {
  defaultValue: { language: 'es'; value: string }
  translatedValues: Array<{ language: 'en'; value: string }>
}
const loc = (t: Txt): LocalizedString => ({
  defaultValue: { language: 'es', value: t.es },
  translatedValues: [{ language: 'en', value: t.en }],
})
const num = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')
const numEn = (n: number) => (Math.round(n * 10) / 10).toString()

/** El beneficio viene de la base en español («10 % + 1 cortesía»): el inglés se arma con los mismos números. */
export function beneficioEn(es: string): string {
  return es
    .replace(/(\d+(?:[.,]\d+)?)\s?%/g, '$1%')
    .replace(/(\d+) cortesías/g, '$1 complimentary items')
    .replace(/1 cortesía/g, '1 complimentary item')
}

// ── Clase y objeto genéricos ─────────────────────────────────────────────────────
export interface DisenoPase {
  /** Color de fondo (hex). Lo aprueba Ismael (CONTRATO §7); por defecto, el negro del Club. */
  colorFondo: string
  /** URL pública del logo (https). Opcional mientras no esté el diseño. */
  logoUrl?: string | null
}
export const DISENO_POR_DEFECTO: DisenoPase = { colorFondo: '#0d0d0d', logoUrl: null }

export const idClase = (issuerId: string) => `${issuerId}.club-satori`
export const idObjeto = (issuerId: string, miembroId: string) => `${issuerId}.club-${miembroId}`

export function armarClase(issuerId: string) {
  if (!RE_ISSUER.test(issuerId)) throw new Error('issuerId no válido')
  return {
    id: idClase(issuerId),
    // Sin plantilla propia por ahora: Google arma el diseño estándar con los módulos del objeto.
    enableSmartTap: false,
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  }
}

export interface TextModule { id: string; header: string; body: string; localizedHeader: LocalizedString; localizedBody: LocalizedString }
export interface LinkUri { id: string; uri: string; description: string; localizedDescription: LocalizedString }

const modulo = (id: string, h: Txt, b: Txt): TextModule =>
  ({ id, header: h.es, body: b.es, localizedHeader: loc(h), localizedBody: loc(b) })
const link = (id: string, uri: string, d: Txt): LinkUri =>
  ({ id, uri, description: d.es, localizedDescription: loc(d) })

/**
 * El objeto del pase para una persona (contrato v1). Reglas (CONTRATO §1 y §2):
 *  · código de barras = `codigo_barras` (QR del socio si es socio; si no, QR de cupones). Sin código si no hay rol.
 *  · socio pendiente: aviso «Validá tu alta», sin beneficio ni cortesías.
 *  · anfitrión: créditos y personas; QR de cupones en el reverso si el código de barras es el del socio.
 *  · `estado = 'baja'` → el pase queda EXPIRED.
 */
export function armarObjeto(issuerId: string, d: PaseDatos, diseno: DisenoPase = DISENO_POR_DEFECTO) {
  const err = validarDatos(d)
  if (err) throw new Error(`Datos del pase no válidos: ${err}`)
  if (!RE_ISSUER.test(issuerId)) throw new Error('issuerId no válido')

  const textos: TextModule[] = []
  const links: LinkUri[] = []
  const soc = d.socio
  const anf = d.anfitrion

  if (soc && soc.estado === 'pendiente') {
    textos.push(modulo('socio', { es: 'Local Club', en: 'Local Club' },
      { es: 'Validá tu alta en tu próxima visita: mostrá este pase en caja.', en: 'Validate your sign-up on your next visit: show this pass at the register.' }))
  } else if (soc && soc.estado === 'activo') {
    const ben = soc.beneficio
    textos.push(modulo('socio', { es: 'Local Club', en: 'Local Club' },
      ben ? { es: ben, en: beneficioEn(ben) } : { es: 'Socio activo', en: 'Active member' }))
    const sorpresas = soc.cortesias.filter(c => c.sorpresa).reduce((s, c) => s + c.cantidad, 0)
    if (sorpresas > 0) {
      textos.push(modulo('cortesia', { es: 'Tu próxima visita', en: 'Your next visit' },
        { es: sorpresas === 1 ? '1 cortesía sorpresa' : `${sorpresas} cortesías sorpresa`,
          en: sorpresas === 1 ? '1 surprise treat' : `${sorpresas} surprise treats` }))
    }
  }

  if (anf && anf.activo) {
    textos.push(modulo('creditos', { es: 'Créditos', en: 'Credits' },
      { es: `${num(anf.creditos)} · ${anf.personas} ${anf.personas === 1 ? 'persona' : 'personas'}`,
        en: `${numEn(anf.creditos)} · ${anf.personas} ${anf.personas === 1 ? 'guest' : 'guests'}` }))
    textos.push(modulo('proximo', { es: 'Para el próximo medio crédito', en: 'To your next half credit' },
      { es: `${anf.personas_proximo_medio} ${anf.personas_proximo_medio === 1 ? 'persona' : 'personas'}`,
        en: `${anf.personas_proximo_medio} ${anf.personas_proximo_medio === 1 ? 'guest' : 'guests'}` }))
    if (d.canjear_url) {
      links.push(link('canjear', d.canjear_url, { es: 'Canjear créditos (código de 10 minutos)', en: 'Redeem credits (10-minute code)' }))
    }
    if (d.codigo_barras?.tipo === 'socio') {
      links.push(link('cupones', anf.qr_url, { es: 'Tus cupones para compartir', en: 'Your coupons to share' }))
    }
  }

  for (const p of d.promociones.slice(0, 3)) {
    textos.push(modulo(`promo-${p.id.slice(0, 8)}`, { es: p.nombre, en: p.nombre_en ?? p.nombre }, { es: p.beneficio, en: beneficioEn(p.beneficio) }))
  }

  const subtitulo: Txt = d.pestanas.includes('mi_club') && d.pestanas.includes('anfitrion')
    ? { es: 'Socio y anfitrión', en: 'Member and host' }
    : d.pestanas.includes('mi_club') ? { es: 'Socio del Local Club', en: 'Local Club member' }
    : d.pestanas.includes('anfitrion') ? { es: 'Anfitrión', en: 'Host' }
    : { es: 'Club Satori', en: 'Club Satori' }

  const objeto: Record<string, unknown> = {
    id: idObjeto(issuerId, d.miembro_id),
    classId: idClase(issuerId),
    state: d.estado === 'baja' ? 'EXPIRED' : 'ACTIVE',
    cardTitle: loc({ es: 'Club Satori', en: 'Club Satori' }),
    header: loc({ es: d.nombre_pila, en: d.nombre_pila }),
    subheader: loc(subtitulo),
    hexBackgroundColor: diseno.colorFondo,
    textModulesData: textos,
    linksModuleData: { uris: links },
  }
  if (diseno.logoUrl && diseno.logoUrl.startsWith('https://')) {
    objeto.logo = { sourceUri: { uri: diseno.logoUrl } }
  }
  if (d.codigo_barras && d.estado !== 'baja') {
    objeto.barcode = {
      type: 'QR_CODE',
      value: d.codigo_barras.valor,
      // texto bajo el QR: el código corto (lo que va después de /s/ o /r/), para tipearlo a mano en caja
      alternateText: d.codigo_barras.valor.split('/').pop() ?? '',
    }
  }
  const txt = JSON.stringify(objeto)
  if (txt.includes('@') || /\+506/.test(txt)) throw new Error('el objeto quedó con datos de contacto')
  return objeto
}

// ── JWT «Save to Google Wallet» (RS256 con WebCrypto) ────────────────────────────
export interface CuentaServicio { client_email: string; private_key: string }

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlTexto = (t: string) => b64url(new TextEncoder().encode(t))

/** PEM PKCS#8 («-----BEGIN PRIVATE KEY-----», el formato de las cuentas de servicio de Google) → CryptoKey. */
export async function importarClave(pem: string): Promise<CryptoKey> {
  const cuerpo = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  if (!cuerpo || /[^A-Za-z0-9+/=]/.test(cuerpo)) throw new Error('clave privada no válida (se espera PKCS#8 en PEM)')
  const der = Uint8Array.from(atob(cuerpo), c => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/** Lee el JSON de la cuenta de servicio (secreto del Edge) sin mostrar su contenido en los errores. */
export function leerCuentaServicio(json: string): CuentaServicio {
  let x: Partial<CuentaServicio>
  try { x = JSON.parse(json) } catch { throw new Error('GOOGLE_WALLET_SA_KEY no es JSON') }
  if (typeof x.client_email !== 'string' || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(x.client_email)) {
    throw new Error('GOOGLE_WALLET_SA_KEY: client_email no válido')
  }
  if (typeof x.private_key !== 'string' || !x.private_key.includes('PRIVATE KEY')) throw new Error('GOOGLE_WALLET_SA_KEY: falta private_key')
  return { client_email: x.client_email, private_key: x.private_key }
}

/**
 * JWT firmado para «Save to Google Wallet». Lleva la clase y el objeto completos (Google los crea o actualiza al
 * guardar). `origins`: los dominios desde los que se muestra el botón.
 */
export async function firmarJwt(sa: CuentaServicio, clase: object, objeto: object, origins: string[], ahora = new Date()): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(ahora.getTime() / 1000),
    origins,
    payload: { genericClasses: [clase], genericObjects: [objeto] },
  }
  const entrada = `${b64urlTexto(JSON.stringify(header))}.${b64urlTexto(JSON.stringify(claims))}`
  const clave = await importarClave(sa.private_key)
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(entrada)))
  return `${entrada}.${b64url(firma)}`
}

/**
 * Google recomienda que el JWT no pase de ~1.800 caracteres (el completo, con clase y objeto, ronda los 3 KB). El
 * «JWT flaco» lleva solo `{ id, classId }` del objeto: sirve cuando el objeto YA existe en Google (lo crea o
 * actualiza la sincronización por la API REST, B3). Hasta B3 se usa el completo.
 */
export const LARGO_JWT_RECOMENDADO = 1800
export function objetoFlaco(objeto: { id?: unknown; classId?: unknown }) {
  if (typeof objeto.id !== 'string' || typeof objeto.classId !== 'string') throw new Error('objeto sin id o classId')
  return { id: objeto.id, classId: objeto.classId }
}
export async function firmarJwtFlaco(sa: CuentaServicio, objeto: { id?: unknown; classId?: unknown }, origins: string[], ahora = new Date()): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = { iss: sa.client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(ahora.getTime() / 1000), origins,
                   payload: { genericObjects: [objetoFlaco(objeto)] } }
  const entrada = `${b64urlTexto(JSON.stringify(header))}.${b64urlTexto(JSON.stringify(claims))}`
  const clave = await importarClave(sa.private_key)
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(entrada)))
  return `${entrada}.${b64url(firma)}`
}

export const urlGuardar = (jwt: string) => `https://pay.google.com/gp/v/save/${jwt}`
