// Locales (`public.locations`): el correo base de cada local (mig 195), que arma el alias de alta de empleados.
// Lee quien hoy lee `locations` (authenticated con rol); escribe solo el owner (política locations_write_owner).
import { supabase } from './supabase'
import { aliasCorreoEjemplo, localDelAlias, validarCorreoBase, type LocalCorreo } from '../../modules/admin/aliasCorreo'
import { localActual } from './club'

export async function getLocalesCorreo(): Promise<LocalCorreo[]> {
  const { data, error } = await supabase.from('locations').select('id, name, is_active, correo_base').order('id')
  if (error) throw new Error(error.message)
  return (data ?? []) as LocalCorreo[]
}

/** Guarda el correo base de UN local (vacío = borrar). Valida antes; la base vuelve a validar con el check de la 195. */
export async function guardarCorreoBase(id: string, entrada: string): Promise<string | null> {
  const v = validarCorreoBase(entrada)
  if (!v.ok) throw new Error(v.error)
  const { data, error } = await supabase.from('locations')
    .update({ correo_base: v.valor, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.code === '23514' ? 'La base rechazó el formato del correo' : error.message)
  // La RLS no da error al que no puede escribir: devuelve 0 filas.
  if (!data || data.length !== 1) throw new Error('No se guardó: solo el owner puede cambiar los datos del local')
  return v.valor
}

export interface AliasDelLocal {
  /** Nombre del local del alias (null si no hay ningún local encendido). */
  local: string | null
  /** «base+nombre@dominio», o null si el local no tiene correo base cargado. */
  alias: string | null
}

/** El alias del local activo (el elegido en la app; si no, el local por defecto de la caja). */
export async function getAliasDelLocal(): Promise<AliasDelLocal> {
  const l = localDelAlias(await getLocalesCorreo(), localActual())
  return { local: l?.name ?? null, alias: aliasCorreoEjemplo(l?.correo_base) }
}
