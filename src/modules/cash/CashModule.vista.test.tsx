// @vitest-environment happy-dom
// 15-nov: el aviso «Revisar los movimientos de Caja pendientes» del Inicio abre Caja en «Pendientes» (?vista=pendientes).
// El parámetro nunca da permisos: una pestaña que el rol no ve se ignora y Caja abre en la de siempre. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const s = vi.hoisted(() => ({ role: 'manager' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: s.role, full_name: 'Prueba' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: () => {} }))
vi.mock('../../shared/api/cash', () => ({
  getOpenCashSession: async () => null,
  getCashSessions: async () => [],
  getAllCashMovements: async () => [],
  getSuppliers: async () => [],
  getSupplierCredits: async () => [],
  getCreditApplications: async () => [],
  getCierresDia: async () => [],
}))
vi.mock('../../shared/api/jornadasConVentas', () => ({ getJornadasConVentas: async () => [] }))
vi.mock('./CashTurno',       () => ({ default: () => <p>pantalla turno</p> }))
vi.mock('./CashCierre',      () => ({ default: () => <p>pantalla cierre</p> }))
vi.mock('./CashMovimientos', () => ({ default: () => <p>pantalla movimientos</p> }))
vi.mock('./CashProveedores', () => ({ default: () => <p>pantalla proveedores</p> }))
vi.mock('./CashPendientes',  () => ({ default: () => <p>pantalla pendientes</p> }))
vi.mock('./CashResumen',     () => ({ default: () => <p>pantalla resumen</p> }))

import CashModule from './CashModule'

const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><CashModule /></MemoryRouter>)

beforeEach(() => { cleanup(); s.role = 'manager' })

describe('Caja · enlace desde el Inicio (?vista=)', () => {
  it('?vista=pendientes abre «Pendientes» (manager)', async () => {
    montar('/caja?vista=pendientes')
    expect(await screen.findByText('pantalla pendientes')).toBeTruthy()
    expect(screen.queryByText('pantalla turno')).toBeNull()
  })
  it('?vista=pendientes abre «Pendientes» también para el contador', async () => {
    s.role = 'contador'
    montar('/caja?vista=pendientes')
    expect(await screen.findByText('pantalla pendientes')).toBeTruthy()
  })
  it('sin parámetro, la de siempre: «Caja Diaria»', async () => {
    montar('/caja')
    expect(await screen.findByText('pantalla turno')).toBeTruthy()
  })
  it('una pestaña que el rol no ve se ignora: el contador pide «cierre» y abre en Movimientos', async () => {
    s.role = 'contador'
    montar('/caja?vista=cierre')
    expect(await screen.findByText('pantalla movimientos')).toBeTruthy()
    expect(screen.queryByText('pantalla cierre')).toBeNull()
  })
  it('una vista inventada no rompe: «Caja Diaria»', async () => {
    montar('/caja?vista=inventada')
    expect(await screen.findByText('pantalla turno')).toBeTruthy()
  })
})
