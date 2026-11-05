// @vitest-environment happy-dom
// Primer ingreso con contraseña temporal (05/11) + login sin «Crear cuenta».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const sb = vi.hoisted(() => ({ invoke: vi.fn(), refreshSession: vi.fn(async () => ({ data: {}, error: null })) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { functions: { invoke: sb.invoke }, auth: { refreshSession: sb.refreshSession } } }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { full_name: 'Ana Pérez' }, signOut: vi.fn(), signIn: vi.fn() }) }))

import CambiarPasswordInicial from './CambiarPasswordInicial'
import LoginPage from './LoginPage'
import { debeCambiarPassword } from '../../shared/api/altaEmpleado'
import type { User } from '@supabase/supabase-js'

const llenar = (actual: string, nueva: string, nueva2 = nueva) => {
  fireEvent.change(screen.getByLabelText('Contraseña temporal'), { target: { value: actual } })
  fireEvent.change(screen.getByLabelText(/Contraseña nueva \(mínimo 8\)/), { target: { value: nueva } })
  fireEvent.change(screen.getByLabelText('Repetir contraseña nueva'), { target: { value: nueva2 } })
  fireEvent.click(screen.getByText('Guardar y entrar'))
}

beforeEach(() => { sb.invoke.mockReset(); sb.refreshSession.mockClear() })

describe('CambiarPasswordInicial', () => {
  it.each([
    ['corta', 'Temp12345678', 'corta1', 'corta1', 'La contraseña nueva debe tener al menos 8 caracteres'],
    ['no coinciden', 'Temp12345678', 'nueva-larga-1', 'nueva-larga-2', 'Las contraseñas nuevas no coinciden'],
    ['igual a la temporal', 'Temp12345678', 'Temp12345678', 'Temp12345678', 'La contraseña nueva tiene que ser distinta de la temporal'],
  ])('validación local: %s', (_c, actual, nueva, nueva2, msg) => {
    render(<CambiarPasswordInicial />)
    llenar(actual, nueva, nueva2)
    expect(screen.getByRole('alert').textContent).toBe(msg)
    expect(sb.invoke).not.toHaveBeenCalled()
  })

  it('ok → llama a la función y refresca la sesión (el flag nuevo viene en el token)', async () => {
    sb.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    render(<CambiarPasswordInicial />)
    llenar('Temp12345678', 'mi-clave-nueva')
    await waitFor(() => expect(sb.refreshSession).toHaveBeenCalledTimes(1))
    expect(sb.invoke).toHaveBeenCalledWith('alta-empleado', { body: { action: 'cambiar_password', actual: 'Temp12345678', nueva: 'mi-clave-nueva' } })
  })

  it('temporal incorrecta → mensaje de la función, sin refrescar', async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ code: 'actual_incorrecta', error: 'La contraseña actual no es correcta', ref: 'x' }), { status: 400 }) } })
    render(<CambiarPasswordInicial />)
    llenar('mala-temporal', 'mi-clave-nueva')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('La contraseña actual no es correcta'))
    expect(sb.refreshSession).not.toHaveBeenCalled()
  })

  it('debeCambiarPassword lee SOLO app_metadata (user_metadata no cuenta)', () => {
    expect(debeCambiarPassword({ app_metadata: { cambiar_password: true }, user_metadata: {} } as unknown as User)).toBe(true)
    expect(debeCambiarPassword({ app_metadata: { cambiar_password: false }, user_metadata: { cambiar_password: true } } as unknown as User)).toBe(false)
    expect(debeCambiarPassword({ app_metadata: {}, user_metadata: {} } as unknown as User)).toBe(false)
    expect(debeCambiarPassword(null)).toBe(false)
  })
})

describe('LoginPage', () => {
  it('sin «Crear cuenta»; avisa que la cuenta la da la gerencia', () => {
    render(<LoginPage />)
    expect(screen.queryByText('Crear cuenta')).toBeNull()
    expect(screen.queryByLabelText('Nombre completo')).toBeNull()
    expect(screen.getByText('¿No tenés cuenta? Pedísela a la gerencia.')).toBeTruthy()
    expect(screen.getByText('Ingresar')).toBeTruthy()
  })
})
