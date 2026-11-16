// @vitest-environment happy-dom
// Mig 180 (pedido del dueño, 16-nov): «Reservar una mesa» en la página del cupón del turista, con el OpenTable del local
// del cupón (`local.reserva`), tal cual; sin link, no hay botón (no cae al rid por defecto).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botonReservaCupon } from './reservaCupon'
import { TEXTOS } from './i18n'

const LINK_NO = 'https://www.opentable.com/restref/client/?rid=9990102&lang=en-US&ot_source=Club&ot_campaign=cupon'

test('con link de OpenTable del local: botón con el link (campaña «turista»), en pestaña nueva y con noopener noreferrer', () => {
  const a = botonReservaCupon({ reserva: LINK_NO }, TEXTOS.es.reservar_titulo)!
  expect(a.tagName).toBe('A')
  // opción B (16-nov): solo ot_campaign cambia (cupon → turista); ot_source y el resto, tal cual
  expect(a.getAttribute('href')).toBe(LINK_NO.replace('ot_campaign=cupon', 'ot_campaign=turista'))
  expect(a.target).toBe('_blank')
  expect(a.rel).toBe('noopener noreferrer')
  expect(a.textContent).toBe('Reservar una mesa')
  expect(botonReservaCupon({ reserva: LINK_NO }, TEXTOS.en.reservar_titulo)!.textContent).toBe('Book a table')
})

test('sin link (null, sin clave, sin local) o con un link que no es de OpenTable: no hay botón (ni el rid por defecto)', () => {
  for (const local of [null, undefined, {}, { reserva: null }, { reserva: '' }, { reserva: 'https://reservas.ejemplo.test/r?rid=1' },
                       { reserva: 'http://www.opentable.com/r?rid=1' }, { reserva: 'javascript:alert(1)//opentable.com' },
                       { reserva: 'https://www.opentable.com@otro.test/r' }, { reserva: 42 }]) {
    expect(botonReservaCupon(local as never, 'Reservar una mesa'), JSON.stringify(local)).toBeNull()
  }
})

test('la página del cupón vigente pinta el botón con el local del cupón (local.reserva de club_cupon_ver)', () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8')   // happy-dom cambia URL
  const cupon = main.slice(main.indexOf('async function vistaCupon('), main.indexOf('let pararSondeo'))
  expect(cupon).toMatch(/botonReservaCupon\(local, t\.reservar_titulo\)/)
  expect(main).toMatch(/interface LocalPub \{[^}]*reserva\?: string \| null/)
})
