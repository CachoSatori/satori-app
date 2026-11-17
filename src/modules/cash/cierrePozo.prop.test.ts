// Pruebas de PROPIEDADES del «debería» del cierre sobre el pozo único (sagrado `cierrePozo.ts` y su núcleo
// `pozo.ts`; ninguno se toca). No se reabre el modelo de caja: se prueba el que está (ver ESTADO).
//
// Ledgers ficticios de unos días de agosto con sesiones, asientos de apertura y filas que genera el propio
// cierre. Colones enteros; dólares con 2 decimales, comparados en centavos (redondeo declarado).
//
// Semilla fija (R11). Si cae, fast-check imprime semilla y `path`; otra: `FC_SEED=123 npx vitest run <archivo>`.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { CashMovement, CashSession, MovementType } from '../../shared/types/database'
import { MOVEMENT_TYPES, CAJAS_ORIGEN, METODOS_PAGO } from './cashUtils'
import { saldoPozoEfectivo, contribucionPozo } from './pozo'
import {
  basePozoParaCierre, deberiaPozo, SUBCAT_VENTAS_CIERRE, SUBCAT_AJUSTE_CIERRE, SUBCAT_APERTURA_POZO, DESC_RETIRO_CIERRE,
} from './cierrePozo'

const SEED = Number(process.env.FC_SEED ?? 20261117)
fc.configureGlobal({ seed: SEED, numRuns: 300 })

const DIAS = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']
const SESIONES: CashSession[] = DIAS.map((d, i) => ({ id: `s${i}`, session_date: d, status: 'closed' }) as CashSession)

const crc = fc.integer({ min: 0, max: 1_000_000 })
const usd = fc.integer({ min: 0, max: 200_000 }).map(c => c / 100)
const dia = fc.constantFrom(...DIAS)
// created_at: mediodía o 23:30 CR (05:30 UTC del día siguiente, R10)
const instante = fc.tuple(dia, fc.boolean()).map(([d, noche]) => {
  if (!noche) return `${d}T18:00:00+00:00`
  const sig = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  return `${sig}T05:30:00+00:00`
})
const SUB_TRASPASO = ['Registradora → Caja Fuerte', 'Caja Fuerte → Banco', 'Caja Fuerte → Caja Proveedores', 'Banco → Caja Fuerte', 'Otro traspaso', '', 'Banco → Banco']

let seq = 0
function armar(p: Partial<CashMovement> & { movement_type: MovementType }): CashMovement {
  seq += 1
  return {
    id: `m${seq}`, session_id: null, created_by: 'u-ficticio', amount_crc: 0, amount_usd: 0, currency: 'CRC',
    exchange_rate: 500, description: '', subcategory: '', supplier_id: null, supplier_name: null, employee_name: null,
    method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado', approved_by: null, approved_at: null,
    account_id: null, created_at: '2026-08-04T18:00:00+00:00', updated_at: '2026-08-04T18:00:00+00:00', ...p,
  } as CashMovement
}

/** Movimiento operativo cualquiera (no generado por un cierre). */
const operativo = fc.record({
  movement_type: fc.constantFrom(...MOVEMENT_TYPES),
  amount_crc: crc, amount_usd: usd,
  caja_origen: fc.constantFrom(...CAJAS_ORIGEN),
  method: fc.constantFrom(...METODOS_PAGO, ''),
  status: fc.constantFrom('aprobado', 'aprobado', 'pendiente', 'rechazado'),
  sub: fc.constantFrom(...SUB_TRASPASO),
  session_id: fc.option(fc.constantFrom(...SESIONES.map(s => s.id)), { nil: null }),
  created_at: instante,
}).map(({ sub, ...m }) => armar({ ...m, subcategory: m.movement_type === 'traspaso' ? sub : '' } as CashMovement))

const apertura = fc.tuple(dia, crc, usd, instante).map(([d, c, u, t]) =>
  armar({ movement_type: 'ingreso', subcategory: SUBCAT_APERTURA_POZO, description: `${SUBCAT_APERTURA_POZO} ${d}`, amount_crc: c, amount_usd: u, created_at: t }))

