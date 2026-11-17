// «Cambiar mi contraseña»: validación, fuerza, traducción de errores y orden de llamadas a Supabase Auth.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sb = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), signOut: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { auth: { signInWithPassword: sb.signIn, updateUser: sb.update, signOut: sb.signOut } } }))

import {
  validarCambio, fuerzaPassword, MENSAJE_DEBIL, motivoReingreso, motivoActualizar, cambiarMiPassword, PASSWORD_MIN_CAMBIO,
} from './miPassword'

describe('validarCambio', () => {
  it('mínimo 10', () => {
    expect(PASSWORD_MIN_CAMBIO).toBe(10)
    expect(validarCambio('vieja-clave-1', '123456789', '123456789')).toBe('La contraseña nueva debe tener al menos 10 caracteres')
    expect(validarCambio('vieja-clave-1', 'murcielago77', 'murcielago77')).toBeNull()
  })
  it('actual vacía, no coinciden, igual a la actual', () => {
    expect(validarCambio('', 'nueva-clave-larga', 'nueva-clave-larga')).toBe('Escribí tu contraseña actual')
    expect(validarCambio('vieja-clave-1', 'nueva-clave-larga', 'nueva-clave-largA')).toBe('Las contraseñas nuevas no coinciden')
    expect(validarCambio('misma-clave-1', 'misma-clave-1', 'misma-clave-1')).toBe('La contraseña nueva tiene que ser distinta de la actual')
  })
})

describe('validarCambio · «Débil» no se acepta (decisión del dueño 17-nov)', () => {
  it.each([
    ['un solo tipo', 'murcielago'],
    ['palabra del local', 'Satori2026!!'],
    ['repetida', 'aaaaBBBB1234'],
    ['solo números', '1234567890'],
  ])('%s → mensaje con ejemplo', (_c, p) => {
    expect(validarCambio('vieja-clave-1', p, p)).toBe(MENSAJE_DEBIL)
  })
  it('aceptable y fuerte pasan', () => {
    expect(validarCambio('vieja-clave-1', 'murcielago77', 'murcielago77')).toBeNull()
    expect(validarCambio('vieja-clave-1', 'Tortuga-verde7', 'Tortuga-verde7')).toBeNull()
  })
})

describe('fuerzaPassword', () => {
  it.each([
    ['corta', 'Ab1!', 'debil'],
    ['palabra del local', 'Satori2026!!', 'debil'],
    ['con tilde: contraseña', 'MiContraseña99', 'debil'],
    ['repetida', 'aaaaBBBB1234', 'debil'],
    ['un solo tipo, 10', 'murcielago', 'debil'],
    ['dos tipos, 12', 'murcielago77', 'media'],
    ['frase larga un tipo', 'tortuga verde en la playa', 'fuerte'],
    ['14 con tres tipos', 'Tortuga-verde7', 'fuerte'],
  ])('%s', (_c, p, f) => expect(fuerzaPassword(p)).toBe(f))
})

describe('traducción de errores', () => {
  it('reingreso', () => {
    expect(motivoReingreso({ code: 'invalid_credentials', status: 400 })).toBe('actual_incorrecta')
    expect(motivoReingreso({ name: 'AuthRetryableFetchError', status: 0 })).toBe('sin_conexion')
    expect(motivoReingreso({ code: 'over_request_rate_limit', status: 429 })).toBe('demasiados_intentos')
    expect(motivoReingreso({ status: 500 })).toBe('desconocido')
  })
  it('actualizar', () => {
    expect(motivoActualizar({ code: 'same_password', status: 422 })).toBe('igual_a_actual')
    expect(motivoActualizar({ code: 'weak_password', status: 422 })).toBe('debil_servidor')
    expect(motivoActualizar({ code: 'reauthentication_needed', status: 400 })).toBe('reautenticar')
    expect(motivoActualizar({ status: 500 })).toBe('desconocido')
  })
})

describe('cambiarMiPassword', () => {
  beforeEach(() => {
    sb.signIn.mockReset(); sb.update.mockReset(); sb.signOut.mockReset()
    sb.signIn.mockResolvedValue({ data: {}, error: null })
    sb.update.mockResolvedValue({ data: {}, error: null })
    sb.signOut.mockResolvedValue({ error: null })
  })

  it('ok: reingresa con la actual, cambia y cierra las otras sesiones, en ese orden', async () => {
    const r = await cambiarMiPassword('ana@ejemplo.test', 'vieja-clave-1', 'nueva-clave-larga')
    expect(r).toEqual({ ok: true, otrasSesionesCerradas: true })
    expect(sb.signIn).toHaveBeenCalledWith({ email: 'ana@ejemplo.test', password: 'vieja-clave-1' })
    expect(sb.update).toHaveBeenCalledWith({ password: 'nueva-clave-larga' })
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(sb.signIn.mock.invocationCallOrder[0]).toBeLessThan(sb.update.mock.invocationCallOrder[0])
    expect(sb.update.mock.invocationCallOrder[0]).toBeLessThan(sb.signOut.mock.invocationCallOrder[0])
  })

  it('actual incorrecta: no cambia nada', async () => {
    sb.signIn.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400 } })
    const r = await cambiarMiPassword('ana@ejemplo.test', 'mala', 'nueva-clave-larga')
    expect(r).toEqual({ ok: false, motivo: 'actual_incorrecta' })
    expect(sb.update).not.toHaveBeenCalled()
    expect(sb.signOut).not.toHaveBeenCalled()
  })

  it('falla updateUser: no cierra sesiones', async () => {
    sb.update.mockResolvedValue({ data: {}, error: { code: 'same_password', status: 422 } })
    expect(await cambiarMiPassword('ana@ejemplo.test', 'a-b-c-d-e-f', 'nueva-clave-larga')).toEqual({ ok: false, motivo: 'igual_a_actual' })
    expect(sb.signOut).not.toHaveBeenCalled()
  })

  it('falla el cierre de otras sesiones: el cambio vale y se avisa', async () => {
    sb.signOut.mockResolvedValue({ error: { status: 500 } })
    expect(await cambiarMiPassword('ana@ejemplo.test', 'vieja-clave-1', 'nueva-clave-larga')).toEqual({ ok: true, otrasSesionesCerradas: false })
    sb.signOut.mockRejectedValue(new Error('x'))
    expect(await cambiarMiPassword('ana@ejemplo.test', 'vieja-clave-1', 'nueva-clave-larga')).toEqual({ ok: true, otrasSesionesCerradas: false })
  })

  it('sin correo o excepción de red: no lanza', async () => {
    expect(await cambiarMiPassword(undefined, 'a', 'b')).toEqual({ ok: false, motivo: 'sin_correo' })
    expect(sb.signIn).not.toHaveBeenCalled()
    sb.signIn.mockRejectedValue({ name: 'AuthRetryableFetchError', status: 0 })
    expect(await cambiarMiPassword('ana@ejemplo.test', 'vieja-clave-1', 'nueva-clave-larga')).toEqual({ ok: false, motivo: 'sin_conexion' })
  })
})
