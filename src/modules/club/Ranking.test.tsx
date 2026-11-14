// @vitest-environment happy-dom
// Club → Ranking de socios (mig 161): orden, período, aviso de local sin PoS, cero datos y exporte auditado.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { rankingDePrueba, rankingVacio } from './cohortesFixture.test-util'

const st = vi.hoisted(() => ({ datos: null as unknown, llamadas: [] as Array<[string, string, string | null, boolean]>, aperturas: [] as Array<string | null> }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/utils', async orig => ({ ...(await orig<typeof import('../../shared/utils')>()), todayCR: () => '2026-11-14' }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p161-a', nombre: 'Local P161 A', activo: true }],
  localActual: () => 'p161-a',
  getRanking: async (d: string, h: string, l: string | null, e = false, a: string | null = null) => {
    st.llamadas.push([d, h, l, e]); st.aperturas.push(a); return st.datos
  },
}))

import Ranking from './Ranking'

const nombres = () => screen.getAllByTestId('fila-socio').map(f => f.querySelector('td')?.textContent ?? '')

beforeEach(() => { st.datos = rankingDePrueba(); st.llamadas = []; st.aperturas = [] })

describe('Club → Ranking de socios', () => {
  it('abre con los últimos 90 días (hora CR) en el local del Club, sin exporte', async () => {
    render(<Ranking />)
    await screen.findByTestId('resumen')
    expect(st.llamadas[0]).toEqual(['2026-08-17', '2026-11-14', 'p161-a', false])
  })

  it('ordena por venta y al tocar una columna cambia el orden', async () => {
    render(<Ranking />)
    await screen.findByTestId('resumen')
    expect(nombres()[0]).toContain('Socio Uno')
    fireEvent.click(screen.getByRole('button', { name: /Visitas/ }))   // visitas, de mayor a menor
    expect(nombres()[0]).toContain('Socio Uno')
    fireEvent.click(screen.getByRole('button', { name: /Visitas/ }))   // de menor a mayor
    expect(nombres()[0]).toContain('=Socio Nuevo')
    fireEvent.click(screen.getByRole('button', { name: /^Socio/ }))
    expect(nombres()[0]).toContain('=Socio Nuevo')
    expect(nombres()[1]).toContain('Socio Dos')
  })

  it('muestra totales sin contar dos veces y marca el descuento como estimado', async () => {
    render(<Ranking />)
    expect((await screen.findByTestId('resumen')).textContent).toContain('₡32.000 de venta respaldada en 2 facturas')
    expect(screen.getByText(/Descuento \(estimado\)/)).toBeTruthy()
    expect(screen.getByText('Total (cada factura una vez)')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/@|\+506/)
  })

  it('«Este mes» cambia el período; un período al revés avisa y no llama', async () => {
    render(<Ranking />)
    await screen.findByTestId('resumen')
    fireEvent.click(screen.getByText('Este mes'))
    await waitFor(() => expect(st.llamadas.at(-1)).toEqual(['2026-11-01', '2026-11-14', 'p161-a', false]))
    const n = st.llamadas.length
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-12-01' } })
    expect(await screen.findByText('«Hasta» es antes de «desde».')).toBeTruthy()
    expect(st.llamadas.length).toBe(n)
  })

  it('exportar CSV pide los datos a la base con exporte (queda auditado)', async () => {
    const crear = vi.fn(() => 'blob:x'); const soltar = vi.fn()
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: soltar })
    render(<Ranking />)
    await screen.findByTestId('resumen')
    fireEvent.click(screen.getByText('Exportar CSV'))
    await waitFor(() => expect(st.llamadas.at(-1)?.[3]).toBe(true))
    expect(st.aperturas.at(-1)).toBe(st.aperturas[0])
    await waitFor(() => expect(crear).toHaveBeenCalled())
  })

  it('rastro: un id por apertura; varios cambios de filtro seguidos → una sola consulta, con el mismo id', async () => {
    const { unmount } = render(<Ranking />)
    await screen.findByTestId('resumen')
    const id = st.aperturas[0]
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-02' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } })
    await waitFor(() => expect(st.llamadas.length).toBe(2))
    await new Promise(r => setTimeout(r, 700))
    expect(st.llamadas.length).toBe(2)   // debounce: los tres cambios, una consulta
    expect(st.llamadas[1]).toEqual(['2026-10-02', '2026-10-31', 'p161-a', false])
    expect(st.aperturas).toEqual([id, id])
    unmount()
    render(<Ranking />)
    await waitFor(() => expect(st.aperturas.length).toBe(3))
    expect(st.aperturas[2]).not.toBe(id)   // otra apertura, otro id (otra fila de rastro)
  })

  it('cero socios y local sin PoS: aviso informativo, sin tabla ni error', async () => {
    st.datos = rankingVacio()
    render(<Ranking />)
    expect((await screen.findByTestId('resumen')).textContent).toContain('Todavía no hay socios')
    expect(screen.getByText(/Sin facturas del PoS en el período: Local P161 C/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
