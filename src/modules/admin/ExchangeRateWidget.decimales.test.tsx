// @vitest-environment happy-dom
//
// Tipo de cambio de Admin con decimales (firma del dueño, 14-nov): tenía step={1} y el navegador
// marcaba inválido un TC como 505.37. Ahora step="any"; el valor se guarda tal cual
// (exchange_rates.usd_to_crc es numeric(10,2)).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  getCurrentRate: vi.fn(async () => 500),
  getRateHistory: vi.fn(async () => []),
  saveRate:       vi.fn(async (p: Record<string, unknown>) => { void p }),
}))
vi.mock('../../shared/api/exchangeRate', () => api)
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner' } }) }))

import ExchangeRateWidget from './ExchangeRateWidget'

describe('Admin · tipo de cambio acepta decimales', () => {
  it('505.37 pasa checkValidity y se guarda sin redondear', async () => {
    render(<ExchangeRateWidget />)
    const input = await screen.findByPlaceholderText('640') as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('500'))
    fireEvent.change(input, { target: { value: '505.37' } })
    expect(input.validity.stepMismatch).toBe(false)
    expect(input.checkValidity()).toBe(true)
    fireEvent.click(screen.getByText('Actualizar'))
    await waitFor(() => expect(api.saveRate).toHaveBeenCalledTimes(1))
    expect(api.saveRate.mock.calls[0][0]).toMatchObject({ usd_to_crc: 505.37 })
  })
})
