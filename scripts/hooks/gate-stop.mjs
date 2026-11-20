#!/usr/bin/env node
// Stop: antes de que la sesión termine, si hay trabajo sin entregar (cambios sin commitear, archivos nuevos o commits
// por delante de origin), corre `bash scripts/ci/gate.sh`. Si falla: exit 2 y las líneas de falla a stderr; el modelo
// sigue trabajando.
// Sin bucle infinito: con `stop_hook_active` (el modelo ya siguió por un Stop anterior) se cuentan las rondas; a la
// tercera seguida que falla, deja terminar y avisa (tope de 3 rondas, skill satori-estandar-pr §12). Un gate verde se
// recuerda para ese mismo estado del árbol (no se repite si no cambió nada).
// Camino rápido: si todo lo que cambió son .md, en lugar del gate completo corren las guardas que leen documentos
// (privacidad, dominio, Wallet, ref de prod, migraciones de ESTADO, sagrados, checks protegidos).
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TOPE_RONDAS = 3

function git(raiz, args) {
  const r = spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

/** ¿Hay algo sin entregar? @returns {{ sucio: boolean, adelante: number }} */
export function trabajoPendiente(raiz) {
  const sucio = (git(raiz, ['status', '--porcelain']) ?? '').trim() !== ''
  let adelante = 0
  const conUpstream = git(raiz, ['rev-list', '--count', '@{u}..HEAD'])
  if (conUpstream !== null) adelante = Number(conUpstream.trim()) || 0
  else {
    const contraMain = git(raiz, ['rev-list', '--count', 'origin/main..HEAD'])
    if (contraMain !== null) adelante = Number(contraMain.trim()) || 0
  }
  return { sucio, adelante }
}

/** Pruebas guardianas que leen documentos: el camino rápido de un cambio solo de .md. */
export const GUARDAS_DOCS = [
  'src/privacidadRepo.test.ts', 'src/dominioRepo.test.ts', 'src/walletRepo.test.ts', 'src/refProdEnPruebas.test.ts',
  'supabase/migraciones.test.ts', 'scripts/ci/sagrados.test.ts', 'scripts/ci/checks-protegidos.test.ts',
]

/** Archivos cambiados en la rama: contra la base (merge-base con origin/main), sin commitear y nuevos. */
export function archivosCambiados(raiz) {
  const base = (git(raiz, ['merge-base', 'HEAD', 'origin/main']) ?? '').trim() || 'HEAD'
  const lista = [
    ...(git(raiz, ['diff', '--name-only', base]) ?? '').split('\n'),
    ...(git(raiz, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n'),
  ]
  return [...new Set(lista.map(s => s.trim()).filter(Boolean))]
}

/** ¿Solo cambiaron .md? (lista vacía = no) */
export const soloDocs = archivos => archivos.length > 0 && archivos.every(a => a.toLowerCase().endsWith('.md'))

/** Huella del estado del árbol: HEAD + diff contra HEAD + archivos nuevos (con su contenido). */
export function huella(raiz) {
  const h = createHash('sha256')
  h.update(git(raiz, ['rev-parse', 'HEAD']) ?? '')
  h.update(git(raiz, ['diff', 'HEAD', '--binary']) ?? '')
  const nuevos = (git(raiz, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean)
  for (const n of nuevos) {
    h.update(n)
    h.update(git(raiz, ['hash-object', '--', n]) ?? '')
  }
  return h.digest('hex')
}

function rutaGit(raiz, nombre) {
  const p = (git(raiz, ['rev-parse', '--git-path', nombre]) ?? '').trim()
  return isAbsolute(p) ? p : join(raiz, p)
}

function leer(ruta) { try { return readFileSync(ruta, 'utf8').trim() } catch { return '' } }

/** ¿Las dependencias instaladas están al día con el lockfile? Entonces el gate puede saltar `npm ci`. */
export function dependenciasAlDia(raiz) {
  const ok = dir => {
    const lock = join(raiz, dir, 'package-lock.json')
    const inst = join(raiz, dir, 'node_modules', '.package-lock.json')
    return existsSync(lock) && existsSync(inst) && statSync(inst).mtimeMs >= statSync(lock).mtimeMs
  }
  return ok('.') && ok('club-web')
}

/**
 * @param {{ stopActivo: boolean, rondas: number }} e
 * @returns {'correr' | 'dejar-por-tope'}
 */
export function decidirRonda({ stopActivo, rondas }) {
  if (stopActivo && rondas >= TOPE_RONDAS) return 'dejar-por-tope'
  return 'correr'
}

/** Raíz del repo git que contiene `dir` (la sesión puede estar en un worktree), o null. */
function raizGit(dir) {
  if (!dir) return null
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

export function main() {
  let entrada = {}
  try { entrada = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { /* sin entrada */ }
  const raiz = raizGit(entrada.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (git(raiz, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') process.exit(0)
  if (!existsSync(join(raiz, 'scripts', 'ci', 'gate.sh'))) process.exit(0)

  const { sucio, adelante } = trabajoPendiente(raiz)
  if (!sucio && adelante === 0) process.exit(0)

  const archivoOk = rutaGit(raiz, 'satori-gate-ok')
  const archivoRondas = rutaGit(raiz, 'satori-stop-rondas')
  const estado = huella(raiz)
  if (leer(archivoOk) === estado) process.exit(0)

  const stopActivo = entrada.stop_hook_active === true
  const rondas = stopActivo ? Number(leer(archivoRondas)) || 0 : 0
  if (decidirRonda({ stopActivo, rondas }) === 'dejar-por-tope') {
    writeFileSync(archivoRondas, '0')
    process.stdout.write(JSON.stringify({
      systemMessage: `[satori gate] El gate sigue en FAIL después de ${TOPE_RONDAS} rondas: la sesión termina, pero NO hay entrega. Reportá la causa y lo descartado (satori-estandar-pr §12).`,
    }) + '\n')
    process.exit(0)
  }

  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  if (dependenciasAlDia(raiz)) env.GATE_SKIP_INSTALL = '1'
  const vitest = join(raiz, 'node_modules', '.bin', 'vitest')
  const rapido = soloDocs(archivosCambiados(raiz)) && existsSync(vitest)
  const r = rapido
    ? spawnSync(vitest, ['run', ...GUARDAS_DOCS.filter(f => existsSync(join(raiz, f)))], { cwd: raiz, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('bash', [join(raiz, 'scripts', 'ci', 'gate.sh')], { cwd: raiz, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')
  if (r.status === 0) {
    writeFileSync(archivoOk, estado)
    writeFileSync(archivoRondas, '0')
    process.exit(0)
  }
  writeFileSync(archivoRondas, String(rondas + 1))
  const motivo = sucio ? 'hay cambios sin commitear' : `hay ${adelante} commit(s) sin subir`
  process.stderr.write([
    `[satori gate] No termines todavía: ${motivo} y ${rapido ? 'las guardas de docs fallan' : 'el gate falla'} (ronda ${rondas + 1}/${TOPE_RONDAS}).`,
    ...salida.slice(-40),
  ].join('\n') + '\n')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
