// Aviso de privacidad (08-nov noche): v1.1 suma el email en «Qué datos guardamos». La versión de club-web tiene que ser
// la misma que la base carga por defecto (si no, la base rechaza el alta y el opt-in del cupón).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { AVISO_PRIVACIDAD_SHA256, AVISO_PRIVACIDAD_VERSION } from './config'
import { TEXTOS } from './i18n'

test('v1.1: el aviso completo (ES/EN) dice que guardamos el email, si lo da', () => {
  expect(AVISO_PRIVACIDAD_VERSION).toBe('v1.1')
  expect(TEXTOS.es.alta_aviso).toContain('Qué datos guardamos: tu nombre, tu número de WhatsApp y tu email, si lo das.')
  expect(TEXTOS.en.alta_aviso).toContain('What we keep: your name, your WhatsApp number and your email, if you give it.')
})

test('la versión de club-web es la que la migración del Club carga por defecto', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/150_club_satori_esquema.sql', import.meta.url), 'utf8')
  expect(sql).toContain(`alter column aviso_privacidad_version set default '${AVISO_PRIVACIDAD_VERSION}'`)
})

test('v1.1 corregido (08-nov noche): ofertas solo si las aceptó, servidores fuera de CR y retención = la configuración', () => {
  const es = TEXTOS.es.alta_aviso, en = TEXTOS.en.alta_aviso
  expect(es).toContain('y, solo si lo aceptaste, mandarte ofertas de Satori. No vendemos tus datos ni los usamos para nada más.')
  expect(es).not.toContain('para otra cosa')   // ya no contradice a las ofertas
  expect(es).toContain('Los guardamos en servicios tecnológicos que contratamos, con servidores fuera de Costa Rica.')
  expect(en).toContain('only if you agreed, send you Satori offers')
  expect(en).toContain('We store it with technology services we hire, on servers outside Costa Rica.')
  const sql = readFileSync(new URL('../../supabase/migrations/150_club_satori_esquema.sql', import.meta.url), 'utf8')
  const meses = sql.match(/contactos_ofertas_meses int not null default (\d+)/)?.[1]
  expect(meses).toBeTruthy()
  expect(es).toContain(`hasta que te des de baja o hasta ${meses} meses desde que nos lo dejaste`)
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
  const sql = readFileSync(new URL('../../supabase/migrations/150_club_satori_esquema.sql', import.meta.url), 'utf8')
  for (const k of ['es', 'en'] as const) {
    const h = createHash('sha256').update(TEXTOS[k].alta_aviso, 'utf8').digest('hex')
    expect(h, `cambió el texto ${k} del aviso: subí la versión y registrá su huella`).toBe(AVISO_PRIVACIDAD_SHA256[k])
  }
  expect(sql).toContain(`('${AVISO_PRIVACIDAD_VERSION}', '${AVISO_PRIVACIDAD_SHA256.es}', '${AVISO_PRIVACIDAD_SHA256.en}')`)
})
