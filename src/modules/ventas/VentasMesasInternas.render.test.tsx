// @vitest-environment happy-dom
// Ajustes → «Mesas internas»: el owner agrega (normalizada) y quita; el manager solo la ve. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./resumenV2Datos', () => ({ getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]) }))
let lista = ['51', '52', '53']
const agregar = vi.fn(async (_l: string, m: string) => { lista = [...lista, m] })
const quitar = vi.fn(async (_l: string, m: string) => { lista = lista.filter(x => x !== m) })
vi.mock('./mesasInternas', async () => ({
  ...(await vi.importActual<object>('./mesasInternas')),
  listarMesasInternas: vi.fn(async () => lista),
  agregarMesaInterna: (...a: [string, string]) => agregar(...a),
  quitarMesaInterna: (...a: [string, string]) => quitar(...a),
}))

import VentasMesasInternas from './VentasMesasInternas'

beforeEach(() => { role = 'owner'; lista = ['51', '52', '53']; agregar.mockClear(); quitar.mockClear() })
afterEach(cleanup)

describe('VentasMesasInternas', () => {
  it('owner: ve 51, 52 y 53; agrega «054» como 54 y quita la 52', async () => {
    render(<VentasMesasInternas />)
    await screen.findByText('Mesa 51')
    fireEvent.change(screen.getByLabelText('Mesa nueva'), { target: { value: ' 054 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await screen.findByText('Mesa 54')
    expect(agregar).toHaveBeenCalledWith('santa-teresa', '54')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar mesa 52' }))
    await vi.waitFor(() => expect(screen.queryByText('Mesa 52')).toBeNull())
    expect(quitar).toHaveBeenCalledWith('santa-teresa', '52')
  })
  it('owner: un número raro no se manda', async () => {
    render(<VentasMesasInternas />)
    await screen.findByText('Mesa 51')
    fireEvent.change(screen.getByLabelText('Mesa nueva'), { target: { value: 'mesa 5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await screen.findByRole('alert')
    expect(agregar).not.toHaveBeenCalled()
  })
  it('manager: la ve, sin agregar ni quitar', async () => {
    role = 'manager'
    render(<VentasMesasInternas />)
    await screen.findByText('Mesa 53')
    expect(screen.queryByRole('button', { name: 'Agregar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull()
    expect(document.body.textContent).toContain('Solo el owner cambia esta lista')
  })
})
