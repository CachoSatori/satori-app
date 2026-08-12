import { describe, it, expect, vi, afterEach } from 'vitest'

// Regresión del bug "Cannot read properties of undefined (reading 'rest')".
// Asignar `const rpc = supabase.rpc` (o `supabase.from`) DESESTACA el método: al llamarlo como
// función suelta, `this=undefined` y supabase-js hace `this.rest.…` → TypeError. El fix es
// `.bind(supabase)`. Este mock reproduce ese contrato exacto: rpc/from EXIGEN `this.rest`, así que
// si cash.ts vuelve a perder el bind, createSupplierCredit tira y getSupplierCredits cae a [].

const { supa, rpcCalls, fromCalls } = vi.hoisted(() => {
  const rpcCalls: Array<{ fn: string; thisOk: boolean }> = []
  const fromCalls: Array<{ table: string; thisOk: boolean }> = []
  const rest = { __marker: 'rest' }
  const supa: Record<string, unknown> = { rest }
  // `function` (no arrow) → `this` es observable, igual que los métodos reales del cliente.
  supa.rpc = function (this: { rest?: unknown } | undefined, fn: string) {
    const thisOk = !!(this && this.rest)
    rpcCalls.push({ fn, thisOk })
    if (!thisOk) throw new Error("Cannot read properties of undefined (reading 'rest')")
    return Promise.resolve({ data: 'new-credit-id', error: null })
  }
  supa.from = function (this: { rest?: unknown } | undefined, table: string) {
    const thisOk = !!(this && this.rest)
    fromCalls.push({ table, thisOk })
    if (!thisOk) throw new Error("Cannot read properties of undefined (reading 'rest')")
    return { select: () => Promise.resolve({ data: [{ id: 'c1', supplier_id: 's1' }], error: null }) }
  }
  return { supa, rpcCalls, fromCalls }
})

vi.mock('./supabase', () => ({ supabase: supa }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

afterEach(() => { rpcCalls.length = 0; fromCalls.length = 0; vi.resetModules() })

describe('cash.ts — supplier credits: rpc/from ligados al cliente (bind, no pierden this)', () => {
  it('createSupplierCredit invoca supabase.rpc con this=cliente y devuelve el id', async () => {
    const { createSupplierCredit } = await import('./cash')
    const id = await createSupplierCredit({
      supplier_id: 's1', origin: 'sobrepago', amount_crc: 1000,
      motivo: 'm', referencia: 'r', client_op_id: 'op-1',
    })
    expect(id).toBe('new-credit-id')
    expect(rpcCalls).toEqual([{ fn: 'create_supplier_credit', thisOk: true }])
  })

  it('getSupplierCredits invoca supabase.from con this=cliente y devuelve las filas (no [])', async () => {
    const { getSupplierCredits } = await import('./cash')
    const rows = await getSupplierCredits()
    // Sin bind, fromAny(...) tiraría → el try/catch lo tragaría → rows=[] y thisOk=false. Ambos fallan.
    expect(fromCalls).toEqual([{ table: 'supplier_credits', thisOk: true }])
    expect(rows).toEqual([{ id: 'c1', supplier_id: 's1' }])
  })
})
