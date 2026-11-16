// @vitest-environment happy-dom
// D 16-nov (el dueño): «Reservar» en el portal del socio → OpenTable del local (rid por defecto de la mig 173).
import { test, expect } from 'vitest'
import { tarjetaReservar, urlReservaLocal, urlReservaOpenTable, urlReservaSocio, urlWidgetOpenTable, WIDGET_ESPERA_MS, WIDGET_SANDBOX } from './reservar'
import { vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
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
  const el = tarjetaReservar({ titulo: TEXTOS.es.reservar_titulo, txt: TEXTOS.es.reservar_txt, boton: TEXTOS.es.reservar_boton, abrir: 'x', falla: 'x', marco: 'x' })!
  const a = el.querySelector('a')!
  expect(a.textContent).toBe('Reservar')
  expect(a.getAttribute('href')).toBe('https://www.opentable.com/restref/client/?rid=1347736')
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  expect(tarjetaReservar({ titulo: 'x', txt: 'x', boton: 'x', abrir: 'x', falla: 'x', marco: 'x' }, null)).toBeNull()
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
  const el = tarjetaReservar({ titulo: 'x', txt: 'x', boton: 'Reservar', abrir: 'x', falla: 'x', marco: 'x' }, urlReservaSocio(LINK_LOCAL))!
  expect(el.querySelector('a')!.getAttribute('href')).toBe(LINK_LOCAL)
})

test('el portal del socio pinta «Reservar» en «Mi Club» con el link de SU local (socio.reserva_url)', () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8')   // happy-dom cambia URL
  const socio = main.slice(main.indexOf('function seccionSocio('), main.indexOf('function seccionCumple('))
  expect(socio).toMatch(/tarjetaReservar\(\{ titulo: t\.reservar_titulo, txt: t\.reservar_txt, boton: t\.reservar_boton, abrir: t\.reservar_abrir, falla: t\.reservar_falla, marco: t\.reservar_marco \},\s*urlReservaSocio\(socio\.reserva_url\), urlWidgetOpenTable\(socio\.reserva_url, idioma\)\)/)
})

// ── D 16-nov (el dueño) + revisión de seguridad #214: el widget de OpenTable en un IFRAME (ningún script de terceros) ──
const LINK_DUENO = 'https://www.opentable.com/r/satori-sushi-santa-teresa-reservations-santa-teresa?restref=1347736&lang=en-US&ot_source=Club%20Satori&ot_campaign=Club%20Satori'
// La URL del «mural» que arma el loader de OpenTable para el script que generó el dueño (con isNewTab=true: sin el loader
// no hay ventana encima del portal).
const W = (rid: string, lang: string, src = 'Club%20Satori', camp = src) =>
  'https://www.opentable.com/widget/reservation/mural?colorThemeId=1&isDarkMode=false&domain=com&isIframe=true' +
  `&lang=${lang}&isNewTab=true&otCampaign=${camp}&otSource=${src}&restaurantIds=${rid}&type=standard&font=BrandonText` +
  '&primaryColor=ffffff&primaryFontColor=333333&buttonColor=da3743&buttonFontColor=ffffff&logoPid=0&backgroundPid=0' +
  '&demo=false&otLogo=standard&loadAllWidgets=false&theme=standard'

test('widget: desde el link del dueño (/r/…?restref=) sale el mural de Santa Teresa con origen «Club Satori»; lang según el portal', () => {
  expect(urlWidgetOpenTable(LINK_DUENO, 'en')).toBe(W('1347736', 'en-US'))
  expect(urlWidgetOpenTable(LINK_DUENO, 'es')).toBe(W('1347736', 'es-MX'))
})

test('widget: link /restref/client/?rid= (el formato de fábrica de la 173) → ese rid, origen «Club Satori» si falta', () => {
  expect(urlWidgetOpenTable('https://www.opentable.com/restref/client/?rid=9990002', 'es')).toBe(W('9990002', 'es-MX'))
  expect(urlWidgetOpenTable('https://www.opentable.com/restref/client/?rid=9990002&lang=en-US', 'en')).toBe(W('9990002', 'en-US'))
  // si trae los dos, manda restref (el de los links /r/ que genera OpenTable)
  expect(urlWidgetOpenTable('https://www.opentable.com/r/x?restref=9990005&rid=1', 'es')).toBe(W('9990005', 'es-MX'))
})

