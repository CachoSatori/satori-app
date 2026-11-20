#!/usr/bin/env node
// PostToolUse de Edit/Write/MultiEdit sobre .ts/.tsx: eslint SOLO del archivo tocado. Si el archivo tiene más errores
// que en la base (merge-base con origin/main, o HEAD), exit 2 y los errores a stderr (el modelo los ve y los arregla).
// Se compara contra la base porque el repo arrastra deuda de lint (scripts/ci/lint-linea-base.json): tocar un archivo
// viejo no obliga a limpiarlo entero, pero no se puede sumar un error. Un archivo nuevo no puede tener ninguno.
// Sin node_modules (no se corrió npm ci) avisa y no bloquea (exit 1).
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Ruta del archivo tocado según la herramienta (Edit, Write, MultiEdit). */
export function archivoTocado(entrada) {
  const ti = entrada?.tool_input ?? {}
  return ti.file_path ?? entrada?.tool_response?.filePath ?? null
}

/** @returns {{ tipo: 'saltar' } | { tipo: 'lint', abs: string, rel: string }} */
export function decidirArchivo(ruta, raiz) {
  if (!ruta || !/\.(ts|tsx)$/.test(ruta)) return { tipo: 'saltar' }
  const abs = isAbsolute(ruta) ? ruta : resolve(raiz, ruta)
  const rel = relative(raiz, abs)
  if (rel.startsWith('..') || isAbsolute(rel) || /(^|\/)(node_modules|dist)\//.test(rel)) return { tipo: 'saltar' }
  if (!existsSync(abs)) return { tipo: 'saltar' }
  return { tipo: 'lint', abs, rel }
}

function git(raiz, args) {
  const r = spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

/** Contenido del archivo en la base de la rama (merge-base con origin/main; si no hay, HEAD). null = archivo nuevo. */
export function textoBase(raiz, rel) {
  const base = git(raiz, ['merge-base', 'HEAD', 'origin/main'])?.trim() || 'HEAD'
  return git(raiz, ['show', `${base}:${rel}`])
}

export async function lintear(raiz, abs, rel) {
  let ESLint
  try {
    const req = createRequire(join(raiz, 'package.json'))
    ;({ ESLint } = await import(pathToFileURL(req.resolve('eslint')).href))
  } catch {
    return { sinEslint: true }
  }
  const eslint = new ESLint({ cwd: raiz })
  if (await eslint.isPathIgnored(abs)) return { ignorado: true }
  const [actual] = await eslint.lintFiles([abs])
  const viejo = textoBase(raiz, rel)
  let erroresBase = 0
  if (viejo !== null) {
    const [r] = await eslint.lintText(viejo, { filePath: abs })
    erroresBase = r?.errorCount ?? 0
  }
  return {
    errores: actual.errorCount,
    erroresBase,
    mensajes: actual.messages.filter(m => m.severity === 2).map(m => `${rel}:${m.line}:${m.column} ${m.message} (${m.ruleId ?? 'parse'})`),
  }
}

/** Raíz del repo git que contiene `dir` (la sesión puede estar en un worktree), o null. */
function raizGit(dir) {
  if (!dir) return null
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

export async function main() {
  let entrada = {}
  try { entrada = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { /* sin entrada */ }
  const ruta = archivoTocado(entrada)
  const base = process.env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd()
  const raiz = raizGit(ruta && isAbsolute(ruta) ? dirname(ruta) : base) || base
  const d = decidirArchivo(ruta, raiz)
  if (d.tipo === 'saltar') process.exit(0)
  const r = await lintear(raiz, d.abs, d.rel)
  if (r.sinEslint) {
    process.stderr.write('[satori lint] no encuentro eslint (¿falta npm ci?): no se revisó el archivo.\n')
    process.exit(1)
  }
  if (r.ignorado || r.errores <= r.erroresBase) process.exit(0)
  const lineas = [
    `[satori lint] ${d.rel}: ${r.errores} error(es) de eslint (en la base: ${r.erroresBase}). Arreglalos antes de seguir:`,
    ...r.mensajes.slice(0, 30),
  ]
  process.stderr.write(lineas.join('\n') + '\n')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
