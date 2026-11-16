// @vitest-environment happy-dom
// D 16-nov (el dueño, opción B): las reservas del Club se separan en OpenTable por campaña (ot_campaign) según desde dónde
// se reserva. ot_source queda como viene; nada del socio viaja a OpenTable. Links ficticios (rid 999…).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conCampanaOpenTable, GRUPOS_RESERVA, urlReservaSocio, urlWidgetOpenTable, type GrupoReserva } from './reservar'
import { botonReservaCupon } from './reservaCupon'

const BASE = 'https://www.opentable.com/restref/client/?rid=9990201&lang=es-MX&ot_source=Club%20Satori'
const CON_CAMP = 'https://www.opentable.com/r/local-ficticio?restref=9990202&ot_source=Club%20Satori&ot_campaign=Club%20Satori&lang=en-US'

test('reemplazo: ot_campaign cambia por el grupo EN SU LUGAR; ot_source y el resto, tal cual', () => {
  expect(conCampanaOpenTable(CON_CAMP, 'local'))
    .toBe('https://www.opentable.com/r/local-ficticio?restref=9990202&ot_source=Club%20Satori&ot_campaign=local&lang=en-US')
})

test('agregado: sin ot_campaign se agrega al final (antes del #)', () => {
  expect(conCampanaOpenTable(BASE, 'turista')).toBe(BASE + '&ot_campaign=turista')
  expect(conCampanaOpenTable(BASE + '#x', 'turista')).toBe(BASE + '&ot_campaign=turista#x')
  expect(conCampanaOpenTable(BASE + '&', 'turista')).toBe(BASE + '&ot_campaign=turista')
})

test('cada grupo deja su etiqueta exacta', () => {
  expect(GRUPOS_RESERVA).toEqual(['local', 'turista', 'referente', 'cumpleanos'])
  for (const g of GRUPOS_RESERVA) {
    expect(new URL(conCampanaOpenTable(CON_CAMP, g)).searchParams.getAll('ot_campaign')).toEqual([g])
    expect(new URL(conCampanaOpenTable(BASE, g)).searchParams.getAll('ot_campaign')).toEqual([g])
  }
})

test('ot_campaign repetido o codificado (ot%5Fcampaign) queda uno solo, con el grupo', () => {
  const dup = BASE + '&ot_campaign=a&lang=en-US&ot_campaign=b&ot%5Fcampaign=c'
  expect(conCampanaOpenTable(dup, 'referente')).toBe(BASE + '&ot_campaign=referente&lang=en-US')
})

test('sin ot_source (o vacío) NO se inventa nada: el link queda igual', () => {
  for (const u of ['https://www.opentable.com/restref/client/?rid=9990203', 'https://www.opentable.com/restref/client/?rid=9990203&ot_campaign=x',
    'https://www.opentable.com/restref/client/?rid=9990203&ot_source=', 'https://www.opentable.com/restref/client/?rid=9990203&ot_source',
    'https://www.opentable.com/r/local-ficticio', 'https://www.opentable.com/r/x#ot_source=Club'])
    for (const g of GRUPOS_RESERVA) expect(conCampanaOpenTable(u, g), u).toBe(u)
})

test('host no válido (no OpenTable, http, usuario@, puerto, parecido) → el link no se toca', () => {
  for (const u of ['https://reservas.ejemplo.test/r?rid=1&ot_source=Club', 'http://www.opentable.com/r?rid=1&ot_source=Club',
    'https://www.opentable.com@otro.test/r?ot_source=Club', 'https://www.opentable.com:8443/r?ot_source=Club',
    'https://www.opentable.com.otro.test/r?ot_source=Club', 'https://otroopentable.com/r?ot_source=Club'])
    expect(conCampanaOpenTable(u, 'local'), u).toBe(u)
})

test('un grupo que no es de los cuatro no cambia nada', () => {
  expect(conCampanaOpenTable(CON_CAMP, 'Juan Pérez' as GrupoReserva)).toBe(CON_CAMP)
})

test('nada del socio: los parámetros que salen son los del link + ot_campaign=<grupo>', () => {
  for (const g of GRUPOS_RESERVA) {
    const sale = new URL(conCampanaOpenTable(BASE, g)).searchParams
    expect([...sale.keys()]).toEqual(['rid', 'lang', 'ot_source', 'ot_campaign'])
    expect(sale.get('ot_source')).toBe('Club Satori')
  }
})

test('botón del portal: link del local con «local»; sin link del local → rid por defecto sin campaña', () => {
  expect(urlReservaSocio(BASE, 'local')).toBe(BASE + '&ot_campaign=local')
  expect(urlReservaSocio(null, 'local')).toBe('https://www.opentable.com/restref/client/?rid=1347736')
})

test('widget: otCampaign = el grupo y otSource tal cual cuando el link trae ot_source', () => {
  for (const g of GRUPOS_RESERVA) {
    const q = new URL(urlWidgetOpenTable(CON_CAMP, 'es', g)!).searchParams
    expect(q.get('otCampaign')).toBe(g)
    expect(q.get('otSource')).toBe('Club Satori')
    expect(q.get('restaurantIds')).toBe('9990202')
  }
  // sin ot_source en el link: el widget sigue como antes (campaña del link o «Club Satori»), no toma el grupo
  const sinSrc = new URL(urlWidgetOpenTable('https://www.opentable.com/r/x?restref=9990204&ot_campaign=Viejo', 'es', 'local')!).searchParams
  expect(sinSrc.get('otCampaign')).toBe('Viejo')
})

test('página del cupón del turista: campaña «turista»; sin ot_source, el link igual', () => {
  expect(botonReservaCupon({ reserva: CON_CAMP }, 'Reservar una mesa')!.getAttribute('href'))
    .toBe(CON_CAMP.replace('ot_campaign=Club%20Satori', 'ot_campaign=turista'))
  const sinSrc = 'https://www.opentable.com/restref/client/?rid=9990205'
  expect(botonReservaCupon({ reserva: sinSrc }, 'x')!.getAttribute('href')).toBe(sinSrc)
})

test('main.ts: el portal del socio usa «local» y en ningún lado del portal aparece otro grupo (referente sin punto de uso)', () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8')
  expect([...main.matchAll(/urlReservaSocio\(([^)]*)\)/g)].map(m => m[1])).toEqual(["socio.reserva_url, 'local'"])
  expect(main).not.toMatch(/'(referente|cumpleanos|turista)'\)/)
})
