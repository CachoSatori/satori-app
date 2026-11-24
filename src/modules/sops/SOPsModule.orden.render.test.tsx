// @vitest-environment happy-dom
// R35 · SOPs → editor de un procedimiento, cuadro «Orden» (`type="number"`, columna integer). Antes `Number('')` guardaba
// orden 0 con texto ilegible («0-450», «5-») y «2.5» llegaba a la base y fallaba con el error crudo. Ahora aviso que
// nombra el cuadro, «Guardar procedimiento» apagado y la API no se llama. Vacío = 0, como antes. Datos ficticios.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { teclearNumero } from '../cash/teclearNumero.testutil'

const H = vi.hoisted(() => ({ saveSOPItem: vi.fn(async () => {}) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./sopsPdf', () => ({ abrirPdf: vi.fn(), librosVisibles: () => [] }))
vi.mock('../../shared/api/sops', async orig => ({
  ...(await orig<typeof import('../../shared/api/sops')>()), getSOPs: async () => [], saveSOPItem: H.saveSOPItem, deleteSOPItem: vi.fn(),
}))

import SOPsModule from './SOPsModule'

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const guardar = () => screen.getByRole('button', { name: 'Guardar procedimiento' }) as HTMLButtonElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null

async function abrirEditor() {
  render(<SOPsModule />)
  fireEvent.click((await screen.findAllByText(/Nuevo procedimiento/))[0])
  fireEvent.change(screen.getByPlaceholderText('ej: Apertura de salón'), { target: { value: 'Procedimiento ficticio' } })
  fireEvent.change(screen.getAllByRole('textbox').find(e => e.tagName === 'TEXTAREA')!, { target: { value: '## Objetivo\nTexto.' } })
  return screen.getByRole('spinbutton', { name: 'Orden' }) as HTMLInputElement
}

describe('SOPs · cuadro «Orden»', () => {
  it.each(['5-', '--', '0-450', '2.5', '-1'])('vacío + «%s» → aviso con «Orden», botón apagado, no guarda', async texto => {
    const orden = await abrirEditor()
    teclearNumero(orden, '')
    teclearNumero(orden, texto)
    expect(aviso()).toContain('«Orden»')
    expect(guardar().disabled).toBe(true)
    fireEvent.click(guardar())
    expect(H.saveSOPItem).not.toHaveBeenCalled()
  })

  it('vacío guarda 0 y un entero se guarda igual que antes', async () => {
    const orden = await abrirEditor()
    teclearNumero(orden, '')
    expect(aviso()).toBeNull()
    teclearNumero(orden, '3')
    fireEvent.click(guardar())
    await waitFor(() => expect(H.saveSOPItem).toHaveBeenCalled())
    expect((H.saveSOPItem.mock.calls[0] as unknown as [{ display_order: number }])[0].display_order).toBe(3)
  })
})
