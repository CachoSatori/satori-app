// (16-nov) «Reservar una mesa» en la pestaña del anfitrión: el OpenTable del local del miembro con la campaña `referente`
// (#220). Sin link del local, no hay tarjeta (nunca el rid por defecto ni otro local). Links ficticios.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { urlReservaAnfitrion } from './reservaAnfitrion'
import { urlReservaOpenTable } from './reservar'

const OT = 'https://www.opentable.com/r/ejemplo-restaurante?restref=123456&lang=es-MX&ot_source=Club%20Satori&ot_campaign=club%20satori'

test('con el link del local: el mismo link con ot_campaign=referente (el resto intacto)', () => {
  expect(urlReservaAnfitrion({ socio: { reserva_url: OT } })).toBe(
    'https://www.opentable.com/r/ejemplo-restaurante?restref=123456&lang=es-MX&ot_source=Club%20Satori&ot_campaign=referente')
})

test('sin ot_campaign en el link, se agrega; sin ot_source, el link queda igual (no se inventa el origen)', () => {
  expect(urlReservaAnfitrion({ socio: { reserva_url: 'https://www.opentable.com/restref/client/?rid=99&ot_source=Club' } }))
    .toBe('https://www.opentable.com/restref/client/?rid=99&ot_source=Club&ot_campaign=referente')
  expect(urlReservaAnfitrion({ socio: { reserva_url: 'https://www.opentable.com/restref/client/?rid=99' } }))
    .toBe('https://www.opentable.com/restref/client/?rid=99')
})

test('anfitrión puro (la base no devuelve link) o link que no es de OpenTable: sin tarjeta, nunca el rid por defecto', () => {
  for (const p of [{}, { socio: null }, { socio: { reserva_url: null } }, { socio: { reserva_url: 'https://evil.example/opentable.com' } },
                   { socio: { reserva_url: 'http://www.opentable.com/r/x?ot_source=a' } }, null, undefined]) {
    const u = urlReservaAnfitrion(p)
    expect(u).toBeNull()
    expect(u).not.toBe(urlReservaOpenTable())
  }
})

test('si la base algún día devuelve el link arriba (todo miembro), se usa ese primero', () => {
  const otro = 'https://www.opentable.com/restref/client/?rid=7&ot_source=Club'
  expect(urlReservaAnfitrion({ reserva_url: otro, socio: { reserva_url: OT } })).toBe(`${otro}&ot_campaign=referente`)
})

test('main.ts pinta la tarjeta en la pestaña del anfitrión con este link (y el de «Mi Club» sigue con `local`)', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
  const anf = main.slice(main.indexOf('const anfitrion: HTMLElement[]'), main.indexOf('pintar(', main.indexOf('const anfitrion: HTMLElement[]')))
  expect(anf).toContain('tarjetaReservaAnfitrion(p)')
  expect(main).toMatch(/urlReservaSocio\(socio\.reserva_url, 'local'\)/)
})
