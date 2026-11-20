// Marcas que habilitan lo que los hooks frenan. Viven FUERA del repo versionado: archivos `.claude/*.local` (los ignora
// `.gitignore` por `*.local`) o variables de entorno fijadas al abrir la sesión. Formato y uso: scripts/hooks/README.md.
// Un agente no puede escribirlas por Bash (lo frena guardia.mjs) y por Edit/Write pide permiso (`permissions.ask`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MARCAS = {
  sha: { archivo: '.claude/sha-firmado.local', variable: 'SATORI_SHA_FIRMADO' },
  noche: { archivo: '.claude/ok-dueno-noche.local', variable: 'SATORI_OK_DUENO_NOCHE' },
  prod: { archivo: '.claude/turno-prod.local', variable: 'SATORI_TURNO_PROD' },
}

/** Nombres de archivo de las marcas, para que la guardia frene escribirlas por Bash. */
export const RE_ARCHIVO_MARCA = /(?:^|[/\\])(sha-firmado|ok-dueno-noche|turno-prod)\.local\b/

/** Texto de la marca: variable de entorno + archivo (se suman). @returns {string} */
export function leerMarca(clave, { raiz, env = process.env }) {
  const m = MARCAS[clave]
  let texto = env[m.variable] ?? ''
  try { texto += '\n' + readFileSync(join(raiz, m.archivo), 'utf8') } catch { /* sin archivo */ }
  return texto.trim()
}

/**
 * OK del dueño para mergear de 19:00 a 23:30: la fecha CR de hoy (AAAA-MM-DD) y la cita textual del OK entre «…» o
 * "…" (8 caracteres o más), en la misma línea. Vence sola al cambiar el día.
 * @returns {{ ok: true, cita: string } | { ok: false, motivo: string }}
 */
export function okNocheValido(texto, fechaCR) {
  if (!texto) return { ok: false, motivo: 'no hay OK del dueño para la noche' }
  for (const linea of texto.split('\n')) {
    if (!linea.includes(fechaCR)) continue
    const cita = /«([^»]{8,})»|"([^"]{8,})"/.exec(linea)
    if (cita) return { ok: true, cita: (cita[1] ?? cita[2]).trim() }
  }
  return { ok: false, motivo: `el OK de la noche no tiene la fecha de hoy (${fechaCR}) con la cita del dueño entre «…»` }
}

/**
 * Turno de prod (regla 13): una línea con «TURNO DE PROD» y la fecha CR de hoy. Vence sola al cambiar el día.
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
export function turnoProdValido(texto, fechaCR) {
  if (!texto) return { ok: false, motivo: 'no hay turno de prod' }
  const ok = texto.split('\n').some(l => /TURNO DE PROD/.test(l) && l.includes(fechaCR))
  return ok ? { ok: true } : { ok: false, motivo: `el turno de prod no tiene «TURNO DE PROD» con la fecha de hoy (${fechaCR})` }
}

/**
 * SHA firmados: una línea por PR, `#<número> <sha>` (o `<número> <sha>`); un `<sha>` solo vale para cualquier PR.
 * El SHA tiene 7 a 40 hex. @returns {{ pr: number | null, sha: string }[]}
 */
export function shasFirmados(texto) {
  const salida = []
  for (const linea of texto.split('\n')) {
    const m = /^\s*(?:#?(\d+)\s+)?([0-9a-f]{7,40})\b/i.exec(linea)
    if (m) salida.push({ pr: m[1] ? Number(m[1]) : null, sha: m[2].toLowerCase() })
  }
  return salida
}

/** ¿La cabeza del PR es un SHA firmado para ese PR? */
export function shaFirmadoCoincide(firmados, pr, cabeza) {
  const c = String(cabeza).toLowerCase()
  return firmados.some(f => (f.pr === null || f.pr === pr) && c.startsWith(f.sha))
}
