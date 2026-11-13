// (D12 = A, 13-nov) Guarda un alias aprendido en `suppliers.aliases`. No toca plata.
// Camino principal: la RPC `proveedor_agregar_alias` (mig 153), que agrega el alias en UN UPDATE atómico (dos cajas a la
// vez ya no se pisan), no duplica por la clave de matchSupplier y solo con el proveedor activo. Es SECURITY INVOKER:
// decide la RLS de suppliers (suppliers_op_write: owner, manager, cajero).
// Respaldo: si la base todavía no tiene la 153 (función inexistente), cae al método de antes — relee los alias FRESCOS
// y hace UPDATE del array —, así el front se puede mergear antes o después de la migración.
import { supabase } from './supabase'
import { sumarAlias } from '../utils/proveedorAlias'

export type ResultadoAlias = 'agregado' | 'ya_estaba'

type PgError = { message: string; code?: string } | null
type RpcInvoke = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError }>

/** ¿El error dice que la función no existe en la base (sin la 153)? PostgREST: PGRST202; Postgres: 42883. */
export const esFuncionInexistente = (e: PgError) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message))

async function guardarPorUpdate(supplierId: string, alias: string): Promise<ResultadoAlias> {
  const { data, error } = await supabase.from('suppliers').select('aliases').eq('id', supplierId).single()
  if (error) throw new Error(error.message)
  const actuales = ((data as { aliases: string[] | null } | null)?.aliases) ?? []
  const nuevos = sumarAlias(actuales, alias)
  if (nuevos === actuales) return 'ya_estaba'
  const { data: upd, error: e2 } = await supabase.from('suppliers').update({ aliases: nuevos }).eq('id', supplierId).select('id')
  if (e2) throw new Error(e2.message)
  // Con RLS, un UPDATE sin permiso no da error: devuelve 0 filas. Eso también es «no se guardó».
  if (!upd || (upd as unknown[]).length === 0) throw new Error('No se pudo guardar el alias (sin permiso).')
  return 'agregado'
}

export async function guardarAliasProveedor(supplierId: string, alias: string): Promise<ResultadoAlias> {
  // `.bind`: sin él, supabase-js pierde `this` (ver el comentario de `rpc` en cash.ts).
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoke
  const { data, error } = await rpc('proveedor_agregar_alias', { p_supplier_id: supplierId, p_alias: alias })
  if (error) {
    if (esFuncionInexistente(error)) return guardarPorUpdate(supplierId, alias)
    throw new Error(error.message)
  }
  // false = ya estaba (por clave), proveedor inactivo o la RLS no dejó escribir: en ningún caso se agregó.
  return data === true ? 'agregado' : 'ya_estaba'
}
