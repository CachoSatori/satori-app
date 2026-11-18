// Los textos de Mi Rendimiento cuando la comparación con el equipo (mig 194) no se puede mostrar. Personal: voseo.
import type { EquipoAgregado } from '../../shared/api/rendimientoEquipo'

export const AVISO_EQUIPO_NO_DISPONIBLE = 'La comparación con el equipo no está disponible ahora.'
export const AVISO_GRUPO_CHICO =
  'Tu posición y los promedios del equipo se muestran cuando hay al menos 4 personas con ventas en el período (así no se identifica a nadie).'
export const SIN_DATOS_ANIO_PASADO = 'sin datos del año pasado'
export const AVISO_SIN_VENTAS = 'Sin ventas tuyas en el período: no hay con qué comparar.'

/** El aviso que va en lugar de la comparación, o `null` si la comparación está completa. */
export function textoMotivoEquipo(d: EquipoAgregado | null): string | null {
  if (!d) return AVISO_EQUIPO_NO_DISPONIBLE
  if (d.motivo === 'grupo_chico') return AVISO_GRUPO_CHICO
  if (d.motivo === 'sin_ventas') return AVISO_SIN_VENTAS
  return null
}
