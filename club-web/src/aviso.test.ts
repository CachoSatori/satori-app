// Aviso de privacidad (08-nov noche): v1.1 suma el email en «Qué datos guardamos». La versión de club-web tiene que ser
// la misma que la base carga por defecto (si no, la base rechaza el alta y el opt-in del cupón).
import { test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { AVISO_PRIVACIDAD_SHA256, AVISO_PRIVACIDAD_VERSION } from './config'
import { TEXTOS } from './i18n'

// (12-nov, v1.2) La versión vigente y su huella pueden venir de cualquier migración (la 150 cargó v1.1; la 159, v1.2):
// se leen todas, en orden. La que manda es la ÚLTIMA que cambia el default.
const DIR_MIG = new URL('../../supabase/migrations/', import.meta.url)
const MIGS = readdirSync(DIR_MIG).filter(f => f.endsWith('.sql')).sort((a, b) => parseInt(a) - parseInt(b)).map(f => readFileSync(new URL(f, DIR_MIG), 'utf8')).join('\n')
const ULTIMO_DEFAULT = [...MIGS.matchAll(/alter column aviso_privacidad_version set default '([^']+)'/g)].at(-1)?.[1]

test('v1.3: el aviso completo (ES/EN) dice que guardamos el email, si lo da', () => {
  expect(AVISO_PRIVACIDAD_VERSION).toBe('v1.3')
  expect(TEXTOS.es.alta_aviso).toContain('Qué datos guardamos: su nombre, su número de WhatsApp y su email, si lo da.')
  expect(TEXTOS.en.alta_aviso).toContain('What we keep: your name, your WhatsApp number and your email, if you give it.')
})

test('la versión de club-web es la que las migraciones cargan por defecto (la última que lo cambia)', () => {
  expect(ULTIMO_DEFAULT).toBe(AVISO_PRIVACIDAD_VERSION)
})

test('(12-nov) v1.2 con «usted»: el español no tutea ni vosea', () => {
  expect(TEXTOS.es.alta_aviso).not.toMatch(/\b(tu|tus|te|sos|podés|querés|aceptás|agregás|dejaste|aceptaste)\b/)
})

test('(14-nov, D6 A) v1.2 dice, en ES y EN, que es solo para mayores de 18 y cómo se trata el cumpleaños', () => {
  const es = TEXTOS.es.alta_aviso, en = TEXTOS.en.alta_aviso
  expect(es).toContain('Edad: el Local Club es solo para mayores de 18 años. Al anotarse confirma que lo es.')
  expect(es).toContain('Si nos da su cumpleaños con su permiso, solo el día y el mes (sin el año).')
  expect(es).toContain('también el de su cumpleaños, si nos dio permiso')
  expect(es).toContain('Después no se cambia desde el portal: para corregirlo o retirar el permiso, escríbanos. Si se da de baja, lo borramos.')
  expect(en).toContain('Age: the Local Club is only for people 18 or older. By signing up you confirm you are.')
  expect(en).toContain('If you give us your birthday with your permission, only the day and month (no year).')
  expect(en).toContain('your birthday cannot be changed from the portal')
  // v1.2 todavía no salió: la huella vieja de v1.2 (solo «usted») NO puede quedar en ninguna migración ni en config
  expect(MIGS).not.toContain('661a25dd310346231d49429c7bf216c3bc84d5670bd107d35ae638028a607df7')
  expect(AVISO_PRIVACIDAD_SHA256.en).not.toBe('748b783881f21370e3238517996a2a47780b0c7a18c597ecc7528a56018fddf7')
})

test('(14-nov) v1.2 se registra una sola vez en las migraciones (la 159)', () => {
  expect([...MIGS.matchAll(/\('v1\.2', '[0-9a-f]{64}', '[0-9a-f]{64}'\)/g)].length).toBe(1)
})

test('(15-nov, D-cumple-1 A) v1.3: el cumpleaños se agrega UNA vez desde el portal y el WhatsApp incluye el beneficio; se registra una vez (la 173)', () => {
  const es = TEXTOS.es.alta_aviso, en = TEXTOS.en.alta_aviso
  expect(es).toContain('Si no nos dio su cumpleaños al anotarse, puede agregarlo una sola vez desde su portal.')
  expect(es).toContain('avisarle por WhatsApp sobre su cuenta del Club (incluido el beneficio de su cumpleaños)')
  expect(en).toContain('If you did not give us your birthday when you signed up, you can add it once from your portal.')
  expect(en).toContain('message you on WhatsApp about your Club account (including your birthday benefit)')
  // ya no dice que «no se cambia desde el portal» a secas (ahora se AGREGA una vez)
  expect(es).not.toMatch(/escribiendo a [^ ]+\. El cumpleaños no se cambia desde el portal/)
  expect([...MIGS.matchAll(/\('v1\.3', '[0-9a-f]{64}', '[0-9a-f]{64}'\)/g)].length).toBe(1)
  // las huellas de v1.2 no se reusan para v1.3
  expect(AVISO_PRIVACIDAD_SHA256.es).not.toBe('755d3ac1c19bf0d679f6e7844bcf950aec4803abd2098616d0c2b6b897e256dc')
  expect(AVISO_PRIVACIDAD_SHA256.en).not.toBe('a83ec65f5cc5eecb1a9d9a1c59c13af9b222110931c01d0b873c990404a306cf')
})

test('v1.1 corregido (08-nov noche): ofertas solo si las aceptó, servidores fuera de CR y retención = la configuración', () => {
  const es = TEXTOS.es.alta_aviso, en = TEXTOS.en.alta_aviso
  expect(es).toContain('y, solo si lo aceptó, mandarle ofertas de Satori. No vendemos sus datos ni los usamos para nada más.')
  expect(es).not.toContain('para otra cosa')   // ya no contradice a las ofertas
  expect(es).toContain('Los guardamos en servicios tecnológicos que contratamos, con servidores fuera de Costa Rica.')
  expect(en).toContain('only if you agreed, send you Satori offers')
  expect(en).toContain('We store it with technology services we hire, on servers outside Costa Rica.')
  const sql = readFileSync(new URL('../../supabase/migrations/150_club_satori_esquema.sql', import.meta.url), 'utf8')
  const meses = sql.match(/contactos_ofertas_meses int not null default (\d+)/)?.[1]
  expect(meses).toBeTruthy()
  expect(es).toContain(`hasta que se dé de baja o hasta ${meses} meses desde que nos lo dejó`)
  expect(en).toContain(`until you opt out or for up to ${meses} months from when you left it`)
})

test('(09-nov) v1.1 sin marcas pendientes: dirección del responsable y 24 meses confirmados por el dueño', () => {
  for (const t of [TEXTOS.es.alta_aviso, TEXTOS.en.alta_aviso]) {
    expect(t).not.toMatch(/CONFIRMAR|<[^>]+>/)
  }
  expect(TEXTOS.es.alta_aviso).toContain('Frente al Hotel Trópico Latino, Santa Teresa, Cóbano, Provincia de Puntarenas, 60111, Costa Rica.')
  expect(TEXTOS.en.alta_aviso).toContain('Across from Hotel Trópico Latino, Santa Teresa, Cóbano, Puntarenas Province, 60111, Costa Rica.')
})

test('(09-nov, B8) la huella del texto de cada idioma es la registrada para la versión, aquí y en la base', () => {
  for (const k of ['es', 'en'] as const) {
    const h = createHash('sha256').update(TEXTOS[k].alta_aviso, 'utf8').digest('hex')
    expect(h, `cambió el texto ${k} del aviso: subí la versión y registrá su huella`).toBe(AVISO_PRIVACIDAD_SHA256[k])
  }
  expect(MIGS).toContain(`('${AVISO_PRIVACIDAD_VERSION}', '${AVISO_PRIVACIDAD_SHA256.es}', '${AVISO_PRIVACIDAD_SHA256.en}')`)
})
