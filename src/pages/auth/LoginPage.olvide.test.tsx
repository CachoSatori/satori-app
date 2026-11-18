// @vitest-environment happy-dom
// «¿Olvidaste tu contraseña?» en el login: el mensaje es el MISMO exista o no la cuenta (ni el límite de Supabase ni un
// fallo del correo lo delatan), el enlace vuelve a /mi-cuenta de la app, hay freno de un pedido por minuto, y si se
// volvió de un enlace vencido se abre solo con el aviso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const sb = vi.hoisted(() => ({ reset: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({ supabase: { auth: { resetPasswordForEmail: sb.reset, onAuthStateChange: vi.fn() } } }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ signIn: vi.fn() }) }))

import LoginPage from './LoginPage'
import { MENSAJE_ENLACE_ENVIADO, avisarEnlaceVencido } from '../../shared/api/recuperarClave'

const CORREO = 'persona@ejemplo.test'
const abrir = () => {
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }))
}
const pedir = (correo = CORREO) => {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: correo } })
  fireEvent.click(screen.getByRole('button', { name: /Mandar (otro )?enlace/ }))
}

beforeEach(() => {
  sb.reset.mockReset().mockResolvedValue({ data: {}, error: null })
  localStorage.clear(); sessionStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
afterEach(() => { vi.useRealTimers() })

describe('Login · ¿Olvidaste tu contraseña?', () => {
  it('pide el enlace con vuelta a /mi-cuenta de la app y muestra el mensaje fijo', async () => {
    abrir()
    pedir()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(MENSAJE_ENLACE_ENVIADO))
    expect(sb.reset).toHaveBeenCalledTimes(1)
    const [correo, opciones] = sb.reset.mock.calls[0]
    expect(correo).toBe(CORREO)
    expect(opciones.redirectTo).toBe(`${window.location.origin}${import.meta.env.BASE_URL}mi-cuenta`)
  })

  // Lo que devuelve Supabase cuando la cuenta existe vs. cuando no: el texto en pantalla tiene que ser idéntico.
  const casos: [string, unknown][] = [
    ['cuenta que no existe (Supabase responde OK igual)', { data: {}, error: null }],
    ['límite por usuario (429, solo pasa si la cuenta existe)', { data: null, error: { status: 429, code: 'over_email_send_rate_limit' } }],
    ['falló el envío del correo (500, solo si existe)', { data: null, error: { status: 500, code: 'unexpected_failure' } }],
  ]
  it.each(casos)('sin enumeración: %s → mismo mensaje', async (_n, respuesta) => {
    abrir()
    pedir()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    const conCuenta = screen.getByRole('status').textContent
    expect(screen.queryByRole('alert')).toBeNull()
    // otra vez, desde cero, con la otra respuesta
    document.body.innerHTML = ''
    localStorage.clear()
    sb.reset.mockResolvedValue(respuesta)
    abrir()
    pedir('nadie@ejemplo.test')
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toBe(conCuenta)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('freno: después de pedir, el botón queda apagado con la cuenta regresiva; al minuto vuelve', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    abrir()
    pedir()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    const boton = screen.getByRole('button', { name: /Podés pedir otro en \d+ s/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(sb.reset).toHaveBeenCalledTimes(1)
    // Primero se vacían los efectos pendientes: el setInterval de la cuenta regresiva se registra en un useEffect, y si
    // el reloj salta antes de que exista, nadie lo escucha y la prueba cae «a veces» según la carga de la máquina (R11).
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(61_000) })
    const otra = await screen.findByRole('button', { name: 'Mandar otro enlace' }) as HTMLButtonElement
    expect(otra.disabled).toBe(false)
    fireEvent.click(otra)
    await waitFor(() => expect(sb.reset).toHaveBeenCalledTimes(2))
  })

  it('el freno sobrevive a recargar la pantalla (queda en el equipo, sin el correo)', async () => {
    abrir()
    pedir()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    document.body.innerHTML = ''
    abrir()
    expect((screen.getByRole('button', { name: /Podés pedir otro en/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.stringify({ ...localStorage })).not.toContain(CORREO)
  })

  it('sin conexión: lo dice y NO activa el freno', async () => {
    sb.reset.mockResolvedValue({ data: null, error: { name: 'AuthRetryableFetchError', status: 0 } })
    abrir()
    pedir()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sin conexión'))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Mandar enlace' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('correo incompleto: no va al servidor', () => {
    abrir()
    pedir('persona')
    expect(screen.getByRole('alert').textContent).toBe('Escribí tu correo completo')
    expect(sb.reset).not.toHaveBeenCalled()
  })

  it('volviendo de un enlace vencido: se abre solo, con el aviso y el botón para pedir otro', () => {
    avisarEnlaceVencido()
    render(<LoginPage />)
    expect(screen.getByTestId('aviso-enlace-vencido').textContent).toContain('venció o ya se usó')
    expect(screen.getByRole('button', { name: 'Mandar enlace' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a ingresar' }))
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeTruthy()
  })
})
