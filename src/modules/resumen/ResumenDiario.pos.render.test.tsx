// @vitest-environment happy-dom
//
// Resumen del día: la venta sale del PoS (16-nov). Un día sin xls ahora muestra ventas, la
// navegación va día por día y una lectura caída no se confunde con «no hubo ventas».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'p1', role: 'owner' } }) }))
vi.mock('../../shared/api/supabase', () => {
  const cadena = (): unknown => {
    const p: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) }
    return new Proxy(p, { get: (o, k) => (k in o ? o[k as string] : () => cadena()) })
  }
  return { supabase: { from: () => cadena() } }
})

let pedidos: Array<[string, string]> = []
let falla = false
const DIA = {
  fileName: 'pos', uploadedAt: '2026-11-05',
  saloneros: { MESERO_FICTICIO: { pax: 4, total: 88_000, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [] } },
}
vi.mock('../ventas/ventasFuente', async orig => ({
  ...(await orig<Record<string, unknown>>()),
  ventasDelRango: async (desde: string, hasta: string) => {
    pedidos.push([desde, hasta])
    if (falla) throw new Error('sin conexión')
    return { dias: desde === '2026-11-16' ? { '2026-11-16': DIA } : {}, pm: {} }
  },
}))

import ResumenDiario from './ResumenDiario'
import { fi } from '../../shared/utils'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))   // 23:30 CR del 16-nov
  pedidos = []; falla = false
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const montar = () => render(<MemoryRouter><ResumenDiario /></MemoryRouter>)

describe('ResumenDiario · ventas del PoS', () => {
  it('hoy (CR, de noche) pide ese día al PoS y muestra la venta', async () => {
    montar()
    await waitFor(() => expect(screen.getByText(fi(88_000))).toBeTruthy())
    expect(pedidos[0]).toEqual(['2026-11-16', '2026-11-16'])
  })

  it('«Anterior» va al día de antes (no salta a un día con xls)', async () => {
    montar()
    await waitFor(() => expect(screen.getByText(fi(88_000))).toBeTruthy())
    fireEvent.click(screen.getByText('‹ Anterior'))
    await waitFor(() => expect(pedidos).toContainEqual(['2026-11-15', '2026-11-15']))
    await waitFor(() => expect(screen.getByText('El PoS no tiene ventas de este día')).toBeTruthy())
  })

  it('si el PoS no se puede leer lo dice (no «sin ventas»)', async () => {
    falla = true
    montar()
    await waitFor(() => expect(screen.getByText('No se pudieron leer las ventas del PoS')).toBeTruthy())
  })
})
