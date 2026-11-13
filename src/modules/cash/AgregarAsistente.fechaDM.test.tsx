// @vitest-environment happy-dom
// (13-nov, prod) Un tiquete decía «9/11/2026 5:05 p.m.» (Costa Rica: 9 de noviembre) y la app registró «fact 2026-09-11».
// Cadena completa: la Edge (simulada) devuelve la fecha como la leyó la IA → extractImageDetalle REAL la normaliza
// (conFechaCR) → el asistente precarga 2026-11-09, avisa «la leímos como D/M» y la descripción lleva la fecha buena.
// Reloj fijado de noche en CR: 23:30 del 13-nov = 05:30 UTC del 14-nov.
//
// Mutaciones (13-nov):
//  M1. documents.ts: extractImageDetalle sin `.map(d => conFechaCR(d))` → caen 3 pruebas de este archivo.
//  M2. AgregarAsistente: sacar el bloque `{avisoFecha && …}` → caen 3.
//  M3. fechaFactura.ts: quitar la rama de la clave FE (deClave) → caen 3 (con fechaFactura.test.ts).
//  M4. sin la inversión → caen 6 · M5. sin el aviso de futuro → caen 5 · M6. `>` por `>=` en el límite de 60 días → cae 1.
//  M7. el aviso de futuro con la fecha UTC (`toISOString`) en vez de todayCR() → cae 1 (la última de este archivo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'

const m = vi.hoisted(() => ({
  crearMov: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'mov-1', _pending: false })),
  invoke: vi.fn(),
}))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: m.crearMov, upsertSupplier: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { functions: { invoke: m.invoke } } }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: async () => ({ path: 'docs/f.jpg', sha: 'sha-foto' }),
           createDocumentRow: async () => ({ id: 'doc1' }), sha256File: async () => 'sha-foto', findDuplicate: async () => null,
           findDocsPorSha: async () => [], findDuplicateClave: async () => null, findFacturaParecida: async () => null,
           signedUrl: async () => null }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => <span>📷 factura</span> }))

import AgregarAsistente from './AgregarAsistente'

// Datos ficticios. Clave FE ficticia: 506 + DDMMAA + 41 dígitos.
const clave = (ddmmaa: string) => `506${ddmmaa}${'0'.repeat(12)}${'1'.repeat(20)}1${'2'.repeat(8)}`
const tiquete = (fecha: string, clave_fe: string | null = null) => ({ tipo: 'factura', proveedor: 'Proveedor Ficticio',
  numero_documento: '777', moneda: 'CRC', fecha, total: 12345, confianza: 0.9, items: [], clave_fe })
const sup: Supplier = { id: 'p1', name: 'Proveedor Ficticio', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' }
const session = { id: 's1', shift_type: 'PM' } as unknown as CashSession
const D_M = 'Revisá la fecha: la leímos como D/M.'
const FUTURO = 'Revisá la fecha: queda en el futuro.'

async function cargar(doc: ReturnType<typeof tiquete>) {
  m.invoke.mockResolvedValue({ data: { documentos: [doc] }, error: null })
  render(<AgregarAsistente openSession={session} suppliers={[sup]} role="cajero" createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />)
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement,
    { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: /Confirmar y registrar/ })
  return screen.getByLabelText('Fecha de factura') as HTMLInputElement
}

beforeEach(() => {
  cleanup()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T05:30:00Z'))   // 23:30 CR del 13-nov
  m.crearMov.mockClear(); m.invoke.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('fecha de factura día/mes (Costa Rica)', () => {
  it('caso de prod: la IA leyó 2026-09-11 → se precarga 2026-11-09, con aviso, y la descripción lleva «fact 2026-11-09»', async () => {
    const input = await cargar(tiquete('2026-09-11'))
    expect(input.value).toBe('2026-11-09')
    expect(screen.getByRole('status').textContent).toContain(D_M)
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ }))
    await waitFor(() => expect(m.crearMov).toHaveBeenCalledTimes(1))
    const desc = String(m.crearMov.mock.calls[0][0].description)
    expect(desc).toContain('fact 2026-11-09')
    expect(desc).not.toContain('2026-09-11')
  })

  it('la clave FE manda sobre la fecha de la IA, sin aviso', async () => {
    const input = await cargar(tiquete('2026-10-25', clave('091126')))
    expect(input.value).toBe('2026-11-09')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('fecha no ambigua (25/10) queda igual, sin aviso', async () => {
    const input = await cargar(tiquete('2026-10-25'))
    expect(input.value).toBe('2026-10-25')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ambigua leída en el futuro (2026-12-03) → 2026-03-12 con aviso D/M', async () => {
    const input = await cargar(tiquete('2026-12-03'))
    expect(input.value).toBe('2026-03-12')
    expect(screen.getByRole('status').textContent).toContain(D_M)
  })

  it('una fecha futura nunca queda sin aviso: ni la leída (25/12) ni la que escribe el usuario', async () => {
    const input = await cargar(tiquete('2026-12-25'))
    expect(input.value).toBe('2026-12-25')
    expect(screen.getByRole('status').textContent).toContain(FUTURO)
    fireEvent.change(input, { target: { value: '2026-11-10' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(input, { target: { value: '2026-11-14' } })   // mañana en CR (aunque en UTC ya sea 14)
    expect(screen.getByRole('status').textContent).toContain(FUTURO)
  })
})
