// @vitest-environment happy-dom
// Club → Cohortes (mig 161): lo que ve la pantalla. Los permisos los decide la base (pruebas SQL 161).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { cohortesDePrueba, cohortesVacias } from './cohortesFixture.test-util'

const st = vi.hoisted(() => ({ datos: null as unknown, pedidos: [] as Array<string | null>, aperturas: [] as Array<string | null> }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p161-a', nombre: 'Local P161 A', activo: true }, { id: 'p161-b', nombre: 'Local P161 B', activo: true }],
  localActual: () => 'p161-a',
  getCohortes: async (l: string | null, a: string | null = null) => { st.pedidos.push(l); st.aperturas.push(a); return st.datos },
}))

import Cohortes from './Cohortes'

beforeEach(() => { st.datos = cohortesDePrueba(); st.pedidos = []; st.aperturas = [] })

describe('Club → Cohortes', () => {
  it('una fila por mes de alta, con cuenta y %, y «aún no» donde no puede medirse (no 0)', async () => {
    render(<Cohortes />)
    const ene = await screen.findByTestId('cohorte-2001-01')
    expect(ene.textContent).toContain('ene 2001')
    expect(ene.textContent).toContain('1 (50 %)')
    expect(ene.textContent).toContain('3,5')
    const nueva = screen.getByTestId('cohorte-2026-11')
    expect(nueva.textContent?.match(/aún no/g)).toHaveLength(3)
    expect(screen.getByTestId('cohorte-2001-02').textContent).toContain('(1 de baja)')
    expect(screen.getByTestId('resumen').textContent).toContain('4 socios')
  })

  it('arranca en el local elegido del Club y «Todos mis locales» pide null', async () => {
    render(<Cohortes />)
    await screen.findByTestId('resumen')
    expect(st.pedidos[0]).toBe('p161-a')
    fireEvent.change(screen.getByLabelText('Local'), { target: { value: '' } })
    await waitFor(() => expect(st.pedidos.at(-1)).toBeNull())
    // rastro: el mismo id de apertura en las dos consultas (la base deja una sola fila)
    expect(st.aperturas[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(st.aperturas.at(-1)).toBe(st.aperturas[0])
  })

  it('cero socios: mensaje, sin tabla y sin error', async () => {
    st.datos = cohortesVacias()
    render(<Cohortes />)
    expect((await screen.findByTestId('resumen')).textContent).toContain('Todavía no hay socios')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
