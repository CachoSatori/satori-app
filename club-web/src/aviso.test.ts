// Aviso de privacidad (08-nov noche): v1.1 suma el email en «Qué datos guardamos». La versión de club-web tiene que ser
// la misma que la base carga por defecto (si no, la base rechaza el alta y el opt-in del cupón).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AVISO_PRIVACIDAD_VERSION } from './config'
import { TEXTOS } from './i18n'

test('v1.1: el aviso completo (ES/EN) dice que guardamos el email, si lo da', () => {
  expect(AVISO_PRIVACIDAD_VERSION).toBe('v1.1')
  expect(TEXTOS.es.alta_aviso).toContain('Qué datos guardamos: tu nombre, tu número de WhatsApp y tu email, si lo das.')
  expect(TEXTOS.en.alta_aviso).toContain('What we keep: your name, your WhatsApp number and your email, if you give it.')
})

test('la versión de club-web es la que la migración del Club carga por defecto', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/075_club_satori_esquema.sql', import.meta.url), 'utf8')
  expect(sql).toContain(`alter column aviso_privacidad_version set default '${AVISO_PRIVACIDAD_VERSION}'`)
})
