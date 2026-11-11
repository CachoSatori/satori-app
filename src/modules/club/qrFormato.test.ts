import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsearQR, esQrCaja, QR_CAJA_TARJETA_VIEJA, urlCupon, urlReferente, urlPortal, urlCanje, urlSocio, configurarClubUrl, clubUrl, MSG_SIN_DOMINIO } from './qrFormato'
import { aClubError, opcionesCanje, MSG_REFERENTE_INACTIVO } from '../../shared/api/club'

describe('parsearQR', () => {
  beforeEach(() => configurarClubUrl('https://club.ejemplo.test'))
  it('reconoce la URL de referente y la de cupón', () => {
    expect(parsearQR(urlReferente('ABCD2345'))).toEqual({ tipo: 'referente', codigo: 'ABCD2345' })
    expect(parsearQR(urlCupon('ABCD2345XY'))).toEqual({ tipo: 'cupon', codigo: 'ABCD2345XY' })
    expect(parsearQR('http://CLUB.ejemplo.test/C/abcd2345xy/')).toEqual({ tipo: 'cupon', codigo: 'ABCD2345XY' })
  })
  it('acepta el código solo, con espacios y minúsculas', () => {
    expect(parsearQR(' abcd 2345 ')).toEqual({ tipo: 'referente', codigo: 'ABCD2345' })
    expect(parsearQR('abcd2345xy')).toEqual({ tipo: 'cupon', codigo: 'ABCD2345XY' })
  })
  it('rechaza basura, otros dominios y caracteres ambiguos (0/O/1/I)', () => {
    expect(parsearQR('').tipo).toBe('desconocido')
    expect(parsearQR('<script>').tipo).toBe('desconocido')
    expect(parsearQR('https://otro.com/c/ABCD2345XY').tipo).toBe('desconocido')
    expect(parsearQR('ABCD0123').tipo).toBe('desconocido')
    expect(parsearQR('ABCDEFGHI').tipo).toBe('desconocido')
  })
  it('R-01: reconoce el código de canje (/k/ o 6 a mano)', () => {
    expect(parsearQR(urlCanje('ABC234'))).toEqual({ tipo: 'canje', codigo: 'ABC234' })
    expect(parsearQR(' abc 234 ')).toEqual({ tipo: 'canje', codigo: 'ABC234' })
    expect(parsearQR('ABC012').tipo).toBe('desconocido')
  })
  it('LC-A1: reconoce el QR fijo del socio (/s/ o 9 a mano), distinto del de cupones (/r/, 8)', () => {
    expect(parsearQR(urlSocio('ABCD2345K'))).toEqual({ tipo: 'socio', codigo: 'ABCD2345K' })
    expect(parsearQR(' abcd 2345 k ')).toEqual({ tipo: 'socio', codigo: 'ABCD2345K' })
    expect(parsearQR(urlReferente('ABCD2345'))).toEqual({ tipo: 'referente', codigo: 'ABCD2345' })
    expect(parsearQR('https://club.ejemplo.test/s/ABCD2345').tipo).toBe('desconocido')   // /s/ con 8 no es socio
  })
  it('arma la URL del portal', () => {
    expect(urlPortal('ab'.repeat(32))).toBe('https://club.ejemplo.test/p/' + 'ab'.repeat(32))
  })
})

describe('dominio por configuración (08-nov noche)', () => {
  it('sin dominio: los links fallan con un aviso claro y la caja solo acepta códigos sueltos', () => {
    configurarClubUrl(null)
    expect(() => clubUrl()).toThrow(MSG_SIN_DOMINIO)
    expect(() => urlReferente('ABCD2345')).toThrow(MSG_SIN_DOMINIO)
    expect(parsearQR('https://club.ejemplo.test/r/ABCD2345').tipo).toBe('desconocido')
    expect(parsearQR('ABCD2345')).toEqual({ tipo: 'referente', codigo: 'ABCD2345' })
  })
  it('lee solo el dominio configurado; mal formado = sin dominio', () => {
    configurarClubUrl('https://otro.ejemplo.test/')
    expect(parsearQR('https://otro.ejemplo.test/r/ABCD2345').tipo).toBe('referente')
    expect(parsearQR('https://club.ejemplo.test/r/ABCD2345').tipo).toBe('desconocido')
    expect(parsearQR('https://otroXejemplo.test/r/ABCD2345').tipo).toBe('desconocido')   // el punto no es comodín
    configurarClubUrl('http://club.ejemplo.test')
    expect(() => clubUrl()).toThrow(MSG_SIN_DOMINIO)
  })
})

describe('errores y opciones de canje', () => {
  it('REFERENTE_INACTIVO → mensaje de caja', () => {
    const e = aClubError({ message: 'REFERENTE_INACTIVO' })
    expect(e.message).toBe(MSG_REFERENTE_INACTIVO)
    expect(e.codigo).toBe('REFERENTE_INACTIVO')
    expect(e.esRed).toBe(false)
  })
  it('error de red → esRed (el p_op se reusa)', () => {
    expect(aClubError(new TypeError('Failed to fetch')).esRed).toBe(true)
    expect(aClubError({ message: 'Saldo insuficiente' }).esRed).toBe(false)
  })
  it('opciones 1 / 1,5 / 2 desde la config', () => {
    expect(opcionesCanje({ canje_min: 1, canje_paso: 0.5, max_creditos_por_visita: 2 })).toEqual([1, 1.5, 2])
  })
})

