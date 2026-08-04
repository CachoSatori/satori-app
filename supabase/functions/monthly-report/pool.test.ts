// ORACLE TEST (vinculante) — ata la reimplementación del pool del correo (pool.ts) al SAGRADO
// calcTurno.totalPool. Para un set de sesiones sintéticas exige, AL PESO:
//   poolTotalSesion(...) === calcTurno(...).totals.totalPool
// Cubre: solo-sala, solo-barra, con electrónica, mixto y USD (tc). Más un test NEGATIVO que prueba
// que el método viejo (solo columnas efectivo+barra) NO cuadra cuando hay propinaSala.
// Corre bajo vitest (env node) — importa el sagrado directo desde src/.
import { describe, it, expect } from 'vitest'
import { poolTotalSesion, type PoolEntry } from './pool'
import { calcTurno, type DraftLine } from '../../../src/shared/utils/tipCalculations'
import type { UserRole } from '../../../src/shared/types/database'

type EntryCfg = { role: UserRole; crc?: number; usd?: number }
type Caso = { nombre: string; ef_crc: number; ef_usd: number; barra_crc: number; barra_elec: number; tc: number; entries: EntryCfg[] }

const draftLine = (i: number, e: EntryCfg): DraftLine => ({
  employeeId: `e${i}`, employeeName: `E${i}`, role: e.role, active: true, hours: 5,
  propina_crc: e.crc ?? 0, propina_usd: e.usd ?? 0, pts_rol: 1, pts_val: 0, take_home: 0,
})

// SAGRADO: calcTurno recibe la barra ya sumada (efectivo + electrónica), igual que TipStats/TipHistory.
const sagradoTotalPool = (c: Caso): number =>
  calcTurno(c.entries.map((e, i) => draftLine(i, e)), c.ef_crc, c.ef_usd, c.barra_crc + c.barra_elec, c.tc).totals.totalPool

const correoTotalPool = (c: Caso): number =>
  poolTotalSesion(
    { pool_efectivo_crc: c.ef_crc, pool_efectivo_usd: c.ef_usd, pool_barra_crc: c.barra_crc, pool_barra_electronico_crc: c.barra_elec, exchange_rate: c.tc },
    c.entries.map((e): PoolEntry => ({ role: e.role, tip_amount_crc: e.crc ?? 0, tip_amount_usd: e.usd ?? 0 })),
  )

const casos: Caso[] = [
  { nombre: 'solo sala (efectivo + propinas individuales, sin barra)', ef_crc: 100000, ef_usd: 0, barra_crc: 0, barra_elec: 0, tc: 640,
    entries: [{ role: 'salonero', crc: 50000 }, { role: 'salonero', crc: 30000 }, { role: 'cajero', crc: 5000 }] },
  { nombre: 'solo barra (efectivo + barra; barman/barback sin propina individual)', ef_crc: 50000, ef_usd: 0, barra_crc: 20000, barra_elec: 0, tc: 640,
    entries: [{ role: 'barman' }, { role: 'barback' }, { role: 'salonero' }] },
  { nombre: 'con barra electrónica (datáfono)', ef_crc: 40000, ef_usd: 0, barra_crc: 10000, barra_elec: 15000, tc: 640,
    entries: [{ role: 'salonero', crc: 5000 }, { role: 'barman' }] },
  { nombre: 'mixto (sala + barra + electrónica + cocina sin propina)', ef_crc: 60000, ef_usd: 0, barra_crc: 8000, barra_elec: 12000, tc: 640,
    entries: [{ role: 'salonero', crc: 40000 }, { role: 'cajero', crc: 5000 }, { role: 'manager', crc: 3000 }, { role: 'barman' }, { role: 'cocina' }] },
  { nombre: 'con USD (efectivo y propina en dólares · tc)', ef_crc: 10000, ef_usd: 100, barra_crc: 0, barra_elec: 0, tc: 650,
    entries: [{ role: 'salonero', crc: 20000, usd: 50 }, { role: 'runner', crc: 0, usd: 10 }] },
]

describe('monthly-report · pool del correo === calcTurno.totalPool (oracle, al peso)', () => {
  for (const c of casos) {
    it(c.nombre, () => {
      const sagrado = sagradoTotalPool(c)
      expect(sagrado).toBeGreaterThan(0)
      expect(correoTotalPool(c)).toBe(sagrado)
    })
  }

  it('NEGATIVO: el método viejo (solo columnas efectivo+barra) NO cuadra cuando hay propinaSala', () => {
    const c = casos[0]                                                        // solo sala: propinaSala = 85.000
    const viejo = c.ef_crc + c.ef_usd * c.tc + c.barra_crc + c.barra_elec     // lo que sumaba el correo antes
    const sagrado = sagradoTotalPool(c)
    expect(viejo).not.toBe(sagrado)                                          // bug: viejo (100.000) << totalPool (185.000)
    expect(correoTotalPool(c)).toBe(sagrado)                                 // el fix sí cuadra al peso
  })
})
