// Pruebas de PROPIEDADES de `saldoCajaFuerte` (sagrado `cashUtils.ts`, NO se toca).
//
// Generan ledgers ficticios (colones enteros, dólares con 2 decimales) y verifican reglas que el saldo
// cumple SIEMPRE. Los dólares se comparan en centavos (`Math.round(x * 100)`): es el redondeo declarado
// de las columnas de plata (numeric(12,2)); el orden de suma en coma flotante no puede mover un centavo.
//
// Semilla fija (R11). Si cae, fast-check imprime semilla y `path`; otra: `FC_SEED=123 npx vitest run <archivo>`.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { CashMovement, MovementType } from '../../shared/types/database'
import { saldoCajaFuerte, MOVEMENT_TYPES, CAJAS_ORIGEN, METODOS_PAGO, CATEGORIAS_DEFAULT, EGRESO_TYPES } from './cashUtils'

const SEED = Number(process.env.FC_SEED ?? 20261117)
fc.configureGlobal({ seed: SEED, numRuns: 300 })

const crc = fc.integer({ min: 0, max: 1_000_000 })
const usd = fc.integer({ min: 0, max: 200_000 }).map(c => c / 100)
const SUBCATS = [...new Set(Object.values(CATEGORIAS_DEFAULT).flat()), '', 'Ajuste', 'Registradora → Banco', 'Banco → Caja Fuerte']

let seq = 0
function armar(p: { tipo: MovementType; crc: number; usd: number; caja: string; metodo: string; estado: string; sub: string }): CashMovement {
  seq += 1
  return {
    id: `m${seq}`, session_id: null, created_by: 'u-ficticio', movement_type: p.tipo,
    amount_crc: p.crc, amount_usd: p.usd, currency: 'CRC', exchange_rate: 500,
    description: '', subcategory: p.sub, supplier_id: null, supplier_name: null, employee_name: null,
    method: p.metodo, shift: '', caja_origen: p.caja, status: p.estado,
    approved_by: null, approved_at: null, account_id: null,
    created_at: '2026-08-05T12:00:00+00:00', updated_at: '2026-08-05T12:00:00+00:00',
  } as CashMovement
}

const movimiento = fc.record({
  tipo: fc.constantFrom(...MOVEMENT_TYPES),
  crc, usd,
  caja: fc.constantFrom(...CAJAS_ORIGEN, 'Caja Fuerte', 'Caja Fuerte'),   // Caja Fuerte más seguido
  metodo: fc.constantFrom(...METODOS_PAGO, ''),
  estado: fc.constantFrom('aprobado', 'aprobado', 'pendiente', 'rechazado'),
  sub: fc.constantFrom(...SUBCATS),
}).map(armar)
const ledger = fc.array(movimiento, { maxLength: 40 })

const centavos = (s: { crc: number; usd: number }) => ({ crc: s.crc, usd: Math.round(s.usd * 100) })

describe('saldoCajaFuerte — propiedades', () => {
  it('conmutatividad: el orden de los movimientos no cambia el saldo', () => {
    const conPerm = ledger.chain(l => fc.tuple(fc.constant(l), fc.shuffledSubarray(l, { minLength: l.length, maxLength: l.length })))
    fc.assert(fc.property(conPerm, ([l, perm]) => {
      expect(centavos(saldoCajaFuerte(perm))).toEqual(centavos(saldoCajaFuerte(l)))
    }))
  })

  it('aditividad: saldo(A ++ B) = saldo(A) + saldo(B)', () => {
    fc.assert(fc.property(ledger, ledger, (a, b) => {
      const sa = saldoCajaFuerte(a), sb = saldoCajaFuerte(b)
      expect(centavos(saldoCajaFuerte([...a, ...b]))).toEqual(centavos({ crc: sa.crc + sb.crc, usd: sa.usd + sb.usd }))
    }))
  })

  it('idempotencia de recalcular: dos corridas sobre el mismo ledger dan lo mismo y no lo mutan', () => {
    fc.assert(fc.property(ledger, l => {
      const copia = structuredClone(l)
      expect(saldoCajaFuerte(l)).toEqual(saldoCajaFuerte(l))
      expect(l).toEqual(copia)
    }))
  })

  it('neutros: pendientes y filas de otra caja no mueven el saldo', () => {
    const neutro = movimiento.chain(m => fc.constantFrom<Partial<CashMovement>>(
      { status: 'pendiente' }, { caja_origen: 'Banco' }, { caja_origen: 'Registradora' }, { caja_origen: 'Caja Proveedores' },
    ).map(cambio => ({ ...m, ...cambio })))
    fc.assert(fc.property(ledger, fc.array(neutro, { maxLength: 10 }), (l, ns) => {
      expect(centavos(saldoCajaFuerte([...l, ...ns]))).toEqual(centavos(saldoCajaFuerte(l)))
    }))
  })

  it('ida y vuelta: «X → Caja Fuerte» y «Caja Fuerte → X» por el mismo monto se cancelan', () => {
    fc.assert(fc.property(ledger, crc, usd, fc.constantFrom('Registradora', 'Banco', 'Caja Proveedores'), (l, c, u, otra) => {
      const entra = armar({ tipo: 'traspaso', crc: c, usd: u, caja: 'Caja Fuerte', metodo: 'Efectivo', estado: 'aprobado', sub: `${otra} → Caja Fuerte` })
      const sale = armar({ tipo: 'traspaso', crc: c, usd: u, caja: 'Caja Fuerte', metodo: 'Efectivo', estado: 'aprobado', sub: `Caja Fuerte → ${otra}` })
      expect(centavos(saldoCajaFuerte([...l, entra, sale]))).toEqual(centavos(saldoCajaFuerte(l)))
    }))
  })

  it('signo: solo ingresos válidos de Caja Fuerte → saldo ≥ 0; solo egresos → saldo ≤ 0', () => {
    const de = (tipos: MovementType[]) => fc.array(fc.record({ tipo: fc.constantFrom(...tipos), crc, usd })
      .map(x => armar({ ...x, caja: 'Caja Fuerte', metodo: 'Efectivo', estado: 'aprobado', sub: '' })), { maxLength: 20 })
    fc.assert(fc.property(de(['ingreso']), de(EGRESO_TYPES), (ing, egr) => {
      const si = saldoCajaFuerte(ing), se = saldoCajaFuerte(egr)
      expect(si.crc).toBeGreaterThanOrEqual(0); expect(si.usd).toBeGreaterThanOrEqual(0)
      expect(se.crc).toBeLessThanOrEqual(0); expect(se.usd).toBeLessThanOrEqual(0)
    }))
  })
})
