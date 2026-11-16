// @vitest-environment happy-dom
// 180 · Club → Locales → «Link de reservas (OpenTable)»: valida antes de mandar, guarda tal cual por local y vacío borra.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const H = vi.hoisted(() => ({ update: vi.fn(), filas: [] as Array<{ location_id: string; reserva_url: string | null }> }))
// Se simula solo `supabase.from('club_config')`: lectura de la columna y el UPDATE directo por local (RLS: solo owner).
vi.mock('../../shared/api/supabase', () => ({ supabase: { rpc: vi.fn(), from: (t: string) => ({
  select: async (cols: string) => (t === 'club_config' && cols === 'location_id,reserva_url'
    ? { data: H.filas, error: null } : { data: null, error: { message: `no simulada: ${t} ${cols}` } }),
  update: (v: { reserva_url: string | null }) => ({ eq: (_c: string, id: string) => ({ select: async () => {
    H.update(id, v.reserva_url); return { data: [{ location_id: id }], error: null } } }) }),
}) } }))
import ReservaLocales from './ReservaLocales'

const LOCALES = [{ id: 'local-a', nombre: 'Local A', activo: true }, { id: 'local-b', nombre: 'Local B', activo: true }]
const URL_A = 'https://www.opentable.com/restref/client/?rid=9990101&ot_source=Club%20Satori'

describe('ReservaLocales', () => {
  beforeEach(() => {
    H.update.mockReset()
    H.filas = [{ location_id: 'local-a', reserva_url: URL_A }, { location_id: 'local-b', reserva_url: null }]
  })
  it('muestra el link de cada local y guarda el nuevo TAL CUAL (con sus parámetros) en ESE local', async () => {
    render(<ReservaLocales locales={LOCALES as never} />)
    const a = await screen.findByLabelText('Link de reservas de OpenTable de Local A') as HTMLInputElement
    await waitFor(() => expect(a.value).toBe(URL_A))
    const b = screen.getByLabelText('Link de reservas de OpenTable de Local B')
    const nuevo = 'https://www.opentable.com.mx/r/local-b-ficticio?ot_source=Locales&ot_campaign=cupon'
    fireEvent.change(b, { target: { value: `  ${nuevo}  ` } })
    fireEvent.click(screen.getAllByText('Guardar')[1])
    await screen.findByText('Local B: link de reservas guardado.')
    expect(H.update).toHaveBeenCalledWith('local-b', nuevo)
  })
  it('rechaza un link que no es de OpenTable sin llamar a la base', async () => {
    render(<ReservaLocales locales={LOCALES as never} />)
    const b = await screen.findByLabelText('Link de reservas de OpenTable de Local B')
    fireEvent.change(b, { target: { value: 'https://reservas.ejemplo.test/r?rid=1' } })
    fireEvent.click(screen.getAllByText('Guardar')[1])
    await screen.findByText(/tiene que ser de OpenTable/)
    expect(H.update).not.toHaveBeenCalled()
  })
  it('vacío borra el link (null)', async () => {
    render(<ReservaLocales locales={LOCALES as never} />)
    const a = await screen.findByLabelText('Link de reservas de OpenTable de Local A') as HTMLInputElement
    await waitFor(() => expect(a.value).toBe(URL_A))
    fireEvent.change(a, { target: { value: '   ' } })
    fireEvent.click(screen.getAllByText('Guardar')[0])
    await screen.findByText('Local A: sin link de reservas.')
    expect(H.update).toHaveBeenCalledWith('local-a', null)
  })
})
