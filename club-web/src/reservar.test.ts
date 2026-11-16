// @vitest-environment happy-dom
// D 16-nov (el dueño): «Reservar» en el portal del socio → OpenTable del local (rid por defecto de la mig 173).
import { test, expect } from 'vitest'
import { tarjetaReservar, urlReservaLocal, urlReservaOpenTable, urlReservaSocio } from './reservar'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPENTABLE_RID } from './config'
import { TEXTOS } from './i18n'

test('arma el link de OpenTable con el rid por defecto (el mismo que el default de la 173)', () => {
  expect(OPENTABLE_RID).toBe('1347736')
  expect(urlReservaOpenTable()).toBe('https://www.opentable.com/restref/client/?rid=1347736')
  expect(urlReservaOpenTable('42')).toBe('https://www.opentable.com/restref/client/?rid=42')
})

test('un rid que no es solo dígitos no arma link (no se inyecta nada en la URL)', () => {
  for (const malo of ['', ' ', '13477a6', '1&lang=xx', 'https://otro.test', '1234567890123']) expect(urlReservaOpenTable(malo)).toBeNull()
})

test('textos del botón en ES («Reservar») y EN', () => {
  expect(TEXTOS.es.reservar_boton).toBe('Reservar')
  expect(TEXTOS.en.reservar_boton).toBe('Book')
  for (const k of ['reservar_titulo', 'reservar_txt'] as const) {
    expect(TEXTOS.es[k].length).toBeGreaterThan(3)
    expect(TEXTOS.en[k].length).toBeGreaterThan(3)
  }
})

test('la tarjeta «Reservar» abre OpenTable en otra pestaña, sin pasarle la página de origen', () => {
  const el = tarjetaReservar({ titulo: TEXTOS.es.reservar_titulo, txt: TEXTOS.es.reservar_txt, boton: TEXTOS.es.reservar_boton })!
  const a = el.querySelector('a')!
  expect(a.textContent).toBe('Reservar')
  expect(a.getAttribute('href')).toBe('https://www.opentable.com/restref/client/?rid=1347736')
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  expect(tarjetaReservar({ titulo: 'x', txt: 'x', boton: 'x' }, null)).toBeNull()
})

// mig 179 (D 16-nov, opción A): el link del local del socio, TAL CUAL (OpenTable registra el canal por sus parámetros)
const LINK_LOCAL = 'https://www.opentable.com/restref/client/?rid=9990002&lang=en-US&ot_source=Club&ot_campaign=socio'

test('el link del local se usa tal cual: mismos parámetros, mismo orden, nada reconstruido', () => {
  expect(urlReservaLocal(LINK_LOCAL)).toBe(LINK_LOCAL)
  expect(urlReservaSocio(LINK_LOCAL)).toBe(LINK_LOCAL)
  for (const ok of ['https://www.opentable.com.mx/r/local-ficticio?ref=club', 'https://restref.opentable.co.uk/client/?rid=9990003#x',
    'https://opentable.com/r?x=1%20y', 'https://WWW.OPENTABLE.COM/booking/r?rid=9990004']) expect(urlReservaLocal(ok)).toBe(ok)
})

test('sin link del local (null, ausente o no OpenTable) → el rid por defecto', () => {
  const porDefecto = 'https://www.opentable.com/restref/client/?rid=1347736'
  for (const malo of [null, undefined, '', 42, {}, 'http://www.opentable.com/r?rid=1', 'https://reservas.ejemplo.test/r?rid=1',
    'https://www.opentable.com.otro.test/r', 'https://www.opentable.com@otro.test/r', 'https://www.opentable.com:8443/r',
    'https://otroopentable.com/r', 'javascript:alert(1)//opentable.com', 'https://www.opentable.com/r?x=a b',
    'https://www.opentable.com/r?x=' + 'a'.repeat(300)]) {
    expect(urlReservaLocal(malo)).toBeNull()
    expect(urlReservaSocio(malo)).toBe(porDefecto)
  }
})

test('la tarjeta abre el link del local tal cual', () => {
  const el = tarjetaReservar({ titulo: 'x', txt: 'x', boton: 'Reservar' }, urlReservaSocio(LINK_LOCAL))!
  expect(el.querySelector('a')!.getAttribute('href')).toBe(LINK_LOCAL)
})

test('el portal del socio pinta «Reservar» en «Mi Club» con el link de SU local (socio.reserva_url)', () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8')   // happy-dom cambia URL
  const socio = main.slice(main.indexOf('function seccionSocio('), main.indexOf('function seccionCumple('))
  expect(socio).toMatch(/tarjetaReservar\(\{ titulo: t\.reservar_titulo, txt: t\.reservar_txt, boton: t\.reservar_boton \}, urlReservaSocio\(socio\.reserva_url\)\)/)
})
