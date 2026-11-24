// Hallazgo 252, ronda 2 (Menor 1 del verificador): la regla de «no contar dos veces un cambio de pago sin terminar»
// vale en TODO Caja, no solo en la Caja Diaria. Una sola fuente: las anotaciones del aparato (reemplazoPago.ts) y
// `aplicarReemplazos`. Este hook las lee de todos los turnos y se entera cuando cambian (evento propio y `storage`
// de otras pestañas del navegador).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  EVENTO_REEMPLAZOS, leerTodosLosReemplazos, aplicarReemplazos, reemplazosAbiertos, revisarCambioEnBase,
  soltarReemplazo, type EstadoCambio, type ReemplazoPendiente,
} from './reemplazoPago'
import { getCashMovementById } from '../../shared/api/cash'

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
 * `estados`: (ronda 3) cómo está cada cambio abierto en la BASE, por id del viejo (revisarCambioEnBase). Si el viejo
 * ya no existe, la anotación se suelta sola y se llama `alResolver` (recargar: la lista cargada quedó vieja).
 */
export function useMovimientosSinReemplazados<M extends { id: string; _pending?: boolean }>(
  movs: M[], opts?: { alResolver?: () => void },
): { cuenta: M[]; abiertos: ReemplazoPendiente[]; estados: Record<string, EstadoCambio> } {
  const raw = useSyncExternalStore(suscribir, foto, fotoServidor)
  const base = useMemo(() => {
    const lista = JSON.parse(raw) as ReemplazoPendiente[]
    return { cuenta: aplicarReemplazos(movs, lista), abiertos: reemplazosAbiertos(movs, lista) }
  }, [movs, raw])

  const [estados, setEstados] = useState<Record<string, EstadoCambio>>({})
  const alResolver = useRef(opts?.alResolver)
  useEffect(() => { alResolver.current = opts?.alResolver })
  // Clave estable de lo que hay que revisar: los pares abiertos y si el nuevo sigue en la cola.
  const clave = base.abiertos
    .map(r => `${r.viejo}>${r.nuevo}:${movs.some(m => m.id === r.nuevo && m._pending) ? 'c' : 'b'}`).join('|')
  useEffect(() => {
    if (!base.abiertos.length) return
    let vivo = true
    void (async () => {
      const nuevos: Record<string, EstadoCambio> = {}
      let soltados = 0
      for (const r of base.abiertos) {
        const e = await revisarCambioEnBase(r, movs, id => getCashMovementById(id))
        nuevos[r.viejo] = e
        if (e === 'resuelto') { soltarReemplazo(r.viejo); soltados++ }
      }
      if (!vivo) return
      setEstados(nuevos)
      if (soltados) alResolver.current?.()
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  return { ...base, estados }
}
