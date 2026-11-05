import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mig 071 — cierre del día ATÓMICO: el cliente hace UNA llamada (RPC) y propaga su error; la Fase 1
// traduce el choque con el UNIQUE(session_date) a un mensaje claro.

const { rpcSpy, insertResult } = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  insertResult: { data: null as unknown, error: null as { message: string; code?: string } | null },
}))

vi.mock('./supabase', () => {
  // `rpc` real usa `this` (el cliente): este mock lo exige, así un `supabase.rpc` suelto (sin bind)
  // revienta acá igual que en la base (bug real encontrado en staging).
  const cliente: { rest: object; rpc: (...a: unknown[]) => unknown; from: () => unknown } = {
    rest: {},
    rpc(this: { rest?: object } | undefined, ...args: unknown[]) {
      if (!this || !this.rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      return rpcSpy(...args)
    },
    from: () => {
      const b = {
        insert: () => b, select: () => b,
        single: () => Promise.resolve(insertResult),
      }
      return b
    },
  }
  return { supabase: cliente }
})
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

const resultado = (data: unknown, error: { message: string; code?: string } | null = null) => {
  const b = { abortSignal: () => b, then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data, error }).then(res, rej) }
  return b
}

const cierre = {
  vn_crc: 100000, vn_usd: 20, propinas_n_crc: 30000, otros_n_crc: 50000, ef_real_n_crc: 80000,
  sep_diaria_crc: 100000, sep_diaria_usd: 0, sep_registradora_crc: 50000, sep_registradora_usd: 0,
  remanente_crc: 400000, remanente_usd: 2000, diferencia_crc: -567, ajuste_tipo: 'Faltante',
  ajuste_motivo: 'cambio mal dado', notas: '', tipo_cambio: 505,
}

describe('cash.ts — cerrarDiaCompleto / deshacerCierreDia (RPC atómica, mig 071)', () => {
  beforeEach(() => { rpcSpy.mockReset() })
  afterEach(() => { vi.resetModules() })

  it('UNA sola llamada a cerrar_dia_completo con los valores tal cual (ventas por turno, retiro, ajuste)', async () => {
    rpcSpy.mockReturnValue(resultado({ cierre_id: 'c1', idempotente: false }))
    const { cerrarDiaCompleto } = await import('./cash')
    const r = await cerrarDiaCompleto({
      fecha: '2026-11-02', client_op_id: 'op-1', exchange_rate: 505, cierre,
      ventas: { mediodia: { crc: 20000, usd: 0 }, noche: { crc: 80000, usd: 20 } },
      retiro_crc: 50000, ajuste: { crc: -567, usd: 0, motivo: 'cambio mal dado' },
    })
    expect(r).toEqual({ cierre_id: 'c1', idempotente: false })
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('cerrar_dia_completo', {
      p_fecha: '2026-11-02', p_client_op_id: 'op-1', p_cierre: cierre,
      p_ventas: [{ turno: 'Mediodía', crc: 20000, usd: 0 }, { turno: 'Noche', crc: 80000, usd: 20 }],
      p_retiro_crc: 50000, p_ajuste: { crc: -567, usd: 0, motivo: 'cambio mal dado' }, p_exchange_rate: 505,
    })
  })

  it('si la base rechaza, propaga el error (nada quedó escrito: la transacción se revierte)', async () => {
    rpcSpy.mockReturnValue(resultado(null, { message: 'Cerrá el turno abierto en Caja Diaria antes del cierre del día' }))
    const { cerrarDiaCompleto } = await import('./cash')
    await expect(cerrarDiaCompleto({
      fecha: '2026-11-02', client_op_id: 'op-1', exchange_rate: 505, cierre,
      ventas: { mediodia: { crc: 0, usd: 0 }, noche: { crc: 0, usd: 0 } }, retiro_crc: 0, ajuste: { crc: 0, usd: 0, motivo: '' },
    })).rejects.toThrow('Cerrá el turno abierto en Caja Diaria antes del cierre del día')
  })

  it('deshacer: owner/manager sin credenciales; cajero con email + contraseña de gerencia', async () => {
    rpcSpy.mockReturnValue(resultado({ cierre_id: 'c1' }))
    const { deshacerCierreDia } = await import('./cash')
    await deshacerCierreDia('2026-11-02')
    await deshacerCierreDia('2026-11-02', 'jefe@satori.cr', 'secreta')
    expect(rpcSpy.mock.calls).toEqual([
      ['deshacer_cierre_dia', { p_fecha: '2026-11-02' }],
      ['deshacer_cierre_dia', { p_fecha: '2026-11-02', p_manager_email: 'jefe@satori.cr', p_manager_password: 'secreta' }],
    ])
  })

  it('deshacer: el error de la base se ve con la fecha', async () => {
    rpcSpy.mockReturnValue(resultado(null, { message: 'No autorizado para deshacer el cierre' }))
    const { deshacerCierreDia } = await import('./cash')
    await expect(deshacerCierreDia('2026-11-02')).rejects.toThrow('No se pudo deshacer el cierre del 2026-11-02: No autorizado para deshacer el cierre')
  })
})

describe('cash.ts — saveCierreParcial con el UNIQUE(session_date)', () => {
  afterEach(() => { vi.resetModules(); insertResult.error = null })

  it('23505 → «el mediodía ya está sellado», no un error técnico', async () => {
    insertResult.error = { message: 'duplicate key value violates unique constraint "cash_cierres_dia_session_date_key"', code: '23505' }
    const { saveCierreParcial } = await import('./cash')
    await expect(saveCierreParcial({ session_date: '2026-11-02' } as Parameters<typeof saveCierreParcial>[0]))
      .rejects.toThrow('El mediodía del 2026-11-02 ya está sellado. Recargá la pantalla para verlo.')
  })

  it('otro error → se propaga tal cual', async () => {
    insertResult.error = { message: 'JWT expired' }
    const { saveCierreParcial } = await import('./cash')
    await expect(saveCierreParcial({ session_date: '2026-11-02' } as Parameters<typeof saveCierreParcial>[0])).rejects.toThrow('JWT expired')
  })
})