test('widget: ot_source y ot_campaign salen del link (multi-local: cada local con su origen); raros → «Club Satori»', () => {
  expect(urlWidgetOpenTable('https://www.opentable.com/r/local-ficticio?restref=9990003&ot_source=Club%20Satori%20Nosara&ot_campaign=Socios', 'es'))
    .toBe(W('9990003', 'es-MX', 'Club%20Satori%20Nosara', 'Socios'))
  expect(urlWidgetOpenTable('https://www.opentable.com/r/x?restref=9990003&ot_source=Portal+Club', 'en')).toBe(W('9990003', 'en-US', 'Portal%20Club', 'Club%20Satori'))
  for (const raro of ['a%26restaurantIds%3D1', '%3Cscript%3E', 'x%22y', 'a'.repeat(61), '%20%20', 'https%3A%2F%2Fotro.test'])
    expect(urlWidgetOpenTable(`https://www.opentable.com/r/x?restref=9990003&ot_source=${raro}&ot_campaign=${raro}`, 'es')).toBe(W('9990003', 'es-MX'))
})

test('widget: sin link del local, o link malicioso / no OpenTable → el rid por defecto (config.ts) con origen «Club Satori»', () => {
  const porDefecto = W('1347736', 'es-MX')
  for (const malo of [null, undefined, '', 42, 'http://www.opentable.com/r?restref=9990002', 'https://reservas.ejemplo.test/r?restref=9990002',
    'https://www.opentable.com.otro.test/r?restref=9990002', 'https://www.opentable.com@otro.test/r?restref=9990002',
    'javascript:alert(1)//opentable.com?restref=9990002', 'https://www.opentable.com/r?restref=99"><script>'])
    expect(urlWidgetOpenTable(malo, 'es')).toBe(porDefecto)
})

test('widget: link de OpenTable válido pero sin rid de dígitos → SIN widget (nunca el de otro local); queda el botón', () => {
  for (const sinRid of ['https://www.opentable.com/r/local-ficticio', 'https://www.opentable.com/r/x?restref=12a4',
    'https://www.opentable.com/r/x?restref=1%26rid%3D2', 'https://www.opentable.com/r/x?rid=1234567890123'])
    expect(urlWidgetOpenTable(sinRid, 'es')).toBeNull()
})

test('widget: siempre https://www.opentable.com/widget/reservation/mural y sin nada del socio', () => {
  for (const l of [LINK_DUENO, null, 'https://www.opentable.com.mx/r/x?restref=9990004', 'https://restref.opentable.co.uk/client/?rid=9990006']) {
    const u = new URL(urlWidgetOpenTable(l, 'es')!)
    expect(u.origin).toBe('https://www.opentable.com')
    expect(u.pathname).toBe('/widget/reservation/mural')
    expect(u.searchParams.get('isNewTab')).toBe('true')
    expect([...u.searchParams.keys()].length).toBe(21)
  }
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8')
  expect([...main.matchAll(/urlWidgetOpenTable\(([^)]*)\)/g)].map(m => m[1])).toEqual(['socio.reserva_url, idioma'])
})

const TX = { titulo: 'Reservar una mesa', txt: 'x', boton: 'Reservar', abrir: 'Abrir en OpenTable', falla: 'No cargó', marco: 'Reservas de OpenTable' }

