/**
 * B4 · Pase de Apple Wallet del Club Satori, APAGADO. Módulo PURO (Edge `club-pase` en Deno y vitest en Node), solo con
 * WebCrypto: sin librerías, sin red y sin secretos propios (el certificado y su clave los recibe).
 *
 * Qué arma:
 *  · `pass.json` con el MISMO contrato que el de Google (`club_pase_datos`, docs/club-satori/CONTRATO-pase.md): los mismos
 *    textos (créditos en colones, referidos del mes, «Vale en todos los Satori»), el mismo QR, y la baja como `voided`.
 *    Nunca teléfono, email ni el token del portal.
 *  · `manifest.json` (sha1 de cada archivo), su firma PKCS#7 «detached» en DER (SignedData con los atributos que pide
 *    Apple: contentType, messageDigest y signingTime; certificado del Pass Type ID y el intermedio WWDR), y el
 *    `.pkpass` (zip sin comprimir).
 *
 * Apagado (CONTRATO §6): el Edge no ofrece Apple mientras `club_config.wallet_apple_activo` esté en false o falten el
 * certificado y su clave (el dueño los carga cuando haya cuenta de Apple Developer). Este módulo no lee ningún flag:
 * solo arma. Las pruebas usan un certificado FALSO generado en memoria y verifican la firma con `openssl cms`.
 */
import { colones, validarDatos, type PaseDatos } from './googlePase.ts'

export interface ConfigApple {
  passTypeIdentifier: string          // pass.<dominio invertido>.club
  teamIdentifier: string              // 10 caracteres de Apple
  webServiceURL: string | null        // https://…/club-pase/apple (el web service de actualización); null = sin updates
  colorFondo?: string                 // #0d0d0d (diseño v4)
}
const RE_PASS_TYPE = /^pass\.[a-z0-9-]+(\.[a-z0-9-]+)+$/i
const RE_TEAM = /^[A-Z0-9]{10}$/

