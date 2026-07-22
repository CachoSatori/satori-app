import { describe, it, expect } from 'vitest'
import type { CashMovement } from '../../shared/types/database'
import {
  CAJAS_FISICAS,
  contribucionPozo,
  cuentaEnPozo,
  esCajaFisica,
  esEfectivo,
  parseTraspaso,
  saldoPozoEfectivo,
} from './pozo'

// Fábrica mínima: solo importan los campos que el pozo mira. El resto se rellena para
// satisfacer el tipo sin ensuciar cada caso de prueba.
function mov(p: Partial<CashMovement>): CashMovement {
  return {
    id: p.id ?? 'm1',
    session_id: null,
    created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 0,
    amount_usd: p.amount_usd ?? 0,
    currency: 'CRC',
    exchange_rate: 500,
    description: p.description ?? '',
    subcategory: p.subcategory ?? '',
    supplier_id: null,
    supplier_name: null,
    employee_name: null,
    method: p.method ?? 'Efectivo',
    shift: '',
    caja_origen: p.caja_origen ?? 'Caja Fuerte',
    status: p.status ?? 'aprobado',
    approved_by: null,
    approved_at: null,
    account_id: null,
    created_at: '2026-07-01T12:00:00+00:00',
    updated_at: '2026-07-01T12:00:00+00:00',
  } as CashMovement
}

const crc = (movs: CashMovement[]) => saldoPozoEfectivo(movs).crc

describe('pozo — qué mueve el efectivo', () => {
  it('un pago a proveedor en efectivo RESTA del pozo', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'ingreso', caja_origen: 'Caja Fuerte', amount_crc: 100_000 }),
      mov({ movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores', amount_crc: 30_000 }),
    ])
    expect(r.crc).toBe(70_000)
    expect(r.indeterminados.cantidad).toBe(0)
  })

  it('una propina pagada desde la Registradora RESTA (aunque la Caja Fuerte ni se entere)', () => {
    const propina = mov({
      movement_type: 'egreso_personal',
      caja_origen: 'Registradora',
      subcategory: 'Propinas por turno',
      amount_crc: 27_850,
    })
    expect(crc([propina])).toBe(-27_850)
    expect(contribucionPozo(propina).clase).toBe('egreso')
  })

  it('los 4 tipos de egreso restan igual', () => {
    for (const t of ['egreso_mercaderia', 'egreso_personal', 'egreso_operativo', 'egreso_socios'] as const) {
      expect(crc([mov({ movement_type: t, amount_crc: 1_000 })])).toBe(-1_000)
    }
  })

  it('cuenta las tres cajas físicas y deja el Banco afuera', () => {
    for (const caja of CAJAS_FISICAS) {
      expect(crc([mov({ caja_origen: caja, amount_crc: 500 })])).toBe(500)
    }
    expect(crc([mov({ caja_origen: 'Banco', amount_crc: 500 })])).toBe(0)
    expect(contribucionPozo(mov({ caja_origen: 'Banco', amount_crc: 500 })).clase).toBe('fuera')
  })
})

