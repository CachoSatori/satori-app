import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// discardDiaCompleto (borrar el día) debe enrutar el borrado de CADA cash_movement por la RPC
// delete_movement_cascade (mig 039) — NUNCA con un `.delete()` plano sobre cash_movements, que
// dejaría accounting_entries huérfanos (source_id a un movimiento inexistente, sin reversa) e
// inventory_review_task colgadas, sin auditoría. El cierre (cash_cierres_dia) y las sesiones
// (cash_sessions) SÍ van por `.delete()` crudo (no tocan el libro), pero SOLO después de los
// movimientos. Este test fija ambos invariantes: ruta por RPC + orden.
//
// Fix 05/11: la selección sin turno va por DÍA OPERATIVO (no por created_at) — casos reales del
// 20/07 y del 20/10 —, ningún delete sin chequear su error, y si el plan cambió desde la vista
// previa no se borra nada. También discardCierreDia propaga el error de cada delete.

const calls: string[] = []
const rpcArgs: Array<Record<string, unknown>> = []

const { rpcSpy } = vi.hoisted(() => ({ rpcSpy: vi.fn() }))

// thenable que soporta .abortSignal() (lo exige deleteCashMovement vía withWriteTimeout)
const rpcBuilder = {
  abortSignal: () => rpcBuilder,
  then: (res: (v: { error: null }) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(res, rej),
}

type Row = Record<string, unknown>
const DB = {
  sesiones: [] as Row[],
  movTurno: [] as Row[],
  movPorCreacion: [] as Row[],
  movPorDescripcion: [] as Row[],
  errores: {} as Record<string, string>,   // 'tabla.delete' → mensaje de error a devolver
}
const fila = (p: Row): Row => ({ session_id: null, subcategory: '', description: '', amount_crc: 0, amount_usd: 0, movement_type: 'ingreso', ...p })

// Builder de `.from(table)`: encadena select/delete/filtros, soporta .abortSignal() y es thenable.
// Si alguien intenta `.delete()` sobre cash_movements desde discardDiaCompleto, REVIENTA.
function makeBuilder(table: string) {
  const state = { op: 'select' as 'select' | 'delete', filtro: '' as '' | 'in' | 'gte' | 'like' }
  const builder = {
    select: () => builder,
    delete: () => { state.op = 'delete'; return builder },
    eq: () => builder,
    in: () => { state.filtro = 'in'; return builder },
    is: () => builder,
    gte: () => { state.filtro = 'gte'; return builder },
    lt: () => builder,
    like: () => { if (state.filtro !== 'in') state.filtro = 'like'; return builder },
    abortSignal: () => builder,
    then(res: (v: { data: unknown; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
      const key = `${table}.${state.op}`
      if (table === 'cash_movements' && state.op === 'delete' && !permitirDeleteMovs) {
        throw new Error('discardDiaCompleto NO debe borrar cash_movements con .delete() plano: va por la RPC')
      }
      let data: unknown = null
      if (table === 'cash_sessions' && state.op === 'select') data = DB.sesiones
      else if (table === 'cash_movements' && state.op === 'select') {
        data = state.filtro === 'in' ? DB.movTurno : state.filtro === 'gte' ? DB.movPorCreacion : DB.movPorDescripcion
      }
      calls.push(key)
      const error = DB.errores[key] ? { message: DB.errores[key] } : null
      return Promise.resolve({ data, error }).then(res, rej)
    },
  }
  return builder
}
let permitirDeleteMovs = false

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: rpcSpy,
  },
}))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

function escenarioBase() {
  DB.sesiones = [{ id: 'sess-1', session_date: '2026-06-20' }]
  DB.movTurno = [fila({ id: 'turn-mov-1', session_id: 'sess-1', created_at: '2026-06-20T15:00:00Z' }), fila({ id: 'turn-mov-2', session_id: 'sess-1', created_at: '2026-06-20T16:00:00Z' })]
  DB.movPorCreacion = [fila({ id: 'day-mov-1', description: 'traspaso manual', created_at: '2026-06-20T18:00:00Z' })]
  DB.movPorDescripcion = []
  DB.errores = {}
}

