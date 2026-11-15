// @vitest-environment happy-dom
// Club → Embudo del anfitrión (mig 162): mes CR, grupos (equipo aparte), reseña opcional, cero datos, Nosara y exporte auditado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { embudoDePrueba, embudoVacio } from './embudoFixture.test-util'

const st = vi.hoisted(() => ({ datos: null as unknown, llamadas: [] as Array<[string, string | null, boolean, string | null]> }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./estilos', async orig => ({ ...(await orig<typeof import('./estilos')>()), mesActualCR: () => '2001-03' }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p162-a', nombre: 'Local P162 A', activo: true }],
  localActual: () => 'p162-a',
  getEmbudoAnfitrion: async (m: string, l: string | null, e = false, a: string | null = null) => { st.llamadas.push([m, l, e, a]); return st.datos },
}))

import Embudo from './Embudo'

beforeEach(() => { st.datos = embudoDePrueba(); st.llamadas = [] })

describe('Club → Embudo del anfitrión', () => {
  it('abre en el mes CR y el local del Club, sin exporte y con un id de apertura', async () => {
    render(<Embudo />)
    await screen.findByTestId('resumen')
    expect(st.llamadas[0].slice(0, 3)).toEqual(['2001-03', 'p162-a', false])
    expect(st.llamadas[0][3]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('el equipo va aparte (desempeño, sin créditos con D7) de referentes y concierges', async () => {
    render(<Embudo />)
    const eq = await screen.findByTestId('grupo-equipo')
    expect(eq.textContent).toContain('Equipo Uno')
    expect(eq.textContent).toContain('no gana créditos')
    expect(eq.textContent).not.toContain('Referente Uno')
    expect(within(screen.getByTestId('grupo-anfitrion')).getByText('=Referente Uno')).toBeTruthy()
    expect(screen.getByText(/«QR visto» no se guarda/)).toBeTruthy()
  })

  it('sin la 158 no hay columna de reseña; con la 158, sí', async () => {
    const { unmount } = render(<Embudo />)
    await screen.findByTestId('resumen')
    expect(screen.queryByText('Clic en reseña')).toBeNull()
    unmount()
    st.datos = embudoDePrueba(true)
    render(<Embudo />)
    await screen.findByTestId('resumen')
    expect(screen.getAllByText(/Clic en reseña/).length).toBeGreaterThan(0)
  })

  it('cambiar el mes vuelve a pedir con la MISMA apertura; cambios seguidos esperan y piden una sola vez', async () => {
    render(<Embudo />)
    await screen.findByTestId('resumen')
    const ap = st.llamadas[0][3]
    const pausa = () => act(() => new Promise(ok => setTimeout(ok, 60)))
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2001-02' } }); await pausa()
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2001-01' } }); await pausa()
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2000-12' } }); await pausa()
    expect(st.llamadas).toHaveLength(1)                  // todavía en la espera (debounce)
    await waitFor(() => expect(st.llamadas.at(-1)).toEqual(['2000-12', 'p162-a', false, ap]))
    expect(st.llamadas).toHaveLength(2)
  })

  it('exportar CSV pide los datos a la base con exporte (queda auditado)', async () => {
    const crear = vi.fn(() => 'blob:x'); const soltar = vi.fn()
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: soltar })
    render(<Embudo />)
    await screen.findByTestId('resumen')
    fireEvent.click(screen.getByText('Exportar CSV'))
    await waitFor(() => expect(st.llamadas.at(-1)?.[2]).toBe(true))
    expect(st.llamadas.at(-1)?.[3]).toBe(st.llamadas[0][3])
    await waitFor(() => expect(crear).toHaveBeenCalled())
  })

  it('cero datos y local sin PoS: explicado, sin tablas ni error', async () => {
    st.datos = embudoVacio()
    render(<Embudo />)
    expect((await screen.findByTestId('vacio')).textContent).toContain('Todavía no hay anfitriones con cupones')
    expect(screen.getByText(/Sin facturas del PoS en el mes: Local P162 C/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/@|\+506/)
  })
})
