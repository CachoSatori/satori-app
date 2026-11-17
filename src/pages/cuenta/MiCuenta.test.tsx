// @vitest-environment happy-dom
// «Cambiar mi contraseña» (pantalla): flujo feliz, contraseña actual incorrecta, sin conexión y que la
// contraseña no termine en console ni en localStorage/sessionStorage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const sb = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), signOut: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { auth: { signInWithPassword: sb.signIn, updateUser: sb.update, signOut: sb.signOut } } }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { email: 'ana@ejemplo.test' }, profile: { full_name: 'Ana Pérez' } }) }))

import MiCuenta from './MiCuenta'

const ACTUAL = 'vieja-clave-1'
const NUEVA = 'Tortuga-verde7'

const llenar = (actual: string, nueva: string, nueva2 = nueva) => {
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: actual } })
  fireEvent.change(screen.getByLabelText('Contraseña nueva (mínimo 10)'), { target: { value: nueva } })
  fireEvent.change(screen.getByLabelText('Repetir contraseña nueva'), { target: { value: nueva2 } })
}
const pantalla = () => render(<MemoryRouter><MiCuenta /></MemoryRouter>)

let espias: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  sb.signIn.mockReset(); sb.update.mockReset(); sb.signOut.mockReset()
  sb.signIn.mockResolvedValue({ data: {}, error: null })
  sb.update.mockResolvedValue({ data: {}, error: null })
  sb.signOut.mockResolvedValue({ error: null })
  localStorage.clear(); sessionStorage.clear()
  espias = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
afterEach(() => {
  // Nunca la contraseña en console ni en el almacenamiento del navegador.
  for (const e of espias) for (const args of e.mock.calls) {
    expect(JSON.stringify(args)).not.toContain(ACTUAL)
    expect(JSON.stringify(args)).not.toContain(NUEVA)
  }
  const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
  expect(guardado).not.toContain(ACTUAL)
  expect(guardado).not.toContain(NUEVA)
  espias.forEach(e => e.mockRestore())
})

describe('MiCuenta · cambiar mi contraseña', () => {
  it('los campos son type=password con el autocomplete correcto (gestores de contraseñas, nada visible)', () => {
    pantalla()
    const campos: [string, string][] = [
      ['Contraseña actual', 'current-password'],
      ['Contraseña nueva (mínimo 10)', 'new-password'],
      ['Repetir contraseña nueva', 'new-password'],
    ]
    for (const [label, ac] of campos) {
      const el = screen.getByLabelText(label) as HTMLInputElement
      expect(el.getAttribute('type')).toBe('password')
      expect(el.getAttribute('autocomplete')).toBe(ac)
    }
  })

  it('flujo feliz: reingresa, cambia, cierra las otras sesiones y avisa', async () => {
    pantalla()
    llenar(ACTUAL, NUEVA)
    expect(screen.getByText('Fuerza: Fuerte')).toBeTruthy()
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Listo: tu contraseña cambió.'))
    expect(screen.getByRole('status').textContent).toContain('Cerramos tu sesión en los otros equipos')
    expect(sb.signIn).toHaveBeenCalledWith({ email: 'ana@ejemplo.test', password: ACTUAL })
    expect(sb.update).toHaveBeenCalledWith({ password: NUEVA })
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'others' })
    // Los campos ya no están en pantalla.
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull()
  })

  it('contraseña actual incorrecta: mensaje simple, no cambia nada y vacía el campo', async () => {
    sb.signIn.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } })
    pantalla()
    llenar(ACTUAL, NUEVA)
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('La contraseña actual no es correcta'))
    expect(sb.update).not.toHaveBeenCalled()
    expect(sb.signOut).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Contraseña actual') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Contraseña nueva (mínimo 10)') as HTMLInputElement).value).toBe(NUEVA)
  })

  it('validación local: corta → no va al servidor', () => {
    pantalla()
    llenar(ACTUAL, 'corta-123')
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByRole('alert').textContent).toBe('La contraseña nueva debe tener al menos 10 caracteres')
    expect(sb.signIn).not.toHaveBeenCalled()
  })

  it('contraseña «Débil»: mensaje con ejemplo y no va al servidor', () => {
    pantalla()
    llenar(ACTUAL, 'murcielago')
    expect(screen.getByText('Fuerza: Débil')).toBeTruthy()
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByRole('alert').textContent).toContain('Esa contraseña es muy fácil de adivinar')
    expect(screen.getByRole('alert').textContent).toContain('por ejemplo')
    expect(sb.signIn).not.toHaveBeenCalled()
  })

  it('sin conexión: botón apagado con «Necesitás conexión»; vuelve al reconectar', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    pantalla()
    llenar(ACTUAL, NUEVA)
    const boton = screen.getByText('Necesitás conexión') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(sb.signIn).not.toHaveBeenCalled()
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    expect((screen.getByText('Cambiar contraseña') as HTMLButtonElement).disabled).toBe(false)
  })
})
