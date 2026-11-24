// @vitest-environment happy-dom
// Inventario → 🧾 Revisión: misma tabla que la Bandeja (InvLineTable REAL, no mockeada). Un precio ilegible («0-450»)
// apaga «💾 Guardar» y «✓ Completar» y no se escribe nada (ni metadatos, ni mapeo, ni la RPC). Borrarlo destraba.
// Tipeo con userEvent sobre la imitación de Chrome (R29). Datos ficticios.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ingredient } from '../../shared/types/inventario'
import { imitarInputNumeroDeChrome, textoVisible } from '../tips/inputNumeroComoChrome.testutil'

const H = vi.hoisted(() => {
  const task = { id: 't1', status: 'PENDIENTE', cash_movement_id: 'm1', document_id: 'doc1', supplier_id: null,
    entry_date: '2026-07-01', amount_crc: 50000, currency: 'CRC' }
  const doc = { id: 'doc1', image_path: 'docs/factura-ficticia.jpg', linked_movement_id: 'm1', estado: 'procesado',
    raw_json: { items: [{ descripcion: 'Pescado ficticio', cantidad: 2, unidad: 'K' }], total: 50000, proveedor: 'Proveedor Ficticio' } }
  const movement = { id: 'm1', created_by: 'u-1', amount_crc: 50000, amount_usd: 0, currency: 'CRC', method: 'Efectivo',
    status: 'aprobado', caja_origen: 'Caja Proveedores', created_at: '2026-07-01T10:00:00Z', description: 'Compra ficticia' }
  const responses: Record<string, { data: unknown; error: null }> = {
    inventory_review_task: { data: [task], error: null }, documents: { data: [doc], error: null },
    cash_movements: { data: [movement], error: null }, profiles: { data: [{ id: 'u-1', full_name: 'Usuario Ficticio' }], error: null },
  }
  const makeBuilder = (t: string) => {
    const result = responses[t] ?? { data: [], error: null }
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, order: () => b, update: () => b, single: () => b,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko),
    }
    return b
  }
  return { makeBuilder, rpc: vi.fn(async () => ({ error: null })), meta: vi.fn(async () => {}), learn: vi.fn(async () => {}) }
})

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: (t: string) => H.makeBuilder(t), rpc: H.rpc } }))
vi.mock('../../shared/api/documents', () => ({ signedUrl: vi.fn(async () => null), uploadImage: vi.fn(), extractImage: vi.fn(), createDocumentRow: vi.fn() }))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({ getSuppliers: vi.fn(async () => []), updateMovementMetadata: H.meta }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u-1', full_name: 'Usuario Ficticio', role: 'contador' } }) }))
vi.mock('../../shared/api/inventoryIngest', async orig => {
  const real = await orig<typeof import('../../shared/api/inventoryIngest')>()
  return { ...real, getSupplierItemMap: vi.fn(async () => []), learnSupplierMappings: H.learn }
})

import InvRevision from './InvRevision'

const ING = [{ id: 'ing-1', name: 'Pescado ficticio', unit: 'K' }] as unknown as Ingredient[]

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const boton = (re: RegExp) => screen.getByRole('button', { name: re }) as HTMLButtonElement
const precio = () => screen.getByLabelText('Precio: Pescado ficticio') as HTMLInputElement

async function abrir(u: ReturnType<typeof userEvent.setup>) {
  render(<InvRevision ingredients={ING} onRefresh={vi.fn()} />)
  await u.click(await screen.findByText('Revisar →'))
  await screen.findByLabelText('Precio: Pescado ficticio')
  await waitFor(() => expect(boton(/Completar/).disabled).toBe(false))
}

describe('Inventario → Revisión · precio ilegible no se guarda ni se completa', () => {
  it('«0-450» → aviso, «💾 Guardar» y «✓ Completar» apagados, no se escribe nada', async () => {
    const u = userEvent.setup()
    await abrir(u)
    expect(textoVisible(precio())).toBe('0')
    await u.type(precio(), '-450')
    expect(screen.getByRole('alert').textContent).toContain('«Precio · Pescado ficticio»')
    expect(boton(/Guardar/).disabled).toBe(true)
    expect(boton(/Completar/).disabled).toBe(true)
    await u.click(boton(/Guardar/))
    await u.click(boton(/Completar/))
    expect(H.meta).not.toHaveBeenCalled()
    expect(H.learn).not.toHaveBeenCalled()
    expect(H.rpc).not.toHaveBeenCalled()
  })

  it('borrar el «0-450» destraba y «💾 Guardar» vuelve a escribir', async () => {
    const u = userEvent.setup()
    await abrir(u)
    await u.type(precio(), '-450')
    await u.clear(precio())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(boton(/Completar/).disabled).toBe(false)
    await u.click(boton(/Guardar/))
    await waitFor(() => expect(H.meta).toHaveBeenCalledTimes(1))
  })
})