describe('pozo — traspasos', () => {
  it('un traspaso entre cajas físicas es NEUTRO: la plata cambia de bolsillo, no de casa', () => {
    const t = mov({
      movement_type: 'traspaso',
      caja_origen: 'Registradora',
      subcategory: 'Registradora → Caja Fuerte',
      amount_crc: 400_000,
    })
    expect(crc([t])).toBe(0)
    expect(contribucionPozo(t).clase).toBe('traspaso-interno')
    expect(saldoPozoEfectivo([t]).indeterminados.cantidad).toBe(0)
  })

  it("'Caja Fuerte → Banco' RESTA — el efectivo se fue de la casa", () => {
    const t = mov({
      movement_type: 'traspaso',
      caja_origen: 'Caja Fuerte',
      subcategory: 'Caja Fuerte → Banco',
      amount_crc: 250_000,
    })
    expect(crc([t])).toBe(-250_000)
    expect(contribucionPozo(t).clase).toBe('traspaso-sale-a-banco')
  })

  it("'Banco → Caja Fuerte' SUMA", () => {
    const t = mov({
      movement_type: 'traspaso',
      caja_origen: 'Caja Fuerte',
      subcategory: 'Banco → Caja Fuerte',
      amount_crc: 250_000,
    })
    expect(crc([t])).toBe(250_000)
    expect(contribucionPozo(t).clase).toBe('traspaso-entra-de-banco')
  })

  it('la dirección la manda subcategory, NO el method: un depósito cargado como Transferencia igual resta', () => {
    // Los depósitos históricos están cargados con method='Transferencia' aunque lo que
    // salió de la bóveda fueron billetes. Si mirásemos el method, se perderían.
    const deposito = mov({
      movement_type: 'traspaso',
      caja_origen: 'Caja Fuerte',
      method: 'Transferencia',
      subcategory: 'Caja Fuerte → Banco',
      amount_crc: 11_206_886,
    })
    expect(crc([deposito])).toBe(-11_206_886)
  })

  it("'Otro traspaso' queda NEUTRO pero contado en indeterminados", () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'traspaso', subcategory: 'Otro traspaso', amount_crc: 90_000, amount_usd: 5 }),
    ])
    expect(r.crc).toBe(0)
    expect(r.usd).toBe(0)
    expect(r.indeterminados).toEqual({ cantidad: 1, crc: 90_000, usd: 5 })
  })

  it('un traspaso sin subcategory también cae en indeterminados', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'traspaso', caja_origen: 'Registradora', subcategory: '', amount_crc: 6_180 }),
      mov({ movement_type: 'traspaso', caja_origen: 'Registradora', subcategory: 'Ajuste', amount_crc: 14_020 }),
    ])
    expect(r.crc).toBe(0)
    expect(r.indeterminados).toEqual({ cantidad: 2, crc: 20_200, usd: 0 })
  })

  it('un traspaso sin ninguna punta física (Banco → Banco) no mueve el pozo y se cuenta', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'traspaso', caja_origen: 'Banco', subcategory: 'Banco → Banco', amount_crc: 1_000 }),
    ])
    expect(r.crc).toBe(0)
    expect(r.indeterminados.cantidad).toBe(1)
  })

  it('un indeterminado con monto nulo se cuenta igual, sumando cero', () => {
    // Solo en dólares y con el colón en null: el contador tiene que subir sin arrastrar NaN.
    const r = saldoPozoEfectivo([
      mov({
        movement_type: 'traspaso',
        subcategory: 'Otro traspaso',
        amount_crc: null as unknown as number,
        amount_usd: 40,
      }),
    ])
    expect(r.indeterminados).toEqual({ cantidad: 1, crc: 0, usd: 40 })
    expect(r.crc).toBe(0)
  })

  it('indeterminados NO está sumado al saldo — se devuelve aparte', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'ingreso', amount_crc: 10_000 }),
      mov({ movement_type: 'traspaso', subcategory: 'Otro traspaso', amount_crc: 999_999 }),
    ])
    expect(r.crc).toBe(10_000)
    expect(r.indeterminados.crc).toBe(999_999)
  })
})

