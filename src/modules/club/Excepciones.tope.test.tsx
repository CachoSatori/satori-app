// @vitest-environment happy-dom
// (14-nov) ANFITRION_SOBRE_TOPE: el «Qué es» dice el tope que trae la excepción (`detalle.tope_crc`), no un monto fijo.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Excepcion } from '../../shared/api/club'

const exc = vi.hoisted(() => ({ lista: [] as unknown[] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getExcepciones: async () => exc.lista,
  getAlertasPrioritarias: async () => [],
}))

import Excepciones from './Excepciones'

const tope = (detalle: Record<string, unknown>): Excepcion => ({
  tipo: 'ANFITRION_SOBRE_TOPE', ref: 'tope:m1:2026-11', fecha: '2026-11-10T20:00:00Z', factura: null, certeza: 'exacta',
  detalle: { miembro: 'Anfitrión Prueba', mes: '2026-11', ...detalle }, resuelta: false, nota: null, resuelta_en: null,
} as unknown as Excepcion)

async function abrir() {
  render(<Excepciones />)
  fireEvent.click(await screen.findByText('Anfitrión sobre el tope', { selector: 'strong' }))
  return screen.getByText(/ganó en el mes más que el tope configurado/).textContent ?? ''
}

describe('Excepciones · ANFITRION_SOBRE_TOPE', () => {
  it('dice el tope del detalle (₡30.000), no un ₡25.000 fijo', async () => {
    exc.lista = [tope({ tope_crc: 30000 })]
    const t = await abrir()
    expect(t).toContain('el tope configurado del mes (₡30.000)')
    expect(t).not.toContain('25.000')
  })
  it('sin tope en el detalle: «el tope configurado del mes», sin monto', async () => {
    exc.lista = [tope({})]
    const t = await abrir()
    expect(t).toContain('el tope configurado del mes.')
    expect(t).not.toMatch(/₡/)
  })
})
