// 180 · Link de reservas por local: solo https de OpenTable, tal cual (igual que club_reserva_url_ok de la 179 y que
// club-web/src/reservar.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizarReservaUrl, RE_HOST_OPENTABLE, RE_RESERVA_OPENTABLE } from './reservaUrl'

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
