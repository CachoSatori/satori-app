// @vitest-environment happy-dom
// R35 · CRM → «Registrar interacción» (ClientesModule) y «Fidelización» (LoyaltyConfig): un cuadro `type="number"` con
// texto ilegible da `value === ''` + `validity.badInput`; antes `Number(x) || 0` registraba ₡0 / 0 puntos o guardaba la
// regla en 0 sin aviso. Ahora aviso que nombra el cuadro, botón apagado y no se llama a la API. Cuadros escritos con
// `teclearNumero` arrancando vacíos (R30); búsquedas por rol y nombre (R32). Datos ficticios.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { teclearNumero } from '../cash/teclearNumero.testutil'
import { DEFAULT_RULES, type Customer } from '../../shared/types/crm'

const CLIENTE: Customer = {
  id: 'c1', phone: '+00000000', name: 'Cliente Ficticio', email: null, birth_date: null, channel_origin: 'manual',
  first_seen: '2026-01-01', last_seen: null, total_visits: 0, total_spent_crc: 0, points: 0, tier: 'nuevo',
  wallet_pass_id: null, notes: null, active: true, created_at: '2026-01-01', updated_at: '2026-01-01',
}
const H = vi.hoisted(() => ({
  addInteraction: vi.fn(async () => {}), saveLoyaltyRules: vi.fn(async () => {}), upsertReward: vi.fn(async () => {}),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../../shared/api/crm', () => ({
  getCustomers: async () => [CLIENTE], upsertCustomer: vi.fn(), deactivateCustomer: vi.fn(),
  getInteractions: async () => [], addInteraction: H.addInteraction,
  getLoyaltyRules: async () => ({ ...DEFAULT_RULES }), getRewards: async () => [],
  saveLoyaltyRules: H.saveLoyaltyRules, upsertReward: H.upsertReward, deleteReward: vi.fn(),
}))

import ClientesModule from './ClientesModule'
import LoyaltyConfig from './LoyaltyConfig'

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const cuadro = (nombre: string) => screen.getByRole('spinbutton', { name: nombre }) as HTMLInputElement
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null

describe('Clientes · registrar interacción', () => {
  const abrir = async () => {
    render(<ClientesModule />)
    fireEvent.click(await screen.findByText('Cliente Ficticio'))
    fireEvent.click(boton('+ Registrar interacción'))
  }

  it.each([['Monto ₡', '5-'], ['Monto ₡', '--'], ['Puntos +', '0-450'], ['Puntos −', '-'], ['Puntos +', '2.5'], ['Puntos −', '-3']])(
    '«%s» con «%s» → aviso con el cuadro, «Guardar» apagado, no registra', async (nombre, texto) => {
      await abrir()
      teclearNumero(cuadro(nombre), '')
      teclearNumero(cuadro(nombre), texto)
      expect(aviso()).toContain(`«${nombre}»`)
      expect(boton('Guardar').disabled).toBe(true)
      fireEvent.click(boton('Guardar'))
      expect(H.addInteraction).not.toHaveBeenCalled()
    })

  it('monto ilegible no recalcula los puntos con 0; borrarlo destraba y vacío registra 0 como antes', async () => {
    await abrir()
    teclearNumero(cuadro('Monto ₡'), '12000')
    const puntos = cuadro('Puntos +').value
    teclearNumero(cuadro('Monto ₡'), '12000-')
    expect(cuadro('Puntos +').value).toBe(puntos)
    teclearNumero(cuadro('Monto ₡'), '')
    teclearNumero(cuadro('Puntos +'), '')
    expect(aviso()).toBeNull()
    fireEvent.click(boton('Guardar'))
    await waitFor(() => expect(H.addInteraction).toHaveBeenCalled())
    expect((H.addInteraction.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ amount_crc: 0, points_earned: 0, points_spent: 0 })
  })
})

describe('Fidelización · reglas y recompensas', () => {
  it.each(['5-', '0-450', '-10'])('regla «Bonus cumpleaños» con «%s» → aviso, «Guardar reglas» apagado, no guarda', async texto => {
    render(<LoyaltyConfig />)
    const c = await screen.findByRole('spinbutton', { name: 'Bonus cumpleaños' })
    teclearNumero(c, '')
    teclearNumero(c, texto)
    expect(aviso()).toContain('«Bonus cumpleaños»')
    expect(boton(/Guardar reglas/).disabled).toBe(true)
    fireEvent.click(boton(/Guardar reglas/))
    expect(H.saveLoyaltyRules).not.toHaveBeenCalled()
  })

  it('regla válida (con decimales) se guarda igual que antes', async () => {
    render(<LoyaltyConfig />)
    teclearNumero(await screen.findByRole('spinbutton', { name: 'Puntos por ₡1.000' }), '2.5')
    fireEvent.click(boton(/Guardar reglas/))
    await waitFor(() => expect(H.saveLoyaltyRules).toHaveBeenCalled())
    expect((H.saveLoyaltyRules.mock.calls[0] as unknown as [Record<string, number>])[0].points_per_1000).toBe(2.5)
  })

  it.each(['5-', '2.5', '-1'])('costo de recompensa «%s» → aviso y no se agrega (la columna es entera)', async texto => {
    render(<LoyaltyConfig />)
    fireEvent.change(await screen.findByPlaceholderText('Nombre'), { target: { value: 'Postre ficticio' } })
    teclearNumero(cuadro('Puntos (costo de la recompensa)'), '')
    teclearNumero(cuadro('Puntos (costo de la recompensa)'), texto)
    expect(aviso()).toContain('«Puntos (costo de la recompensa)»')
    expect(boton('+ Agregar').disabled).toBe(true)
    fireEvent.click(boton('+ Agregar'))
    expect(H.upsertReward).not.toHaveBeenCalled()
  })
})