const rgb = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error('color no válido')
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`
}

/** Token del web service de Apple para un pase: HMAC-SHA256(secreto, miembro) en hex. No sale de la base ni del portal. */
export async function tokenWebService(secreto: string, miembroId: string): Promise<string> {
  if (secreto.length < 32) throw new Error('el secreto del web service de Apple tiene que tener 32 o más')
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const f = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`apple-ws:${miembroId}`)))
  return [...f].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** El `pass.json` (storeCard). Mismos datos y textos que el objeto de Google. */
export function armarPassJson(d: PaseDatos, cfg: ConfigApple, tokenWs: string | null): Record<string, unknown> {
  const err = validarDatos(d)
  if (err) throw new Error(`Datos del pase no válidos: ${err}`)
  if (!RE_PASS_TYPE.test(cfg.passTypeIdentifier)) throw new Error('passTypeIdentifier no válido')
  if (!RE_TEAM.test(cfg.teamIdentifier)) throw new Error('teamIdentifier no válido')
  const soc = d.socio
  const anf = d.anfitrion
  const primarios: Array<Record<string, unknown>> = []
  const secundarios: Array<Record<string, unknown>> = []
  const reverso: Array<Record<string, unknown>> = []
  if (soc && soc.estado === 'pendiente') {
    secundarios.push({ key: 'socio', label: 'Local Club', value: 'Valide su alta en su próxima visita' })
  } else if (soc && soc.estado === 'activo') {
    secundarios.push({ key: 'socio', label: 'Local Club', value: 'Vale en todos los Satori' })
    const sorpresas = soc.cortesias.filter(c => c.sorpresa).reduce((s, c) => s + c.cantidad, 0)
    if (sorpresas > 0) secundarios.push({ key: 'cortesia', label: 'Su próxima visita', value: sorpresas === 1 ? '1 cortesía sorpresa' : `${sorpresas} cortesías sorpresa` })
  }
  if (anf && anf.activo) {
    primarios.push({ key: 'creditos', label: 'Créditos', value: `${colones(anf.creditos * anf.valor_credito_crc, '.')} disponibles` })
    if (anf.referidos_mes > 0) {
      secundarios.push({ key: 'referidos', label: 'Referidos',
                         value: `${anf.referidos_mes} ${anf.referidos_mes === 1 ? 'persona referida' : 'personas referidas'} este mes` })
    }
    reverso.push({ key: 'proximo', label: 'Para el próximo medio crédito',
                   value: `${anf.personas_proximo_medio} ${anf.personas_proximo_medio === 1 ? 'persona' : 'personas'}` })
    if (d.canjear_url) reverso.push({ key: 'canjear', label: 'Canjear créditos (código de 10 minutos)', value: d.canjear_url })
    if (d.codigo_barras?.tipo === 'socio') reverso.push({ key: 'cupones', label: 'Sus cupones para compartir', value: anf.qr_url })
  }
  const subtitulo = d.pestanas.includes('mi_club') && d.pestanas.includes('anfitrion') ? 'Socio y anfitrión'
    : d.pestanas.includes('mi_club') ? 'Socio del Local Club' : d.pestanas.includes('anfitrion') ? 'Anfitrión' : 'Club Satori'
  const pase: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeIdentifier,
    teamIdentifier: cfg.teamIdentifier,
    serialNumber: d.miembro_id,
    organizationName: 'Satori',
    description: 'Club Satori',
    logoText: 'Club Satori',
    backgroundColor: rgb(cfg.colorFondo ?? '#0d0d0d'),
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(200, 200, 200)',
    storeCard: { headerFields: [{ key: 'nombre', label: subtitulo, value: d.nombre_pila }],
                 primaryFields: primarios, secondaryFields: secundarios, backFields: reverso },
  }
  if (d.estado === 'baja') pase.voided = true
  if (d.codigo_barras && d.estado !== 'baja') {
    const corto = d.codigo_barras.valor.split('/').pop() ?? ''
    pase.barcodes = [{ format: 'PKBarcodeFormatQR', message: d.codigo_barras.valor, messageEncoding: 'iso-8859-1', altText: corto }]
  }
  if (cfg.webServiceURL) {
    if (!/^https:\/\//.test(cfg.webServiceURL)) throw new Error('webServiceURL tiene que ser https')
    if (!tokenWs || tokenWs.length < 16) throw new Error('falta el token del web service')
    pase.webServiceURL = cfg.webServiceURL
    pase.authenticationToken = tokenWs
  }
  const txt = JSON.stringify(pase)
  if (txt.includes('@') || /\+506/.test(txt)) throw new Error('el pase quedó con datos de contacto')
  return pase
}

// ── DER mínimo (lo justo para PKCS#7 SignedData) ──────────────────────────────────────────────────────────────────
const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length } return o }
const largo = (n: number) => {
  if (n < 128) return Uint8Array.of(n)
  const b: number[] = []
  for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x & 0xff)
  return Uint8Array.of(0x80 | b.length, ...b)
}
export const tlv = (tag: number, ...c: Uint8Array[]) => { const v = cat(...c); return cat(Uint8Array.of(tag), largo(v.length), v) }
export const seq = (...c: Uint8Array[]) => tlv(0x30, ...c)
const cmp = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length }
export const setDe = (...c: Uint8Array[]) => tlv(0x31, ...[...c].sort(cmp))   // DER: SET OF ordenado
export function oid(s: string) {
  const p = s.split('.').map(Number)
  const out = [40 * p[0] + p[1]]
  for (const n of p.slice(2)) {
    const b = [n & 0x7f]
    for (let x = Math.floor(n / 128); x > 0; x = Math.floor(x / 128)) b.unshift(0x80 | (x & 0x7f))
    out.push(...b)
  }
  return tlv(0x06, Uint8Array.from(out))
}
export const entero = (n: number | Uint8Array) => {
  let b = typeof n === 'number' ? Uint8Array.from(n === 0 ? [0] : (() => { const r: number[] = []; for (let x = n; x > 0; x = Math.floor(x / 256)) r.unshift(x & 0xff); return r })()) : n
  if (b[0] & 0x80) b = cat(Uint8Array.of(0), b)
  return tlv(0x02, b)
}
const NULO = Uint8Array.of(0x05, 0x00)
const octetos = (b: Uint8Array) => tlv(0x04, b)
const utc = (d: Date) => tlv(0x17, new TextEncoder().encode(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))

/** Lee un elemento DER: devuelve el TLV entero, el contenido y dónde sigue. */
export function leerDer(b: Uint8Array, i = 0) {
  const tag = b[i]
  let n = b[i + 1], h = 2
  if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j++) n = n * 256 + b[i + 2 + j]; h = 2 + k }
  return { tag, todo: b.subarray(i, i + h + n), contenido: b.subarray(i + h, i + h + n), siguiente: i + h + n }
}
/** Emisor (Name) y número de serie de un certificado X.509 en DER (para IssuerAndSerialNumber). */
export function emisorYSerie(certDer: Uint8Array) {
  const cert = leerDer(certDer)
  const tbs = leerDer(cert.contenido)
  let i = 0
  let e = leerDer(tbs.contenido, i)
  if (e.tag === 0xa0) { i = e.siguiente; e = leerDer(tbs.contenido, i) }          // [0] version
  const serie = e; i = serie.siguiente
  const algo = leerDer(tbs.contenido, i); i = algo.siguiente
  const emisor = leerDer(tbs.contenido, i)
  if (serie.tag !== 0x02 || emisor.tag !== 0x30) throw new Error('certificado no válido')
  return { emisor: emisor.todo, serie: serie.todo }
}
export function pemADer(pem: string, tipo: 'CERTIFICATE' | 'PRIVATE KEY'): Uint8Array {
  const m = new RegExp(`-----BEGIN ${tipo}-----([\\s\\S]*?)-----END ${tipo}-----`).exec(pem)
  if (!m) throw new Error(`no hay ${tipo} en el PEM`)
  const c = m[1].replace(/\s+/g, '')
  if (/[^A-Za-z0-9+/=]/.test(c)) throw new Error('PEM no válido')
  return Uint8Array.from(atob(c), x => x.charCodeAt(0))
}

const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', sha256: '2.16.840.1.101.3.4.2.1',
  rsa: '1.2.840.113549.1.1.1', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
}

/** Firma PKCS#7 «detached» del manifest (lo que Apple llama `signature`). */
export async function firmarManifest(manifest: Uint8Array, certPem: string, clavePem: string, wwdrPem: string, ahora = new Date()): Promise<Uint8Array> {
  const cert = pemADer(certPem, 'CERTIFICATE')
  const wwdr = pemADer(wwdrPem, 'CERTIFICATE')
  const clave = await crypto.subtle.importKey('pkcs8', new Uint8Array(pemADer(clavePem, 'PRIVATE KEY')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(manifest)))
  const atributos = [
    seq(oid(OID.contentType), setDe(oid(OID.data))),
    seq(oid(OID.signingTime), setDe(utc(ahora))),
    seq(oid(OID.messageDigest), setDe(octetos(resumen))),
  ]
  const firmados = setDe(...atributos)                                  // lo que se firma: el SET (tag 0x31)
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new Uint8Array(firmados)))
  const { emisor, serie } = emisorYSerie(cert)
  const signerInfo = seq(entero(1), seq(emisor, serie), seq(oid(OID.sha256), NULO),
    cat(Uint8Array.of(0xa0), firmados.subarray(1)),                    // [0] IMPLICIT: el mismo contenido, otro tag
    seq(oid(OID.rsa), NULO), octetos(firma))
  const signedData = seq(entero(1), setDe(seq(oid(OID.sha256), NULO)), seq(oid(OID.data)),
    tlv(0xa0, cert, wwdr), setDe(signerInfo))
  return seq(oid(OID.signedData), tlv(0xa0, signedData))
}

// ── zip sin comprimir (lo que es un .pkpass) ──────────────────────────────────────────────────────────────────────
const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const u16 = (n: number) => Uint8Array.of(n & 0xff, (n >>> 8) & 0xff)
const u32 = (n: number) => Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff)
export function zipSinComprimir(archivos: Array<[string, Uint8Array]>): Uint8Array {
  const locales: Uint8Array[] = [], centrales: Uint8Array[] = []
  let off = 0
  for (const [nombre, datos] of archivos) {
    const n = new TextEncoder().encode(nombre), c = crc32(datos)
    const comun = cat(u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(c), u32(datos.length), u32(datos.length), u16(n.length), u16(0))
    const local = cat(u32(0x04034b50), comun, n, datos)
    centrales.push(cat(u32(0x02014b50), u16(20), comun, u16(0), u16(0), u16(0), u32(0), u32(off), n))
    locales.push(local); off += local.length
  }
  const cd = cat(...centrales)
  return cat(...locales, cd, u32(0x06054b50), u16(0), u16(0), u16(archivos.length), u16(archivos.length), u32(cd.length), u32(off), u16(0))
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

/** El `.pkpass`: pass.json + imágenes + manifest.json (sha1 de cada uno) + signature (PKCS#7 del manifest). */
export async function armarPkpass(pase: Record<string, unknown>, imagenes: Record<string, Uint8Array>,
                                  firma: { cert: string; clave: string; wwdr: string }, ahora = new Date()): Promise<Uint8Array> {
  if (!imagenes['icon.png']) throw new Error('Apple exige icon.png')
  for (const n of Object.keys(imagenes)) if (!/^(icon|logo|strip|thumbnail)(@[23]x)?\.png$/.test(n)) throw new Error(`imagen no prevista: ${n}`)
  const archivos: Array<[string, Uint8Array]> = [['pass.json', new TextEncoder().encode(JSON.stringify(pase))],
    ...Object.entries(imagenes).sort(([a], [b]) => (a < b ? -1 : 1))]
  const manifest: Record<string, string> = {}
  for (const [n, b] of archivos) manifest[n] = hex(await crypto.subtle.digest('SHA-1', new Uint8Array(b)))
  const m = new TextEncoder().encode(JSON.stringify(manifest))
  return zipSinComprimir([...archivos, ['manifest.json', m], ['signature', await firmarManifest(m, firma.cert, firma.clave, firma.wwdr, ahora)]])
}
