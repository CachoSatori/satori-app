import { describe, it, expect } from 'vitest'
import { parsearQR, urlCupon, urlReferente, urlPortal } from './qrFormato'
import { aClubError, opcionesCanje, MSG_REFERENTE_INACTIVO } from '../../shared/api/club'

describe('parsearQR', () => {
  it('reconoce la URL de referente y la de cupón', () => {
    expect(parsearQR(urlReferente('ABCD2345'))).toEqual({ tipo: 'referente', codigo: 'ABCD2345' })
    expect(parsearQR(urlCupon('ABCD2345XY'))).toEqual({ tipo: 'cupon', codigo: 'ABCD2345XY' })
    expect(parsearQR('http://CLUB.satoricostarica.com/C/abcd2345xy/')).toEqual({ tipo: 'cupon', codigo: 'ABCD2345XY' })
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
  it('arma la URL del portal', () => {
    expect(urlPortal('ab'.repeat(32))).toBe('https://club.satoricostarica.com/p/' + 'ab'.repeat(32))
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

import { describirPos, describirPedido, describirFactura, posDePedido, posDeFactura, posParaServidor } from '../../shared/api/club'
describe('pedido del PoS (piloto)', () => {
  it('describe el pedido como lo ve la caja: «Pedido 14 · Mesa 20 · ₡48.500»', () => {
    expect(describirPedido({ pedido: '14', mesa: '20', total_crc: 48500 })).toBe('Pedido 14 · Mesa 20 · ₡48.500')
    expect(describirPedido({ pedido: '3', mesa: null, total_crc: null })).toBe('Pedido 3 · sin total')
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
  })
})
