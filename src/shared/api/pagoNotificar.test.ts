// (19-nov, dueño) Comprobante de pago al proveedor: UNA llamada a pago-notificar por pago, con todos los ids.
// Mientras prod tenga la Edge vieja (solo entiende `movimiento_id`), la app cae a una llamada por id.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fn = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: fn.invoke } } }))

import { sendPagoProveedorEmail, MENSAJE_EDGE_VIEJA } from './cash'

const err400 = (error: string) => ({ data: null, error: { context: new Response(JSON.stringify({ ok: false, error }), { status: 400 }) } })

// mockClear (no mockReset): con mockReset, vitest 4 da por falla un throw de la implementación aunque el código lo atrape.
beforeEach(() => { fn.invoke.mockClear(); fn.invoke.mockResolvedValue({ data: { ok: true }, error: null }) })

describe('sendPagoProveedorEmail', () => {
  it('una sola llamada con TODOS los ids del pago (deduplicados)', async () => {
    fn.invoke.mockResolvedValue({ data: { ok: true, agrupado: true }, error: null })
    await sendPagoProveedorEmail(['a1', 'a2', 'a1'])
    expect(fn.invoke).toHaveBeenCalledTimes(1)
    expect(fn.invoke).toHaveBeenCalledWith('pago-notificar', { body: { movimiento_ids: ['a1', 'a2'] } })
  })
  it('sin ids → no llama', async () => {
    await sendPagoProveedorEmail([])
    expect(fn.invoke).not.toHaveBeenCalled()
  })
  it('Edge vieja (400 «Falta movimiento_id») → cae a una llamada por id, como antes', async () => {
    fn.invoke.mockResolvedValueOnce(err400(MENSAJE_EDGE_VIEJA)).mockResolvedValue({ data: { ok: true }, error: null })
    await sendPagoProveedorEmail(['a1', 'a2'])
    expect(fn.invoke).toHaveBeenCalledTimes(3)
    expect(fn.invoke).toHaveBeenNthCalledWith(2, 'pago-notificar', { body: { movimiento_id: 'a1' } })
    expect(fn.invoke).toHaveBeenNthCalledWith(3, 'pago-notificar', { body: { movimiento_id: 'a2' } })
  })
  it('otro error de la Edge nueva (p. ej. 409 sin pagar, 400 de otro tipo) → NO reintenta por id', async () => {
    fn.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ ok: false, error: 'Hay movimientos que no están pagados' }), { status: 409 }) } })
    await sendPagoProveedorEmail(['a1', 'a2'])
    fn.invoke.mockResolvedValueOnce(err400('Los movimientos son de proveedores distintos'))
    await sendPagoProveedorEmail(['a1', 'a2'])
    expect(fn.invoke).toHaveBeenCalledTimes(2)
  })
  it('nunca lanza (la plata manda): sin red sigue de largo', async () => {
    fn.invoke.mockImplementation(async () => { throw new Error('Failed to fetch') })
    const r = await sendPagoProveedorEmail(['a1'])
    expect(r).toBeUndefined()
    expect(fn.invoke).toHaveBeenCalledTimes(1)
  })
})
