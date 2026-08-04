// ORACLE TEST (vinculante) — ata la reimplementación del pool del correo (pool.ts) al SAGRADO.
// Oráculo = calcHistory (es quien resuelve effectiveRole = covered_role ?? rol base y llama a calcTurno).
// Para un set de sesiones sintéticas exige, AL PESO:  poolTotalSesion(...) === calcHistory(...).totalPool
// Cubre: solo-sala, solo-barra, con electrónica, mixto, USD (tc) y un caso con COVERED_ROLE que cruza
// sala↔barra. Más un test NEGATIVO (el método viejo de columnas no cuadra cuando hay propinaSala).
// Corre bajo vitest (env node) — importa el sagrado directo desde src/.
import { describe, it, expect } from 'vitest'
import { poolTotalSesion, type PoolEntry } from './pool'
import { calcHistory } from '../../../src/shared/utils/tipCalculations'
import type { UserRole } from '../../../src/shared/types/database'

// emp = id único por entry · role = rol BASE · covered = rol cubierto ese turno (?? = sin cobertura)
type EntryCfg = { emp: string; role: UserRole; covered?: UserRole | null; crc?: number; usd?: number }
type Caso = { nombre: string; ef_crc: number; ef_usd: number; barra_crc: number; barra_elec: number; tc: number; entries: EntryCfg[] }

const rolePoints = (['salonero','barman','barback','runner','cocina','cajero','manager'] as UserRole[])
  .map(role => ({ role, points: 1 }))

// SAGRADO: calcHistory recibe entries (con covered_role) + empleados + rolePoints. Barra = ef + electrónica.
const oraculoTotalPool = (c: Caso): number => calcHistory(
  c.entries.map(e => ({
    employee_id: e.emp, hours_worked: 5, tip_amount_crc: e.crc ?? 0, tip_amount_usd: e.usd ?? 0,
    points: 1, payout_crc: 0, covered_role: e.covered ?? null,
  })),
  c.entries.map(e => ({ id: e.emp, full_name: e.emp, role: e.role })),
  rolePoints,
  { pool_efectivo_crc: c.ef_crc, pool_efectivo_usd: c.ef_usd, pool_barra_crc: c.barra_crc + c.barra_elec, exchange_rate: c.tc },
).totalPool

// CORREO: poolTotalSesion clasifica por el rol EFECTIVO (covered ?? base), igual que el caller (index.ts).
const correoTotalPool = (c: Caso): number => poolTotalSesion(
  { pool_efectivo_crc: c.ef_crc, pool_efectivo_usd: c.ef_usd, pool_barra_crc: c.barra_crc, pool_barra_electronico_crc: c.barra_elec, exchange_rate: c.tc },
  c.entries.map((e): PoolEntry => ({ role: e.covered ?? e.role, tip_amount_crc: e.crc ?? 0, tip_amount_usd: e.usd ?? 0 })),
)

const casos: Caso[] = [
  { nombre: 'solo sala (efectivo + propinas individuales, sin barra)', ef_crc: 100000, ef_usd: 0, barra_crc: 0, barra_elec: 0, tc: 640,
    entries: [{ emp: 's1', role: 'salonero', crc: 50000 }, { emp: 's2', role: 'salonero', crc: 30000 }, { emp: 'c1', role: 'cajero', crc: 5000 }] },
  { nombre: 'solo barra (efectivo + barra; barman/barback sin propina individual)', ef_crc: 50000, ef_usd: 0, barra_crc: 20000, barra_elec: 0, tc: 640,
    entries: [{ emp: 'b1', role: 'barman' }, { emp: 'b2', role: 'barback' }, { emp: 's1', role: 'salonero' }] },
  { nombre: 'con barra electrónica (datáfono)', ef_crc: 40000, ef_usd: 0, barra_crc: 10000, barra_elec: 15000, tc: 640,
    entries: [{ emp: 's1', role: 'salonero', crc: 5000 }, { emp: 'b1', role: 'barman' }] },
  { nombre: 'mixto (sala + barra + electrónica + cocina sin propina)', ef_crc: 60000, ef_usd: 0, barra_crc: 8000, barra_elec: 12000, tc: 640,
    entries: [{ emp: 's1', role: 'salonero', crc: 40000 }, { emp: 'c1', role: 'cajero', crc: 5000 }, { emp: 'm1', role: 'manager', crc: 3000 }, { emp: 'b1', role: 'barman' }, { emp: 'k1', role: 'cocina' }] },
  { nombre: 'con USD (efectivo y propina en dólares · tc)', ef_crc: 10000, ef_usd: 100, barra_crc: 0, barra_elec: 0, tc: 650,
    entries: [{ emp: 's1', role: 'salonero', crc: 20000, usd: 50 }, { emp: 'r1', role: 'runner', crc: 0, usd: 10 }] },
  // COVERED cruzando sala↔barra: un barman que CUBRIÓ salonero → SALA (su propina cuenta); un salonero
  // que CUBRIÓ barman → BARRA (su propina NO cuenta). Por rol BASE daría otro número; por covered cuadra.
  { nombre: 'covered_role cruza sala↔barra', ef_crc: 50000, ef_usd: 0, barra_crc: 10000, barra_elec: 0, tc: 640,
    entries: [
      { emp: 'b1', role: 'barman',   covered: 'salonero', crc: 20000 },   // barman→salonero: SALA, +20000
      { emp: 's1', role: 'salonero', covered: 'barman',   crc: 8000 },    // salonero→barman: BARRA, excluido
      { emp: 's2', role: 'salonero', crc: 12000 },                        // sala normal, +12000
    ] },
]

describe('monthly-report · pool del correo === calcHistory.totalPool (oracle, al peso, covered_role)', () => {
  for (const c of casos) {
    it(c.nombre, () => {
      const sagrado = oraculoTotalPool(c)
      expect(sagrado).toBeGreaterThan(0)
      expect(correoTotalPool(c)).toBe(sagrado)
    })
  }

  it('covered cruzado: por covered (92.000) ≠ por rol base (80.000) — el correo sigue al covered', () => {
    const c = casos[casos.length - 1]
    expect(oraculoTotalPool(c)).toBe(92000)          // 50000 ef + 32000 propinaSala(covered) + 10000 barra
    expect(correoTotalPool(c)).toBe(92000)
    const porBase = c.ef_crc + c.ef_usd * c.tc
      + c.entries.filter(e => e.role !== 'barman' && e.role !== 'barback').reduce((s, e) => s + (e.crc ?? 0) + (e.usd ?? 0) * c.tc, 0)
      + c.barra_crc + c.barra_elec
    expect(porBase).toBe(80000)                      // rol base clasificaría distinto → número equivocado
    expect(porBase).not.toBe(92000)
  })

  it('NEGATIVO: el método viejo (solo columnas efectivo+barra) NO cuadra cuando hay propinaSala', () => {
    const c = casos[0]                                                        // solo sala: propinaSala = 85.000
    const viejo = c.ef_crc + c.ef_usd * c.tc + c.barra_crc + c.barra_elec     // lo que sumaba el correo antes
    const sagrado = oraculoTotalPool(c)
    expect(viejo).not.toBe(sagrado)                                          // bug: viejo (100.000) << totalPool (185.000)
    expect(correoTotalPool(c)).toBe(sagrado)                                 // el fix sí cuadra al peso
  })
})
