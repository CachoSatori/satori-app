import { describe, expect, it, vi } from 'vitest'
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
import { esDuplicadoDeLogin, loginsDeCaja, loginsSinEmpleado, mensajeDuplicado, usoLoginsDeCaja, validarPosLogin } from './posLogin'

const EMPS = [
  { id: 'a', full_name: 'EMPLEADO A', pos_login: '026' },
  { id: 'b', full_name: 'EMPLEADO B', pos_login: null },
]

describe('validarPosLogin', () => {
  it('vacío = sin login (null)', () => {
    expect(validarPosLogin('  ', 'b', EMPS)).toEqual({ ok: true, valor: null })
  })
  it('acepta dígitos (2 a 6) y conserva los ceros a la izquierda', () => {
    expect(validarPosLogin(' 0909 ', 'b', EMPS)).toEqual({ ok: true, valor: '0909' })
    expect(validarPosLogin('041', 'b', EMPS)).toEqual({ ok: true, valor: '041' })
  })
  it('rechaza formato inválido', () => {
    for (const v of ['7', 'abc', '12a', '1234567', '0 26']) {
      expect(validarPosLogin(v, 'b', EMPS).ok, v).toBe(false)
    }
  })
  it('rechaza los logins de caja y el compartido', () => {
    expect(validarPosLogin('111', 'b', EMPS)).toEqual({ ok: false, error: '111 es el login fijo de caja del turno mañana, no de una persona.' })
    expect(validarPosLogin('222', 'b', EMPS)).toEqual({ ok: false, error: '222 es el login fijo de caja del turno tarde, no de una persona.' })
    expect(validarPosLogin('388', 'b', EMPS)).toMatchObject({ ok: false, error: expect.stringMatching(/caja/) })
    expect(validarPosLogin('02', 'b', EMPS)).toMatchObject({ ok: false, error: expect.stringMatching(/compartido/) })
  })
  it('duplicado con otro empleado → «Ese login ya lo tiene <nombre>»', () => {
    expect(validarPosLogin('026', 'b', EMPS)).toEqual({ ok: false, error: 'Ese login ya lo tiene EMPLEADO A.' })
  })
  it('re-guardar el login propio no es duplicado', () => {
    expect(validarPosLogin('026', 'a', EMPS)).toEqual({ ok: true, valor: '026' })
  })
})

describe('esDuplicadoDeLogin / mensajeDuplicado', () => {
  it('reconoce el índice único', () => {
    expect(esDuplicadoDeLogin({ message: 'duplicate key value violates unique constraint "employees_pos_login_key"' })).toBe(true)
    expect(esDuplicadoDeLogin({ code: '23505' })).toBe(true)
    expect(esDuplicadoDeLogin({ message: 'otra cosa' })).toBe(false)
    expect(mensajeDuplicado(null)).toBe('Ese login ya lo tiene otro empleado.')
  })
})

describe('loginsSinEmpleado', () => {
  it('cuenta facturas y última fecha; saca asignados, caja y compartido', () => {
    const r = loginsSinEmpleado([
      { salonero_login: '026', dia: '2026-11-01' },   // asignado → afuera
      { salonero_login: '041', dia: '2026-10-01' },
      { salonero_login: '041', dia: '2026-11-03' },
      { salonero_login: '039', dia: '2026-10-15' },
      { salonero_login: '111', dia: '2026-10-15' },   // caja → afuera
      { salonero_login: '02',  dia: '2026-10-15' },   // compartido → afuera
      { salonero_login: null,  dia: '2026-10-15' },
    ], EMPS)
    expect(r).toEqual([
      { login: '041', facturas: 2, ultima: '2026-11-03' },
      { login: '039', facturas: 1, ultima: '2026-10-15' },
    ])
  })
})

describe('logins fijos de caja', () => {
  it('la lista sale del mapa de cajas: 111 mañana, 222 tarde', () => {
    expect(loginsDeCaja()).toEqual([{ login: '111', turno: 'mañana' }, { login: '222', turno: 'tarde' }])
  })
  it('se muestran siempre, con su uso si aparecen', () => {
    expect(usoLoginsDeCaja([
      { salonero_login: '222', dia: '2026-10-01' }, { salonero_login: '222', dia: '2026-10-09' },
      { salonero_login: '041', dia: '2026-10-09' },
    ])).toEqual([
      { login: '111', turno: 'mañana', facturas: 0, ultima: null },
      { login: '222', turno: 'tarde', facturas: 2, ultima: '2026-10-09' },
    ])
  })
  it('un alias viejo de una persona ya asignada no sale como «sin empleado»', () => {
    // 266 es el código histórico de la misma persona que 038 (personasNdf.ts).
    const r = loginsSinEmpleado([{ salonero_login: '266', dia: '2026-10-01' }],
      [{ id: 'x', full_name: 'EMPLEADO X', pos_login: '038' }])
    expect(r).toEqual([])
  })
})

describe('Grok 106: rechazo «solo el owner» de la base', () => {
  it('reconoce el 42501 y el mensaje del trigger', async () => {
    const { esRechazoSoloOwner, puedeCambiarPerfil } = await import('./posLogin')
    expect(esRechazoSoloOwner({ code: '42501' })).toBe(false)   // un 42501 cualquiera no es «solo el owner»
    expect(esRechazoSoloOwner({ code: '42501', message: 'permission denied for table employees' })).toBe(false)
    expect(esRechazoSoloOwner({ message: 'Solo el owner cambia el login del PoS de un empleado…' })).toBe(true)
    expect(esRechazoSoloOwner({ message: 'otra cosa' })).toBe(false)
    expect(puedeCambiarPerfil(false, { pos_login: '026' })).toBe(false)
    expect(puedeCambiarPerfil(false, { pos_login: null })).toBe(true)
    expect(puedeCambiarPerfil(true, { pos_login: '026' })).toBe(true)
  })
})
