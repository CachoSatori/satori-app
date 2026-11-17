// @vitest-environment happy-dom
// (16-nov) FacturaVerify pide la firma de la foto recién cuando la fila se ve (IntersectionObserver), no al montarse:
// con cientos de filas en Caja → Movimientos, firmar todas juntas hacía que Storage respondiera 429/544.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

const H = vi.hoisted(() => ({ signedUrl: vi.fn(async (p: string) => `https://firmada.test/${p}`) }))
vi.mock('./api/documents', () => ({ signedUrl: H.signedUrl, getDocByMovement: vi.fn(async () => null) }))
vi.mock('./api/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }), rpc: vi.fn() } }))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Cajera Ficticia' } }) }))

import FacturaVerify from './FacturaVerify'
import type { CashMovement } from './types/database'
import type { DocumentRow } from './api/documents'

type Cb = (es: Array<{ isIntersecting: boolean }>) => void
let observados: Array<{ cb: Cb; el: Element | null }> = []
class IOFalso {
  cb: Cb; el: Element | null = null
  constructor(cb: Cb) { this.cb = cb }
  observe(el: Element) { this.el = el; observados.push(this) }
  disconnect() { observados = observados.filter(o => o !== this) }
}

const mov = { id: 'm1', factura_verified_by: null, factura_verified_at: null } as unknown as CashMovement
const doc = { id: 'd1', image_path: '2026-11-15/foto.jpg' } as unknown as DocumentRow

describe('FacturaVerify: firma al verse', () => {
  beforeEach(() => { H.signedUrl.mockClear(); observados = []; vi.stubGlobal('IntersectionObserver', IOFalso) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('no firma al montarse; firma cuando la fila entra a la vista y muestra la miniatura (lazy)', async () => {
    render(<FacturaVerify movement={mov} doc={doc} compact />)
    await act(async () => { await Promise.resolve() })
    expect(H.signedUrl).not.toHaveBeenCalled()
    expect(observados).toHaveLength(1)
    await act(async () => { observados[0].cb([{ isIntersecting: false }]) })
    expect(H.signedUrl).not.toHaveBeenCalled()
    await act(async () => { observados[0].cb([{ isIntersecting: true }]) })
    await waitFor(() => expect(H.signedUrl).toHaveBeenCalledWith('2026-11-15/foto.jpg'))
    const img = await screen.findByAltText('Factura')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(observados).toHaveLength(0)   // dejó de observar
  })

  it('sin IntersectionObserver (navegador viejo) firma al montarse, como antes', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<FacturaVerify movement={mov} doc={doc} />)
    await waitFor(() => expect(H.signedUrl).toHaveBeenCalledTimes(1))
  })

  it('sin factura enlazada: ni observa ni firma', async () => {
    render(<FacturaVerify movement={mov} doc={null} />)
    expect(screen.getByText('⚠ falta factura')).toBeTruthy()
    expect(observados).toHaveLength(0)
    expect(H.signedUrl).not.toHaveBeenCalled()
  })
})
