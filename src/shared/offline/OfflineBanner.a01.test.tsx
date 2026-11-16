// @vitest-environment happy-dom
// A01: lo que VE el personal cuando el servidor rechaza una op o la cola se traba.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { RejectedOp } from './outbox'

const rej: RejectedOp = {
  client_op_id: 'op-x', table: 'cash_movements', op: 'insert',
  payload: { amount_crc: 5000, description: 'Pago de ejemplo' },
  created_at: '2026-11-17T05:30:00.000Z',   // 23:30 del 16/11 en CR
  rejected_at: '2026-11-17T06:00:00.000Z', reason: 'un dato no cumple una regla de la base', code: '23514', status: 400,
}
const state = { pending: 0, rejected: 0, role: 'cajero' as string, stuck: { attempts: 0 } as { attempts: number; kind?: string; head?: string } }
const requeue = vi.fn<(id: string) => Promise<void>>(async () => {})
const force = vi.fn<(id: string, n: number, m: string) => Promise<boolean>>(async () => true)
const resolve = vi.fn<(id: string, by: string | null) => Promise<void>>(async () => {})

vi.mock('./outbox', async () => {
  const real = await vi.importActual<typeof import('./outbox')>('./outbox')
  return {
    ...real,
    initOutbox: () => {},
    flushNow: async () => null,
    pendingCount: async () => state.pending,
    rejectedCount: async () => state.rejected,
    rejectedOps: async () => (state.rejected ? [rej] : []),
    getStuck: () => state.stuck,
    requeueRejectedNow: (id: string) => requeue(id),
    resolveRejectedNow: (id: string, by: string | null) => resolve(id, by),
    forceRejectHeadNow: (id: string, n: number, m: string) => force(id, n, m),
  }
})
vi.mock('../api/supabase', () => ({ supabase: {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: state.role }, user: { id: 'u-ficticio' } }) }))

import OfflineBanner from './OfflineBanner'

beforeEach(() => {
  state.pending = 0; state.rejected = 0; state.role = 'cajero'; state.stuck = { attempts: 0 }
  requeue.mockClear(); resolve.mockClear(); force.mockClear()
})
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('A01 — aviso de operaciones rechazadas', () => {
  it('con rechazadas muestra el texto exacto, aunque no haya cola pendiente', async () => {
    state.rejected = 2
    render(<OfflineBanner />)
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Hay 2 operaciones que el servidor rechazó: avisá al manager')
  })

  it('singular', async () => {
    state.rejected = 1
    render(<OfflineBanner />)
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Hay 1 operación que el servidor rechazó: avisá al manager')
  })

  it('sin nada pendiente ni rechazado no muestra nada', async () => {
    const { container } = render(<OfflineBanner />)
    await flush()
    expect(container.textContent).toBe('')
  })

  it('«Ver detalle» muestra qué, cuándo (hora CR) y motivo; el cajero no ve los botones de resolver', async () => {
    state.rejected = 1
    render(<OfflineBanner />)
    await flush()
    fireEvent.click(screen.getByText('Ver detalle'))
    await flush()
    const d = screen.getByRole('dialog')
    expect(d.textContent).toContain('Movimiento de caja · nuevo · ₡5.000 · Pago de ejemplo')
    expect(d.textContent).toContain('registrada 16/11 23:30')
    expect(d.textContent).toContain('un dato no cumple una regla de la base (HTTP 400 · 23514)')
    expect(d.textContent).toContain('Solo un encargado o el dueño puede resolverlas.')
    expect(screen.queryByText('↻ Reintentar')).toBeNull()
  })

  it('el manager puede reintentar', async () => {
    state.rejected = 1; state.role = 'manager'
    render(<OfflineBanner />)
    await flush()
    fireEvent.click(screen.getByText('Ver detalle'))
    await flush()
    fireEvent.click(screen.getByText('↻ Reintentar'))
    await flush()
    expect(requeue).toHaveBeenCalledWith('op-x')
  })

  it('el dueño resuelve solo si confirma', async () => {
    state.rejected = 1; state.role = 'owner'
    render(<OfflineBanner />)
    await flush()
    fireEvent.click(screen.getByText('Ver detalle'))
    await flush()
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    ;(window as unknown as { confirm: unknown }).confirm = confirm
    fireEvent.click(screen.getByText('✓ Ya lo resolví')); await flush()
    expect(resolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('✓ Ya lo resolví')); await flush()
    expect(resolve).toHaveBeenCalledWith('op-x', 'u-ficticio')
    expect(confirm).toHaveBeenCalledTimes(2)
  })
})

describe('A01 — aviso de cola trabada', () => {
  it('tras 5 intentos por sesión vencida muestra el motivo', async () => {
    state.pending = 3; state.stuck = { attempts: 5, kind: 'sesion' }
    render(<OfflineBanner />)
    await flush()
    expect(screen.getByRole('status').textContent).toContain(
      'No se pudo sincronizar después de 5 intentos: la sesión venció. Volvé a iniciar sesión (lo pendiente no se pierde). Lo pendiente sigue guardado en este aparato.')
  })
  it('con 4 intentos todavía no avisa', async () => {
    state.pending = 3; state.stuck = { attempts: 4, kind: 'sesion' }
    render(<OfflineBanner />)
    await flush()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.body.textContent).toContain('3 operaciones pendientes de sincronizar')
  })
})

describe('verificador #234 — «Pasar a rechazadas»', () => {
  it('manager con cola trabada por el servidor: ve el botón y, si confirma, pasa la primera op', async () => {
    state.pending = 2; state.role = 'manager'; state.stuck = { attempts: 5, kind: 'servidor', head: 'op-h' }
    render(<OfflineBanner />)
    await flush()
    const confirm = vi.fn().mockReturnValue(true)
    ;(window as unknown as { confirm: unknown }).confirm = confirm
    fireEvent.click(screen.getByText('Pasar a rechazadas')); await flush()
    expect(confirm.mock.calls[0][0]).toContain('No se borra')
    expect(force).toHaveBeenCalledWith('op-h', 5, 'el servidor no está respondiendo bien; se sigue reintentando')
  })
  it('el cajero no ve el botón', async () => {
    state.pending = 2; state.stuck = { attempts: 5, kind: 'servidor', head: 'op-h' }
    render(<OfflineBanner />)
    await flush()
    expect(screen.queryByText('Pasar a rechazadas')).toBeNull()
  })
  it('con freno por sesión vencida no se ofrece (se arregla entrando de nuevo)', async () => {
    state.pending = 2; state.role = 'owner'; state.stuck = { attempts: 5, kind: 'sesion', head: 'op-h' }
    render(<OfflineBanner />)
    await flush()
    expect(screen.queryByText('Pasar a rechazadas')).toBeNull()
  })
})
