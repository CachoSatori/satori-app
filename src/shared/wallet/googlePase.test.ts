// B1: pase de Google Wallet. La clave de la cuenta de servicio es FALSA: se genera en memoria en cada corrida
// (nunca hay una clave escrita en el repo, ni de prueba).
import { describe, it, expect, beforeAll } from 'vitest'
import {
  armarClase, armarObjeto, fechaCR, sinRolVigente, colones, disenoPropuesto, configurarBaseClub, firmarJwt, firmarJwtFlaco, LARGO_JWT_RECOMENDADO, urlGuardar, validarDatos, leerCuentaServicio, beneficioEn, idObjeto,
  type PaseDatos, type CuentaServicio,
} from './googlePase'
configurarBaseClub('https://club.ejemplo.test')   // (08-nov noche) el dominio es configuración

const ISSUER = '3388000000012345678'
const TOKEN_PASE = 'a'.repeat(64)

// Datos ficticios con la forma exacta del contrato v1 (CONTRATO-pase.md §2).
const base = (over: Partial<PaseDatos> = {}): PaseDatos => ({
  contrato: 1,
  miembro_id: '00000000-0000-4000-8000-00000000c0de',
  version: 418,
  actualizado_en: '2026-11-07T19:30:00Z',
  nombre_pila: 'Ana',
  estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' },
  pestanas: ['mi_club', 'anfitrion'],
  codigo_barras: { tipo: 'socio', valor: 'https://club.ejemplo.test/s/ABCD2345K' },
  socio: {
    estado: 'activo', desde: '2026-11-10', qr_url: 'https://club.ejemplo.test/s/ABCD2345K',
    beneficio: '10 % + 1 cortesía', visitas_mes: 3,
    cortesias: [{ sorpresa: true, cantidad: 1, motivo: 'promo', vence_en: null }],
  },
  anfitrion: {
    activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
    personas: 14, creditos: 2, personas_proximo_medio: 1, valor_credito_crc: 18000, referidos_mes: 9, creditos_ganados_mes: 1.5,
  },
  promociones: [{ id: '8f0e0000-0000-4000-8000-000000000001', nombre: 'Local Club', nombre_en: null, beneficio: '10 % + 1 cortesía',
                  para: ['socio'], vigente_hasta: null, dias: [1, 2, 3, 4, 5, 6, 7], horario: null }],
  canjear_url: `https://club.ejemplo.test/w/${TOKEN_PASE}`,
  ...over,
})

let sa: CuentaServicio
let publica: CryptoKey
beforeAll(async () => {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  sa = { client_email: 'pase-prueba@proyecto-falso.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` }
  publica = par.publicKey
})

// Lo que las pruebas leen del objeto del pase.
interface ObjetoPrueba {
  id: string; classId: string; state: string
  barcode?: { type: string; value: string; alternateText: string }
  linksModuleData: { uris: Array<{ id: string; uri: string }> }
  textModulesData: Array<{ id: string; body: string; localizedBody: { translatedValues: Array<{ language: string; value: string }> } }>
  subheader: { defaultValue: { value: string } }
}
const obj = (o: object) => o as unknown as ObjetoPrueba

const decodificar = (parte: string) => JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))

describe('validarDatos (contrato v1)', () => {
  it('acepta el ejemplo del contrato', () => expect(validarDatos(base())).toBeNull())
  it('rechaza otro contrato, contactos, el token del portal y URLs fuera del dominio', () => {
    expect(validarDatos({ ...base(), contrato: 2 })).toMatch(/contrato/)
    expect(validarDatos(base({ nombre_pila: 'ana@ejemplo.com' }))).toMatch(/contacto/)
    expect(validarDatos(base({ nombre_pila: '+50688887777' }))).toMatch(/contacto/)
    expect(validarDatos(base({ canjear_url: `https://club.ejemplo.test/p/${'b'.repeat(64)}` }))).toMatch(/token de pase/)
    expect(validarDatos(base({ codigo_barras: { tipo: 'socio', valor: 'https://otro.ejemplo/s/X' } }))).toMatch(/dominio/)
  })
})