describe('pozo — qué NO cuenta', () => {
  it('excluye pendiente Y rechazado (a diferencia de saldoCajaFuerte, que solo excluye pendiente)', () => {
    expect(crc([mov({ movement_type: 'egreso_mercaderia', amount_crc: 5_000, status: 'pendiente' })])).toBe(0)
    expect(crc([mov({ movement_type: 'egreso_mercaderia', amount_crc: 5_000, status: 'rechazado' })])).toBe(0)
    expect(crc([mov({ movement_type: 'egreso_mercaderia', amount_crc: 5_000, status: 'aprobado' })])).toBe(-5_000)
  })

  it('un traspaso pendiente o rechazado tampoco entra a indeterminados', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'traspaso', subcategory: 'Otro traspaso', amount_crc: 100, status: 'rechazado' }),
    ])
    expect(r.indeterminados.cantidad).toBe(0)
    expect(contribucionPozo(mov({ status: 'pendiente' })).clase).toBe('fuera')
  })

  it('ignora los métodos que no son efectivo', () => {
    for (const method of ['Transferencia', 'SINPE', 'tarjeta', 'Lafise']) {
      expect(crc([mov({ movement_type: 'egreso_operativo', method, amount_crc: 9_000 })])).toBe(0)
    }
  })

  it('una fila SIN method cuenta como efectivo (filas viejas anteriores al campo)', () => {
    expect(crc([mov({ movement_type: 'egreso_operativo', method: '', amount_crc: 9_000 })])).toBe(-9_000)
    expect(crc([mov({ movement_type: 'egreso_operativo', method: null as unknown as string, amount_crc: 9_000 })])).toBe(-9_000)
    expect(crc([mov({ movement_type: 'ingreso', method: '  EFECTIVO  ', amount_crc: 7_000 })])).toBe(7_000)
  })

  it('un movement_type desconocido no mueve nada', () => {
    const raro = mov({ movement_type: 'ajuste_marciano' as unknown as CashMovement['movement_type'], amount_crc: 1_000 })
    expect(crc([raro])).toBe(0)
    expect(contribucionPozo(raro).clase).toBe('fuera')
  })

  it('montos nulos o ausentes se tratan como cero', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'ingreso', amount_crc: null as unknown as number, amount_usd: null as unknown as number }),
    ])
    expect(r).toEqual({ crc: 0, usd: 0, indeterminados: { cantidad: 0, crc: 0, usd: 0 } })
  })
})

describe('pozo — dólares', () => {
  it('lleva CRC y USD por separado, con las mismas reglas', () => {
    const r = saldoPozoEfectivo([
      mov({ movement_type: 'ingreso', amount_crc: 100_000, amount_usd: 200 }),
      mov({ movement_type: 'egreso_socios', caja_origen: 'Caja Fuerte', amount_crc: 0, amount_usd: 50 }),
      mov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco', amount_crc: 10_000, amount_usd: 20 }),
      mov({ movement_type: 'traspaso', subcategory: 'Registradora → Caja Fuerte', amount_crc: 5_000, amount_usd: 5 }),
    ])
    expect(r.crc).toBe(90_000)
    expect(r.usd).toBe(130)
  })
})

describe('pozo — helpers', () => {
  it('esCajaFisica / esEfectivo / cuentaEnPozo', () => {
    expect(esCajaFisica('Caja Fuerte')).toBe(true)
    expect(esCajaFisica('Banco')).toBe(false)
    expect(esCajaFisica(null)).toBe(false)
    expect(esEfectivo(undefined)).toBe(true)
    expect(esEfectivo('Efectivo')).toBe(true)
    expect(esEfectivo('SINPE')).toBe(false)
    expect(cuentaEnPozo('aprobado')).toBe(true)
    expect(cuentaEnPozo('PENDIENTE')).toBe(false)
    expect(cuentaEnPozo(null)).toBe(true)
  })

  it('parseTraspaso lee las tres flechas y rechaza lo ilegible', () => {
    expect(parseTraspaso('Caja Fuerte → Banco')).toEqual({ origen: 'Caja Fuerte', destino: 'Banco' })
    expect(parseTraspaso('Registradora -> Caja Fuerte')).toEqual({ origen: 'Registradora', destino: 'Caja Fuerte' })
    expect(parseTraspaso('Banco => Caja Fuerte')).toEqual({ origen: 'Banco', destino: 'Caja Fuerte' })
    expect(parseTraspaso('Otro traspaso')).toBeNull()
    expect(parseTraspaso(null)).toBeNull()
    expect(parseTraspaso('→ Caja Fuerte')).toBeNull()
    expect(parseTraspaso('A → B → C')).toBeNull()
  })

  it('el saldo de una lista vacía es cero', () => {
    expect(saldoPozoEfectivo([])).toEqual({ crc: 0, usd: 0, indeterminados: { cantidad: 0, crc: 0, usd: 0 } })
  })
})
