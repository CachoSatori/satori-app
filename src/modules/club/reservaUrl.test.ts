// 180 · Link de reservas por local: solo https de OpenTable, tal cual (igual que club_reserva_url_ok de la 179 y que
// club-web/src/reservar.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { conCampanaOpenTable, GRUPOS_RESERVA, normalizarReservaUrl, RE_HOST_OPENTABLE, RE_RESERVA_OPENTABLE, type GrupoReserva } from './reservaUrl'
import * as web from '../../../club-web/src/reservar'

const raiz = resolve(__dirname, '../../..')
const leer = (p: string) => readFileSync(resolve(raiz, p), 'utf8')

describe('normalizarReservaUrl', () => {
  it('acepta OpenTable con sus parámetros TAL CUAL (solo quita espacios alrededor); variantes regionales y subdominios', () => {
    const u = 'https://www.opentable.com/restref/client/?rid=9990101&lang=es-MX&ot_source=Club%20Satori&corrid=prueba'
    expect(normalizarReservaUrl(`  ${u} `)).toBe(u)
    expect(normalizarReservaUrl('https://www.opentable.com.mx/r/local-ficticio?ref=club')).toBe('https://www.opentable.com.mx/r/local-ficticio?ref=club')
    expect(normalizarReservaUrl('https://restref.opentable.co.uk/client/?rid=9990003#x')).toBe('https://restref.opentable.co.uk/client/?rid=9990003#x')
    expect(normalizarReservaUrl('https://www.opentable.com/restref/client/?rid=1347736')).toBe('https://www.opentable.com/restref/client/?rid=1347736')
  })
  it('vacío = null (sin link)', () => {
    expect(normalizarReservaUrl('   ')).toBeNull()
  })
  it('rechaza http, otros dominios, dominios parecidos, usuario@, puerto, javascript y > 300', () => {
    for (const u of ['http://www.opentable.com/r?rid=1', 'https://reservas.ejemplo.test/r?rid=1', 'https://www.opentable.com.otro.test/r',
                     'https://www.opentable.com@otro.test/r', 'https://www.opentable.com:8443/r', 'https://otroopentable.com/r',
                     'javascript:alert(1)//opentable.com', 'https://www.opentable.com/r?x=' + 'a'.repeat(300)]) {
      expect(() => normalizarReservaUrl(u), u.slice(0, 40)).toThrow(/tiene que ser de OpenTable/)
    }
  })
})

describe('180: la app, la base y club-web validan lo mismo', () => {
  it('la expresión es la de club_reserva_url_ok (179) y el host el de club-web/src/reservar.ts', () => {
    const sql = leer('supabase/migrations/179_club_portal_reserva_local.sql')
    const m = /p_url ~\* '(\^https:\/\/[^']+)'/.exec(sql)
    expect(m).not.toBeNull()
    expect(RE_RESERVA_OPENTABLE.source.replace(/\\\//g, '/')).toBe(m![1])
    const web = leer('club-web/src/reservar.ts')
    expect(web).toContain(`const HOST_OPENTABLE = /${RE_HOST_OPENTABLE.source}/i`)
  })
  it('la migración 180 valida Locales con la interna de la 179 (trigger) y la copia sale de Promociones', () => {
    const sql = leer('supabase/migrations/180_club_reserva_url_por_local.sql')
    expect(sql).toMatch(/before insert or update of reserva_url on public\.club_config/)
    expect(sql).toMatch(/not public\.club_reserva_url_ok\(new\.reserva_url\)/)
    expect(sql).toMatch(/update public\.club_config c\s+set reserva_url = k\.reserva_url\s+from public\.club_cumple_config k/)
  })
})

describe('opción B (16-nov): campaña de OpenTable por grupo — la app y club-web dan lo mismo', () => {
  const casos = [
    'https://www.opentable.com/restref/client/?rid=9990401&ot_source=Club%20Satori',
    'https://www.opentable.com/r/x?restref=9990402&ot_source=Club%20Satori&ot_campaign=Club%20Satori&lang=en-US',
    'https://www.opentable.com/r/x?restref=9990402&ot_source=Club&ot_campaign=a&ot%5Fcampaign=b#frag',
    'https://www.opentable.com/r/x?restref=9990402&ot_source=Club&',
    'https://www.opentable.com/restref/client/?rid=9990403', 'https://www.opentable.com/restref/client/?rid=9990403&ot_source=',
    'https://www.opentable.com/r/x', 'https://reservas.ejemplo.test/r?ot_source=Club', 'http://www.opentable.com/r?ot_source=Club',
    'https://www.opentable.com@otro.test/r?ot_source=Club', 'https://www.opentable.com:8443/r?ot_source=Club',
    'https://www.opentable.com/r?ot_source=Club&x=' + 'a'.repeat(300), 'https://restref.opentable.co.uk/client/?rid=9990404&ot_source=UK',
  ]
  it('mismos grupos y mismo resultado en todos los casos', () => {
    expect(GRUPOS_RESERVA).toEqual(web.GRUPOS_RESERVA)
    for (const u of casos) for (const g of [...GRUPOS_RESERVA, 'otro' as GrupoReserva])
      expect(conCampanaOpenTable(u, g), `${g} ${u.slice(0, 60)}`).toBe(web.conCampanaOpenTable(u, g))
  })
  it('reemplaza o agrega solo con ot_source en un host válido', () => {
    expect(conCampanaOpenTable(casos[0], 'cumpleanos')).toBe(casos[0] + '&ot_campaign=cumpleanos')
    expect(conCampanaOpenTable(casos[1], 'cumpleanos')).toContain('&ot_campaign=cumpleanos&lang=en-US')
    for (const u of casos.slice(4, 12)) expect(conCampanaOpenTable(u, 'cumpleanos')).toBe(u)
  })
})
