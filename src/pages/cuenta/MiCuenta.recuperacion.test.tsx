// @vitest-environment happy-dom
// /mi-cuenta en MODO RECUPERACIÓN (entró con el enlace de «¿Olvidaste tu contraseña?»): no pide la actual, aplica las
// mismas reglas de fuerza, cambia con updateUser y cierra las otras sesiones; si el enlace venció, lo dice y ofrece
// pedir otro. Fuera de recuperación (u otro usuario) sigue pidiendo la actual.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const sb = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), signOut: vi.fn(), recargar: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({
  supabase: { auth: { signInWithPassword: sb.signIn, updateUser: sb.update, signOut: sb.signOut, onAuthStateChange: vi.fn() } },
}))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'ana@ejemplo.test' }, profile: { full_name: 'Persona Ficticia' }, signOut: sb.signOut }),
}))
vi.mock('../../shared/hooks/useCambioClave', () => ({ useCambioClave: () => ({ debe: true, consultando: false, recargar: sb.recargar }) }))

import MiCuenta from './MiCuenta'
import { marcarRecuperacion, terminarRecuperacion, tomarAvisoLogin } from '../../shared/api/recuperarClave'

const NUEVA = 'Tortuga-verde7'
const pantalla = () => render(
  <MemoryRouter initialEntries={['/mi-cuenta']}>
    <Routes>
      <Route path="/mi-cuenta" element={<MiCuenta />} />
      <Route path="/login" element={<p>pantalla de ingreso</p>} />
    </Routes>
  </MemoryRouter>,
)
const llenar = (nueva: string, nueva2 = nueva) => {
  fireEvent.change(screen.getByLabelText('Contraseña nueva (mínimo 8)'), { target: { value: nueva } })
  fireEvent.change(screen.getByLabelText('Repetir contraseña nueva'), { target: { value: nueva2 } })
}

beforeEach(() => {
  sb.signIn.mockReset(); sb.update.mockReset(); sb.signOut.mockReset(); sb.recargar.mockReset()
  sb.update.mockResolvedValue({ data: {}, error: null })
  sb.signOut.mockResolvedValue({ error: null })
  sb.recargar.mockResolvedValue(false)
  localStorage.clear(); sessionStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
  expect(guardado).not.toContain(NUEVA)
  terminarRecuperacion()
  vi.restoreAllMocks()
})

describe('MiCuenta · modo recuperación', () => {
  it('no pide la contraseña actual; avisa que entró con el enlace; sin el aviso de «obligatorio»', () => {
    marcarRecuperacion('u1')
    pantalla()
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull()
    expect(screen.getByTestId('aviso-recuperacion').textContent).toContain('No hace falta la anterior')
    expect(screen.queryByTestId('aviso-cambio-obligatorio')).toBeNull()
    expect(screen.getByRole('heading').textContent).toBe('Crear contraseña nueva')
  })

  it('éxito: updateUser sin reingresar, cierra las otras sesiones, vuelve a consultar la marca y termina el modo', async () => {
    marcarRecuperacion('u1')
    pantalla()
    llenar(NUEVA)
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Listo: tu contraseña cambió.'))
    expect(sb.signIn).not.toHaveBeenCalled()
    expect(sb.update).toHaveBeenCalledWith({ password: NUEVA })
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(sb.recargar).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('satori-recuperacion')).toBeNull()
  })

  it('mismas reglas de fuerza: «Débil» con su motivo, corta y que no coincidan → no va al servidor', () => {
    marcarRecuperacion('u1')
    pantalla()
    llenar('murcielago')
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByRole('alert').textContent).toBe('Contraseña débil. Le falta un número: agregá al menos uno (no hace falta ningún signo)')
    llenar('cort-12')
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByRole('alert').textContent).toBe('La contraseña nueva debe tener al menos 8 caracteres')
    llenar(NUEVA, NUEVA + 'x')
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByRole('alert').textContent).toBe('Las contraseñas nuevas no coinciden')
    expect(sb.update).not.toHaveBeenCalled()
  })

  it('enlace vencido: mensaje claro y «Pedir otro enlace» → cierra la sesión local y el login abre el pedido con aviso', async () => {
    sb.update.mockResolvedValue({ data: {}, error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } })
    marcarRecuperacion('u1')
    pantalla()
    llenar(NUEVA)
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('El enlace del correo venció o ya se usó. Pedí uno nuevo'))
    expect(screen.queryByText('Cambiar contraseña')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pedir otro enlace' }))
    await screen.findByText('pantalla de ingreso')
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(tomarAvisoLogin()).toBe('vencido')
    expect(sessionStorage.getItem('satori-recuperacion')).toBeNull()
  })

  it('sesión del enlace vencida (401): también «enlace vencido»', async () => {
    sb.update.mockResolvedValue({ data: {}, error: { status: 401, code: 'session_expired' } })
    marcarRecuperacion('u1')
    pantalla()
    llenar(NUEVA)
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    await screen.findByRole('button', { name: 'Pedir otro enlace' })
  })

  it('fuera de recuperación sigue pidiendo la actual (y la exige)', () => {
    pantalla()
    expect(screen.getByLabelText('Contraseña actual')).toBeTruthy()
    llenar(NUEVA)
    fireEvent.click(screen.getByText('Cambiar contraseña'))
    expect(screen.getByText('Escribí tu contraseña actual')).toBeTruthy()
    expect(sb.update).not.toHaveBeenCalled()
  })

  it('recuperación de OTRO usuario no vale para este', () => {
    marcarRecuperacion('otro-usuario')
    pantalla()
    expect(screen.getByLabelText('Contraseña actual')).toBeTruthy()
  })

  it('recuperación vencida (pasó la hora) no vale', () => {
    marcarRecuperacion('u1', Date.now() - 2 * 60 * 60_000)
    pantalla()
    expect(screen.getByLabelText('Contraseña actual')).toBeTruthy()
  })
})