describe('cash.ts — discardDiaCompleto enruta por delete_movement_cascade (no .delete() crudo)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    calls.length = 0
    rpcArgs.length = 0
    permitirDeleteMovs = false
    escenarioBase()
    rpcSpy.mockReset()
    rpcSpy.mockImplementation((fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`)
      rpcArgs.push(args)
      return rpcBuilder
    })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'navigator')
  })

  it('borra CADA movimiento (turno + nivel-día) por la RPC, con la nota del día', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20')

    const rpcCalls = calls.filter(c => c === 'rpc:delete_movement_cascade')
    expect(rpcCalls).toHaveLength(3)
    expect(rpcArgs).toEqual([
      { p_movement_id: 'turn-mov-1', p_note: 'Borrado de día completo 2026-06-20' },
      { p_movement_id: 'turn-mov-2', p_note: 'Borrado de día completo 2026-06-20' },
      { p_movement_id: 'day-mov-1', p_note: 'Borrado de día completo 2026-06-20' },
    ])
  })

  it('respeta el orden: todos los movimientos (RPC) ANTES de borrar cierre y sesiones', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20')

    const lastRpc = calls.lastIndexOf('rpc:delete_movement_cascade')
    const cierreDelete = calls.indexOf('cash_cierres_dia.delete')
    const sessionsDelete = calls.indexOf('cash_sessions.delete')
    expect(lastRpc).toBeGreaterThanOrEqual(0)
    expect(cierreDelete).toBeGreaterThan(lastRpc)          // cierre después de los movimientos
    expect(sessionsDelete).toBeGreaterThan(cierreDelete)   // sesiones (paso 4) después del cierre (paso 3)
  })

  it('pasa las credenciales de gerencia a la RPC cuando vienen (cajero)', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20', 'jefe@satori.cr', 'secreta')
    expect(rpcArgs[0]).toEqual({
      p_movement_id: 'turn-mov-1',
      p_note: 'Borrado de día completo 2026-06-20',
      p_manager_email: 'jefe@satori.cr',
      p_manager_password: 'secreta',
    })
  })

  it('20/10 (caso real): NO borra las ventas ni el ajuste del cierre del 19/10 sellado a las 00:31', async () => {
    DB.sesiones = []; DB.movTurno = []
    DB.movPorCreacion = [
      fila({ id: 'v1910', subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-10-19', amount_crc: 15600, amount_usd: 100, created_at: '2026-10-20T06:31:38Z' }),
      fila({ id: 'a1910', subcategory: 'Ajuste de cierre', description: 'Ajuste de cierre 2026-10-19 · Sobrante · x', amount_crc: 54106.7, created_at: '2026-10-20T06:31:39Z' }),
      fila({ id: 'manual', description: 'DUEÑO PEPE', amount_crc: 5000, created_at: '2026-10-20T15:00:00Z' }),
    ]
    const { discardDiaCompleto, previewDiaCompleto } = await import('./cash')
    const plan = await previewDiaCompleto('2026-10-20')
    expect(plan.borrar.map(f => f.id)).toEqual(['manual'])
    expect(plan.ajenas.map(f => f.id)).toEqual(['v1910', 'a1910'])
    await discardDiaCompleto('2026-10-20', undefined, undefined, plan.borrar.map(f => f.id))
    expect(rpcArgs.map(a => a.p_movement_id)).toEqual(['manual'])
  })

  it('20/07 (caso real): NO borra ventas del 19/07 ni propinas del 17/07', async () => {
    DB.sesiones = []; DB.movTurno = []
    DB.movPorCreacion = [
      fila({ id: 'p1707', subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-17 Noche', amount_crc: 70775, created_at: '2026-07-20T12:00:00Z' }),
      fila({ id: 'p2007', subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-20 Noche', amount_crc: 57480, created_at: '2026-07-20T12:00:00Z' }),
      fila({ id: 'vm1907', subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-07-19', amount_crc: 6973, created_at: '2026-07-20T21:07:00Z' }),
      fila({ id: 'vn1907', subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-07-19', amount_crc: -26089.81, amount_usd: 100, created_at: '2026-07-20T21:07:00Z' }),
    ]
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-07-20')
    expect(rpcArgs.map(a => a.p_movement_id)).toEqual(['p2007'])
  })

  it('borrar el 19/10 SÍ incluye su cierre creado el 20/10 (llega por la fecha de la descripción)', async () => {
    DB.sesiones = []; DB.movTurno = []; DB.movPorCreacion = []
    DB.movPorDescripcion = [fila({ id: 'v1910', subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-10-19', created_at: '2026-10-20T06:31:38Z' })]
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-10-19')
    expect(rpcArgs.map(a => a.p_movement_id)).toEqual(['v1910'])
  })

  it('si el plan cambió desde la vista previa, NO borra nada', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await expect(discardDiaCompleto('2026-06-20', undefined, undefined, ['turn-mov-1', 'turn-mov-2'])).rejects.toThrow(/cambiaron desde la vista previa/)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(calls).not.toContain('cash_cierres_dia.delete')
    expect(calls).not.toContain('cash_sessions.delete')
  })

  it('paso 3: si falla el delete del cierre, propaga el error (antes se tragaba) y no borra los turnos', async () => {
    DB.errores['cash_cierres_dia.delete'] = 'permission denied'
    const { discardDiaCompleto } = await import('./cash')
    await expect(discardDiaCompleto('2026-06-20')).rejects.toThrow(/NO el cierre del 2026-06-20: permission denied/)
    expect(calls).not.toContain('cash_sessions.delete')
  })
})

describe('cash.ts — discardCierreDia chequea el error de cada delete', () => {
  beforeEach(() => { calls.length = 0; permitirDeleteMovs = true; escenarioBase() })
  afterEach(() => { permitirDeleteMovs = false; vi.resetModules() })

  it('sin errores: borra ventas, retiro, ajuste y cierre', async () => {
    const { discardCierreDia } = await import('./cash')
    await discardCierreDia('2026-10-19')
    expect(calls).toEqual(['cash_movements.delete', 'cash_movements.delete', 'cash_movements.delete', 'cash_cierres_dia.delete'])
  })

  it('si falla un delete de movimientos, lanza (la pantalla lo muestra) y no sigue', async () => {
    DB.errores['cash_movements.delete'] = 'JWT expired'
    const { discardCierreDia } = await import('./cash')
    await expect(discardCierreDia('2026-10-19')).rejects.toThrow('No se pudo deshacer el cierre del 2026-10-19 (ventas del cierre): JWT expired')
    expect(calls).toEqual(['cash_movements.delete'])
  })
})
