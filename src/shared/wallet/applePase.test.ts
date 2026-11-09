// B4 · pase de Apple (APAGADO). Certificado y clave FALSOS generados en memoria; nada real.
// La firma y el zip se verifican con herramientas independientes (openssl cms y zipfile de Python) cuando están.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { armarPassJson, armarPkpass, firmarManifest, tokenWebService, zipSinComprimir, crc32, seq, setDe, tlv, oid, entero, emisorYSerie,
         type ConfigApple } from './applePase'
import { configurarBaseClub, type PaseDatos } from './googlePase'
configurarBaseClub('https://club.ejemplo.test')

const A = '00000000-0000-4000-8000-0000000000aa'
const CFG: ConfigApple = { passTypeIdentifier: 'pass.test.ejemplo.club', teamIdentifier: 'ABCDE12345', webServiceURL: 'https://club.ejemplo.test/apple' }
const datos = (over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1, miembro_id: A, version: 9, actualizado_en: '2026-11-08T08:00:00Z', nombre_pila: 'Cami', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: 'https://club.ejemplo.test/r/ABCD2345' }, socio: null,
  anfitrion: { activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
               personas: 12, creditos: 2, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 6, creditos_ganados_mes: 1 },
  promociones: [], canjear_url: 'https://club.ejemplo.test/w/tokenpase0123456789', ...over,
})

type Campo = { key: string; value: string }
type Pase = { storeCard: Record<string, Campo[]>; barcodes?: unknown[]; voided?: boolean } & Record<string, unknown>
const pem = (der: Uint8Array, tipo: string) => `-----BEGIN ${tipo}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${tipo}-----\n`
async function certFalso(cn: string) {
  const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey))
  const nombre = seq(setDe(seq(oid('2.5.4.3'), tlv(0x0c, new TextEncoder().encode(cn)))))
  const alg = seq(oid('1.2.840.113549.1.1.11'), Uint8Array.of(0x05, 0x00))
  const t = (s: string) => tlv(0x17, new TextEncoder().encode(s))
  const tbs = seq(tlv(0xa0, entero(2)), entero(4242), alg, nombre, seq(t('261101000000Z'), t('361101000000Z')), nombre, spki)
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, tbs))
  const cert = seq(tbs, alg, tlv(0x03, Uint8Array.of(0), firma))
  return { cert: pem(cert, 'CERTIFICATE'), clave: pem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey)), 'PRIVATE KEY'), der: cert }
}
const hay = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0 || spawnSync(cmd, ['version'], { encoding: 'utf8' }).status === 0

const verificados: string[] = []
let firmante: Awaited<ReturnType<typeof certFalso>>
let wwdr: Awaited<ReturnType<typeof certFalso>>
beforeAll(async () => { firmante = await certFalso('Pass Type ID FALSO'); wwdr = await certFalso('WWDR FALSO') })

describe('B4 · pass.json (mismo contrato y textos que Google)', () => {
  it('anfitrión: créditos en colones, referidos del mes, QR de cupones y web service con su token', async () => {
    const tok = await tokenWebService('x'.repeat(40), A)
    const p = armarPassJson(datos(), CFG, tok) as Pase
    expect(p).toMatchObject({ formatVersion: 1, serialNumber: A, passTypeIdentifier: CFG.passTypeIdentifier, teamIdentifier: CFG.teamIdentifier,
                              backgroundColor: 'rgb(13, 13, 13)', webServiceURL: CFG.webServiceURL, authenticationToken: tok })
    expect(p.storeCard.primaryFields[0]).toMatchObject({ key: 'creditos', value: '₡36.000 disponibles' })
    expect(p.storeCard.secondaryFields).toContainEqual(expect.objectContaining({ value: '6 personas referidas este mes' }))
    expect(p.barcodes[0]).toEqual({ format: 'PKBarcodeFormatQR', message: 'https://club.ejemplo.test/r/ABCD2345', messageEncoding: 'iso-8859-1', altText: 'ABCD2345' })
    expect(tok).toMatch(/^[0-9a-f]{64}$/)
    expect(await tokenWebService('x'.repeat(40), A)).toBe(tok)                 // estable
    expect(await tokenWebService('y'.repeat(40), A)).not.toBe(tok)              // depende del secreto
  })
  it('socio activo: «Vale en todos los Satori» (genérico, no la promo de un local); pendiente: «Validá tu alta»', () => {
    const socio = { estado: 'activo' as const, desde: '2026-10-01', qr_url: 'https://club.ejemplo.test/s/SOCIO123', beneficio: null, visitas_mes: 1, cortesias: [] }
    const p = armarPassJson(datos({ pestanas: ['mi_club'], anfitrion: null, socio, codigo_barras: { tipo: 'socio', valor: socio.qr_url } }), { ...CFG, webServiceURL: null }, null) as Pase
    expect(p.storeCard.secondaryFields).toContainEqual(expect.objectContaining({ value: 'Vale en todos los Satori' }))
    expect(JSON.stringify(p)).not.toMatch(/Local Prueba|local-prueba/)        // el pase no depende del local
    const pend = armarPassJson(datos({ pestanas: ['mi_club'], anfitrion: null, socio: { ...socio, estado: 'pendiente' } }), { ...CFG, webServiceURL: null }, null) as Pase
    expect(pend.storeCard.secondaryFields[0].value).toMatch(/^Validá tu alta/)
  })
  it('baja: voided y sin código; sin teléfono ni email; datos y configuración no válidos se rechazan', () => {
    const p = armarPassJson(datos({ estado: 'baja' }), { ...CFG, webServiceURL: null }, null) as Pase
    expect(p.voided).toBe(true)
    expect(p.barcodes).toBeUndefined()
    expect(() => armarPassJson(datos({ nombre_pila: 'a@b.c' }), { ...CFG, webServiceURL: null }, null)).toThrow()
    expect(() => armarPassJson(datos(), { ...CFG, teamIdentifier: 'corto' }, 'x'.repeat(64))).toThrow('teamIdentifier')
    expect(() => armarPassJson(datos(), CFG, null)).toThrow('token del web service')
    expect(() => armarPassJson(datos(), { ...CFG, webServiceURL: 'http://inseguro.test' }, 'x'.repeat(64))).toThrow('https')
  })
})

