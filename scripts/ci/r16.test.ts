// (19-nov, menores del #301) Prueba propia de R16 («toda migración NUEVA respecto de la base tiene un número mayor que
// `ultimo_ledger_prod`», en supabase/migraciones.test.ts) con un archivo RENOMBRADO.
// Por qué: `git diff --diff-filter=A` no ve un renombrado (lo informa como R, no como A), y un .sql que se renombra a un
// número viejo es justo la forma en que entra una migración fuera de orden. Acá se corre la prueba REAL de R16, sin copiarla,
// en un repo git descartable con una base conocida: si alguien vuelve a mirar solo los «A», la prueba del renombrado deja de caer.
// Mutación: en supabase/migraciones.test.ts reemplazar el cálculo de `nuevas` por
//   `git diff --name-only --diff-filter=A <base> -- supabase/migrations/` → cae «un renombrado a un número viejo no pasa inadvertido».
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const RAIZ = resolve(__dirname, '..', '..')
let d = ''
let base = ''

const git = (...a: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...a], { cwd: d, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const sql = (n: string) => writeFileSync(join(d, 'supabase/migrations', n), '-- prueba\nselect 1;\n')

/** Corre SOLO la prueba R16 real (supabase/migraciones.test.ts copiada tal cual) en el repo descartable; devuelve su estado. */
function r16(): 'passed' | 'failed' | 'sin-prueba' {
  const r = spawnSync(process.execPath, [join(RAIZ, 'node_modules/vitest/vitest.mjs'), 'run', '--root', d, '--config', join(d, 'vitest.config.mjs'), 'supabase/migraciones.test.ts', '-t', 'R16', '--reporter=json'], {
    cwd: d, encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GATE_BASE: base },
  })
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  const t = (j.testResults?.[0]?.assertionResults ?? []).find((x: { title: string }) => x.title.startsWith('R16'))
  return t ? t.status : 'sin-prueba'
}

describe('R16 con archivos nuevos y renombrados (repo descartable)', () => {
  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), 'r16-'))
    git('init', '-q')
    mkdirSync(join(d, 'supabase/migrations'), { recursive: true })
    copyFileSync(join(RAIZ, 'supabase/migraciones.test.ts'), join(d, 'supabase/migraciones.test.ts'))
    writeFileSync(join(d, 'supabase/migraciones-reservadas.json'), JSON.stringify({
      ultimo_ledger_prod: 194, bloques: {}, usadas_antes_de_los_bloques: {}, libres_fuera_de_bloque: [], asignadas: {},
    }))
    writeFileSync(join(d, 'vitest.config.mjs'), 'export default { test: { include: ["supabase/*.test.ts"] } }\n')
    symlinkSync(join(RAIZ, 'node_modules'), join(d, 'node_modules'))
    writeFileSync(join(d, '.gitignore'), 'node_modules\n')
    sql('193_vieja.sql'); sql('194_ultima.sql')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    base = git('rev-parse', 'HEAD')
  }, 60_000)
  afterAll(() => rmSync(d, { recursive: true, force: true }))

  it('control: sin cambios contra la base, R16 pasa', () => {
    expect(r16()).toBe('passed')
  }, 90_000)

  it('una migración nueva con número mayor al ledger pasa', () => {
    sql('195_nueva.sql')
    expect(r16()).toBe('passed')
    rmSync(join(d, 'supabase/migrations/195_nueva.sql'))
  }, 90_000)

  it('una migración nueva con número ≤ al ledger cae', () => {
    sql('150_vieja_nueva.sql')
    expect(r16()).toBe('failed')
    rmSync(join(d, 'supabase/migrations/150_vieja_nueva.sql'))
  }, 90_000)

  it('un renombrado a un número viejo no pasa inadvertido (git lo informa como R, no como A)', () => {
    git('mv', 'supabase/migrations/194_ultima.sql', 'supabase/migrations/120_ultima.sql')
    // sanity: es un renombrado de verdad para git, y `--diff-filter=A` no lo ve
    git('add', '-A')
    expect(git('diff', '--cached', '--name-status', '-M', base)).toMatch(/^R\d+\t.*194_ultima\.sql\t.*120_ultima\.sql/m)
    expect(git('diff', '--cached', '--name-only', '--diff-filter=A', base)).toBe('')
    expect(r16()).toBe('failed')
  }, 90_000)
})
