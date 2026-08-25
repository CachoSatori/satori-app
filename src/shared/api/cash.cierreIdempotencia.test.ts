import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Idempotencia de los asientos de cierre (ventas / retiro / apertura de pozo).
//
// Antes, las tres dependían de UNA sola capa: un `delete` de limpieza cuyo error ni siquiera se
// leía. Si ese delete fallaba en silencio (retry tras timeout, doble tap, red mala), el insert
// volvía a entrar y materializaba PLATA DUPLICADA en cash_movements → descuadre de Caja Fuerte.
// Ahora llevan client_op_id determinístico (mismo asiento → mismo uuid) y el UNIQUE de la mig 021
// rebota el duplicado con 23505, que se tolera. El delete sigue siendo la primera capa: es el que
// permite CORREGIR (re-cerrar el día con otro monto).
//
// El mock de abajo NO es un espía de llamadas: es una tabla en memoria que impone el UNIQUE de
// client_op_id y respeta la atomicidad del statement (un insert de N filas entra entero o no
// entra). Así los tests miden el invariante real — cuántas filas quedan y con qué monto — en vez
// de que el payload "traiga el campo".

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  rows:        [] as Row[],       // la tabla cash_movements
  deleteFails: false,             // simula la limpieza que falla en silencio
  deleteCount: 0,
}))

const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: () => {
    const eqs: [string, unknown][] = []
    const likes: [string, string][] = []
    let op: 'select' | 'delete' | 'insert' = 'select'
    let incoming: Row[] = []

    const matches = (r: Row) =>
      eqs.every(([k, v]) => r[k] === v) &&
      likes.every(([k, pat]) => new RegExp(
        '^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$',
      ).test(String(r[k] ?? '')))

    const b: Record<string, unknown> = {
      select:      () => b,
      delete:      () => { op = 'delete'; return b },
      insert:      (rows: unknown) => { op = 'insert'; incoming = Array.isArray(rows) ? rows as Row[] : [rows as Row]; return b },
      eq:          (k: string, v: unknown) => { eqs.push([k, v]); return b },
      like:        (k: string, v: string) => { likes.push([k, v]); return b },
      order:       () => b,
      abortSignal: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
        let error: unknown = null
        if (op === 'delete') {
          state.deleteCount++
          // El delete que falla NO borra nada: es exactamente el escenario que hoy duplica plata.
          if (state.deleteFails) error = { message: 'could not delete', code: '55P03' }
          else state.rows = state.rows.filter(r => !matches(r))
        }
        if (op === 'insert') {
          // UNIQUE (cash_movements_client_op_id_key, mig 021) + atomicidad del statement:
          // si UNA fila choca, Postgres rechaza el INSERT COMPLETO y no entra ninguna.
          const choca = incoming.some(n => n.client_op_id != null
            && state.rows.some(r => r.client_op_id === n.client_op_id))
          if (choca) error = { message: 'duplicate key value violates unique constraint "cash_movements_client_op_id_key"', code: '23505' }
          else state.rows.push(...incoming.map(r => ({ ...r })))
        }
        return Promise.resolve({ data: null, error }).then(res, rej)
      },
    }
    return b
  },
}))

