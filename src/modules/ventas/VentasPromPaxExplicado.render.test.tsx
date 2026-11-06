// @vitest-environment happy-dom
//
// «Prom/PAX explicado» montado: filtros → RPC (mock con las filas que devolvería) → tarjetas,
// «Qué explica el cambio», tablas, «Ver detalle» y CSV.
//
// Con `PROMPAX_PANTALLA_FILE` (filas REALES del RPC 078 de staging, bajadas como owner simulado)
// además verifica en pantalla los números del §9 v2.3. Sin la variable, solo el caso sintético.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FilaPromPaxRpc } from '../../shared/api/posNdf'

const H = vi.hoisted(() => ({ filas: [] as FilaPromPaxRpc[], llamadas: [] as [string, string, string][] }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/posNdf', () => ({
  getSaloneroNombres: vi.fn(async () => ({})),
  getPromPaxAgregado: vi.fn(async (local: string, desde: string, hasta: string) => {
    H.llamadas.push([local, desde, hasta])
    return H.filas.filter(f => f.dia >= desde && f.dia <= hasta)
  }),
}))

import VentasPromPaxExplicado from './VentasPromPaxExplicado'

const f = (dia: string, franja: FilaPromPaxRpc['franja'], login: string | null, pax: number, neta: number, canal = 'salon'): FilaPromPaxRpc =>
  ({ dia, franja, salonero_login: login, canal, tickets: 1, pax, neta, neta_sin_pax: pax ? 0 : neta, tickets_sin_pax: pax ? 0 : 1 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T18:00:00Z'))
  H.llamadas = []
})
afterEach(() => { vi.useRealTimers() })

describe('VentasPromPaxExplicado — caso sintético', () => {
  it('por defecto: el mes anterior contra el período anterior, en una sola llamada', async () => {
    H.filas = []
    for (let d = 1; d <= 28; d++) {
      const dia = (m: string) => `2026-${m}-${String(d).padStart(2, '0')}`
      H.filas.push(f(dia('09'), 'noche', '026', 20, 300_000), f(dia('09'), 'mañana', '028', 10, 110_000))
      H.filas.push(f(dia('10'), 'noche', '026', 22, 360_000), f(dia('10'), 'mañana', '028', 10, 120_000),
                   f(dia('10'), 'noche', null, 0, 5_000), f(dia('10'), 'noche', null, 0, 40_000, 'delivery'))
    }
    render(<VentasPromPaxExplicado />)
    await waitFor(() => expect(screen.getByTestId('pp-tarjetas')).toBeTruthy())
    expect(H.llamadas).toEqual([['santa-teresa', '2026-08-31', '2026-10-31']])
    expect(screen.getByTestId('pp-periodos').textContent).toContain('1 oct 2026 – 31 oct 2026')

    const tarjetas = screen.getByTestId('pp-tarjetas')
    // oct: neta salón 28×(360k+120k+5k) = 13.580.000 / 28×32 pax = 896 → ₡15.156
    expect(tarjetas.textContent).toContain('₡15.156')
    expect(screen.getByTestId('pp-explicacion').textContent).toMatch(/^Las ventas subieron/)
    expect(screen.getByTestId('pp-tabla-turno')).toBeTruthy()
    expect(screen.getByTestId('pp-tabla-saloneroTurno').textContent).toContain('vs promedio del turno')

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }))
    expect(screen.getByTestId('pp-leyenda').textContent).toContain('Rendimiento = el grupo vendió más o menos por persona')
    expect(within(screen.getByTestId('pp-tabla-dia')).getByText('Rendimiento')).toBeTruthy()
    expect(screen.getByTestId('pp-tabla-dia').textContent).toContain('venta sin pax')

    const urls: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => { urls.push(b); return 'blob:x' }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    fireEvent.click(within(screen.getByTestId('pp-tabla-dia')).getByText('CSV'))
    expect(urls).toHaveLength(1)
    const csv = await urls[0].text()
    expect(csv.split('\n')[0]).toContain('"Grupo","Pax","% pax","Prom/PAX","Comparación"')
  })

  it('con turno = mañana no hay tabla por turno y la de saloneros es por salonero', async () => {
    H.filas = [f('2026-10-02', 'mañana', '028', 40, 500_000), f('2026-09-02', 'mañana', '028', 40, 480_000)]
    render(<VentasPromPaxExplicado />)
    await waitFor(() => expect(screen.getByTestId('pp-tarjetas')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Mañana' }))
    expect(screen.queryByTestId('pp-tabla-turno')).toBeNull()
    expect(screen.getByTestId('pp-tabla-salonero')).toBeTruthy()
    expect(screen.getByTestId('pp-explicacion').textContent).toContain('tomalo como orientación')
  })
})

const ARCHIVO = process.env.PROMPAX_PANTALLA_FILE

describe.skipIf(!ARCHIVO)('VentasPromPaxExplicado — §9 v2.3 en pantalla, con filas reales del RPC de staging', () => {
  it('oct 1–29 y su noche por salonero y por día', async () => {
    H.filas = (JSON.parse(readFileSync(ARCHIVO!, 'utf8')) as FilaPromPaxRpc[]).map(x => ({ ...x, neta: Number(x.neta), neta_sin_pax: Number(x.neta_sin_pax) }))
    render(<VentasPromPaxExplicado />)
    await waitFor(() => expect(screen.getByTestId('pp-tarjetas')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Rango' }))
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-29' } })
    await waitFor(() => expect(screen.getByTestId('pp-periodos').textContent).toContain('1 oct 2026 – 29 oct 2026'))
    await waitFor(() => expect(screen.getByTestId('pp-tarjetas').textContent).toContain('₡16.491'))
    expect(screen.getByTestId('pp-tarjetas').textContent).toContain('805')

    const turno = screen.getByTestId('pp-tabla-turno').textContent!
    expect(turno).toContain('₡13.299')
    expect(turno).toContain('₡17.390')

    fireEvent.click(screen.getByRole('button', { name: 'Noche' }))
    await waitFor(() => expect(screen.queryByTestId('pp-tabla-turno')).toBeNull())
    const sal = screen.getByTestId('pp-tabla-salonero').textContent!
    for (const v of ['₡17.934', '₡18.105', '₡16.954', '₡15.080']) expect(sal).toContain(v)
    const dia = screen.getByTestId('pp-tabla-dia').textContent!
    for (const v of ['₡19.421', '₡18.547', '₡15.529']) expect(dia).toContain(v)
  })
})