import { describirPos, describirPedido, describirFactura, marcaFactura, posDePedido, posDeFactura, posParaServidor } from '../../shared/api/club'
describe('pedido del PoS (piloto)', () => {
  it('describe el pedido como lo ve la caja: «Pedido 14 · Mesa 20 · ₡48.500»', () => {
    expect(describirPedido({ pedido: '14', mesa: '20', total_crc: 48500 })).toBe('Pedido 14 · Mesa 20 · ₡48.500')
    expect(describirPedido({ pedido: '3', mesa: null, total_crc: null })).toBe('Pedido 3 · sin total')
    // la mesa es (área, mesa): la mesa 4 del área '3' se muestra con su área
    expect(describirPedido({ pedido: '7', area: '3', mesa: '4', total_crc: 30000 })).toBe('Pedido 7 · Área 3 · Mesa 4 · ₡30.000')
  })
  it('al servidor solo va la clave (pedido o factura); mesa, total y hora los pone el servidor', () => {
    const p = posDePedido({ pedido: '14', mesa: '20', salonero: 'X', total_crc: 48500, pax: 4, actualizado: '2026-11-06T01:00:00Z' })
    expect(posParaServidor(p)).toEqual({ modo: 'pedido', pedido: '14' })
    expect(describirPos(p)).toBe('Pedido 14 · Mesa 20 · ₡48.500')
    const f = posDeFactura({ numero_factura: '900001', hora: '2026-11-06T01:21:30Z', total_crc: 48500, mesa: null, pedido: null })
    expect(posParaServidor(f)).toEqual({ modo: 'factura', numero_factura: '900001' })
  })
  it('plan B: la factura se describe con hora CR, total y mesa si tiene', () => {
    expect(describirFactura({ hora: '2026-11-06T01:21:30Z', total_crc: 48500, mesa: '20' })).toBe('19:21 · ₡48.500 · Mesa 20')
    expect(describirFactura({ hora: '2026-11-06T01:21:30Z', total_crc: 9000, mesa: null })).toBe('19:21 · ₡9.000')
    expect(describirFactura({ hora: '2026-11-06T01:21:30Z', total_crc: 9000, mesa: '20', consecutivo_fe: '00200001040000016012' }))
      .toBe('19:21 · ₡9.000 · Mesa 20 · tiquete …6012')
    expect(describirFactura({ hora: '2026-11-06T01:21:30Z', total_crc: 9000, area: '3', mesa: '4' })).toBe('19:21 · ₡9.000 · Área 3 · Mesa 4')
    expect(posParaServidor(posDePedido({ pedido: '7', area: '3', mesa: '4', salonero: null, total_crc: 1, pax: null, actualizado: '2026-11-06T01:00:00Z' })))
      .toEqual({ modo: 'pedido', pedido: '7' })
  })
  it('S0b: plan B marca la factura en R (cobrada, falta el cierre de caja); la cerrada no lleva marca', () => {
    expect(marcaFactura({ estado: 'R' })).toBe('Cobrada, falta el cierre de caja: vale igual')
    expect(marcaFactura({ estado: 'C' })).toBeNull()
    expect(marcaFactura({})).toBeNull()
  })
})

import { parsearPegado } from './comparacionPegado'
describe('comparación con la página vieja: pegado', () => {
  it('acepta ; tab o coma, y descarta lo que no entiende', () => {
    expect(parsearPegado('Ana Ficticia;2026-11-02;7\nBeto Ficticio\t2026-11-09\t3\nCaro, Ficticia,2026-11-02,4\nbasura')).toEqual([
      { referente: 'Ana Ficticia', semana: '2026-11-02', personas: 7 },
      { referente: 'Beto Ficticio', semana: '2026-11-09', personas: 3 },
      { referente: 'Caro, Ficticia', semana: '2026-11-02', personas: 4 },
    ])
  })
})

describe('(11-nov) QR único de caja: «Tarjeta vieja (sin QR)»', () => {
  beforeEach(() => configurarClubUrl('https://club.ejemplo.test'))
  it('se reconoce con espacios y en minúsculas; nada más lo es', () => {
    expect(esQrCaja(QR_CAJA_TARJETA_VIEJA)).toBe(true)
    expect(esQrCaja('  satori-caja:tarjeta-vieja \n')).toBe(true)
    for (const no of ['', null, undefined, 'SATORI-CAJA', 'SATORI-CAJA:TARJETA-VIEJA-2', urlReferente('ABCD2345'), 'ABCD2345']) expect(esQrCaja(no)).toBe(false)
  })
  it('el cartel de caja lleva exactamente ese código', () => {
    const guion = readFileSync(new URL('../../../scripts/club/cartel_caja.mjs', import.meta.url), 'utf8')
    expect(guion).toContain(`export const QR_CAJA_TARJETA_VIEJA = '${QR_CAJA_TARJETA_VIEJA}'`)
  })
  it('no es un link ni un código del Club: la cámara de un teléfono no abre nada y club_resolver no lo conoce', () => {
    expect(QR_CAJA_TARJETA_VIEJA).not.toMatch(/^https?:|\/|\./)
    expect(parsearQR(QR_CAJA_TARJETA_VIEJA)).toEqual({ tipo: 'desconocido', codigo: null })
  })
})
