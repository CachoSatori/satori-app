// Hallazgo 252, ronda 2 (Menor 1 del verificador): la regla de «no contar dos veces un cambio de pago sin terminar»
// vale en TODO Caja, no solo en la Caja Diaria. Una sola fuente: las anotaciones del aparato (reemplazoPago.ts) y
// `aplicarReemplazos`. Este hook las lee de todos los turnos y se entera cuando cambian (evento propio y `storage`
// de otras pestañas del navegador).

import { useMemo, useSyncExternalStore } from 'react'
import {
  EVENTO_REEMPLAZOS, leerTodosLosReemplazos, aplicarReemplazos, reemplazosAbiertos, type ReemplazoPendiente,
} from './reemplazoPago'

const suscribir = (avisar: () => void) => {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENTO_REEMPLAZOS, avisar)
  window.addEventListener('storage', avisar)
  return () => { window.removeEventListener(EVENTO_REEMPLAZOS, avisar); window.removeEventListener('storage', avisar) }
}
// Texto (no arreglo) para que la foto sea estable entre renders: React compara con Object.is.
const foto = () => JSON.stringify(leerTodosLosReemplazos())
const fotoServidor = () => '[]'

/**
 * `cuenta`: los movimientos para TODAS las cuentas (el viejo de un cambio abierto no está).
 * `abiertos`: los cambios con el viejo y el nuevo a la vista (para avisar y frenar la Noche del Cierre del día).
 */
export function useMovimientosSinReemplazados<M extends { id: string }>(movs: M[]): { cuenta: M[]; abiertos: ReemplazoPendiente[] } {
  const raw = useSyncExternalStore(suscribir, foto, fotoServidor)
  return useMemo(() => {
    const lista = JSON.parse(raw) as ReemplazoPendiente[]
    return { cuenta: aplicarReemplazos(movs, lista), abiertos: reemplazosAbiertos(movs, lista) }
  }, [movs, raw])
}
