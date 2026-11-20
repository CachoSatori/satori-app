// Marcas que habilitan lo que los hooks frenan. Viven FUERA del repo versionado: archivos `.claude/*.local` (los ignora
// `.gitignore` por `*.local`) o variables de entorno fijadas al abrir la sesión. Formato y uso: scripts/hooks/README.md.
// Un agente no puede escribirlas por Bash (lo frena guardia.mjs) y por Edit/Write pide permiso (`permissions.ask`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MARCAS = {
  sha: { archivo: '.claude/sha-firmado.local', variable: 'SATORI_SHA_FIRMADO' },
  noche: { archivo: '.claude/ok-dueno-noche.local', variable: 'SATORI_OK_DUENO_NOCHE' },
  prod: { archivo: '.claude/turno-prod.local', variable: 'SATORI_TURNO_PROD' },
  migracion: { archivo: '.claude/migracion-firmada.local', variable: 'SATORI_MIGRACION_FIRMADA' },
}

/** Archivos de las marcas y de la configuración de Claude Code, para que la guardia frene escribirlos por Bash. */
export const RE_ARCHIVO_MARCA = /(?:^|[/\\])(?:(?:sha-firmado|ok-dueno-noche|turno-prod|migracion-firmada)\.local\b|\.claude[/\\]settings(?:\.local)?\.json$)/

const ESCRIBEN = new Set(['cp', 'mv', 'tee', 'install', 'ln', 'dd', 'touch', 'truncate', 'rsync', 'rm', 'shred', 'chmod', 'unlink'])

/**
 * ¿Este comando simple escribe una marca o `.claude/settings(.local).json`? Leer (cat, jq, git diff, grep) sí se puede.
 * Escribir: redirección (`>`, `>>`), `tee`, `cp`/`rsync`/`install` con el archivo de destino, `mv`, `sed -i` / `perl -i`,
 * `touch`, `rm` de la configuración (borrar una marca sí se puede: revoca). @returns {string | null} el archivo
 */
export function escribeProtegido(prog, args, redirecciones) {
  for (const r of redirecciones) if (/>/.test(r.op) && RE_ARCHIVO_MARCA.test(r.destino)) return r.destino
  const tocados = args.filter(a => !a.startsWith('-') && RE_ARCHIVO_MARCA.test(a))
  if (tocados.length === 0) return null
  const esConfig = a => /settings(?:\.local)?\.json$/.test(a)
  if (prog === 'rm' || prog === 'unlink' || prog === 'shred') return tocados.find(esConfig) ?? null
  if (prog === 'cp' || prog === 'rsync' || prog === 'install') {
    const pos = args.filter(a => !a.startsWith('-'))
    const destino = pos[pos.length - 1]
    return destino && RE_ARCHIVO_MARCA.test(destino) ? destino : null
  }
  if (ESCRIBEN.has(prog)) return tocados[0]
  if ((prog === 'sed' || prog === 'perl') && args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return tocados[0]
  if (prog === 'git' && args.some(a => ['checkout', 'restore', 'apply', 'mv', 'rm'].includes(a))) return tocados[0]
  return null
}

/** Texto de la marca: variable de entorno + archivo (se suman). @returns {string} */
export function leerMarca(clave, { raiz, env = process.env }) {
  const m = MARCAS[clave]
  let texto = env[m.variable] ?? ''
  try { texto += '\n' + readFileSync(join(raiz, m.archivo), 'utf8') } catch { /* sin archivo */ }
  return texto.trim()
}

/**
 * OK del dueño para mergear de 15:00 a 23:30 (de 19:00 a 23:30, además, URGENTE dentro de la cita): en una misma línea, la fecha CR de hoy (AAAA-MM-DD), el número del PR
 * (`#305`) y la cita textual del OK entre «…» o "…" (8 caracteres o más). Vale solo para ese PR y vence al cambiar el día.
 * @returns {{ ok: true, cita: string } | { ok: false, motivo: string }}
 */
export function okNocheValido(texto, fechaCR, pr, { urgente = false } = {}) {
  if (!texto) return { ok: false, motivo: 'no hay OK del dueño' }
  for (const linea of texto.split('\n')) {
    if (!linea.includes(fechaCR)) continue
    if (!new RegExp(`#${pr}(?!\\d)`).test(linea)) continue
    const cita = /«([^»]{8,})»|"([^"]{8,})"/.exec(linea)
    if (!cita) continue
    const texto = (cita[1] ?? cita[2]).trim()
    if (urgente && !/\bURGENTE\b/.test(texto)) continue
    return { ok: true, cita: texto }
  }
  const extra = urgente ? ' con la palabra URGENTE dentro de la cita' : ''
  return { ok: false, motivo: `el OK no tiene, en una línea, la fecha de hoy (${fechaCR}), «#${pr}» y la cita del dueño entre «…»${extra}` }
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

/**
 * Migraciones firmadas: una línea por archivo, `<sha256 del .sql> [nombre]` (64 hex, lo que da `sha256sum`). Habilitan
 * ESE texto exacto aunque traiga drop / delete (p. ej. `drop policy if exists`), al aplicarlo a mano con firma (regla 1).
 * @returns {Set<string>}
 */
export function migracionesFirmadas(texto) {
  const salida = new Set()
  for (const linea of texto.split('\n')) {
    const m = /^\s*([0-9a-f]{64})\b/i.exec(linea)
    if (m) salida.add(m[1].toLowerCase())
  }
  return salida
}
