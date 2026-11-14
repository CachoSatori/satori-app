// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession } from '../../shared/types/database'

// Bug del 14-nov (staging): los inputs de Monto ₡ y Monto $ del asistente no tenían `step`, así que el
// navegador los marcaba inválidos con céntimos («los dos valores válidos más aproximados son 12345 y
// 12346») y el personal redondeaba la factura. Con step="any" el input acepta los céntimos y el monto
// llega tal cual a createCashMovement (este PR no cambia cómo se guarda ni cómo se redondea).

const { createSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
}))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession

function renderAsistente() {
  render(
    <AgregarAsistente openSession={session} suppliers={[]} role="cajero" createdBy="u1" tc={600}
      onCreated={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
}

beforeEach(() => createSpy.mockClear())

describe('AgregarAsistente — montos con céntimos', () => {
  it('Monto ₡ acepta 12345.67 (checkValidity true, sin stepMismatch)', () => {
    renderAsistente()
    const crc = screen.getByLabelText('Monto colones') as HTMLInputElement
    fireEvent.change(crc, { target: { value: '12345.67' } })
    expect(crc.value).toBe('12345.67')
    expect(crc.validity.stepMismatch).toBe(false)
    expect(crc.checkValidity()).toBe(true)
  })

  it('Monto $ acepta 31.47 (checkValidity true)', () => {
    renderAsistente()
    const usd = screen.getByLabelText('Monto dólares') as HTMLInputElement
    fireEvent.change(usd, { target: { value: '31.47' } })
    expect(usd.validity.stepMismatch).toBe(false)
    expect(usd.checkValidity()).toBe(true)
  })

  it('el monto con céntimos llega sin redondear a createCashMovement', async () => {
    renderAsistente()
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'pago de electricidad del mes' } })
    fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: '12345.67' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ })) })
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 12345.67 })
  })
})
