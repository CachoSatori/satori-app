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

test('v1.1 corregido (08-nov noche): ofertas solo si las aceptó, servidores fuera de CR y retención = la configuración', () => {
  const es = TEXTOS.es.alta_aviso, en = TEXTOS.en.alta_aviso
  expect(es).toContain('y, solo si lo aceptaste, mandarte ofertas de Satori. No vendemos tus datos ni los usamos para nada más.')
  expect(es).not.toContain('para otra cosa')   // ya no contradice a las ofertas
  expect(es).toContain('Los guardamos en servicios tecnológicos que contratamos, con servidores fuera de Costa Rica.')
  expect(en).toContain('only if you agreed, send you Satori offers')
  expect(en).toContain('We store it with technology services we hire, on servers outside Costa Rica.')
  const sql = readFileSync(new URL('../../supabase/migrations/075_club_satori_esquema.sql', import.meta.url), 'utf8')
  const meses = sql.match(/contactos_ofertas_meses int not null default (\d+)/)?.[1]
  expect(meses).toBeTruthy()
  expect(es).toContain(`hasta que te des de baja o hasta ${meses} meses sin contacto`)
  expect(en).toContain(`until you opt out or for up to ${meses} months without contact`)
})
