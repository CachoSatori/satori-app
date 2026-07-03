import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saldoCajaFuerte } from '../../modules/cash/cashUtils'
import type { CashMovement } from '../types/database'

// Opción B (FIRMADA por la dueña) — recordCierreAjuste materializa la diferencia del cierre como
// movimiento(s) de Caja Fuerte: faltante (dif<0) → egreso resta · sobrante (dif>0) → ingreso suma.
// Invariantes fijados acá:
//   1. Dirección/monto/moneda correctos por cada moneda que superó su tolerancia (mixto = 2 movs).
//   2. Idempotencia: client_op_id determinístico por fecha+moneda + limpieza previa del día
//      (re-confirmar no duplica; re-cerrar un día que ahora cuadra no arrastra el ajuste viejo).
//   3. Deshacer cierre (discardCierreDia) borra también los ajustes del día.
//   4. LEDGER = FÍSICO: con las filas reales que inserta el cierre (ventas + retiro + ajuste),
//      saldoCajaFuerte devuelve exactamente el contado físico (criterio 4, con propinas 0 —
//      el gap pre-existente de propinas se documenta en el último test).

const state = vi.hoisted(() => ({
  deletes: [] as { table: string; filters: Record<string, string> }[],
  inserts: [] as Record<string, unknown>[][],
  insertError: null as { message: string; code?: string } | null,
}))

const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: (table: string) => {
    const filters: Record<string, string> = {}
    let op: 'select' | 'delete' | 'insert' = 'select'
    let insertedRows: Record<string, unknown>[] = []
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => { op = 'delete'; return b },
      insert: (rows: unknown) => { op = 'insert'; insertedRows = Array.isArray(rows) ? rows : [rows as Record<string, unknown>]; return b },
      eq: (k: string, v: string) => { filters[`eq:${k}`] = v; return b },
      like: (k: string, v: string) => { filters[`like:${k}`] = v; return b },
      order: () => b,
      abortSignal: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === 'delete') state.deletes.push({ table, filters: { ...filters } })
        if (op === 'insert') state.inserts.push(insertedRows)
        const error = op === 'insert' ? state.insertError : null
        return Promise.resolve({ data: null, error }).then(res, rej)
      },
    }
    return b
  },
}))

vi.mock('./supabase', () => ({ supabase: { from: (t: string) => makeBuilder(t), rpc: vi.fn() } }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
  state.deletes.length = 0
  state.inserts.length = 0
  state.insertError = null
})

const base = { session_date: '2026-07-03', created_by: 'u1', exchange_rate: 640, motivo: 'billete falso' }

