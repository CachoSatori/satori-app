// Destinatario de los correos internos (owner). Firma del dueño (16-nov-2026): sin correo por defecto en el
// código (repo público). Sale SOLO del secreto REPORT_TO_EMAIL; si falta o no parece un correo, no se manda
// nada: la función loguea «falta destinatario» y devuelve un error claro.

/** Normaliza el valor del secreto: '' si falta o no tiene forma de correo. */
export function destinatarioDe(valor: string | null | undefined): string {
  const v = (valor ?? '').trim()
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v) ? v : ''
}

export const FALTA_DESTINATARIO = 'falta destinatario'
