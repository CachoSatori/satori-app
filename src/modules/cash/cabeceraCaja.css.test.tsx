// @vitest-environment happy-dom
// Caja PR0 (24-nov): el título «Caja» se cortaba arriba al bajar en el celular. Causa real: la
// cabecera (.cd-module-header) y las pestañas (.cd-nav-tabs) eran las dos `sticky; top: 0` y las
// pestañas tapaban la mitad de arriba de la cabecera. Arreglo: si la cabecera tiene las pestañas
// pegadas debajo, deja de ser sticky. Esta guarda mira las dos mitades: la regla CSS y que en Caja
// las pestañas sigan siendo el hermano siguiente de la cabecera (si no, el selector no aplica).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: () => {} }))
vi.mock('../../shared/api/cash', () => ({
  getOpenCashSession: async () => null, getCashSessions: async () => [], getAllCashMovements: async () => [],
  getSuppliers: async () => [], getSupplierCredits: async () => [], getCreditApplications: async () => [], getCierresDia: async () => [],
}))
vi.mock('../../shared/api/jornadasConVentas', () => ({ getJornadasConVentas: async () => [] }))
vi.mock('./CashTurno', () => ({ default: () => <p>pantalla turno</p> }))

import CashModule from './CashModule'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const bloque = (sel: string) => {
  const i = css.indexOf(sel + ' {')
  return i < 0 ? null : css.slice(i, css.indexOf('}', i))
}

describe('Cabecera de Caja en el celular — el título no queda tapado', () => {
  it('la cabecera seguida de pestañas no es sticky', () => {
    const b = bloque('.cd-module-header:has(+ .cd-nav-tabs)')
    expect(b).not.toBeNull()
    expect(b).toMatch(/position:\s*relative/)
  })
  it('las pestañas siguen pegadas arriba (sticky, top 0)', () => {
    expect(css).toMatch(/\.cd-nav-tabs,\s*\.vt-nav-tabs,\s*\.tips-header\s*\{\s*position:\s*sticky;\s*top:\s*0/)
  })
  it('en Caja las pestañas son el hermano siguiente de la cabecera', async () => {
    render(<MemoryRouter initialEntries={['/caja']}><CashModule /></MemoryRouter>)
    await screen.findByText('pantalla turno')
    const cab = document.querySelector('.cd-module-header')!
    expect(cab.textContent).toContain('Caja')
    expect(cab.nextElementSibling?.classList.contains('cd-nav-tabs')).toBe(true)
  })
})
