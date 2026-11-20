// Hooks de cierre sobre repos git descartables con herramientas simuladas:
//   · TaskCompleted (tests-tarea.mjs): vitest related falso; falla → exit 2 con solo las líneas de falla.
//   · Stop (gate-stop.mjs): gate.sh falso; sin trabajo no corre; con trabajo y FAIL → exit 2; tope de 3 rondas con
//     stop_hook_active; verde se recuerda para el mismo árbol.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const TESTS = resolve(__dirname, 'tests-tarea.mjs')
const STOP = resolve(__dirname, 'gate-stop.mjs')
let raiz: string
const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...a], { cwd: raiz, encoding: 'utf8' })
function ejecutable(ruta: string, cuerpo: string) {
  mkdirSync(join(raiz, ruta, '..'), { recursive: true })
  writeFileSync(join(raiz, ruta), `#!/usr/bin/env bash\n${cuerpo}\n`)
  chmodSync(join(raiz, ruta), 0o755)
}
function correr(script: string, entrada: object) {
  return spawnSync('node', [script], {
    input: JSON.stringify({ cwd: raiz, ...entrada }), encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CLAUDE_PROJECT_DIR: raiz },
  })
}
const corridas = () => (existsSync(join(raiz, 'corridas')) ? readFileSync(join(raiz, 'corridas'), 'utf8').trim().split('\n').length : 0)

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'cierre-hook-'))
  spawnSync('git', ['init', '-q', '-b', 'claude/tema'], { cwd: raiz })
  writeFileSync(join(raiz, '.gitignore'), 'node_modules\ncorridas\nresultado\n')
  writeFileSync(join(raiz, 'a.ts'), 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD') // origin/main = base
})
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

describe('TaskCompleted: pruebas relacionadas', () => {
  beforeEach(() => {
    // vitest falso: anota la corrida; falla si existe el archivo «resultado» con FAIL.
    ejecutable('node_modules/.bin/vitest', 'echo "$@" >> corridas; if [ -f resultado ]; then echo "ruido de progreso"; echo " FAIL  src/x.test.ts > cae"; echo " Tests  1 failed | 3 passed (4)"; exit 1; fi; echo " Tests  4 passed (4)"')
  })
  it('sin cambios en la rama → exit 0 sin correr vitest', () => {
    expect(correr(TESTS, { task_subject: 'x' }).status).toBe(0)
    expect(corridas()).toBe(0)
  })
  it('con cambios y pruebas verdes → exit 0, corre vitest related sobre lo tocado', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 2\n')
    writeFileSync(join(raiz, 'b.ts'), 'export const b = 1\n')
    expect(correr(TESTS, {}).status).toBe(0)
    expect(readFileSync(join(raiz, 'corridas'), 'utf8')).toMatch(/^related --run --passWithNoTests (a\.ts b\.ts|b\.ts a\.ts)/)
  })
  it('una prueba cae → exit 2 y solo las líneas de falla', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 2\n')
    writeFileSync(join(raiz, 'resultado'), 'x')
    const r = correr(TESTS, { task_subject: 'Arreglar caja' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/«Arreglar caja»/)
    expect(r.stderr).toContain('FAIL  src/x.test.ts')
    expect(r.stderr).not.toContain('ruido de progreso')
  })
})

describe('Stop: gate si hay trabajo sin entregar', () => {
  beforeEach(() => {
    // gate falso: anota la corrida; falla si existe «resultado».
    ejecutable('scripts/ci/gate.sh', 'echo x >> corridas; if [ -f resultado ]; then echo "GATE: FAIL paso=vitest sha=1234abcd"; exit 1; fi; echo "GATE: PASS sha=1234abcd tests=1 lint=0/0 build=ok"')
    git('add', '-A')
    git('commit', '-q', '-m', 'gate')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  })
  it('árbol limpio y sin commits por delante → exit 0 sin correr el gate', () => {
    expect(correr(STOP, { stop_hook_active: false }).status).toBe(0)
    expect(corridas()).toBe(0)
  })
  it('cambios sin commitear y gate FAIL → exit 2 con la línea GATE', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 9\n')
    writeFileSync(join(raiz, 'resultado'), 'x')
    const r = correr(STOP, { stop_hook_active: false })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/GATE: FAIL paso=vitest/)
    expect(r.stderr).toMatch(/ronda 1\/3/)
  })
  it('commit local por delante de origin (sin upstream) → corre el gate', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 9\n')
    git('commit', '-qam', 'local')
    writeFileSync(join(raiz, 'resultado'), 'x')
    expect(correr(STOP, {}).status).toBe(2)
  })
  it('tope de 3 rondas con stop_hook_active: la cuarta deja terminar con aviso (sin bucle)', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 9\n')
    writeFileSync(join(raiz, 'resultado'), 'x')
    expect(correr(STOP, { stop_hook_active: false }).status).toBe(2)
    expect(correr(STOP, { stop_hook_active: true }).status).toBe(2)
    expect(correr(STOP, { stop_hook_active: true }).status).toBe(2)
    const r = correr(STOP, { stop_hook_active: true })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).systemMessage).toMatch(/3 rondas/)
    expect(corridas()).toBe(3)
    // un turno nuevo (sin stop_hook_active) vuelve a contar desde cero
    expect(correr(STOP, { stop_hook_active: false }).status).toBe(2)
  })
  it('gate verde se recuerda para el mismo árbol; si cambia, se vuelve a correr', () => {
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 9\n')
    expect(correr(STOP, {}).status).toBe(0)
    expect(correr(STOP, {}).status).toBe(0)
    expect(corridas()).toBe(1)
    writeFileSync(join(raiz, 'a.ts'), 'export const a = 10\n')
    writeFileSync(join(raiz, 'resultado'), 'x')
    expect(correr(STOP, {}).status).toBe(2)
    expect(corridas()).toBe(2)
  })
})
