// @vitest-environment happy-dom
// R35 · Club → Promociones: descuento (%) de una promoción, días del premio de un reto y el beneficio de cumpleaños
// (mínimo de personas, días antes y después). Antes los cuadros de texto borraban lo que no era dígito («0-450» → 450,
// «3.5» → 35, no se podía escribir «12.5») y los `type="number"` de cumpleaños volvían 0 lo ilegible, truncaban «2.5» y
// pasaban un negativo a 0, todo sin aviso. Ahora aviso que nombra el cuadro, botón apagado y la API no se llama. Los
// `type="number"` se escriben con `teclearNumero` arrancando vacíos; búsquedas por rol y nombre (R32). Datos ficticios.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { teclearNumero } from '../cash/teclearNumero.testutil'

const CFG = {
  location_id: 'local-prueba', activo: false, beneficio: 'postre de cortesía', min_personas: 5, dias_antes: 7, dias_despues: 7,
  uno_por_mesa: true, solo_reserva: true, reserva_url: null,
  cortesia: { id: 'k1', codigo: 'P1', nombre: 'Postre Ficticio', activa: true }, lista_para_caja: true,
}
const api = vi.hoisted(() => ({
  guardarPromocion: vi.fn(async () => 'p1'), getRetos: vi.fn(async () => ({ exige_factura: true, retos: [] })),
  guardarReto: vi.fn(async () => 'r1'), getCortesiasDe: vi.fn(async () => []),
  getLocalesClub: vi.fn(async () => [{ id: 'loc-a', nombre: 'Local Ficticio A', activo: true }]),
  getCumpleConfig: vi.fn(), getCortesias: vi.fn(async () => []), guardarCumpleConfig: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))

import { FormPromocion } from './Promociones'
import Retos from './Retos'
import { ConfigCumple } from './CumpleConfig'

beforeEach(() => {
  vi.clearAllMocks()
  api.getCumpleConfig.mockResolvedValue({ ...CFG })
  api.guardarCumpleConfig.mockImplementation(async (d: object) => ({ ...CFG, ...d }))
  window.confirm = vi.fn(() => true)
})
afterEach(() => { cleanup() })

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement
const avisos = () => screen.queryAllByRole('alert').map(a => a.textContent ?? '').join(' | ')

describe('Promociones · descuento (%)', () => {
  const abrir = () => {
    render(<FormPromocion inicial={null} onCancelar={() => {}} onGuardada={() => {}} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Promo ficticia' } })
    return screen.getByRole('textbox', { name: 'Descuento (%)' }) as HTMLInputElement
  }

  it.each(['0-450', '5-', '1.2.3', '1e3', '150'])('«%s» → se ve tal cual, aviso con «Descuento (%%)», no guarda', async texto => {
    const u = userEvent.setup()
    const pct = abrir()
    await u.clear(pct)
    await u.type(pct, texto)
    expect(pct.value).toBe(texto)
    expect(avisos()).toContain('«Descuento (%)»')
    expect(boton('Guardar').disabled).toBe(true)
    fireEvent.click(boton('Guardar'))
    expect(api.guardarPromocion).not.toHaveBeenCalled()
  })

  it('«12.5» se escribe y se guarda 12.5 (antes salía 125)', async () => {
    const u = userEvent.setup()
    const pct = abrir()
    await u.clear(pct)
    await u.type(pct, '12.5')
    expect(avisos()).toBe('')
    fireEvent.click(boton('Guardar'))
    await waitFor(() => expect(api.guardarPromocion).toHaveBeenCalled())
    expect((api.guardarPromocion.mock.calls[0] as unknown as [null, { porcentaje: number }])[1].porcentaje).toBe(12.5)
  })
})

describe('Retos · el premio vale (días)', () => {
  const abrir = async () => {
    render(<Retos owner />)
    fireEvent.click(await screen.findByText('+ Nuevo reto'))
    return screen.getByRole('textbox', { name: 'El premio vale (días)' }) as HTMLInputElement
  }

  it.each(['0-45', '3.5', '5-', '', '6', '91'])('«%s» → aviso con el cuadro, «Guardar borrador» apagado, no guarda', async texto => {
    const u = userEvent.setup()
    const dias = await abrir()
    await u.clear(dias)
    if (texto) await u.type(dias, texto)
    expect(dias.value).toBe(texto)
    expect(avisos()).toContain('«El premio vale (días)»')
    expect(boton('Guardar borrador').disabled).toBe(true)
    fireEvent.click(boton('Guardar borrador'))
    expect(api.guardarReto).not.toHaveBeenCalled()
  })

  it('«45» no da aviso del cuadro', async () => {
    const u = userEvent.setup()
    const dias = await abrir()
    await u.clear(dias)
    await u.type(dias, '45')
    expect(avisos()).not.toContain('«El premio vale (días)»')
  })
})

describe('Beneficio de cumpleaños · mínimo de personas y días', () => {
  const cuadro = (n: string) => screen.getByRole('spinbutton', { name: n }) as HTMLInputElement

  it.each([['Mínimo de personas', '5-'], ['Mínimo de personas', '0'], ['Mínimo de personas', '1e3'], ['Días antes', '--'],
    ['Días antes', '2.5'], ['Días después', '-3'], ['Días después', '31']])(
    '«%s» con «%s» → aviso, Guardar y Encender apagados, no guarda', async (nombre, texto) => {
      render(<ConfigCumple edita />)
      await screen.findByLabelText('Beneficio')
      teclearNumero(cuadro(nombre), '')
      teclearNumero(cuadro(nombre), texto)
      expect(avisos()).toContain(`«${nombre}»`)
      expect(boton('Guardar').disabled).toBe(true)
      expect(boton('Encender').disabled).toBe(true)
      fireEvent.click(boton('Guardar'))
      expect(api.guardarCumpleConfig).not.toHaveBeenCalled()
    })

  it('borrar «Días antes» vale 0, como antes, y se guarda', async () => {
    render(<ConfigCumple edita />)
    await screen.findByLabelText('Beneficio')
    teclearNumero(cuadro('Días antes'), '')
    expect(avisos()).toBe('')
    fireEvent.click(boton('Guardar'))
    await waitFor(() => expect(api.guardarCumpleConfig).toHaveBeenCalled())
    expect((api.guardarCumpleConfig.mock.calls[0] as unknown as [{ dias_antes: number }])[0].dias_antes).toBe(0)
  })
})