test('tarjeta con widget: iframe aislado (sandbox sin top-navigation, sin Referer, lazy, con título) y debajo el link tal cual', () => {
  const el = tarjetaReservar(TX, LINK_DUENO, urlWidgetOpenTable(LINK_DUENO, 'es'))!
  const f = el.querySelector('.reservar-widget > iframe') as HTMLIFrameElement
  expect(f.getAttribute('src')).toBe(W('1347736', 'es-MX'))
  expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')
  expect(WIDGET_SANDBOX).not.toMatch(/top-navigation|allow-modals|allow-downloads/)
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(f.getAttribute('loading')).toBe('lazy')
  expect(f.getAttribute('title')).toBe('Reservas de OpenTable')
  expect([f.getAttribute('width'), f.getAttribute('height')]).toEqual(['224', '301'])
  const a = el.querySelector('a.reservar-abrir')!
  expect(a.textContent).toBe('Abrir en OpenTable')
  expect(a.getAttribute('href')).toBe(LINK_DUENO)
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  expect(el.querySelector('a.btn')).toBeNull()
  expect((el.querySelector('.reservar-falla') as HTMLElement).hidden).toBe(true)
  // un src que no es el mural de www.opentable.com no se incrusta: queda el botón de siempre
  for (const otro of ['https://otro.test/widget/reservation/mural?x=1', 'https://www.opentable.com/widget/reservation/loader?rid=1']) {
    const t = tarjetaReservar(TX, LINK_DUENO, otro)!
    expect(t.querySelector('iframe')).toBeNull()
    expect(t.querySelector('a.btn')!.getAttribute('href')).toBe(LINK_DUENO)
  }
  expect(tarjetaReservar(TX, 'https://www.opentable.com/r/x', null)!.querySelector('a.btn')).not.toBeNull()
})

test('seguridad #214: ningún <script> de OpenTable — ni en la tarjeta ni en el código del portal', () => {
  const el = tarjetaReservar(TX, LINK_DUENO, urlWidgetOpenTable(LINK_DUENO, 'es'))!
  expect(el.querySelector('script')).toBeNull()
  const dir = dirname(fileURLToPath(import.meta.url))
  // el módulo del widget no crea scripts ni nombra el loader; en el resto del código del Club no aparece ningún host de OpenTable
  const reservar = readFileSync(join(dir, 'reservar.ts'), 'utf8')
  expect(reservar).not.toMatch(/createElement\(\s*['"]script['"]/)
  expect(reservar).not.toMatch(/widget\/reservation\/loader/)
  for (const f of readdirSync(dir).filter(x => x.endsWith('.ts') && !x.endsWith('.test.ts') && x !== 'reservar.ts'))
    expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/opentable\.[a-z]/i)
})

test('tarjeta con widget: si el iframe no carga en WIDGET_ESPERA_MS (o falla), se ve el aviso para usar el link', () => {
  vi.useFakeTimers()
  try {
    const b = tarjetaReservar(TX, LINK_DUENO, urlWidgetOpenTable(LINK_DUENO, 'es'))!
    vi.advanceTimersByTime(WIDGET_ESPERA_MS - 1)
    expect((b.querySelector('.reservar-falla') as HTMLElement).hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect((b.querySelector('.reservar-falla') as HTMLElement).hidden).toBe(false)

    const c = tarjetaReservar(TX, LINK_DUENO, urlWidgetOpenTable(LINK_DUENO, 'es'))!
    c.querySelector('iframe')!.dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(WIDGET_ESPERA_MS)
    expect((c.querySelector('.reservar-falla') as HTMLElement).hidden).toBe(true)

    const d = tarjetaReservar(TX, LINK_DUENO, urlWidgetOpenTable(LINK_DUENO, 'es'))!
    d.querySelector('iframe')!.dispatchEvent(new Event('error'))
    expect((d.querySelector('.reservar-falla') as HTMLElement).hidden).toBe(false)
  } finally { vi.useRealTimers() }
})

test('textos nuevos del widget en ES («usted») y EN', () => {
  expect(TEXTOS.es.reservar_abrir).toBe('Abrir en OpenTable')
  expect(TEXTOS.en.reservar_abrir).toBe('Open in OpenTable')
  expect(TEXTOS.es.reservar_falla).toMatch(/Puede abrirla/)
  expect(TEXTOS.en.reservar_falla.length).toBeGreaterThan(10)
  expect(TEXTOS.es.reservar_marco).toBe('Reservas de OpenTable')
  expect(TEXTOS.en.reservar_marco).toBe('OpenTable reservations')
})
