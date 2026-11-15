// @vitest-environment happy-dom
// (14-nov) Regla del dueño: «analizar la app según fecha calendario» y «el movimiento queda registrado el día en que se
// hizo, no por fecha de factura». Bandeja → Confirmar documento:
//  · fecha ambigua (las dos lecturas día/mes posibles): el campo arranca vacío (nunca «hoy»), pregunta y no confirma
//    hasta elegir;
//  · propinas: el movimiento ya no lleva la fecha del documento (antes `fecha` iba a insertInboxMovement → created_at
//    del día del comprobante); la fecha queda en la descripción.
// Reloj fijado de noche en CR: 23:30 del 13-nov = 05:30 UTC del 14-nov.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { DocumentRow, DocExtract } from '../../shared/api/documents'

const m = vi.hoisted(() => ({
  insertInbox: vi.fn<(x: Record<string, unknown>) => Promise<string>>(async () => 'mov-1'),
  createCash: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'mov-2' })),
  setDocEstado: vi.fn(async () => undefined),
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, signedUrl: async () => null, setDocEstado: m.setDocEstado, insertInboxMovement: m.insertInbox }
})
vi.mock('../../shared/api/cash', () => ({
  getSuppliers: vi.fn(), getAllCashMovements: vi.fn(), updateMovementStatus: vi.fn(), upsertSupplier: async () => ({ id: 'p1' }),
  getOpenCashSession: async () => ({ id: 's1', shift_type: 'PM' }), createCashMovement: m.createCash,
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: async () => [] }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: async () => 600 }))
vi.mock('../../shared/api/inventoryIngest', () => ({ listDocsNeedingInventory: async () => [] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => async () => ({ ok: true }) }))

import { ConfirmCard } from './InboxModule'
import { conFechaCR } from '../../shared/api/documents'

// Datos ficticios. Documento leído por la IA y normalizado el día en que se subió (13-nov).
const leido = (fecha: string, tipo: DocExtract['tipo'] = 'factura'): DocExtract => conFechaCR({
  tipo, proveedor: 'Proveedor Ficticio', clave_fe: null, fecha, moneda: 'CRC', metodo_pago: null, banco: null,
  referencia: null, subtotal: null, total: 1000, items: [], cuenta_qb_sugerida: null, confianza: 0.9,
} as DocExtract, '2026-11-13')
const doc = (raw: DocExtract): DocumentRow => ({ id: 'd1', image_path: 'docs/f.jpg', sha256: 'x', clave_fe: null, tipo: raw.tipo,
  raw_json: raw, estado: 'nuevo', linked_movement_id: null, created_by: 'u1', created_at: '2026-11-13T20:00:00Z' })

function abrir(raw: DocExtract) {
  const onDone = vi.fn()
  render(<ConfirmCard doc={doc(raw)} accounts={[]} suppliers={[]} pendientes={[]} tc={600} createdBy="u1" role="cajero"
    onClose={vi.fn()} onDone={onDone} onDiscard={vi.fn()} />)
  return { onDone, input: screen.getByLabelText('Fecha') as HTMLInputElement,
    boton: () => screen.getByRole('button', { name: /^✓ Confirmar/ }) as HTMLButtonElement }
}

beforeEach(() => {
  cleanup()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T05:30:00Z'))
  m.insertInbox.mockClear(); m.createCash.mockClear(); m.setDocEstado.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('Bandeja · fecha ambigua', () => {
  it('«11/10»: el campo arranca vacío (no «hoy»), pregunta y no deja confirmar', async () => {
    const { input, boton } = abrir(leido('2026-10-11'))
    expect(input.value).toBe('')
    expect(screen.getByRole('group', { name: 'Elegí la fecha de la factura' }).textContent)
      .toContain('¿10 de noviembre o 11 de octubre?')
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    await new Promise(r => setTimeout(r, 0))
    expect(m.createCash).not.toHaveBeenCalled()
    expect(m.insertInbox).not.toHaveBeenCalled()
  })

  it('si se vacía el campo después de elegir, la pregunta vuelve y «✓ Confirmar» se apaga', async () => {
    const { input, boton } = abrir(leido('2026-10-11'))
    fireEvent.click(screen.getByRole('button', { name: '10 de noviembre' }))
    expect(boton().disabled).toBe(false)
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByRole('group', { name: 'Elegí la fecha de la factura' })).toBeTruthy()
    expect(screen.getByTestId('falta-fecha').textContent).toContain('Elegí la fecha de la factura')
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    await new Promise(r => setTimeout(r, 0))
    expect(m.createCash).not.toHaveBeenCalled()
  })

  it('al elegir, confirma y la fecha va solo a la descripción (el movimiento entra hoy, en el turno)', async () => {
    const { input, boton, onDone } = abrir(leido('2026-10-11'))
    fireEvent.click(screen.getByRole('button', { name: '10 de noviembre' }))
    expect(input.value).toBe('2026-11-10')
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const mov = m.createCash.mock.calls[0][0]
    expect(String(mov.description)).toContain('fact 2026-11-10')
    expect(mov.session_id).toBe('s1')
    expect('fecha' in mov).toBe(false)
  })
})

describe('Bandeja · propinas: la fecha del movimiento es el día en que se registra', () => {
  it('no se pasa la fecha del documento al movimiento; queda en la descripción', async () => {
    const { input, boton, onDone } = abrir(leido('2026-11-05', 'propinas'))
    expect(input.value).toBe('2026-11-05')
    fireEvent.click(boton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const mov = m.insertInbox.mock.calls[0][0]
    expect(mov.fecha).toBeUndefined()
    expect(String(mov.description)).toContain('fact 2026-11-05')
  })
})
