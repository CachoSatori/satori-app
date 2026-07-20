// @vitest-environment happy-dom
//
// Ruteo del pago en la pestaña Pendientes: una propina dejada pendiente se salda por BANCO
// (no sacó efectivo de la caja — el turno ya cerró); un proveedor se salda como siempre.
// La decisión se toma por `subcategory` del movimiento real, NO por cómo estén agrupadas las
// filas en pantalla: el agrupamiento es display y puede cambiar sin que la plata cambie de vía.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  updateMovementStatus: vi.fn(async (id: string, status: string) => ({ id, status })),
  updateCashMovement:   vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, updates })),
}))
vi.mock('../../shared/api/cash', () => api)
vi.mock('../../shared/ManagerOverride', () => ({
  useManagerOverride: () => vi.fn(async () => ({ ok: true })),
}))

import CashPendientes from './CashPendientes'
const { updateMovementStatus, updateCashMovement } = api

const mov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 10000, amount_usd: 0,
  created_at: '2026-07-15T18:00:00Z', description: '', subcategory: '', shift: null,
  method: 'Efectivo', caja_origen: 'Registradora', supplier_name: null, employee_name: null,
  ...over,
} as unknown as CashMovement)

const propina = mov({
  id: 'prop-1', subcategory: 'Propinas por turno', movement_type: 'egreso_personal',
  description: 'Propinas turno 2026-07-14 Noche', amount_crc: 30000,
})
const proveedor = mov({
  id: 'prov-1', supplier_name: 'Pescados del Pacífico', description: 'Factura 12', amount_crc: 50000,
})

// Botón "✓ Pagado" de la fila que contiene ese texto (no del grupo ni de otra fila).
// El texto puede aparecer también en el encabezado del grupo → nos quedamos con el <tr>.
const pagarFila = (textoDeLaFila: string) => {
  const fila = screen.getAllByText(textoDeLaFila).map(el => el.closest('tr')).find(Boolean)!
  fireEvent.click(within(fila).getByText('✓ Pagado'))
}

beforeEach(() => vi.clearAllMocks())

describe('CashPendientes · una propina pendiente se paga por banco', () => {
  it('propina → updateCashMovement con Transferencia/Banco (no descuenta efectivo)', async () => {
    render(<CashPendientes movements={[propina, proveedor]} sessions={[]} onRefresh={vi.fn()} />)

    pagarFila('Propinas turno 2026-07-14 Noche')

    await waitFor(() => expect(updateCashMovement).toHaveBeenCalledTimes(1))
    expect(updateCashMovement.mock.calls[0][0]).toBe('prop-1')
    expect(updateCashMovement.mock.calls[0][1]).toEqual({
      status: 'aprobado', method: 'Transferencia', caja_origen: 'Banco',
    })
    // La vía de propinas NO pasa por el atajo de solo-status.
    expect(updateMovementStatus).not.toHaveBeenCalled()
  })

  it('proveedor → sigue siendo solo status, sin tocar método ni caja', async () => {
    render(<CashPendientes movements={[propina, proveedor]} sessions={[]} onRefresh={vi.fn()} />)

    pagarFila('Factura 12')

    await waitFor(() => expect(updateMovementStatus).toHaveBeenCalledTimes(1))
    expect(updateMovementStatus.mock.calls[0]).toEqual(['prov-1', 'aprobado'])
    expect(updateCashMovement).not.toHaveBeenCalled()
  })

  it('"Marcar todos pagados" mixto: cada fila va por su vía', async () => {
    // Ambos movimientos en el MISMO grupo visual (mismo supplier_name) — el ruteo debe seguir
    // saliendo del subcategory de cada fila, no del grupo que las contiene.
    const propinaEnGrupoDeProveedor = mov({
      id: 'prop-2', subcategory: 'Propinas por turno', supplier_name: 'Pescados del Pacífico',
      description: 'Propinas turno 2026-07-12 Noche', amount_crc: 8000,
    })
    render(<CashPendientes movements={[proveedor, propinaEnGrupoDeProveedor]} sessions={[]} onRefresh={vi.fn()} />)

    fireEvent.click(screen.getByText('✓ Marcar todos pagados'))

    await waitFor(() => expect(updateCashMovement).toHaveBeenCalledTimes(1))
    expect(updateCashMovement.mock.calls[0][0]).toBe('prop-2')
    expect(updateMovementStatus.mock.calls.map(c => c[0])).toEqual(['prov-1'])
  })
})