/** Filas que escribe el cierre del día `d` (ventas, ajuste, retiro), con un created_at cualquiera (sellado tarde). */
const filaDeCierre = (d: string) => fc.tuple(fc.constantFrom('ventas', 'ajuste', 'retiro'), crc, usd, instante,
  fc.option(fc.constantFrom(...SESIONES.map(s => s.id)), { nil: null })).map(([k, c, u, t, sid]) =>
  k === 'ventas' ? armar({ movement_type: 'ingreso', subcategory: SUBCAT_VENTAS_CIERRE, description: `${SUBCAT_VENTAS_CIERRE} ${d}`, amount_crc: c, amount_usd: u, created_at: t, session_id: sid })
  : k === 'ajuste' ? armar({ movement_type: 'ingreso', subcategory: SUBCAT_AJUSTE_CIERRE, description: `${SUBCAT_AJUSTE_CIERRE} ${d}`, amount_crc: c, created_at: t, session_id: sid })
  : armar({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco', description: `${DESC_RETIRO_CIERRE} ${d}`, amount_crc: c, created_at: t, session_id: sid }))

const ledger = fc.tuple(
  fc.array(operativo, { maxLength: 40 }),
  fc.array(apertura, { maxLength: 2 }),
  fc.array(dia.chain(filaDeCierre), { maxLength: 6 }),
).map(([a, b, c]) => [...a, ...b, ...c])

const ventas = fc.record({ efRealM: crc, efRealN: crc, vmUsd: usd, vnUsd: usd, retiroCrc: crc })
type Ventas = { efRealM: number; efRealN: number; vmUsd: number; vnUsd: number; retiroCrc: number }

const deberia = (movs: CashMovement[], fecha: string, v: Ventas) =>
  deberiaPozo({ base: basePozoParaCierre(movs, SESIONES, fecha), ...v })
const cent = (s: { crc: number; usd: number }) => ({ crc: s.crc, usd: Math.round(s.usd * 100) })
const permutado = ledger.chain(l => fc.tuple(fc.constant(l), fc.shuffledSubarray(l, { minLength: l.length, maxLength: l.length })))

describe('saldoPozoEfectivo — propiedades', () => {
  it('el saldo es exactamente Σ contribucionPozo fila por fila', () => {
    fc.assert(fc.property(ledger, l => {
      const s = saldoPozoEfectivo(l)
      const sum = l.reduce((a, m) => { const c = contribucionPozo(m); return { crc: a.crc + c.crc, usd: a.usd + c.usd } }, { crc: 0, usd: 0 })
      expect(cent(s)).toEqual(cent(sum))
    }))
  })

  it('aditividad y conmutatividad', () => {
    fc.assert(fc.property(permutado, ledger, ([a, perm], b) => {
      expect(cent(saldoPozoEfectivo(perm))).toEqual(cent(saldoPozoEfectivo(a)))
      const sa = saldoPozoEfectivo(a), sb = saldoPozoEfectivo(b), sab = saldoPozoEfectivo([...a, ...b])
      expect(cent(sab)).toEqual(cent({ crc: sa.crc + sb.crc, usd: sa.usd + sb.usd }))
      expect(sab.indeterminados.cantidad).toBe(sa.indeterminados.cantidad + sb.indeterminados.cantidad)
    }))
  })

  it('neutros: traspasos entre cajas físicas, pendientes y rechazados no mueven el saldo', () => {
    const neutro = operativo.chain(m => fc.constantFrom<Partial<CashMovement>>(
      { status: 'pendiente' }, { status: 'rechazado' },
      { movement_type: 'traspaso', subcategory: 'Registradora → Caja Fuerte', status: 'aprobado' },
      { movement_type: 'traspaso', subcategory: 'Caja Fuerte → Caja Proveedores', status: 'aprobado' },
    ).map(c => ({ ...m, ...c })))
    fc.assert(fc.property(ledger, fc.array(neutro, { maxLength: 10 }), (l, ns) => {
      const s0 = saldoPozoEfectivo(l), s1 = saldoPozoEfectivo([...l, ...ns])
      expect(cent(s1)).toEqual(cent(s0))
    }))
  })

  it('depósito al banco y retiro del banco por el mismo monto se cancelan', () => {
    fc.assert(fc.property(ledger, crc, usd, fc.constantFrom('Caja Fuerte', 'Registradora', 'Caja Proveedores'), (l, c, u, caja) => {
      const sale = armar({ movement_type: 'traspaso', subcategory: `${caja} → Banco`, amount_crc: c, amount_usd: u })
      const entra = armar({ movement_type: 'traspaso', subcategory: `Banco → ${caja}`, amount_crc: c, amount_usd: u })
      expect(cent(saldoPozoEfectivo([...l, sale, entra]))).toEqual(cent(saldoPozoEfectivo(l)))
    }))
  })
})

describe('«debería» del cierre (deberiaPozo + basePozoParaCierre) — propiedades', () => {
  it('modelo: debería = pozo(base) + efectivo real M + N − retiro (₡) y pozo(base) + ventas USD ($)', () => {
    fc.assert(fc.property(ledger, dia, ventas, (l, f, v) => {
      const pozo = saldoPozoEfectivo(basePozoParaCierre(l, SESIONES, f))
      const d = deberia(l, f, v)
      expect(d.crc).toBe(pozo.crc + v.efRealM + v.efRealN - v.retiroCrc)
      expect(Math.round(d.usd * 100)).toBe(Math.round((pozo.usd + v.vmUsd + v.vnUsd) * 100))
    }))
  })

  it('conmutatividad: el orden de los movimientos no cambia el debería', () => {
    fc.assert(fc.property(permutado, dia, ventas, ([l, perm], f, v) => {
      expect(cent(deberia(perm, f, v))).toEqual(cent(deberia(l, f, v)))
    }))
  })

  it('idempotencia: filtrar la base dos veces da la misma base', () => {
    fc.assert(fc.property(ledger, dia, (l, f) => {
      const b1 = basePozoParaCierre(l, SESIONES, f)
      expect(basePozoParaCierre(b1, SESIONES, f).map(m => m.id)).toEqual(b1.map(m => m.id))
    }))
  })

  it('re-cierre: las filas que genera el cierre de `fecha` no cambian el debería de esa fecha', () => {
    fc.assert(fc.property(ledger, dia, ventas, (l, f, v) =>
      fc.assert(fc.property(fc.array(filaDeCierre(f), { minLength: 1, maxLength: 3 }), propias => {
        expect(cent(deberia([...l, ...propias], f, v))).toEqual(cent(deberia(l, f, v)))
      }), { numRuns: 3 })), { numRuns: 100 })
  })

  it('orden de sellado: cambiar created_at / sesión de las filas de cierre no mueve el debería de ningún día', () => {
    const retocar = (m: CashMovement) => fc.tuple(instante, fc.option(fc.constantFrom(...SESIONES.map(s => s.id)), { nil: null }))
      .map(([t, sid]) => ({ ...m, created_at: t, updated_at: t, session_id: sid }))
    const conRetoque = fc.tuple(fc.array(operativo, { maxLength: 30 }), fc.array(dia.chain(filaDeCierre), { minLength: 1, maxLength: 6 }))
      .chain(([ops, cierres]) => fc.tuple(fc.constant(ops), fc.constant(cierres), fc.tuple(...cierres.map(retocar))))
    fc.assert(fc.property(conRetoque, dia, ventas, ([ops, cierres, retocados], f, v) => {
      expect(cent(deberia([...ops, ...retocados], f, v))).toEqual(cent(deberia([...ops, ...cierres], f, v)))
    }))
  })

  it('apertura: lo anterior al asiento de apertura no cuenta en el debería de días ≥ apertura', () => {
    // Asiento el 2026-08-04; movimientos operativos del 02 y 03 (por sesión, created_at de ese día).
    const ap = apertura.map(m => ({ ...m, description: `${SUBCAT_APERTURA_POZO} 2026-08-04` }))
    const viejo = fc.tuple(operativo, fc.constantFrom(0, 1)).map(([m, i]) => ({ ...m, session_id: SESIONES[i].id, created_at: `${DIAS[i]}T18:00:00+00:00` }))
    fc.assert(fc.property(fc.array(operativo, { maxLength: 30 }), ap, fc.array(viejo, { minLength: 1, maxLength: 10 }),
      fc.constantFrom('2026-08-04', '2026-08-05', '2026-08-06'), ventas, (l, a, viejos, f, v) => {
        expect(cent(deberia([...l, a, ...viejos], f, v))).toEqual(cent(deberia([...l, a], f, v)))
      }))
  })

  it('linealidad en las ventas: +k ₡ de efectivo real → +k ₡ de debería; +k ₡ de retiro → −k', () => {
    fc.assert(fc.property(ledger, dia, ventas, crc, (l, f, v, k) => {
      const d0 = deberia(l, f, v).crc
      expect(deberia(l, f, { ...v, efRealN: v.efRealN + k }).crc).toBe(d0 + k)
      expect(deberia(l, f, { ...v, retiroCrc: v.retiroCrc + k }).crc).toBe(d0 - k)
    }))
  })
})