describe('cash.ts — cierreAjusteOpId (client_op_id determinístico del ajuste)', () => {
  it('estable por fecha+moneda, distinto entre monedas y fechas, con formato uuid válido', async () => {
    const { cierreAjusteOpId } = await import('./cash')
    const a1 = await cierreAjusteOpId('2026-07-03', 'crc')
    const a2 = await cierreAjusteOpId('2026-07-03', 'crc')
    const b  = await cierreAjusteOpId('2026-07-03', 'usd')
    const c  = await cierreAjusteOpId('2026-07-04', 'crc')
    expect(a1).toBe(a2)          // re-confirmar el mismo cierre → MISMO id → el UNIQUE rebota duplicados
    expect(a1).not.toBe(b)
    expect(a1).not.toBe(c)
    expect(a1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('cash.ts — recordCierreAjuste (Opción B: la diferencia entra al ledger)', () => {
  it('faltante ₡ → UN egreso en Caja Fuerte por el monto exacto, aprobado, con motivo', async () => {
    const { recordCierreAjuste, cierreAjusteOpId } = await import('./cash')
    await recordCierreAjuste({ ...base, dif_crc: -2000, dif_usd: 0 })

    expect(state.inserts).toHaveLength(1)
    const rows = state.inserts[0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      movement_type: 'egreso_operativo',
      amount_crc:    2000,
      amount_usd:    0,
      caja_origen:   'Caja Fuerte',
      subcategory:   'Ajuste de cierre',
      status:        'aprobado',
      session_id:    null,
      description:   'Ajuste de cierre 2026-07-03 · Faltante · billete falso',
      client_op_id:  await cierreAjusteOpId('2026-07-03', 'crc'),
    })
  })

  it('sobrante USD → UN ingreso con amount_usd (₡ en 0)', async () => {
    const { recordCierreAjuste, cierreAjusteOpId } = await import('./cash')
    await recordCierreAjuste({ ...base, motivo: 'apareció un billete', dif_crc: 0, dif_usd: 5 })

    const rows = state.inserts[0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      movement_type: 'ingreso',
      amount_crc:    0,
      amount_usd:    5,
      caja_origen:   'Caja Fuerte',
      description:   'Ajuste de cierre 2026-07-03 · Sobrante · apareció un billete',
      client_op_id:  await cierreAjusteOpId('2026-07-03', 'usd'),
    })
  })

  it('mixto (₡ faltante + $ sobrante) → DOS movimientos con direcciones correctas', async () => {
    const { recordCierreAjuste } = await import('./cash')
    await recordCierreAjuste({ ...base, dif_crc: -2000, dif_usd: 5 })

    const rows = state.inserts[0]
    expect(rows).toHaveLength(2)
    const crc = rows.find(r => (r.amount_crc as number) > 0)!
    const usd = rows.find(r => (r.amount_usd as number) > 0)!
    expect(crc).toMatchObject({ movement_type: 'egreso_operativo', amount_crc: 2000, amount_usd: 0 })
    expect(crc.description).toContain('Faltante')
    expect(usd).toMatchObject({ movement_type: 'ingreso', amount_crc: 0, amount_usd: 5 })
    expect(usd.description).toContain('Sobrante')
  })

  it('SIEMPRE limpia los ajustes previos del día; sin diferencia no inserta nada', async () => {
    const { recordCierreAjuste } = await import('./cash')
    await recordCierreAjuste({ ...base, motivo: '', dif_crc: 0, dif_usd: 0 })

    // La limpieza corre igual: re-cerrar un día que ANTES tuvo diferencia y ahora cuadra
    // no puede arrastrar el ajuste viejo.
    expect(state.deletes.some(d => d.table === 'cash_movements'
      && d.filters['eq:subcategory'] === 'Ajuste de cierre'
      && d.filters['like:description'] === 'Ajuste de cierre 2026-07-03%')).toBe(true)
    expect(state.inserts).toHaveLength(0)
  })

  it('conflicto 23505 (retry: el client_op_id determinístico ya existe) NO revienta', async () => {
    const { recordCierreAjuste } = await import('./cash')
    state.insertError = { message: 'duplicate key value violates unique constraint', code: '23505' }
    await expect(recordCierreAjuste({ ...base, dif_crc: -1000, dif_usd: 0 })).resolves.toBeUndefined()
  })

  it('otro error del server SÍ sube (el caller avisa y pide deshacer/re-cerrar)', async () => {
    const { recordCierreAjuste } = await import('./cash')
    state.insertError = { message: 'permission denied', code: '42501' }
    await expect(recordCierreAjuste({ ...base, dif_crc: -1000, dif_usd: 0 })).rejects.toThrow(/permission denied/)
  })
})

describe('cash.ts — discardCierreDia borra también los ajustes del cierre', () => {
  it('deshacer el cierre elimina Ventas cierre + retiro + Ajuste de cierre del día', async () => {
    const { discardCierreDia } = await import('./cash')
    await discardCierreDia('2026-07-03')

    expect(state.deletes.some(d => d.filters['eq:subcategory'] === 'Ventas cierre')).toBe(true)
    expect(state.deletes.some(d => d.filters['eq:description'] === 'Retiro dueños a banco 2026-07-03')).toBe(true)
    expect(state.deletes.some(d => d.filters['eq:subcategory'] === 'Ajuste de cierre'
      && d.filters['like:description'] === 'Ajuste de cierre 2026-07-03%')).toBe(true)
  })

  it('deshacer el cierre NO toca los pagos de propinas (plata real ya entregada)', async () => {
    const { discardCierreDia } = await import('./cash')
    await discardCierreDia('2026-07-03')

    // Ningún delete filtra por 'Propinas por turno': al re-cerrar, lo pagado se recalcula de los
    // movimientos (siguen ahí) y 'Ventas cierre' se re-crea neto — idempotente, sin duplicar.
    expect(state.deletes.some(d =>
      Object.values(d.filters).some(v => String(v).includes('Propinas por turno')))).toBe(false)
  })
})

// ── Criterio 4 — LEDGER = FÍSICO CONTADO (con el saldoCajaFuerte REAL) ─────────────────────
// Se arma el día completo con las MISMAS filas que produce el cierre en producción: las de
// recordCierreAjuste salen del spy de insert (forma real, no re-tipeada); ventas/retiro se
// modelan con la forma exacta de recordCierreSales/recordCierreRetiro.
const mkMov = (p: Partial<CashMovement>): CashMovement => ({
  id: crypto.randomUUID(), session_id: null, created_by: 'u1', currency: 'CRC',
  description: '', subcategory: '', supplier_id: null, supplier_name: '', employee_name: '',
  method: 'Efectivo', caja_origen: 'Caja Fuerte', status: 'aprobado',
  amount_crc: 0, amount_usd: 0, created_at: '2026-07-03T20:00:00Z', updated_at: '2026-07-03T20:00:00Z',
  movement_type: 'ingreso', shift: '', ...p,
} as CashMovement)

describe('CashCierre + recordCierreAjuste — el saldo de Caja Fuerte arranca del físico contado', () => {
  it('caso completo (propinas pagadas + pendiente + retiro + dif mixta): ledger = contado EXACTO', async () => {
    const { recordCierreAjuste } = await import('./cash')

    // Ledger PREVIO al cierre: saldo inicial (traspaso a CF) + un gasto viejo.
    const previos = [
      mkMov({ movement_type: 'traspaso', subcategory: 'Banco → Caja Fuerte', amount_crc: 100000, amount_usd: 200, created_at: '2026-07-01T12:00:00Z' }),
      mkMov({ movement_type: 'egreso_operativo', amount_crc: 20000, created_at: '2026-07-02T12:00:00Z' }),
    ]
    const saldoBase = saldoCajaFuerte(previos)
    expect(saldoBase).toEqual({ crc: 80000, usd: 200 })

    // Cierre del 2026-07-03 — VÍA REAL de propinas (firmado): M pagó ₡20.000 (sellado),
    // tras el sellado se pagaron ₡5.000 más, y quedó UNA pendiente de ₡8.000 (no resta).
    const efRealM = 300000, efRealN = 200000, retiro = 100000
    const propM = 20000, propNLeg = 5000
    const vmUSD = 50, vnUSD = 30
    const deberia    = saldoBase.crc + (efRealM - propM) + (efRealN - propNLeg - retiro)
    const deberiaUSD = saldoBase.usd + vmUSD + vnUSD
    const contadoCRC = deberia + (-2000)      // faltan ₡2.000 (diferencia REAL, no fantasma)
    const contadoUSD = deberiaUSD + 5         // sobran $5

    // Movimientos del día — propinas por la vía real (Registradora: NO tocan el ledger de CF)…
    const propinas = [
      mkMov({ movement_type: 'egreso_personal', subcategory: 'Propinas por turno', caja_origen: 'Registradora', description: 'Propinas turno 2026-07-03 Mediodía', amount_crc: propM }),
      mkMov({ movement_type: 'egreso_personal', subcategory: 'Propinas por turno', caja_origen: 'Registradora', description: 'Propinas turno 2026-07-03 Noche', amount_crc: propNLeg }),
      mkMov({ movement_type: 'egreso_personal', subcategory: 'Propinas por turno', caja_origen: 'Registradora', description: 'Propinas turno 2026-07-02 Noche', amount_crc: 8000, status: 'pendiente' }),
    ]
    // …'Ventas cierre' ingresa el NETO de propinas pagadas (identidad firmada) + el retiro:
    const ventasYRetiro = [
      mkMov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-07-03', amount_crc: efRealM - propM, amount_usd: vmUSD }),
      mkMov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-07-03', amount_crc: efRealN - propNLeg, amount_usd: vnUSD }),
      mkMov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco', description: 'Retiro dueños a banco 2026-07-03', amount_crc: retiro }),
    ]
    // …y el/los ajustes, con las filas REALES que inserta recordCierreAjuste:
    await recordCierreAjuste({ ...base, dif_crc: contadoCRC - deberia, dif_usd: contadoUSD - deberiaUSD })
    const ajustes = state.inserts[0].map(r => mkMov(r as Partial<CashMovement>))
    expect(ajustes).toHaveLength(2)

    // El ledger completo queda EXACTAMENTE en el físico contado (invariante firmada).
    const ledger = saldoCajaFuerte([...previos, ...propinas, ...ventasYRetiro, ...ajustes])
    expect(ledger.crc).toBe(contadoCRC)
    expect(ledger.usd).toBe(contadoUSD)
  })

  it('IDENTIDAD con propinas pagadas (test del gap DADO VUELTA): ledger = contado, sin fantasmas', async () => {
    // ANTES este test DOCUMENTABA el gap: 'Ventas cierre' ingresaba el BRUTO y el ledger quedaba
    // en contado + propinas (faltante fantasma). Con la vía real firmada, el ingreso es NETO de
    // propinas pagadas → la identidad es exacta y este test la AFIRMA.
    const { recordCierreAjuste } = await import('./cash')
    const propinas = 5000
    const efRealM = 300000
    const deberia = 0 + (efRealM - propinas)              // saldo base 0, solo mediodía, sin retiro
    const contado = deberia                                // el conteo físico cuadra con el "debería"

    const dia = [
      mkMov({ movement_type: 'egreso_personal', subcategory: 'Propinas por turno', caja_origen: 'Registradora', description: 'Propinas turno 2026-07-03 Mediodía', amount_crc: propinas }),
      mkMov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-07-03', amount_crc: efRealM - propinas }),  // NETO
    ]
    await recordCierreAjuste({ ...base, motivo: '', dif_crc: contado - deberia, dif_usd: 0 })  // dif 0 → sin ajuste
    expect(state.inserts).toHaveLength(0)

    expect(saldoCajaFuerte(dia).crc).toBe(contado)   // ✓ identidad exacta — el gap quedó cerrado
  })

  it('propinas PENDIENTES no restan: sin pagos, la identidad cierra con el ingreso bruto', async () => {
    // Un turno dejado pendiente no saca plata: deberia no lo resta, 'Ventas cierre' entra
    // completo y el pendiente (Registradora) no toca CF → ledger = contado igual de exacto.
    const { recordCierreAjuste } = await import('./cash')
    const efRealM = 300000
    const deberia = 0 + efRealM                            // nada pagado → nada resta
    const contado = deberia

    const dia = [
      mkMov({ movement_type: 'egreso_personal', subcategory: 'Propinas por turno', caja_origen: 'Registradora', description: 'Propinas turno 2026-07-03 Mediodía', amount_crc: 12000, status: 'pendiente' }),
      mkMov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-07-03', amount_crc: efRealM }),
    ]
    await recordCierreAjuste({ ...base, motivo: '', dif_crc: 0, dif_usd: 0 })
    expect(state.inserts).toHaveLength(0)
    expect(saldoCajaFuerte(dia).crc).toBe(contado)
  })
})
