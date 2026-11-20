// «Resumen del día» del cierre (decisión del dueño, 20-nov).
// Es el texto que escribe el encargado al cerrar la Fase 2. Se guarda en la columna de notas que
// ya existía (cash_cierres_dia.notas): sin migración ni cambio de esquema. El correo de cierre lo
// muestra arriba, tal cual. Sin resumen no se cierra el día (o se toca «Sin novedades»).

/** Temas rápidos: cada botón agrega «Tema: » en una línea nueva del cuadro. */
export const TEMAS_RESUMEN = ['Queja', 'Personal', 'Emergencia', '86', 'Mantenimiento'] as const
export type TemaResumen = typeof TEMAS_RESUMEN[number]

/** Texto exacto que deja el botón «Sin novedades». */
export const SIN_NOVEDADES = 'Sin novedades'

/** Aviso bajo el cuadro mientras está vacío; también es el error si se intenta cerrar igual. */
export const AVISO_RESUMEN_VACIO = 'Escribí el resumen del día o tocá Sin novedades'

/** Vacío o solo espacios / saltos de línea: el día no se puede cerrar. */
export function resumenVacio(texto: string): boolean {
  return texto.trim() === ''
}

/**
 * Agrega «Tema: » en una línea nueva al final del cuadro.
 * · Cuadro vacío (o solo espacios) → queda solo «Tema: ».
 * · Si el cuadro dice exactamente «Sin novedades», se reemplaza: un tema la contradice.
 * · Si ya termina en salto de línea, no se agrega otro; los espacios sueltos del final se quitan.
 */
export function agregarTema(texto: string, tema: TemaResumen): string {
  const linea = `${tema}: `
  if (resumenVacio(texto) || texto.trim() === SIN_NOVEDADES) return linea
  const base = texto.replace(/[ \t]+$/, '')
  return base.endsWith('\n') ? base + linea : `${base}\n${linea}`
}
