// Cambio de contraseña obligatorio (mig 185): contexto y hook. El proveedor está en CambioClaveProvider.tsx.
import { createContext, useContext } from 'react'

/** Al volver a la pestaña, se vuelve a consultar si pasó más que esto desde la última consulta. */
export const RECONSULTA_AL_VOLVER_MS = 5 * 60_000

export interface CambioClaveCtx {
  /** true = tiene que cambiar la contraseña ya (marcado en la base Y con conexión). */
  debe: boolean
  /** true mientras corre la PRIMERA consulta de este usuario (las rutas esperan; con tope de tiempo). */
  consultando: boolean
  /** Vuelve a preguntar a la base (p. ej. después de cambiar la contraseña). */
  recargar: () => Promise<boolean | null>
}

export const CambioClaveContext = createContext<CambioClaveCtx | null>(null)
const SIN_PROVEEDOR: CambioClaveCtx = { debe: false, consultando: false, recargar: async () => null }

export function useCambioClave(): CambioClaveCtx {
  return useContext(CambioClaveContext) ?? SIN_PROVEEDOR
}
