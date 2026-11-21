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

// ── Resumen del día ≠ motivo de la diferencia (21-nov) ──
// Son dos campos distintos (notas · ajuste_motivo). El resumen cuenta qué pasó en el día; el motivo,
// en una línea, por qué la caja no cuadró. Si el cierre pide motivo, no pueden ser el mismo texto.

/** Etiqueta, ejemplo y tope del campo del motivo de la diferencia. */
export const ETIQUETA_MOTIVO = '¿Por qué hubo diferencia? *'
export const PLACEHOLDER_MOTIVO = 'Ej.: vuelto mal dado en una mesa'
export const MOTIVO_MAX = 160

/** Ejemplo del cuadro del resumen: recuerda que la diferencia va aparte. */
export const PLACEHOLDER_RESUMEN = 'Qué pasó hoy: quejas, personal, 86, mantenimiento… (la diferencia va aparte)'

/** Error y aviso cuando el resumen y el motivo dicen lo mismo. */
export const AVISO_RESUMEN_IGUAL_MOTIVO = 'El resumen del día y el motivo de la diferencia tienen que ser distintos'

/** Para comparar: sin espacios en los bordes, en minúsculas y con los espacios (y saltos) colapsados. */
export function normalizarTexto(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * ¿El resumen y el motivo son el mismo texto (normalizado)? Si alguno está vacío, no: de eso ya
 * se encargan sus propios avisos de obligatorio.
 */
export function resumenIgualMotivo(resumen: string, motivo: string): boolean {
  const r = normalizarTexto(resumen)
  const m = normalizarTexto(motivo)
  return r !== '' && m !== '' && r === m
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
