// @vitest-environment happy-dom
// Club → Embudo del anfitrión (mig 162): mes CR, grupos (equipo aparte), reseña opcional, cero datos, Nosara y exporte auditado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { embudoDePrueba, embudoVacio } from './embudoFixture.test-util'

const st = vi.hoisted(() => ({ datos: null as unknown, llamadas: [] as Array<[string, string | null, boolean]> }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./estilos', async orig => ({ ...(await orig<typeof import('./estilos')>()), mesActualCR: () => '2001-03' }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p162-a', nombre: 'Local P162 A', activo: true }],
  localActual: () => 'p162-a',
  getEmbudoAnfitrion: async (m: string, l: string | null, e = false) => { st.llamadas.push([m, l, e]); return st.datos },
}))

import Embudo from './Embudo'

beforeEach(() => { st.datos = embudoDePrueba(); st.llamadas = [] })

describe('Club → Embudo del anfitrión', () => {
  it('abre en el mes CR y el local del Club, sin exporte', async () => {
    render(<Embudo />)
    await screen.findByTestId('resumen')
    expect(st.llamadas[0]).toEqual(['2001-03', 'p162-a', false])
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

  it('cambiar el mes vuelve a pedir', async () => {
    render(<Embudo />)
    await screen.findByTestId('resumen')
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2001-02' } })
    await waitFor(() => expect(st.llamadas.at(-1)).toEqual(['2001-02', 'p162-a', false]))
  })

  it('exportar CSV pide los datos a la base con exporte (queda auditado)', async () => {
    const crear = vi.fn(() => 'blob:x'); const soltar = vi.fn()
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: soltar })
    render(<Embudo />)
    await screen.findByTestId('resumen')
    fireEvent.click(screen.getByText('Exportar CSV'))
    await waitFor(() => expect(st.llamadas.at(-1)?.[2]).toBe(true))
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