vi.mock('./supabase', () => ({ supabase: { from: () => makeBuilder(), rpc: vi.fn() } }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
  state.rows = []
  state.deleteFails = false
  state.deleteCount = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { warn.mockRestore() })

const FECHA = '2026-08-01'
const ventas = (crcM: number, crcN: number) => ({
  session_date: FECHA, created_by: 'u1', exchange_rate: 640,
  mediodia: { crc: crcM, usd: 0 },
  noche:    { crc: crcN, usd: 0 },
})
const retiro = (amount_crc: number) => ({ session_date: FECHA, created_by: 'u1', exchange_rate: 640, amount_crc })
const pozo   = (monto_crc: number) => ({ fecha: FECHA, created_by: 'u1', monto_crc, monto_usd: 0 })

// ── Criterio 1 — el refactor es INOCUO ────────────────────────────────────────
describe('cierreOpId / cierreAjusteOpId — extraer el helper no movió ni un uuid', () => {
  // Snapshots calculados con un oráculo INDEPENDIENTE (node:crypto, fuera de esta base de
  // código). Si alguno cambia, cambió el algoritmo o el SEED — y los asientos ya escritos en
  // producción dejarían de rebotar sus duplicados. Es la invariante que no se toca.
  const SNAPSHOTS: [string, string][] = [
    ['cierre-ajuste-2026-08-01-crc',      '5eda8775-67aa-4542-ad76-9f4fd36adc9e'],
    ['cierre-ajuste-2026-08-01-usd',      '0ac41421-796a-4e1c-896f-189f8951ae7c'],
    ['cierre-ventas-2026-08-01-mediodia', '228cc84e-bc79-44ee-84d0-0996632971d6'],
    ['cierre-ventas-2026-08-01-noche',    '58764802-f49e-4cde-87ee-9cc4b5366ed1'],
    ['cierre-retiro-2026-08-01',          'cdb2cf59-702d-466f-80c1-d1d2600cba57'],
    ['apertura-pozo-2026-08-01',          '4fb62dd6-93db-49d0-81fe-76051c03d4bb'],
  ]

  it.each(SNAPSHOTS)('cierreOpId(%s) es estable y con formato uuid v4 válido', async (seed, esperado) => {
    const { cierreOpId } = await import('./cash')
    expect(await cierreOpId(seed)).toBe(esperado)
    expect(esperado).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('cierreAjusteOpId devuelve EXACTAMENTE el uuid de siempre (los ajustes en prod lo llevan)', async () => {
    const { cierreAjusteOpId } = await import('./cash')
    expect(await cierreAjusteOpId('2026-08-01', 'crc')).toBe('5eda8775-67aa-4542-ad76-9f4fd36adc9e')
    expect(await cierreAjusteOpId('2026-08-01', 'usd')).toBe('0ac41421-796a-4e1c-896f-189f8951ae7c')
  })

  it('los 6 asientos de un MISMO día tienen ids distintos (ninguno se pisa con otro)', async () => {
    const { cierreOpId } = await import('./cash')
    const ids = await Promise.all(SNAPSHOTS.map(([seed]) => cierreOpId(seed)))
    expect(new Set(ids).size).toBe(6)
  })
})

// ── Criterios 2, 3, 4 — retiro (1 fila) ──────────────────────────────────────
describe('recordCierreRetiro — el retiro no se duplica', () => {
  it('CRITERIO 2 · retry con el delete FALLADO → el 23505 rebota el duplicado: queda 1 fila', async () => {
    const { recordCierreRetiro } = await import('./cash')
    await recordCierreRetiro(retiro(100000))
    expect(state.rows).toHaveLength(1)

    state.deleteFails = true                       // la limpieza del reintento falla en silencio
    await expect(recordCierreRetiro(retiro(100000))).resolves.toBeUndefined()

    expect(state.rows).toHaveLength(1)             // ← antes: 2 filas = ₡200.000 en Caja Fuerte
    expect(state.rows[0].amount_crc).toBe(100000)
    expect(warn).toHaveBeenCalled()                // la limpieza fallida queda registrada
  })

  it('CRITERIO 3 · doble tap concurrente (mismo seed) → 1 fila', async () => {
    const { recordCierreRetiro } = await import('./cash')
    await Promise.all([recordCierreRetiro(retiro(100000)), recordCierreRetiro(retiro(100000))])
    expect(state.rows).toHaveLength(1)
  })

  it('CRITERIO 4 · re-cierre con OTRO monto y delete OK → corrige, no acumula', async () => {
    const { recordCierreRetiro } = await import('./cash')
    await recordCierreRetiro(retiro(100000))
    await recordCierreRetiro(retiro(80000))        // el dueño corrige el retiro
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].amount_crc).toBe(80000)   // el delete (1ª capa) permite CORREGIR
  })

  it('el asiento conserva su identidad firmada (descripción, traspaso, Caja Fuerte → Banco)', async () => {
    const { recordCierreRetiro, cierreOpId } = await import('./cash')
    await recordCierreRetiro(retiro(100000))
    expect(state.rows[0]).toMatchObject({
      movement_type: 'traspaso',
      subcategory:   'Caja Fuerte → Banco',
      caja_origen:   'Caja Fuerte',
      method:        'Transferencia',
      status:        'aprobado',
      session_id:    null,
      amount_crc:    100000,
      description:   'Retiro dueños a banco 2026-08-01',
      client_op_id:  await cierreOpId('cierre-retiro-2026-08-01'),
    })
  })

  it('un error que NO es 23505 sigue subiendo (el cierre avisa y pide deshacer)', async () => {
    const { recordCierreRetiro } = await import('./cash')
    await recordCierreRetiro(retiro(100000))
    // Un 23505 REAL viene del UNIQUE; cualquier otro código tiene que reventar igual que antes.
    state.rows[0].client_op_id = 'otro-id'         // el retry ya no choca…
    const { supabase } = await import('./supabase')
    const spy = vi.spyOn(supabase, 'from').mockReturnValue({
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      insert: () => ({ abortSignal: () => Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' } }) }),
    } as never)
    await expect(recordCierreRetiro(retiro(100000))).rejects.toThrow(/permission denied/)
    spy.mockRestore()
  })
})

// ── Criterio 5 — ventas (2 filas, una por turno) ─────────────────────────────
describe('recordCierreSales — las ventas del cierre no se duplican', () => {
  it('CRITERIO 5 · 2 turnos → 2 filas con client_op_id DISTINTO', async () => {
    const { recordCierreSales, cierreOpId } = await import('./cash')
    await recordCierreSales(ventas(300000, 200000))

    expect(state.rows).toHaveLength(2)
    const m = state.rows.find(r => r.shift === 'Mediodía')!
    const n = state.rows.find(r => r.shift === 'Noche')!
    expect(m.client_op_id).toBe(await cierreOpId('cierre-ventas-2026-08-01-mediodia'))
    expect(n.client_op_id).toBe(await cierreOpId('cierre-ventas-2026-08-01-noche'))
    expect(m.client_op_id).not.toBe(n.client_op_id)
    // Identidad firmada intacta: NETO a Caja Fuerte, subcategoría y descripción de siempre.
    expect(m).toMatchObject({
      movement_type: 'ingreso', subcategory: 'Ventas cierre', caja_origen: 'Caja Fuerte',
      method: 'Efectivo', status: 'aprobado', session_id: null, amount_crc: 300000,
      description: 'Ventas efectivo Mediodía 2026-08-01',
    })
  })

  it('CRITERIO 5 · retry con el delete FALLADO no duplica NINGUNO de los dos turnos', async () => {
    const { recordCierreSales } = await import('./cash')
    await recordCierreSales(ventas(300000, 200000))
    state.deleteFails = true
    await expect(recordCierreSales(ventas(300000, 200000))).resolves.toBeUndefined()

    expect(state.rows).toHaveLength(2)             // ← antes: 4 filas = ₡1.000.000 en Caja Fuerte
    expect(state.rows.filter(r => r.shift === 'Mediodía')).toHaveLength(1)
    expect(state.rows.filter(r => r.shift === 'Noche')).toHaveLength(1)
  })

  it('re-cierre con otros montos y delete OK → corrige los dos turnos', async () => {
    const { recordCierreSales } = await import('./cash')
    await recordCierreSales(ventas(300000, 200000))
    await recordCierreSales(ventas(310000, 190000))
    expect(state.rows).toHaveLength(2)
    expect(state.rows.find(r => r.shift === 'Mediodía')!.amount_crc).toBe(310000)
    expect(state.rows.find(r => r.shift === 'Noche')!.amount_crc).toBe(190000)
  })

  it('un turno en 0 no genera fila (y el otro entra igual)', async () => {
    const { recordCierreSales } = await import('./cash')
    await recordCierreSales(ventas(300000, 0))
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].shift).toBe('Mediodía')
  })

  // TRADE-OFF DECIDIDO (batch único, espejo de recordCierreAjuste): con el delete FALLADO y el
  // monto cambiado, el 23505 rebota el statement entero y queda el monto VIEJO — el cierre
  // reporta éxito. Se elige a conciencia: un monto viejo aparece como diferencia en el próximo
  // cierre; una fila duplicada infla la bóveda EN SILENCIO. Este test fija esa conducta.
  it('delete fallado + monto cambiado → queda el monto VIEJO, nunca dos filas', async () => {
    const { recordCierreSales } = await import('./cash')
    await recordCierreSales(ventas(300000, 200000))
    state.deleteFails = true
    await recordCierreSales(ventas(310000, 190000))
    expect(state.rows).toHaveLength(2)
    expect(state.rows.find(r => r.shift === 'Mediodía')!.amount_crc).toBe(300000)
  })
})

// ── Apertura del pozo (asiento de despliegue, se corre una sola vez) ─────────
describe('recordAperturaPozo — la apertura del pozo no se duplica', () => {
  it('retry con el delete FALLADO → 1 sola apertura', async () => {
    const { recordAperturaPozo, cierreOpId } = await import('./cash')
    await recordAperturaPozo(pozo(500000))
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].client_op_id).toBe(await cierreOpId('apertura-pozo-2026-08-01'))

    state.deleteFails = true
    await expect(recordAperturaPozo(pozo(500000))).resolves.toBeUndefined()
    expect(state.rows).toHaveLength(1)             // ← antes: 2 aperturas = ₡1.000.000
    expect(state.rows[0].amount_crc).toBe(500000)
  })

  it('re-correrla con otra cifra y delete OK sigue CORRIGIENDO (no duplica)', async () => {
    const { recordAperturaPozo } = await import('./cash')
    await recordAperturaPozo(pozo(500000))
    await recordAperturaPozo(pozo(450000))
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].amount_crc).toBe(450000)
  })

  it('la apertura negativa sigue reventando (guardia intacta)', async () => {
    const { recordAperturaPozo } = await import('./cash')
    await expect(recordAperturaPozo({ ...pozo(-1), monto_crc: -1 })).rejects.toThrow(/no puede ser negativa/)
    expect(state.rows).toHaveLength(0)
  })
})