describe('B4 · firma PKCS#7 y .pkpass (certificado FALSO)', () => {
  it('emisor y serie salen del certificado', () => {
    const { serie } = emisorYSerie(firmante.der)
    expect([...serie]).toEqual([0x02, 0x02, 0x10, 0x92])                         // INTEGER 4242
  })
  it('la firma del manifest la verifica openssl cms (detached, sha256, con el firmante y el WWDR)', async () => {
    if (!hay('openssl')) return
    const manifest = new TextEncoder().encode(JSON.stringify({ 'pass.json': 'abc' }))
    const sig = await firmarManifest(manifest, firmante.cert, firmante.clave, wwdr.cert)
    const d = mkdtempSync(join(tmpdir(), 'pkpass-'))
    try {
      writeFileSync(join(d, 'manifest.json'), manifest); writeFileSync(join(d, 'signature'), sig)
      const r = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(d, 'signature'), '-content', join(d, 'manifest.json'), '-noverify', '-out', join(d, 'out')], { encoding: 'utf8' })
      expect(r.stderr).toContain('Verification successful'); verificados.push('openssl')
      writeFileSync(join(d, 'manifest.json'), new TextEncoder().encode(JSON.stringify({ 'pass.json': 'otro' })))   // manifest alterado
      const r2 = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(d, 'signature'), '-content', join(d, 'manifest.json'), '-noverify', '-out', join(d, 'out')], { encoding: 'utf8' })
      expect(r2.status).not.toBe(0)
      const certs = execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', join(d, 'signature'), '-print_certs', '-noout'], { encoding: 'utf8' })
      expect(certs).toContain('Pass Type ID FALSO'); expect(certs).toContain('WWDR FALSO')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  it('el .pkpass es un zip válido con pass.json, imágenes, manifest (sha1 de cada archivo) y signature', async () => {
    const icono = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3)              // bytes ficticios (no hace falta un PNG real)
    const p = armarPassJson(datos(), { ...CFG, webServiceURL: null }, null)
    const zip = await armarPkpass(p, { 'icon.png': icono, 'logo.png': icono }, { cert: firmante.cert, clave: firmante.clave, wwdr: wwdr.cert })
    if (!hay('python3')) return
    const d = mkdtempSync(join(tmpdir(), 'pkpass-'))
    try {
      writeFileSync(join(d, 'p.pkpass'), zip)
      const py = `import zipfile,hashlib,json,sys\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None\nm=json.loads(z.read('manifest.json'))\n` +
        `print(sorted(z.namelist()));print(all(hashlib.sha1(z.read(k)).hexdigest()==v for k,v in m.items()));print(sorted(m))`
      const out = execFileSync('python3', ['-I', '-c', py, join(d, 'p.pkpass')], { encoding: 'utf8' }).trim().split('\n')
      expect(out[0]).toBe("['icon.png', 'logo.png', 'manifest.json', 'pass.json', 'signature']")
      expect(out[1]).toBe('True'); verificados.push('python3')
      expect(out[2]).toBe("['icon.png', 'logo.png', 'pass.json']")
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  it('sin icon.png o con una imagen no prevista, no arma nada', async () => {
    const p = armarPassJson(datos(), { ...CFG, webServiceURL: null }, null)
    const f = { cert: firmante.cert, clave: firmante.clave, wwdr: wwdr.cert }
    await expect(armarPkpass(p, {}, f)).rejects.toThrow('icon.png')
    await expect(armarPkpass(p, { 'icon.png': Uint8Array.of(1), '../x.png': Uint8Array.of(1) }, f)).rejects.toThrow('imagen no prevista')
  })
  it('donde están openssl y python3, las verificaciones independientes corrieron de verdad', () => {
    if (hay('openssl')) expect(verificados).toContain('openssl')
    if (hay('python3')) expect(verificados).toContain('python3')
  })
  it('zip y crc32 con valores conocidos', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const z = zipSinComprimir([['a.txt', new TextEncoder().encode('hola')]])
    expect([...z.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})
