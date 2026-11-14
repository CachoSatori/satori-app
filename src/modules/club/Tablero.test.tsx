// @vitest-environment happy-dom
// Club → Tablero (mig 160): lo que ve cada rol. La base decide los permisos (pruebas SQL 160); acá, la pantalla.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { tableroDePrueba, tableroVacio } from './tableroFixture.test-util'

const st = vi.hoisted(() => ({ rol: 'owner', datos: null as unknown, pct: [] as Array<[string, number]>, mes: [] as string[] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: st.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p160-a', nombre: 'Local P160 A', activo: true }],
  localActual: () => 'p160-a',
  getTablero: async (mes: string) => { st.mes.push(mes); return st.datos },
  setCortesiaCostoPct: async (l: string, p: number) => { st.pct.push([l, p]) },
}))

import Tablero from './Tablero'

beforeEach(() => { st.rol = 'owner'; st.datos = tableroDePrueba(); st.pct = []; st.mes = [] })

describe('Club → Tablero', () => {
  it('muestra la plata, el costo con el descuento rotulado «estimado» y el pasivo', async () => {
    render(<Tablero />)
    expect((await screen.findByTestId('titular')).textContent).toContain('el Club costó ₡95,2')
    expect(screen.getByText('Descuento (estimado)')).toBeTruthy()
    expect(screen.getAllByText('₡31.900').length).toBeGreaterThan(0)
    expect(screen.getByText('Saldo final')).toBeTruthy()
    expect(screen.getByText('₡54.000')).toBeTruthy()
    expect(screen.getByText('Congelado (equipo), fuera del pasivo')).toBeTruthy()
    // pide el mes con día 1 («AAAA-MM-01»), en hora CR
    expect(st.mes[0]).toMatch(/^\d{4}-\d{2}-01$/)
  })

  it('owner: edita el % de las cortesías y recarga', async () => {
    render(<Tablero />)
    const input = await screen.findByLabelText('Costo de una cortesía (%)')
    fireEvent.change(input, { target: { value: '40' } })
    fireEvent.click(screen.getByText('Guardar %'))
    await waitFor(() => expect(st.pct).toEqual([['p160-a', 40]]))
    await waitFor(() => expect(st.mes.length).toBe(2))
  })

  it('owner: un % fuera de 0–100 no se puede guardar', async () => {
    render(<Tablero />)
    const input = await screen.findByLabelText('Costo de una cortesía (%)')
    fireEvent.change(input, { target: { value: '120' } })
    expect((screen.getByText('Guardar %') as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['manager', 'contador'])('%s: ve el tablero pero no edita el %', async rol => {
    st.rol = rol
    render(<Tablero />)
    await screen.findByTestId('titular')
    expect(screen.queryByLabelText('Costo de una cortesía (%)')).toBeNull()
  })

  it('local sin facturas del PoS: aviso, sin error', async () => {
    st.datos = tableroVacio()
    render(<Tablero />)
    expect((await screen.findByTestId('titular')).textContent).toContain('Sin datos del PoS')
    expect(screen.getByText(/no tiene facturas del PoS en el mes/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
