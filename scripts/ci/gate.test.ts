// Prueba de scripts/ci/gate.sh con herramientas simuladas (npx/npm/node falsos en el PATH, repo git descartable):
// rápida y sin tocar la app. Mutación: un paso que falla a propósito → «GATE: FAIL paso=…» y exit ≠ 0.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const GATE = resolve(__dirname, 'gate.sh')
let raiz: string

function falso(nombre: string, cuerpo: string) {
  const f = join(raiz, 'bin', nombre)
  writeFileSync(f, `#!/usr/bin/env bash\n${cuerpo}\n`)
  chmodSync(f, 0o755)
}

function correr(env: Record<string, string> = {}) {
  const r = spawnSync('bash', [GATE], {
    encoding: 'utf8',
    env: { PATH: `${join(raiz, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME ?? '', GATE_ROOT: raiz, GATE_SKIP_INSTALL: '1', GATE_LOGS: join(raiz, 'logs'), ...env },
  })
  const lineas = r.stdout.trim().split('\n')
  return { status: r.status, ultima: lineas[lineas.length - 1], salida: r.stdout }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'gate-test-'))
  mkdirSync(join(raiz, 'bin'))
  spawnSync('git', ['init', '-q'], { cwd: raiz })
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: raiz })
  // npx: tsc ok, vite build crea dist/, vitest imprime resumen.
  falso('npx', 'case "$1" in vite) mkdir -p dist; echo built;; vitest) echo " Tests  7 passed (7)";; *) echo ok;; esac')
  falso('npm', 'echo ok')
  falso('node', 'echo "eslint: 5 problemas (0 errores, 5 advertencias) · línea base: 9"')
})
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

describe('gate.sh', () => {
  it('todo verde → última línea GATE: PASS con sha, tests, lint y build', () => {
    const r = correr()
    expect(r.status).toBe(0)
    expect(r.ultima).toMatch(/^GATE: PASS sha=[0-9a-f]{7,8} tests=7 lint=5\/9 build=ok$/)
  })

  it('mutación: vitest falla → GATE: FAIL paso=vitest y exit 1, mostrando solo las líneas de falla', () => {
    falso('npx', 'case "$1" in vite) mkdir -p dist;; vitest) echo " FAIL  src/x.test.ts > prueba"; echo "ruido de progreso"; echo " Tests  1 failed | 6 passed (7)"; exit 1;; esac')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=vitest sha=[0-9a-f]{7,8}$/)
    expect(r.salida).toContain('FAIL  src/x.test.ts')
    expect(r.salida).not.toContain('ruido de progreso')
  })

  it('mutación: diagnóstico de staging en dist/ → GATE: FAIL paso=anti-diagnostico', () => {
    falso('npx', 'case "$1" in vite) mkdir -p dist; echo armBootHang > dist/a.js;; esac')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=anti-diagnostico /)
  })

  it('mutación: tsc falla → GATE: FAIL paso=tsc y exit 1', () => {
    falso('npx', 'case "$1" in tsc) echo "src/x.ts(3,1): error TS2322: tipo mal"; exit 2;; vite) mkdir -p dist;; vitest) echo " Tests  7 passed (7)";; esac')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=tsc sha=[0-9a-f]{7,8}$/)
    expect(r.salida).toContain('TS2322')
  })

  it('mutación: lint sube → GATE: FAIL paso=lint y muestra archivo y línea del error aunque pasen de 60 líneas', () => {
    const relleno = Array.from({ length: 80 }, (_, i) => `  ${i + 1}:1  warning  relleno  regla-x`).join('\n')
    falso('node', `case "$1" in *guardas-pr*) exit 0;; esac
echo "eslint: 99 problemas (1 errores, 98 advertencias) · línea base: 9"
echo "/repo/src/relleno.ts"; cat <<'X'
${relleno}
X
echo "/repo/src/roto.ts"; echo "  42:7  error  variable sin usar  no-unused-vars"
echo "::error title=Lint::subió"; exit 1`)
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=lint /)
    expect(r.salida).toContain('/repo/src/roto.ts')
    expect(r.salida).toContain('42:7  error')
    expect(r.salida).toContain('::error title=Lint')
  })

  it('mutación: sin conteo de tests (tests=?) → GATE: FAIL, no PASS', () => {
    falso('npx', 'case "$1" in vite) mkdir -p dist;; vitest) echo "todo bien pero sin resumen";; esac')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=vitest-conteo /)
  })

  it('mutación: sin conteo de lint (lint=?/?) → GATE: FAIL, no PASS', () => {
    falso('node', 'case "$1" in *guardas-pr*) exit 0;; esac; echo "eslint sin el formato esperado"')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=lint-conteo /)
  })

  it('en CI, sha= es GATE_SHA (cabeza del PR), no el commit de fusión', () => {
    const r = correr({ GATE_SHA: 'abcdef0123456789abcdef0123456789abcdef01' })
    expect(r.status).toBe(0)
    expect(r.ultima).toMatch(/^GATE: PASS sha=abcdef01 /)
  })

  it('en el CI de un PR, GATE_BASE = HEAD^1 de la fusión (cabeza actual de main), no el base.sha del evento', () => {
    spawnSync('git', ['switch', '-q', '-c', 'pr'], { cwd: raiz })
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', 'commit', '-q', '--allow-empty', '-m', 'pr'], { cwd: raiz })
    spawnSync('git', ['switch', '-q', '-'], { cwd: raiz })
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', 'commit', '-q', '--allow-empty', '-m', 'main avanza'], { cwd: raiz })
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', 'merge', '-q', '--no-ff', '-m', 'fusion', 'pr'], { cwd: raiz })
    const padre = spawnSync('git', ['rev-parse', 'HEAD^1'], { cwd: raiz, encoding: 'utf8' }).stdout.trim()
    falso('node', 'case "$1" in *guardas-pr*) echo "base=$GATE_BASE" > "$GATE_LOGS/../base.txt"; exit 0;; esac; echo "eslint: 5 problemas (0 errores, 5 advertencias) · línea base: 9"')
    const r = correr({ GITHUB_EVENT_NAME: 'pull_request', GATE_BASE: '' })
    expect(r.status).toBe(0)
    expect(readFileSync(join(raiz, 'base.txt'), 'utf8').trim()).toBe(`base=${padre}`)
  })

  it('un paso extra que falla a propósito → GATE: FAIL con su nombre', () => {
    const r = correr({ GATE_PASOS_EXTRA: 'roto:exit 3' })
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=roto /)
  })
})
