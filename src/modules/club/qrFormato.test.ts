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

import { planBValido, describirPos, posDeMesa } from '../../shared/api/club'
describe('mesa del PoS (piloto)', () => {
  it('plan B: mesa + exactamente 4 números', () => {
    expect(planBValido('10', '6012')).toBe(true)
    expect(planBValido('10', '601')).toBe(false)
    expect(planBValido('10', '60a2')).toBe(false)
    expect(planBValido('', '6012')).toBe(false)
  })
  it('describe la mesa elegida para la confirmación', () => {
    const p = posDeMesa({ pedido: '91', mesa: '41', salonero: 'X', total_crc: 25000, pax: 2, actualizado: '2026-11-06T01:00:00Z', dia: '2026-11-05' })
    expect(p).toMatchObject({ modo: 'mesa', mesa: '41', pedido: '91', total: 25000, dia: '2026-11-05' })
    expect(describirPos(p)).toBe('mesa 41 · ₡25.000')
    expect(describirPos({ modo: 'manual', mesa: '43', ultimos4: '6012' })).toBe('mesa 43 · tiquete …6012')
  })
})
