// ── Prom/PAX explicado: quién es el salonero de un login, con las reglas de `personasNdf.ts` ──
//
// El RPC devuelve el login crudo y el día; el nombre se resuelve acá para respetar las vigencias
// (un código reciclado fuera de la ventana de su titular sale como «login XXXX») y los alias (dos
// códigos de una misma persona son UNA fila). Login null = la factura no tiene mesero.

import { clasificarCodigo, nombreDePersona } from '../../shared/ndf/personasNdf'
import type { ResolverSalonero } from './ventasPromPaxExplicado'

export const CLAVE_CAJA = 'caja'
export const NOMBRE_CAJA = 'Caja / sin mesero'

/** `nombres` = `pos_login → full_name` de `employees` (el mismo mapa que usa el ranking). */
export function resolverPersonas(nombres: Readonly<Record<string, string>> = {}): ResolverSalonero {
  return (login, dia) => {
    if (!login || !login.trim()) return { clave: CLAVE_CAJA, nombre: NOMBRE_CAJA }
    const p = clasificarCodigo(login, dia)
    return { clave: p.id, nombre: nombreDePersona(p, nombres) }
  }
}