describe('armarObjeto', () => {
  it('socio y anfitrión: QR del socio como código de barras, cupones y Canjear en el reverso, créditos y cortesía', () => {
    const o = obj(armarObjeto(ISSUER, base()))
    expect(o.id).toBe(idObjeto(ISSUER, '00000000-0000-4000-8000-00000000c0de'))
    expect(o.classId).toBe(`${ISSUER}.club-satori`)
    expect(o.state).toBe('ACTIVE')
    expect(o.barcode).toEqual({ type: 'QR_CODE', value: 'https://club.ejemplo.test/s/ABCD2345K', alternateText: 'ABCD2345K' })
    expect(o.linksModuleData.uris.map((u) => u.id)).toEqual(['canjear', 'cupones'])
    expect(o.linksModuleData.uris[0].uri).toBe(`https://club.ejemplo.test/w/${TOKEN_PASE}`)
    const ids = o.textModulesData.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['socio', 'cortesia', 'creditos', 'proximo']))
    const cort = o.textModulesData.find((t) => t.id === 'cortesia')
    expect(cort?.body).toBe('1 cortesía sorpresa')
    expect(cort?.localizedBody.translatedValues[0]).toEqual({ language: 'en', value: '1 surprise treat' })
    expect(o.subheader.defaultValue.value).toBe('Socio y anfitrión')
  })

  it('(10-nov, el dueño) el nombre visible del pase es «Satori», en los dos idiomas', () => {
    const o = obj(armarObjeto(ISSUER, base())) as unknown as { cardTitle: { defaultValue: { value: string }; translatedValues: Array<{ value: string }> } }
    expect(o.cardTitle.defaultValue.value).toBe('Satori')
    expect(o.cardTitle.translatedValues[0].value).toBe('Satori')
  })

  it('créditos claros (el dueño, 08-nov): el saldo en colones y las personas del mes en otra línea, ES/EN', () => {
    const o = obj(armarObjeto(ISSUER, base()))
    const cred = o.textModulesData.find((t) => t.id === 'creditos')
    expect(cred?.body).toBe('₡36.000 disponibles')
    expect(cred?.localizedBody.translatedValues[0]).toEqual({ language: 'en', value: '₡36,000 available' })
    const ref = o.textModulesData.find((t) => t.id === 'referidos')
    expect(ref?.body).toBe('9 personas referidas este mes')
    expect(ref?.localizedBody.translatedValues[0]).toEqual({ language: 'en', value: '9 guests referred this month' })
    expect(o.textModulesData.some((t) => / · \d+ personas/.test(t.body))).toBe(false)
    // medio crédito y una sola persona; sin referidos en el mes no hay línea
    const b = base()
    const uno = obj(armarObjeto(ISSUER, { ...b, anfitrion: { ...b.anfitrion!, creditos: 0.5, referidos_mes: 1 } }))
    expect(uno.textModulesData.find((t) => t.id === 'creditos')?.body).toBe('₡9.000 disponibles')
    expect(uno.textModulesData.find((t) => t.id === 'referidos')?.body).toBe('1 persona referida este mes')
    const cero = obj(armarObjeto(ISSUER, { ...b, anfitrion: { ...b.anfitrion!, creditos: 0, referidos_mes: 0 } }))
    expect(cero.textModulesData.find((t) => t.id === 'creditos')?.body).toBe('₡0 disponibles')
    expect(cero.textModulesData.some((t) => t.id === 'referidos')).toBe(false)
  })

  it('colones: miles con separador fijo', () => {
    expect(colones(1234567, '.')).toBe('₡1.234.567')
    expect(colones(999, ',')).toBe('₡999')
    expect(colones(18000.4, ',')).toBe('₡18,000')
  })

  it('Club compartido: el socio ve «Vale en todos los Satori» (ES/EN) y el pase no lista promociones', () => {
    const o = obj(armarObjeto(ISSUER, base()))
    const soc = o.textModulesData.find((t) => t.id === 'socio')
    expect(soc?.body).toBe('Vale en todos los Satori')
    expect(soc?.localizedBody.translatedValues[0]).toEqual({ language: 'en', value: 'Valid at every Satori' })
    expect(o.textModulesData.some((t) => t.id.startsWith('promo-'))).toBe(false)
  })

  it('solo anfitrión: el código de barras es el QR de cupones y no se repite como link', () => {
    const o = obj(armarObjeto(ISSUER, base({
      pestanas: ['anfitrion'], socio: null,
      codigo_barras: { tipo: 'cupones', valor: 'https://club.ejemplo.test/r/ABCD2345' },
    })))
    expect(o.barcode?.value).toBe('https://club.ejemplo.test/r/ABCD2345')
    expect(o.linksModuleData.uris.map((u) => u.id)).toEqual(['canjear'])
    expect(o.subheader.defaultValue.value).toBe('Anfitrión')
  })

  it('socio pendiente: aviso de validar, sin beneficio ni cortesías', () => {
    const o = obj(armarObjeto(ISSUER, base({
      pestanas: ['mi_club'], anfitrion: null, canjear_url: null, promociones: [],
      socio: { estado: 'pendiente', desde: '2026-11-10', qr_url: 'https://club.ejemplo.test/s/ABCD2345K', beneficio: null, visitas_mes: 0, cortesias: [] },
    })))
    expect(o.textModulesData.map((t) => t.id)).toEqual(['socio', 'actualizado'])
    expect(o.textModulesData[0].body).toMatch(/^Valide su alta/)
    expect(o.linksModuleData.uris).toEqual([])
  })

  it('(12-nov) la fecha y la hora de Costa Rica de los datos: «Créditos al …» o una línea «Actualizado»', () => {
    // actualizado_en 2026-11-07T19:30:00Z = 7-nov 13:30 en Costa Rica (UTC−6)
    const o = obj(armarObjeto(ISSUER, base())) as unknown as { textModulesData: Array<{ id: string; header: string; localizedHeader: { translatedValues: Array<{ value: string }> } }> }
    const cred = o.textModulesData.find((t) => t.id === 'creditos')
    expect(cred?.header).toBe('Créditos al 7-nov 13:30')
    expect(cred?.localizedHeader.translatedValues[0].value).toBe('Credits as of Nov 7, 13:30')
    expect(o.textModulesData.some((t) => t.id === 'actualizado')).toBe(false)   // con créditos, la fecha va en ese encabezado
    const soloSocio = obj(armarObjeto(ISSUER, base({ pestanas: ['mi_club'], anfitrion: null, canjear_url: null })))
    expect(soloSocio.textModulesData.find((t) => t.id === 'actualizado')?.body).toBe('7-nov 13:30')
    const sinFecha = obj(armarObjeto(ISSUER, base({ actualizado_en: 'no-es-fecha' }))) as unknown as { textModulesData: Array<{ id: string; header: string }> }
    expect(sinFecha.textModulesData.find((t) => t.id === 'creditos')?.header).toBe('Créditos')
  })

  it('(12-nov) fechaCR: UTC−6 fijo, cruza el día y el año; sin fecha válida, null', () => {
    expect(fechaCR('2026-11-12T19:20:00Z')).toEqual({ es: '12-nov 13:20', en: 'Nov 12, 13:20' })
    expect(fechaCR('2026-11-13T03:05:00Z')).toEqual({ es: '12-nov 21:05', en: 'Nov 12, 21:05' })
    expect(fechaCR('2027-01-01T05:59:00Z')).toEqual({ es: '31-dic 23:59', en: 'Dec 31, 23:59' })
    expect(fechaCR('2026-09-01T12:00:00Z')?.es).toBe('1-set 06:00')
    expect(fechaCR(null)).toBeNull()
    expect(fechaCR('')).toBeNull()
  })

  it('(12-nov) sin ningún rol vigente el pase queda EXPIRED, sin código de barras y sin línea de fecha', () => {
    const sinRoles = base({ pestanas: [], anfitrion: { ...base().anfitrion!, activo: false },
      socio: { ...base().socio!, estado: 'baja' } })
    expect(sinRolVigente(sinRoles)).toBe(true)
    const o = obj(armarObjeto(ISSUER, sinRoles))
    expect(o.state).toBe('EXPIRED')
    expect(o.barcode).toBeUndefined()
    expect(o.textModulesData.some((t) => t.id === 'actualizado')).toBe(false)
    // socio pendiente sin anfitrión: sigue vigente (tiene que poder validar el alta en caja)
    const pend = base({ pestanas: ['mi_club'], anfitrion: null, canjear_url: null, socio: { ...base().socio!, estado: 'pendiente' } })
    expect(sinRolVigente(pend)).toBe(false)
    expect(obj(armarObjeto(ISSUER, pend)).state).toBe('ACTIVE')
    expect(sinRolVigente(base())).toBe(false)
  })

  it('baja: el pase queda EXPIRED y sin código de barras', () => {
    const o = obj(armarObjeto(ISSUER, base({ estado: 'baja' })))
    expect(o.state).toBe('EXPIRED')
    expect(o.barcode).toBeUndefined()
  })

  it('token de pase revocado (canjear_url null): sin botón Canjear', () => {
    const o = obj(armarObjeto(ISSUER, base({ canjear_url: null })))
    expect(o.linksModuleData.uris.map((u) => u.id)).toEqual(['cupones'])
  })

  it('nunca lleva contactos ni el token del portal; issuer inválido → error', () => {
    const txt = JSON.stringify(armarObjeto(ISSUER, base()))
    expect(txt).not.toMatch(/@|\+506|\/p\/[0-9a-f]{64}/)
    expect(() => armarObjeto('abc', base())).toThrow(/issuerId/)
    expect(() => armarClase('abc')).toThrow(/issuerId/)
  })

  it('diseño: sin aprobar no lleva logo ni franja; con la propuesta, sí (https del Club)', () => {
    const sin = armarObjeto(ISSUER, base()) as Record<string, unknown>
    expect(sin.logo).toBeUndefined(); expect(sin.heroImage).toBeUndefined()
    const con = armarObjeto(ISSUER, base(), disenoPropuesto('https://club.ejemplo.test')) as { logo: { sourceUri: { uri: string } }; heroImage: { sourceUri: { uri: string } }; hexBackgroundColor: string }
    expect(con.logo.sourceUri.uri).toBe('https://club.ejemplo.test/pase/logo.png')
    expect(con.heroImage.sourceUri.uri).toBe('https://club.ejemplo.test/pase/hero.png')
    expect(con.hexBackgroundColor).toBe('#0d0d0d')
  })

  it('el beneficio se traduce con los mismos números', () => {
    expect(beneficioEn('10 % + 1 cortesía')).toBe('10% + 1 complimentary item')
    expect(beneficioEn('15 %')).toBe('15%')
    expect(beneficioEn('2 cortesías')).toBe('2 complimentary items')
  })
})

