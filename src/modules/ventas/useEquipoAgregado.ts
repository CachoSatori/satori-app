// Los agregados del equipo (mig 194) para un rango, con un caché chico por rango: cambiar de pestaña no vuelve a
// pedir lo mismo. `activo = false` (gerencia o «Ver como», que comparan con sus propios datos) → no pide nada.
import { useEffect, useState } from 'react'
import { getEquipoAgregado, getMiCompetencia, type EquipoAgregado, type MiCompetencia } from '../../shared/api/rendimientoEquipo'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'

/** `cargando` mientras pide; `null` si no hay (función sin aplicar, error o sin rango). */
export type EstadoEquipo = { cargando: boolean; datos: EquipoAgregado | null }

const cache = new Map<string, Promise<EquipoAgregado | null>>()

export function useEquipoAgregado(activo: boolean, desde: string, hasta: string): EstadoEquipo {
  const clave = activo && desde && hasta ? `${desde}|${hasta}` : ''
  const [estado, setEstado] = useState<EstadoEquipo & { clave: string }>({ cargando: !!clave, datos: null, clave })
  useEffect(() => {
    if (!clave) return
    let vivo = true
    let p = cache.get(clave)
    if (!p) {
      p = getEquipoAgregado(LOCAL_POR_DEFECTO, desde, hasta).catch(() => null)
      cache.set(clave, p)
    }
    p.then(d => {
      if (d === null) cache.delete(clave)   // un error no queda guardado: la próxima vez se vuelve a pedir
      if (vivo) setEstado({ cargando: false, datos: d, clave })
    })
    return () => { vivo = false }
  }, [clave, desde, hasta])
  if (!clave) return { cargando: false, datos: null }
  if (estado.clave !== clave) return { cargando: true, datos: null }
  return { cargando: estado.cargando, datos: estado.datos }
}

/** Mi lugar en cada competencia (por id). Vacío si `activo = false`. */
export function useMisCompetencias(activo: boolean, ids: readonly string[]): Record<string, MiCompetencia | null> {
  const clave = activo ? ids.join('|') : ''
  const [out, setOut] = useState<Record<string, MiCompetencia | null>>({})
  useEffect(() => {
    if (!clave) return
    let vivo = true
    Promise.all(clave.split('|').map(async id => [id, await getMiCompetencia(LOCAL_POR_DEFECTO, id).catch(() => null)] as const))
      .then(pares => { if (vivo) setOut(Object.fromEntries(pares)) })
    return () => { vivo = false }
  }, [clave])
  return clave ? out : {}
}

/** Solo para las pruebas: vacía el caché entre casos. */
export function _vaciarCacheEquipo(): void { cache.clear() }
