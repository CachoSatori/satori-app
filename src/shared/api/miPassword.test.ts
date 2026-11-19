// «Cambiar mi contraseña»: validación, fuerza, traducción de errores y orden de llamadas a Supabase Auth.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sb = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), signOut: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { auth: { signInWithPassword: sb.signIn, updateUser: sb.update, signOut: sb.signOut } } }))

import {
  validarCambio, fuerzaPassword, evaluarPassword, tiposDeCaracter, MOTIVO_DEBIL, motivoReingreso, motivoActualizar, cambiarMiPassword, PASSWORD_MIN_CAMBIO,
} from './miPassword'

const SESENTA = 'Tortuga verde 27 en la playa de Santa Teresa con 3 amigos ok'

describe('validarCambio', () => {
  it('mínimo 8 (decisión del dueño 17-nov)', () => {
    expect(PASSWORD_MIN_CAMBIO).toBe(8)
    expect(validarCambio('vieja-clave-1', 'abc1234', 'abc1234')).toBe('La contraseña nueva debe tener al menos 8 caracteres')
    expect(validarCambio('vieja-clave-1', 'abcd1234', 'abcd1234')).toBeNull()
  })
  it('actual vacía, no coinciden, igual a la actual', () => {
    expect(validarCambio('', 'nueva-clave-larga', 'nueva-clave-larga')).toBe('Escribí tu contraseña actual')
    expect(validarCambio('vieja-clave-1', 'nueva-clave-larga', 'nueva-clave-largA')).toBe('Las contraseñas nuevas no coinciden')
    expect(validarCambio('misma-clave-1', 'misma-clave-1', 'misma-clave-1')).toBe('La contraseña nueva tiene que ser distinta de la actual')
  })
})

describe('validarCambio · «Débil» no se acepta y dice el motivo', () => {
  it.each([
    ['solo letras', 'murcielago', 'falta_numero'],
    ['solo números', '1234567890', 'falta_letra'],
    ['nombre del local con un número', 'satori2026', 'nombre_local'],
    ['palabra conocida con un número', 'qwerty12', 'palabra_comun'],
    ['repetición', 'a1a1a1a1', 'repeticion'],
  ] as const)('%s → «Contraseña débil.» + motivo', (_c, p, m) => {
    expect(validarCambio('vieja-clave-1', p, p)).toBe(`Contraseña débil. ${MOTIVO_DEBIL[m]}`)
  })
  it('aceptable y fuerte pasan (sin signos ni mayúsculas)', () => {
    expect(validarCambio('vieja-clave-1', 'abcd1234', 'abcd1234')).toBeNull()
    expect(validarCambio('vieja-clave-1', 'murcielago77', 'murcielago77')).toBeNull()
    expect(validarCambio('vieja-clave-1', SESENTA, SESENTA)).toBeNull()
  })
})

describe('evaluarPassword · reglas del dueño 17-nov', () => {
  it.each([
    // Pedidas en la tarea.
    ['frase larga con «satori» adentro', 'me encanta el sushi de satori los viernes', 'fuerte', null],
    ['frase de 8–15 con «satori» y más palabras', 'satori playa 7', 'fuerte', null],
    ['abcd1234', 'abcd1234', 'media', null],
    ['abcdefgh (falta número)', 'abcdefgh', 'debil', 'falta_numero'],
    ['12345678', '12345678', 'debil', 'falta_letra'],
    ['60 de letras y números', 'a1b2c3d4e5'.repeat(6), 'fuerte', null],
    ['60 con espacios (el caso del dueño)', SESENTA, 'fuerte', null],
    // Bordes.
    ['corta', 'Ab1!', 'debil', 'corta'],
    ['7 caracteres', 'abc1234', 'debil', 'corta'],
    ['nombre del local + año', 'satori2026', 'debil', 'nombre_local'],
    ['nombre del local + año + signos', 'Sushi2026!!', 'debil', 'nombre_local'],
    ['con tilde: contraseña', 'Contraseña99', 'debil', 'palabra_comun'],
    ['nombre del local + palabra', 'satoriplaya7', 'fuerte', null],
    ['secuencia alternada', 'a1a1a1a1', 'debil', 'repeticion'],
    ['bloque repetido', 'ab12ab12', 'debil', 'repeticion'],
    ['un solo carácter, 8', 'aaaaaaaa', 'debil', 'repeticion'],
    ['un solo carácter, 20', '1'.repeat(20), 'debil', 'repeticion'],
    ['16+ solo letras', 'tortuga verde en la playa', 'fuerte', null],
    ['16+ solo números', '8302749165038271', 'fuerte', null],
    ['16+ con palabra del local', 'satorisatorisatori', 'fuerte', null],
    ['4 iguales seguidos ya no es débil', 'aaaa1234bc', 'media', null],
    ['11 con letras y números', 'murciélago7', 'media', null],
    ['12 con letras y números', 'murcielago77', 'fuerte', null],
    ['solo signos', '!!!!@@@@##', 'debil', 'falta_letra'],
    // Tildes, ñ, espacio y mayúscula inicial: siguen sin hacer falta signo ni mayúscula; solo letras = falta número.
    ['tilde = letra', 'murciélago', 'debil', 'falta_numero'],
    ['ñ = letra', 'mañanitass', 'debil', 'falta_numero'],
    ['espacio final', 'murcielago ', 'debil', 'falta_numero'],
    ['solo mayúscula inicial', 'Murcielago', 'debil', 'falta_numero'],
    ['símbolo no reemplaza al número', 'murcielago!', 'debil', 'falta_numero'],
  ] as const)('%s', (_c, p, f, m) => {
    expect(evaluarPassword(p)).toEqual({ fuerza: f, motivo: m })
    expect(fuerzaPassword(p)).toBe(f)
  })
  it('la frase de 60 caracteres mide 60', () => expect(SESENTA.length).toBe(60))
  it('todo motivo tiene texto', () => {
    for (const m of ['corta', 'falta_numero', 'falta_letra', 'nombre_local', 'palabra_comun', 'repeticion'] as const) {
      expect(MOTIVO_DEBIL[m].length).toBeGreaterThan(10)
    }
  })
})

describe('tiposDeCaracter', () => {
  it.each([
    ['áéíóúñ', 1], ['ÁÉÑ', 1], ['a b', 1], ['Abc', 1], ['aBc', 2], ['ABc', 2], ['a1', 2], ['a!', 2], ['a¿', 2], ['aB1!', 4],
  ])('%s → %i', (p, n) => expect(tiposDeCaracter(p as string)).toBe(n))
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
