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
      // «Equipo» es grupo y, desde el 3.5.1, también entrada de Ventas: aparece dos veces.
      expect(within(nav).getAllByText(g).length).toBeGreaterThan(0)
    }
    // 3.5.1: Ventas abre en sus seis entradas, la primera «Resumen».
    const ventas = within(nav).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/ventas'))
    expect(ventas.map(a => a.getAttribute('href'))).toEqual([
      '/ventas?tab=resumen', '/ventas?tab=productos', '/ventas?tab=equipo', '/ventas?tab=tiempos',
      '/ventas?tab=envivo', '/ventas?tab=ajustes',
    ])
    expect(within(nav).queryByRole('link', { name: /^.?Hoy$/ })).toBeNull()
    expect(within(nav).getByRole('link', { name: /Admin/ })).toBeTruthy()
    expect(screen.getByTestId('pantalla')).toBeTruthy()
  })

  it('pie del menú lateral: «Cambiar contraseña» lleva a /mi-cuenta, para cualquier rol con menú', () => {
    for (const r of ['owner', 'cajero']) {
      cleanup(); role = r
      montar()
      expect(within(lateral()).getByRole('link', { name: 'Cambiar contraseña' }).getAttribute('href')).toBe('/mi-cuenta')
    }
  })

  it('marca como activo el módulo de la ruta', () => {
    montar('/caja')
    const caja = within(lateral()).getByRole('link', { name: /Caja/ })
    expect(caja.getAttribute('aria-current')).toBe('page')
  })

  it.each([
    ['/ventas?tab=calendario', '/ventas?tab=tiempos'],           // dirección vieja: Calendario vive en Tiempos
    ['/ventas?tab=equipo&v=icp', '/ventas?tab=equipo'],
    ['/ventas?tab=metas', '/ventas?tab=ajustes'],
    ['/ventas', '/ventas?tab=resumen'],
  ])('marca la entrada de Ventas según la dirección: %s → %s', (url, activa) => {
    montar(url)
    const marcadas = within(lateral()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(marcadas.map(a => a.getAttribute('href'))).toEqual([activa])
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

  it('hoja «Más»: Tab y Shift+Tab quedan dentro de la hoja (B9)', () => {
    role = 'cajero'
    montar('/caja')
    fireEvent.click(within(barra()).getByRole('button', { name: /Más/ }))
    const hoja = screen.getByRole('dialog', { name: 'Todos los módulos' })
    const enfocables = Array.from(hoja.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
    const primero = enfocables[0]
    const ultimo  = enfocables[enfocables.length - 1]
    expect(primero).toBe(within(hoja).getByRole('button', { name: 'Cerrar' }))
    expect(enfocables.length).toBeGreaterThan(2)

    // Del último, Tab vuelve al primero.
    ultimo.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(primero)

    // Del primero, Shift+Tab va al último.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(ultimo)

    // En el medio, Tab no se intercepta (lo resuelve el navegador).
    const medio = enfocables[1]
    medio.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(medio)

    // Si el foco quedó afuera de la hoja, Tab lo trae al primero.
    within(barra()).getByRole('button', { name: /Más/ }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(primero)

    // Sigue abierta.
    expect(screen.getByRole('dialog', { name: 'Todos los módulos' })).toBeTruthy()
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
