import { describe, it, expect } from 'vitest'
import {
  leerMonto, validarMovimiento,
  MSG_MONTO_CERO, MSG_MONTO_INVALIDO, MSG_MONTO_NEGATIVO, MSG_DOLARES_NEGATIVOS,
  MSG_VUELTO_SOLO_INGRESO, MSG_VUELTO_SIN_DOLARES,
} from './validarMovimiento'

// Montos de ejemplo, ficticios.
const err = (r: ReturnType<typeof validarMovimiento>) => (r.ok ? null : r.error)

describe('leerMonto', () => {
  it('vacío → 0; números y texto numérico → el número', () => {
    expect(leerMonto('')).toBe(0)
    expect(leerMonto(null)).toBe(0)
    expect(leerMonto(undefined)).toBe(0)
    expect(leerMonto('   ')).toBe(0)
    expect(leerMonto(12500)).toBe(12500)
    expect(leerMonto('12500')).toBe(12500)
    expect(leerMonto('12500.5')).toBe(12500.5)
    expect(leerMonto('12500,5')).toBe(12500.5)
    expect(leerMonto('-5000')).toBe(-5000)
  })
  it.each(['abc', '12abc', '1.2.3', '1,2,3', '--5', '₡', '1e5'])('«%s» → NaN (nunca 0)', v => {
    expect(leerMonto(v)).toBeNaN()
  })
  it('NaN, Infinity y lo que no es número ni texto → NaN', () => {
    expect(leerMonto(Number.NaN)).toBeNaN()
    expect(leerMonto(Number.POSITIVE_INFINITY)).toBeNaN()
    expect(leerMonto({})).toBeNaN()
    expect(leerMonto(true)).toBeNaN()
  })
})

describe('validarMovimiento — alta manual', () => {
  it('monto vacío en las dos monedas → «Ingresá un monto mayor a cero»', () => {
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: '', usd: '' }))).toBe(MSG_MONTO_CERO)
    expect(MSG_MONTO_CERO).toBe('Ingresá un monto mayor a cero.')
  })
  it('cero → rechazado', () => {
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: 0, usd: 0 }))).toBe(MSG_MONTO_CERO)
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: '0', usd: '' }))).toBe(MSG_MONTO_CERO)
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: '-0', usd: '' }))).toBe(MSG_MONTO_CERO)
  })
  it('no numérico → rechazado aunque la otra moneda tenga monto', () => {
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: 'abc', usd: '' }))).toBe(MSG_MONTO_INVALIDO)
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: 5000, usd: Number.NaN }))).toBe(MSG_MONTO_INVALIDO)
  })
  it('negativo (₡ o $) → rechazado, también en un ingreso con dólares (Ítem 2: el alta no carga vueltos)', () => {
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: -100, usd: 0 }))).toBe(MSG_MONTO_NEGATIVO)
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: 0, usd: -5 }))).toBe(MSG_MONTO_NEGATIVO)
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: -5000, usd: 100 }))).toBe(MSG_MONTO_NEGATIVO)
  })
  it('válido → devuelve los números (texto con coma incluido; -0 se normaliza)', () => {
    expect(validarMovimiento({ tipo: 'egreso_operativo', crc: '12500,50', usd: '' })).toEqual({ ok: true, crc: 12500.5, usd: 0 })
    expect(validarMovimiento({ tipo: 'ingreso', crc: '', usd: 20 })).toEqual({ ok: true, crc: 0, usd: 20 })
    const r = validarMovimiento({ tipo: 'ingreso', crc: -0, usd: 20 })
    expect(r.ok && Object.is(r.crc, 0)).toBe(true)
  })
})

describe('validarMovimiento — edición de un movimiento guardado', () => {
  // Vuelto: así guarda el Cierre del Día un cobro en dólares con vuelto en colones (recordCierreSales).
  const vuelto = { tipo: 'ingreso', crc: -5000, usd: 100 }

  it('vuelto válido (ingreso con $ y ₡ negativos) → se puede editar', () => {
    expect(validarMovimiento(vuelto, 'edicion')).toEqual({ ok: true, crc: -5000, usd: 100 })
    expect(validarMovimiento({ ...vuelto, crc: '-4000' }, 'edicion')).toEqual({ ok: true, crc: -4000, usd: 100 })
    expect(validarMovimiento({ ...vuelto, usd: '120' }, 'edicion')).toEqual({ ok: true, crc: -5000, usd: 120 })
  })
  it('vuelto pasado a egreso (cambio de tipo) → rechazado: el egreso quedaría negativo', () => {
    for (const tipo of ['egreso_operativo', 'egreso_mercaderia', 'egreso_personal', 'traspaso']) {
      expect(err(validarMovimiento({ ...vuelto, tipo }, 'edicion'))).toBe(MSG_VUELTO_SOLO_INGRESO)
    }
  })
  it('vuelto sin dólares → rechazado', () => {
    expect(err(validarMovimiento({ ...vuelto, usd: 0 }, 'edicion'))).toBe(MSG_VUELTO_SIN_DOLARES)
    expect(err(validarMovimiento({ ...vuelto, usd: '' }, 'edicion'))).toBe(MSG_VUELTO_SIN_DOLARES)
  })
  it('dólares negativos → rechazado siempre', () => {
    expect(err(validarMovimiento({ tipo: 'ingreso', crc: 1000, usd: -1 }, 'edicion'))).toBe(MSG_DOLARES_NEGATIVOS)
  })
  it('vacío, cero y no numérico → rechazado igual que en el alta', () => {
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: '', usd: 0 }, 'edicion'))).toBe(MSG_MONTO_CERO)
    expect(err(validarMovimiento({ tipo: 'egreso_operativo', crc: 'x1', usd: 0 }, 'edicion'))).toBe(MSG_MONTO_INVALIDO)
  })
})