describe('firmarJwt («Save to Google Wallet»)', () => {
  it('RS256 verificable con la clave pública; claims de Google; clase y objeto adentro', async () => {
    const clase = armarClase(ISSUER)
    const objeto = armarObjeto(ISSUER, base())
    const ahora = new Date('2026-11-08T08:00:00Z')
    const jwt = await firmarJwt(sa, clase, objeto, ['https://club.ejemplo.test'], ahora)
    const [h, p, f] = jwt.split('.')
    expect(decodificar(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = decodificar(p)
    expect(claims).toMatchObject({ iss: sa.client_email, aud: 'google', typ: 'savetowallet', iat: 1794124800, origins: ['https://club.ejemplo.test'] })
    expect(claims.payload.genericClasses[0].id).toBe(`${ISSUER}.club-satori`)
    expect(claims.payload.genericObjects[0].id).toBe(objeto.id)
    const firma = Buffer.from(f.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publica, firma, new TextEncoder().encode(`${h}.${p}`))
    expect(ok).toBe(true)
    expect(urlGuardar(jwt)).toBe(`https://pay.google.com/gp/v/save/${jwt}`)
  })

  it('el completo pasa el largo recomendado; el flaco (solo id y classId) entra y no lleva datos', async () => {
    const objeto = armarObjeto(ISSUER, base())
    const completo = await firmarJwt(sa, armarClase(ISSUER), objeto, ['https://club.ejemplo.test'])
    const flaco = await firmarJwtFlaco(sa, objeto, ['https://club.ejemplo.test'])
    expect(completo.length).toBeGreaterThan(LARGO_JWT_RECOMENDADO)
    expect(flaco.length).toBeLessThan(LARGO_JWT_RECOMENDADO)
    const claims = decodificar(flaco.split('.')[1])
    expect(claims.payload).toEqual({ genericObjects: [{ id: `${ISSUER}.club-00000000-0000-4000-8000-00000000c0de`, classId: `${ISSUER}.club-satori` }] })
  })

  it('una clave que no es PKCS#8 se rechaza sin mostrar su contenido', async () => {
    await expect(firmarJwt({ ...sa, private_key: 'no-es-una-clave' }, {}, {}, [])).rejects.toThrow(/PKCS#8/)
  })
})

describe('leerCuentaServicio', () => {
  it('pide client_email de cuenta de servicio y private_key; no repite el contenido en el error', () => {
    expect(leerCuentaServicio(JSON.stringify(sa)).client_email).toBe(sa.client_email)
    expect(() => leerCuentaServicio('{roto')).toThrow('GOOGLE_WALLET_SA_KEY no es JSON')
    expect(() => leerCuentaServicio(JSON.stringify({ ...sa, client_email: 'alguien@ejemplo.com' }))).toThrow(/client_email/)
    expect(() => leerCuentaServicio(JSON.stringify({ client_email: sa.client_email }))).toThrow(/private_key/)
  })
})
