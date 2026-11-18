// @vitest-environment happy-dom
// Modo recuperación: se activa SOLO con el evento PASSWORD_RECOVERY de supabase-js (que llega cuando el enlace del
// correo es válido), nunca por escribir la URL a mano; se ata al usuario y vence; SIGNED_OUT lo termina. Un enlace
// vencido (error_code en la URL) deja el aviso para el login.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sb = vi.hoisted(() => ({ oyentes: [] as ((ev: string, s: unknown) => void)[] }))
vi.mock('./supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: (ev: string, s: unknown) => void) => { sb.oyentes.push(cb); return { data: { subscription: { unsubscribe() {} } } } } } },
}))

import {
  iniciarRecuperacion, enRecuperacion, tomarAvisoLogin, urlEsEnlaceFallido, marcarRecuperacion, _reiniciarParaPruebas,
  VIGENCIA_RECUPERACION_MS,
} from './recuperarClave'

const emitir = (ev: string, uid: string | null) => sb.oyentes.forEach(f => f(ev, uid ? { user: { id: uid } } : null))

beforeEach(() => {
  sb.oyentes = []
  sessionStorage.clear(); localStorage.clear()
  _reiniciarParaPruebas()
  window.history.replaceState({}, '', '/mi-cuenta')
})

describe('recuperarClave', () => {
  it('PASSWORD_RECOVERY marca el modo para ESE usuario', () => {
    iniciarRecuperacion()
    expect(enRecuperacion('u1')).toBe(false)
    emitir('PASSWORD_RECOVERY', 'u1')
    expect(enRecuperacion('u1')).toBe(true)
    expect(enRecuperacion('u2')).toBe(false)
    expect(enRecuperacion(null)).toBe(false)
  })

  it('la URL sola NO activa el modo (alguien con la sesión abierta podría escribirla)', () => {
    window.history.replaceState({}, '', '/mi-cuenta#access_token=x&type=recovery')
    iniciarRecuperacion()
    emitir('SIGNED_IN', 'u1')
    expect(enRecuperacion('u1')).toBe(false)
  })

  it('SIGNED_OUT termina el modo', () => {
    iniciarRecuperacion()
    emitir('PASSWORD_RECOVERY', 'u1')
    emitir('SIGNED_OUT', null)
    expect(enRecuperacion('u1')).toBe(false)
  })

  it('vence a la hora', () => {
    marcarRecuperacion('u1', Date.now() - VIGENCIA_RECUPERACION_MS - 1)
    expect(enRecuperacion('u1')).toBe(false)
    marcarRecuperacion('u1', Date.now())
    expect(enRecuperacion('u1')).toBe(true)
  })

  it('enlace vencido en la URL (hash o consulta) → aviso para el login, una sola vez', () => {
    window.history.replaceState({}, '', '/mi-cuenta#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    iniciarRecuperacion()
    expect(tomarAvisoLogin()).toBe('vencido')
    expect(tomarAvisoLogin()).toBeNull()
    expect(urlEsEnlaceFallido('https://ejemplo.test/mi-cuenta?error=access_denied&error_code=otp_expired')).toBe(true)
    expect(urlEsEnlaceFallido('https://ejemplo.test/mi-cuenta#access_token=x&type=recovery')).toBe(false)
    expect(urlEsEnlaceFallido('https://ejemplo.test/caja')).toBe(false)
  })

  it('se inicia una sola vez (un único oyente)', () => {
    iniciarRecuperacion(); iniciarRecuperacion()
    expect(sb.oyentes).toHaveLength(1)
  })
})
