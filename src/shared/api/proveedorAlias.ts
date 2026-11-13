// (D12 = A, 13-nov) Guarda un alias aprendido en `suppliers.aliases`. Sin esquema nuevo: UPDATE directo, permitido
// por RLS a owner, manager y cajero (policy suppliers_op_write, mig 012). Lee los alias FRESCOS de la base justo antes
// (otra sesión pudo agregar uno) y no duplica por la clave de matchSupplier. No toca plata.
import { supabase } from './supabase'
import { sumarAlias } from '../utils/proveedorAlias'

export type ResultadoAlias = 'agregado' | 'ya_estaba'

export async function guardarAliasProveedor(supplierId: string, alias: string): Promise<ResultadoAlias> {
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
