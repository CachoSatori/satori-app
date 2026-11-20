// PostToolUse de lint (scripts/hooks/lint-archivo.mjs) sobre un repo git descartable con un eslint.config mínimo y el
// eslint real del repo (node_modules enlazado): error nuevo → exit 2; deuda que ya estaba → 0; no-.ts → 0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HOOK = resolve(__dirname, 'lint-archivo.mjs')
const RAIZ_REPO = resolve(__dirname, '../..')
let raiz: string
const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...a], { cwd: raiz, encoding: 'utf8' })

function correr(ruta: string, herramienta = 'Edit') {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: herramienta, tool_input: { file_path: ruta }, cwd: raiz }),
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CLAUDE_PROJECT_DIR: raiz },
  })
}

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'lint-hook-'))
  symlinkSync(join(RAIZ_REPO, 'node_modules'), join(raiz, 'node_modules'))
  writeFileSync(join(raiz, 'eslint.config.js'), "export default [{ files: ['**/*.ts'], rules: { 'no-debugger': 'error' } }]\n")
  writeFileSync(join(raiz, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(raiz, 'viejo.ts'), 'debugger\nexport const a = 1\n')
  writeFileSync(join(raiz, 'limpio.ts'), 'export const b = 2\n')
  spawnSync('git', ['init', '-q'], { cwd: raiz })
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
})
afterAll(() => rmSync(raiz, { recursive: true, force: true }))

describe('lint del archivo tocado', () => {
  it('error nuevo en un archivo limpio → exit 2 con el error en stderr', () => {
    writeFileSync(join(raiz, 'limpio.ts'), 'export const b = 2\ndebugger\n')
    const r = correr(join(raiz, 'limpio.ts'))
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/limpio\.ts:2:1 .*no-debugger/)
    writeFileSync(join(raiz, 'limpio.ts'), 'export const b = 2\n')
    expect(correr(join(raiz, 'limpio.ts')).status).toBe(0)
  }, 30_000)

  it('archivo nuevo con error (Write) → exit 2', () => {
    writeFileSync(join(raiz, 'nuevo.ts'), 'debugger\n')
    expect(correr('nuevo.ts', 'Write').status).toBe(2)
    rmSync(join(raiz, 'nuevo.ts'))
  }, 30_000)

  it('deuda vieja que ya estaba en la base → no bloquea; sumar otro error sí', () => {
    writeFileSync(join(raiz, 'viejo.ts'), 'debugger\nexport const a = 3\n')
    expect(correr(join(raiz, 'viejo.ts')).status).toBe(0)
    writeFileSync(join(raiz, 'viejo.ts'), 'debugger\nexport const a = 3\ndebugger\n')
    expect(correr(join(raiz, 'viejo.ts')).status).toBe(2)
  }, 30_000)

  it('no-.ts, fuera del proyecto o inexistente → exit 0 sin lintear', () => {
    writeFileSync(join(raiz, 'notas.md'), 'debugger\n')
    expect(correr(join(raiz, 'notas.md')).status).toBe(0)
    expect(correr('/tmp/otro-proyecto/x.ts').status).toBe(0)
    expect(correr(join(raiz, 'no-existe.ts')).status).toBe(0)
  }, 30_000)
})
