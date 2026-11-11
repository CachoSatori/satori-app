// @vitest-environment happy-dom
//
// Rediseño B4, en el DOM: frase, 3 números, «Para hacer hoy» y el estado «todo en orden».
// La base está simulada (solo lecturas); los datos son ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let role = 'owner'
vi.mock('../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'p1', role, is_active: true, full_name: 'Persona Ficticia' },
    signOut: vi.fn(),
  }),
}))

// Respuestas por tabla: { data, count }. Cualquier cadena de filtros devuelve lo mismo.
let tablas: Record<string, { data?: unknown; count?: number }> = {}
vi.mock('../shared/api/supabase', () => {
  const cadena = (t: string): unknown => {
    const r = { data: tablas[t]?.data ?? null, count: tablas[t]?.count ?? 0, error: null }
    const p: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko),
    }
    return new Proxy(p, { get: (o, k) => (k in o ? o[k as string] : () => cadena(t)) })
  }
  return { supabase: { from: (t: string) => cadena(t) } }
})

let alertaDias: string[] = []
vi.mock('../shared/api/cash', () => ({
  getCierresDia: async () => [],
  getAllCashMovements: async () => [],
  getCashSessions: async () => alertaDias.map((f, i) => ({ id: `s${i}`, status: 'open', session_date: f, cajero_name: null })),
}))
vi.mock('../shared/api/jornadasConVentas', () => ({ getJornadasConVentas: async () => [] }))

import HomePage from './HomePage'

function montar() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>)
}

beforeEach(() => {
  cleanup()
  role = 'owner'
  tablas = { sops: { count: 7 } }
  alertaDias = []
  sessionStorage.clear()
})

describe('Inicio (B4)', () => {
  it('owner sin pendientes: «Todo en orden.», Daruma y los 3 números', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Todo en orden.')).toBeTruthy())
    expect(screen.getByText('Todo en orden')).toBeTruthy()
    for (const t of ['Venta de hoy', 'Propinas del día', 'Caja de hoy']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('owner con movimientos por revisar y un turno viejo: lista con píldoras, lo malo primero', async () => {
    tablas.cash_movements = { data: [], count: 3 }
    alertaDias = ['2026-01-05']
    montar()
    await waitFor(() => expect(screen.getByText('Hay una cosa para resolver hoy.')).toBeTruthy())
    const items = within(screen.getByRole('list')).getAllByRole('button')
    expect(items.map(b => b.textContent)).toEqual([
      expect.stringContaining('1 turno abierto'),
      expect.stringContaining('3 por revisar'),
    ])
    expect(screen.queryByText('Todo en orden')).toBeNull()
  })

  it('contador: no carga la alerta de cierres (como en Caja) y ve igual sus pendientes', async () => {
    role = 'contador'
    tablas.cash_movements = { data: [], count: 2 }
    alertaDias = ['2026-01-05']
    montar()
    await waitFor(() => expect(screen.getByText('Queda un pendiente para hoy.')).toBeTruthy())
    expect(screen.getByText('2 por revisar')).toBeTruthy()
    expect(screen.queryByText(/turno abierto/)).toBeNull()
  })

  it('roles de operación: solo la grilla, sin frase ni números', async () => {
    role = 'barman'
    montar()
    expect(screen.getByText('Tus módulos')).toBeTruthy()
    expect(screen.queryByText('Para hacer hoy')).toBeNull()
    expect(screen.queryByText('Venta de hoy')).toBeNull()
    expect(screen.getByText('Mi Turno')).toBeTruthy()
  })
})
