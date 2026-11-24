// @vitest-environment happy-dom
// Hallazgo 252, ronda 2 (Menor 1 del verificador del PR #355): la tarjeta de efectivo de Movimientos (Caja
// Proveedores dentro del pozo) y las demás pestañas leían los movimientos SIN la regla de la Caja Diaria: con un
// cambio de pago sin terminar contaban el pago dos veces. CashModule les pasa ahora la lista con el viejo fuera
// (aplicarReemplazos); la Caja Diaria sigue recibiendo los de su turno sin filtrar para ofrecer «Terminar el cambio».
// La pestaña se reemplaza por un doble que calcula la tarjeta con la función REAL (saldoTarjetaEfectivo). Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CashMovement, CashSession } from '../../shared/types/database'

const s = vi.hoisted(() => ({ role: 'contador', movs: [] as unknown[], sesiones: [] as unknown[] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: s.role, full_name: 'Prueba' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: () => {} }))
vi.mock('../../shared/api/cash', () => ({
  getOpenCashSession: async () => (s.role === 'manager' ? s.sesiones[0] : null),
  getCashSessions: async () => s.sesiones,
  getAllCashMovements: async () => s.movs,
  getSuppliers: async () => [],
  getSupplierCredits: async () => [],
  getCreditApplications: async () => [],
  getCierresDia: async () => [],
}))
vi.mock('../../shared/api/jornadasConVentas', () => ({ getJornadasConVentas: async () => [] }))
vi.mock('./cierrePozo', async (orig) => ({ ...(await orig<typeof import('./cierrePozo')>()), esPostCorte: () => true }))
vi.mock('./CashMovimientos', async () => {
  const { saldoTarjetaEfectivo } = await import('./tarjetaPozo')
  return {
    default: ({ movements, sessions }: { movements: CashMovement[]; sessions: CashSession[] }) => (
      <div>
        <p data-testid="tarjeta">{saldoTarjetaEfectivo(movements, sessions).crc}</p>
        <p data-testid="ids">{movements.map(m => m.id).sort().join(',')}</p>
      </div>
    ),
  }
})
vi.mock('./CashTurno', () => ({
  default: ({ sessionMovements, allMovements }: { sessionMovements: CashMovement[]; allMovements: CashMovement[] }) => (
    <div>
      <p data-testid="turno">{sessionMovements.map(m => m.id).sort().join(',')}</p>
      <p data-testid="todos">{allMovements.map(m => m.id).sort().join(',')}</p>
    </div>
  ),
}))
vi.mock('./CashCierre',      () => ({ default: () => <p>pantalla cierre</p> }))
vi.mock('./CashProveedores', () => ({ default: () => <p>pantalla proveedores</p> }))
vi.mock('./CashPendientes',  () => ({ default: () => <p>pantalla pendientes</p> }))
vi.mock('./CashResumen',     () => ({ default: () => <p>pantalla resumen</p> }))

import CashModule from './CashModule'
import { todayStr } from './cashUtils'
import { claveReemplazos, guardarReemplazos } from './reemplazoPago'

const HOY = todayStr()
const mov = (id: string, p: Partial<CashMovement>): CashMovement => ({
  id, session_id: 'sHoy', created_by: 'u1', movement_type: 'ingreso', amount_crc: 0, amount_usd: 0,
  currency: 'CRC', exchange_rate: 600, description: '', subcategory: '', supplier_id: null, supplier_name: null,
  employee_name: null, method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado',
  approved_by: null, approved_at: null, account_id: null,
  created_at: `${HOY}T18:00:00Z`, updated_at: `${HOY}T18:00:00Z`, ...p,
} as CashMovement)
const pago = (id: string, crc: number) => mov(id, { movement_type: 'egreso_mercaderia', amount_crc: crc, caja_origen: 'Caja Proveedores' })
const sesion = { id: 'sHoy', session_date: HOY, shift_type: 'Día', status: 'open', cajero_name: 'Caja Test' } as CashSession
const anotar = () => localStorage.setItem(claveReemplazos('sHoy'),
  JSON.stringify([{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]))

const montar = (url = '/caja') => render(<MemoryRouter initialEntries={[url]}><CashModule /></MemoryRouter>)

beforeEach(() => {
  cleanup(); localStorage.clear(); s.role = 'contador'
  s.movs = [mov('mov-fondo', { amount_crc: 100000 }), pago('mov-viejo', 15000), pago('mov-nuevo', 20000)]
  s.sesiones = [sesion]
})

describe('Caja · un cambio de pago sin terminar no cuenta doble fuera de la Caja Diaria', () => {
  it('control: sin anotación, la tarjeta descuenta los dos pagos', async () => {
    montar()
    expect((await screen.findByTestId('tarjeta')).textContent).toBe(String(100000 - 15000 - 20000))
  })

  it('con el par anotado en el aparato, Movimientos no ve el viejo y la tarjeta cuenta el pago una vez', async () => {
    anotar()
    montar()
    expect((await screen.findByTestId('tarjeta')).textContent).toBe(String(100000 - 20000))
    expect(screen.getByTestId('ids').textContent).toBe('mov-fondo,mov-nuevo')
  })

  it('la anotación hecha después (desde la Caja Diaria) se aplica sin recargar', async () => {
    montar()
    await screen.findByTestId('tarjeta')
    act(() => { guardarReemplazos('sHoy', [{ viejo: 'mov-viejo', nuevo: 'mov-nuevo', at: Date.now() }]) })
    expect(screen.getByTestId('tarjeta').textContent).toBe(String(100000 - 20000))
  })

  it('la Caja Diaria recibe su turno SIN filtrar (para «Terminar el cambio») y el resto filtrado', async () => {
    s.role = 'manager'
    anotar()
    montar()
    expect((await screen.findByTestId('turno')).textContent).toBe('mov-fondo,mov-nuevo,mov-viejo')
    expect(screen.getByTestId('todos').textContent).toBe('mov-fondo,mov-nuevo')
  })
})
