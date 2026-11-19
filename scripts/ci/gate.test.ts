// Prueba de scripts/ci/gate.sh con herramientas simuladas (npx/npm/node falsos en el PATH, repo git descartable):
// rápida y sin tocar la app. Mutación: un paso que falla a propósito → «GATE: FAIL paso=…» y exit ≠ 0.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
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

  it('un paso extra que falla a propósito → GATE: FAIL con su nombre', () => {
    const r = correr({ GATE_PASOS_EXTRA: 'roto:exit 3' })
    expect(r.status).toBe(1)
    expect(r.ultima).toMatch(/^GATE: FAIL paso=roto /)
  })
})
