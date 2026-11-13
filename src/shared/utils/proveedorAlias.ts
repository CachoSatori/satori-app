// (D12 = A, 13-nov) Proveedor por nombre leído + alias aprendido.
// La IA lee el nombre LEGAL de la factura («Exportadora X, S.A.») y el proveedor está cargado con el nombre COMERCIAL.
// Cuando la cajera elige a mano el proveedor existente para un nombre leído que no se reconoce, ese nombre se guarda
// como alias del proveedor → la próxima factura se reconoce sola. Funciones puras: sin red, sin estado.
import type { Supplier, UserRole } from '../types/database'

// Mismo `norm` que inventoryIngest (minúsculas + sin tildes), copiado para no traer el cliente de Supabase a utils.
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Clave de comparación de nombres de proveedor: sin mayúsculas, tildes, espacios ni puntuación
 *  («X, S.A.» = «X S. A.» = «X SA»). La usa matchSupplier y la deduplicación de alias. */
export const claveProveedor = (s: string | null | undefined) => norm(s ?? '').replace(/[^a-z0-9]/g, '')

const coincide = (s: Supplier, key: string) =>
  claveProveedor(s.name) === key || (s.aliases ?? []).some(a => claveProveedor(a) === key)

/** Proveedor activo cuyo nombre o alguno de sus alias tiene la misma clave. */
export function matchSupplier(name: string, suppliers: Supplier[]): Supplier | null {
  const key = claveProveedor(name)
  if (!key) return null
  return suppliers.find(s => s.is_active && coincide(s, key)) ?? null
}

/** Largo mínimo (de la clave normalizada) para aprender un alias: menos es ruido de lectura. */
export const ALIAS_MIN = 4

export type DecisionAlias =
  | { agregar: true; alias: string }
  | { agregar: false; motivo: 'vacio' | 'corto' | 'otro_proveedor' | 'ya_esta' | 'sin_destino' }

/** ¿Se aprende `leido` como alias del proveedor `destinoId`? No, si está vacío, es muy corto, ya coincide con OTRO
 *  proveedor activo (ambiguo) o ya es el nombre/un alias del mismo destino. */
export function decidirAlias(leido: string | null | undefined, destinoId: string, suppliers: Supplier[]): DecisionAlias {
  const alias = (leido ?? '').trim()
  const key = claveProveedor(alias)
  if (!key) return { agregar: false, motivo: 'vacio' }
  if (key.length < ALIAS_MIN) return { agregar: false, motivo: 'corto' }
  if (suppliers.some(s => s.is_active && s.id !== destinoId && coincide(s, key))) return { agregar: false, motivo: 'otro_proveedor' }
  const destino = suppliers.find(s => s.id === destinoId)
  if (!destino) return { agregar: false, motivo: 'sin_destino' }
  if (coincide(destino, key)) return { agregar: false, motivo: 'ya_esta' }
  return { agregar: true, alias }
}

/** Lista de alias con `alias` agregado, sin duplicar por clave. Si ya estaba, devuelve la MISMA lista. */
export function sumarAlias(aliases: string[] | null | undefined, alias: string): string[] {
  const lista = aliases ?? []
  const key = claveProveedor(alias)
  if (!key || lista.some(a => claveProveedor(a) === key)) return lista
  return [...lista, alias.trim()]
}

/** Roles que pueden actualizar `suppliers` por RLS (policy suppliers_op_write de la mig 012: owner, manager, cajero).
 *  El contador solo lee (mig 095). A los demás no se les intenta guardar el alias. */
export const puedeAprenderAlias = (role: UserRole) => role === 'owner' || role === 'manager' || role === 'cajero'

/** Línea discreta que ve la cajera cuando el alias quedó guardado. */
export const msgAliasGuardado = (leido: string, proveedor: string) =>
  `✓ Guardado: la próxima vez se reconoce «${leido}» como ${proveedor}.`
