// @vitest-environment happy-dom
//
// Rediseño B3, en el DOM: quién ve el menú, qué entradas tiene y que «Más» abre el resto.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let role = 'owner'
let activa = true
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    profile: { id: 'p1', role, is_active: activa, full_name: 'Persona Ficticia' },
    loading: false,
    signOut: vi.fn(),
  }),
}))
vi.mock('../api/altaEmpleado', () => ({ debeCambiarPassword: () => false }))

import AppShell from './AppShell'

function montar(ruta = '/caja') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AppShell><div data-testid="pantalla">pantalla</div></AppShell>
    </MemoryRouter>,
  )
}

const lateral = () => screen.getAllByRole('navigation', { name: 'Menú principal' })[0]
const barra   = () => screen.getAllByRole('navigation', { name: 'Menú principal' })[1]

beforeEach(() => { cleanup(); role = 'owner'; activa = true })

describe('AppShell', () => {
  it('owner: menú lateral con grupos y las entradas de Ventas', () => {
    montar()
    const nav = lateral()
    for (const g of ['Operación', 'Ventas', 'Equipo', 'Gestión', 'Ajustes']) {
      expect(within(nav).getByText(g)).toBeTruthy()
    }
    const hoy = within(nav).getByRole('link', { name: /Hoy/ })
    expect(hoy.getAttribute('href')).toBe('/ventas?tab=hoy')
    expect(within(nav).getByRole('link', { name: /Admin/ })).toBeTruthy()
    expect(screen.getByTestId('pantalla')).toBeTruthy()
  })

  it('marca como activo el módulo de la ruta', () => {
    montar('/caja')
    const caja = within(lateral()).getByRole('link', { name: /Caja/ })
    expect(caja.getAttribute('aria-current')).toBe('page')
  })

  it('marca la entrada de Ventas según ?tab=', () => {
    montar('/ventas?tab=calendario')
    const hist = within(lateral()).getByRole('link', { name: /Histórico/ })
    expect(hist.getAttribute('aria-current')).toBe('page')
  })

  it('cajero: barra con Inicio, Caja, Propinas, Club y «Más»; «Más» abre el resto', () => {
    role = 'cajero'
    montar('/caja')
    const b = barra()
    expect(within(b).getAllByRole('link').map(a => a.textContent)).toEqual(
      ['家Inicio', '金Caja', '心Propinas', '縁Club'],
    )
    fireEvent.click(within(b).getByRole('button', { name: /Más/ }))
    const hoja = screen.getByRole('dialog', { name: 'Todos los módulos' })
    expect(within(hoja).getByRole('link', { name: /Clientes/ })).toBeTruthy()
    expect(within(hoja).getByRole('link', { name: /Procedimientos/ })).toBeTruthy()
    expect(within(hoja).queryByRole('link', { name: /Admin/ })).toBeNull()
  })

  it('hoja «Más»: modal, foco en «Cerrar», Escape la cierra y el foco vuelve a «Más»', () => {
    role = 'cajero'
    montar('/caja')
    const mas = within(barra()).getByRole('button', { name: /Más/ })
    fireEvent.click(mas)
    const hoja = screen.getByRole('dialog', { name: 'Todos los módulos' })
    expect(hoja.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(within(hoja).getByRole('button', { name: 'Cerrar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(mas)
  })

  it('hoja «Más»: el botón ✕ también devuelve el foco a «Más»', () => {
    role = 'cajero'
    montar('/caja')
    const mas = within(barra()).getByRole('button', { name: /Más/ })
    fireEvent.click(mas)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(mas)
  })

  it.each(['runner', 'barback', 'cocina', 'proveedor'])('%s (3 módulos o menos): sin menú', r => {
    role = r
    montar('/')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByTestId('pantalla')).toBeTruthy()
  })

  it('cuenta deshabilitada: sin menú', () => {
    activa = false
    montar('/')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('login: sin menú', () => {
    montar('/login')
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
