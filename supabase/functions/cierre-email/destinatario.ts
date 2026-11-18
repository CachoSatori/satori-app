// Destinatario de los correos internos (owner). Firma del dueño (16-nov-2026): sin correo por defecto en el
// código (repo público). Sale SOLO del secreto REPORT_TO_EMAIL; si falta o no parece un correo, no se manda
// nada: la función loguea «falta destinatario» y devuelve un error claro.

/** Normaliza el valor del secreto: '' si falta o no tiene forma de correo. */
export function destinatarioDe(valor: string | null | undefined): string {
  const v = (valor ?? '').trim()
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v) ? v : ''
}

export const FALTA_DESTINATARIO = 'falta destinatario'

// Remitente (18-nov): el dominio propio es configuración y no va escrito en el repo (src/dominioRepo.test.ts,
// src/privacidadRepo.test.ts). Sale SOLO del secreto REMITENTE_CORREOS, con la forma «Nombre <dir@dominio>» o
// «dir@dominio». Sin él no se manda nada (igual que sin destinatario).
export function remitenteDe(valor: string | null | undefined): string {
  const v = (valor ?? '').trim()
  const m = /^([^<>@]*?)\s*<([^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+)>$/.exec(v)
  if (m) return m[1] ? `${m[1]} <${m[2]}>` : m[2]
  return destinatarioDe(v)
}

export const FALTA_REMITENTE = 'falta remitente'
