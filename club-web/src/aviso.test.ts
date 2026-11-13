// Aviso de privacidad (08-nov noche): v1.1 suma el email en «Qué datos guardamos». La versión de club-web tiene que ser
// la misma que la base carga por defecto (si no, la base rechaza el alta y el opt-in del cupón).
import { test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { AVISO_PRIVACIDAD_SHA256, AVISO_PRIVACIDAD_VERSION } from './config'
import { TEXTOS } from './i18n'

// (12-nov, v1.2) La versión vigente y su huella pueden venir de cualquier migración (la 150 cargó v1.1; la 152, v1.2):
// se leen todas, en orden. La que manda es la ÚLTIMA que cambia el default.
const DIR_MIG = new URL('../../supabase/migrations/', import.meta.url)
const MIGS = readdirSync(DIR_MIG).filter(f => f.endsWith('.sql')).sort((a, b) => parseInt(a) - parseInt(b)).map(f => readFileSync(new URL(f, DIR_MIG), 'utf8')).join('\n')
const ULTIMO_DEFAULT = [...MIGS.matchAll(/alter column aviso_privacidad_version set default '([^']+)'/g)].at(-1)?.[1]

test('v1.2: el aviso completo (ES/EN) dice que guardamos el email, si lo da', () => {
  expect(AVISO_PRIVACIDAD_VERSION).toBe('v1.2')
  expect(TEXTOS.es.alta_aviso).toContain('Qué datos guardamos: su nombre, su número de WhatsApp y su email, si lo da.')
  expect(TEXTOS.en.alta_aviso).toContain('What we keep: your name, your WhatsApp number and your email, if you give it.')
})

test('la versión de club-web es la que las migraciones cargan por defecto (la última que lo cambia)', () => {
  expect(ULTIMO_DEFAULT).toBe(AVISO_PRIVACIDAD_VERSION)
})

test('(12-nov) v1.2 = v1.1 con «usted»: el español no tutea ni vosea y el inglés no cambió', () => {
  expect(TEXTOS.es.alta_aviso).not.toMatch(/\b(tu|tus|te|sos|podés|querés|aceptás|agregás|dejaste|aceptaste)\b/)
  expect(AVISO_PRIVACIDAD_SHA256.en).toBe('748b783881f21370e3238517996a2a47780b0c7a18c597ecc7528a56018fddf7')
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
