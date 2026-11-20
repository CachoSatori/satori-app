#!/usr/bin/env node
// TaskCompleted: al marcar una tarea como completada corre `vitest related` sobre lo que cambió en la rama
// (diff contra el merge-base con origin/main, más lo sin commitear y los archivos nuevos). Si alguna prueba cae,
// exit 2 (la tarea no se marca completa) y a stderr van solo las líneas de falla.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CODIGO = /\.(ts|tsx|mts|mjs|js|jsx)$/

function git(raiz, args) {
  const r = spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : ''
}

/** Archivos de código tocados en la rama (existentes). */
export function archivosCambiados(raiz) {
  const base = git(raiz, ['merge-base', 'HEAD', 'origin/main']).trim() || 'HEAD'
  const lista = [
    ...git(raiz, ['diff', '--name-only', base]).split('\n'),
    ...git(raiz, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ]
  return [...new Set(lista.map(s => s.trim()).filter(s => s && CODIGO.test(s) && !/(^|\/)(node_modules|dist)\//.test(s)))]
    .filter(s => existsSync(join(raiz, s)))
}

/** Solo las líneas de falla de la salida de vitest (mismo filtro que gate.sh). */
export function lineasDeFalla(salida) {
  const lineas = salida.split('\n')
  const fallas = lineas.filter(l => /^\s*(FAIL|×|✗|AssertionError|Error:)|Test Files|Tests /.test(l)).slice(0, 60)
  return fallas.length ? fallas : lineas.filter(l => l.trim()).slice(-20)
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
  if (!existsSync(join(raiz, 'node_modules', '.bin', 'vitest'))) {
    process.stderr.write('[satori tests] no encuentro vitest (¿falta npm ci?): no se corrieron las pruebas relacionadas.\n')
    process.exit(1)
  }
  const archivos = archivosCambiados(raiz)
  if (archivos.length === 0) process.exit(0)
  const r = spawnSync(join(raiz, 'node_modules', '.bin', 'vitest'), ['related', '--run', '--passWithNoTests', ...archivos], {
    cwd: raiz, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status === 0) process.exit(0)
  const tarea = entrada.task_subject ? ` («${entrada.task_subject}»)` : ''
  process.stderr.write([
    `[satori tests] La tarea${tarea} no se cierra: fallan pruebas relacionadas con lo que cambiaste.`,
    ...lineasDeFalla(`${r.stdout ?? ''}\n${r.stderr ?? ''}`),
  ].join('\n') + '\n')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
