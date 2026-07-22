// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { CashMovement, CashSession } from '../../shared/types/database'
import { POZO_CORTE } from './cierrePozo'
import { fi } from '../../shared/utils'

// FIRMADO POR EL DUEÑO: con el pase del pozo a prod, el filtro "Desde" de Movimientos arranca
// en la FECHA DE CORTE. Las tarjetas de PERÍODO (Ingresos/Egresos/Ajustes) tienen que empezar
// en cero y acumular solo lo nuevo — sin mezclar plata del modelo viejo con la del nuevo.
//
// Los dos límites que este test fija, y que son lo delicado del pedido:
//   · El HISTÓRICO no se toca: mover "Desde" hacia atrás lo muestra igual que siempre.
//   · La tarjeta de PEND. TRANSFERENCIA **no** se filtra por período: un pendiente viejo sigue
//     siendo plata que se debe hoy. Si se filtrara, la deuda real desaparecería de la pantalla.

vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: vi.fn(),
  deleteCashMovement: vi.fn(),
  getCierresDia: vi.fn(async () => []),
  createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn(() => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Dueño' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'

let n = 0
const mov = (p: Partial<CashMovement>): CashMovement => {
  n += 1
  return {
    id: p.id ?? `m${n}`, session_id: p.session_id ?? null, created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 0, amount_usd: p.amount_usd ?? 0, currency: 'CRC',
    exchange_rate: 500, description: p.description ?? '', subcategory: p.subcategory ?? '',
    supplier_id: null, supplier_name: null, employee_name: null,
    method: p.method ?? 'Efectivo', shift: '', caja_origen: p.caja_origen ?? 'Caja Fuerte',
    status: p.status ?? 'aprobado', approved_by: null, approved_at: null, account_id: null,
    created_at: p.created_at ?? `${POZO_CORTE}T12:00:00+00:00`,
    updated_at: p.created_at ?? `${POZO_CORTE}T12:00:00+00:00`,
  } as CashMovement
}

// Anterior al corte pero DENTRO de la ventana vieja de 60 días: así el test discrimina de
// verdad. Con una fecha más vieja, el default anterior también la excluía y los tests pasaban
// con y sin el cambio — no probaban nada.
const ANTES = '2026-07-01'

// Histórico: ingreso y egreso viejos. No deben contar en las tarjetas de período por defecto.
const ingresoViejo = mov({ movement_type: 'ingreso', amount_crc: 900_000, created_at: `${ANTES}T12:00:00+00:00`, description: 'ingreso historico' })
const egresoViejo  = mov({ movement_type: 'egreso_operativo', amount_crc: 300_000, created_at: `${ANTES}T12:00:00+00:00`, description: 'egreso historico' })
// Pendiente VIEJO: plata que se sigue debiendo hoy aunque sea anterior al corte.
const pendienteViejo = mov({
  movement_type: 'egreso_mercaderia', amount_crc: 250_573, status: 'pendiente',
  method: 'Transferencia', caja_origen: 'Banco', created_at: `${ANTES}T12:00:00+00:00`,
  description: 'pendiente historico',
})

const sessions: CashSession[] = []
const render_ = (movements: CashMovement[]) =>
  render(<CashMovimientos movements={movements} sessions={sessions} onRefresh={vi.fn()} />)

/**
 * Valor de una tarjeta de la barra de saldos, por su rótulo.
 *
 * Acotado a `.cd-saldos-bar` A PROPÓSITO: rótulos como "Caja Fuerte" también aparecen en la
 * columna `caja_origen` de la tabla, así que un `getByText` global encuentra varios elementos
 * (o el equivocado) según cuántas filas deje pasar el filtro. Sin este acote el test pasaba o
 * fallaba por el motivo equivocado.
 */
const tarjeta = (label: string): string => {
  const barra = document.querySelector('.cd-saldos-bar') as HTMLElement
  return within(barra).getByText(label).parentElement?.querySelector('.cd-saldo-val')?.textContent ?? ''
}

describe('CashMovimientos — el filtro por defecto arranca en la fecha de corte', () => {
  it('"Desde" viene precargado con POZO_CORTE', () => {
    render_([ingresoViejo, egresoViejo])
    const desde = screen.getByText('Desde').parentElement?.querySelector('input[type="date"]') as HTMLInputElement
    expect(desde.value).toBe(POZO_CORTE)
  })

  it('Ingresos y Egresos del período arrancan en 0 (el histórico no se mezcla)', () => {
    render_([ingresoViejo, egresoViejo])
    expect(tarjeta('Ingresos (período)')).toBe(fi(0))
    expect(tarjeta('Egresos (período)')).toBe(fi(0))
  })

  it('Ajustes de cierre dice "Sin diferencias"', async () => {
    render_([ingresoViejo, egresoViejo])
    await waitFor(() => expect(screen.getByText('Sin diferencias')).toBeTruthy())
  })

  it('un movimiento DEL corte en adelante sí cuenta', () => {
    const nuevo = mov({ movement_type: 'ingreso', amount_crc: 20_000 })   // created_at = POZO_CORTE
    render_([ingresoViejo, nuevo])
    expect(tarjeta('Ingresos (período)')).toBe(fi(20_000))
  })

  it('EL HISTÓRICO NO SE TOCA: ampliando "Desde" hacia atrás vuelve a verse completo', () => {
    render_([ingresoViejo, egresoViejo])
    expect(tarjeta('Ingresos (período)')).toBe(fi(0))

    const desde = screen.getByText('Desde').parentElement?.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(desde, { target: { value: '2026-01-01' } })

    expect(tarjeta('Ingresos (período)')).toBe(fi(900_000))
    expect(tarjeta('Egresos (período)')).toBe(fi(300_000))
    expect(screen.getByText('ingreso historico')).toBeTruthy()
  })
})

describe('CashMovimientos — Pend. Transferencia NO se filtra por período', () => {
  it('un pendiente ANTERIOR al corte se sigue mostrando con el filtro por defecto', () => {
    render_([pendienteViejo])
    // La deuda real no puede desaparecer de la pantalla por mover un filtro de fechas.
    expect(tarjeta('Pend. Transferencia')).toBe(fi(250_573))
    expect(screen.getByText('1 pago')).toBeTruthy()
  })

  it('4 pendientes viejos suman igual con el filtro por defecto', () => {
    const p = (crc: number) => mov({
      movement_type: 'egreso_mercaderia', amount_crc: crc, status: 'pendiente',
      method: 'Transferencia', caja_origen: 'Banco', created_at: `${ANTES}T12:00:00+00:00`,
    })
    render_([p(100_000), p(80_000), p(50_000), p(20_573)])
    expect(tarjeta('Pend. Transferencia')).toBe(fi(250_573))
    expect(screen.getByText('4 pagos')).toBeTruthy()
  })

  it('la tarjeta de efectivo tampoco se filtra por período', () => {
    // Movimientos viejos y nuevos: el saldo los mira TODOS (el filtro es solo de la lista).
    render_([ingresoViejo, egresoViejo])
    expect(tarjeta('Caja Fuerte')).toBe(fi(600_000))   // 900.000 − 300.000, pre-corte
  })
})
