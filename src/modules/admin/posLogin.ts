// ── «Login del PoS» de un empleado (employees.pos_login) ───────────────────────────────────
//
// Módulo PURO. El login del PoS («026», «0909», …) ata cada factura de Nube de Fuego a un empleado:
// con él Ventas, Mi Rendimiento, ICP y «En vivo» ponen el nombre en vez del número. La base ya
// tiene la columna y un índice único parcial (`employees_pos_login_key`, mig 062): dos empleados no
// pueden tener el mismo login. Acá solo se valida antes de guardar y se traduce el rechazo.

import { rolDeCodigo } from '../../shared/ndf/personasNdf'

/** Formato del PoS: solo dígitos, de 2 a 6 (los ceros a la izquierda cuentan: «026» ≠ «26»). */
export const RE_POS_LOGIN = /^\d{2,6}$/

export interface EmpleadoConLogin {
  id:        string
  full_name: string
  pos_login?: string | null
}

export type ResultadoLogin =
  | { ok: true; valor: string | null }
  | { ok: false; error: string }

/**
 * Valida lo que escribió el owner. Vacío = sin login (null). No se normaliza el número: el PoS
 * distingue «026» de «26». No se aceptan los logins de caja ni el compartido (no son de una persona).
 */
export function validarPosLogin(
  texto: string,
  empleadoId: string,
  empleados: readonly EmpleadoConLogin[],
): ResultadoLogin {
  const v = texto.trim()
  if (v === '') return { ok: true, valor: null }
  if (!RE_POS_LOGIN.test(v)) return { ok: false, error: 'El login del PoS son solo números, de 2 a 6 (por ejemplo 026).' }
  const rol = rolDeCodigo(v)
  if (rol === 'caja') return { ok: false, error: `${v} es un login de caja, no de una persona.` }
  if (rol === 'generico') return { ok: false, error: `${v} es el login compartido, no de una persona.` }
  const otro = empleados.find(e => e.id !== empleadoId && (e.pos_login ?? '').trim() === v)
  if (otro) return { ok: false, error: mensajeDuplicado(otro.full_name) }
  return { ok: true, valor: v }
}

export function mensajeDuplicado(nombre: string | null | undefined): string {
  return nombre ? `Ese login ya lo tiene ${nombre}.` : 'Ese login ya lo tiene otro empleado.'
}

/** ¿El error de la base es el del índice único del login? */
export function esDuplicadoDeLogin(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '23505' || /employees_pos_login_key/.test(error.message ?? '')
}

export interface LoginSinEmpleado {
  login:    string
  facturas: number
  /** Último día CR con una factura de ese login (YYYY-MM-DD). */
  ultima:   string
}

/**
 * Los logins que vendieron (facturas cerradas) y que ningún empleado tiene asignado. Sin los de caja
 * ni el compartido. Ordenados por facturas, de más a menos.
 */
export function loginsSinEmpleado(
  facturas: readonly { salonero_login: string | null; dia: string }[],
  empleados: readonly EmpleadoConLogin[],
): LoginSinEmpleado[] {
  const asignados = new Set(empleados.map(e => (e.pos_login ?? '').trim()).filter(Boolean))
  const m = new Map<string, LoginSinEmpleado>()
  for (const f of facturas) {
    const login = (f.salonero_login ?? '').trim()
    if (!login || asignados.has(login)) continue
    const rol = rolDeCodigo(login)
    if (rol === 'caja' || rol === 'generico') continue
    const e = m.get(login) ?? { login, facturas: 0, ultima: f.dia }
    e.facturas += 1
    if (f.dia > e.ultima) e.ultima = f.dia
    m.set(login, e)
  }
  return [...m.values()].sort((a, b) => b.facturas - a.facturas || a.login.localeCompare(b.login))
}
