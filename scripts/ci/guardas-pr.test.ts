// Guardas R04 y R14 (scripts/ci/guardas-pr.mjs) sobre repos git descartables: cada una cae con su mutación y pasa sin ella.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error módulo .mjs sin tipos
import { evaluar, parsearNameStatus } from './guardas-pr.mjs'

const SCRIPT = resolve(__dirname, 'guardas-pr.mjs')
let raiz: string

const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...a], { cwd: raiz, encoding: 'utf8' })
function escribir(ruta: string, texto: string) { mkdirSync(dirname(join(raiz, ruta)), { recursive: true }); writeFileSync(join(raiz, ruta), texto) }
function commit(msg: string) { git('add', '-A'); git('commit', '-q', '-m', msg) }
const REGISTRO = {
  asignadas: { '153': { nombre: 'alias', bloque: 'pase', origen: '096' } },
}
function correr(env: Record<string, string> = {}) {
  const base = git('rev-parse', 'base').stdout.trim()
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GATE_ROOT: raiz, GATE_BASE: base, ...env } })
  return { status: r.status, salida: r.stdout + r.stderr }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'guardas-pr-'))
  git('init', '-q', '-b', 'main')
  escribir('supabase/migraciones-reservadas.json', JSON.stringify(REGISTRO))
  escribir('supabase/migrations/096_alias.sql', 'select 1;')
  escribir('supabase/migrations/100_otra.sql', 'select 2;')
  escribir('supabase/functions/x/index.ts', 'export {}')
  commit('base')
  git('tag', 'base')
})
afterEach(() => rmSync(raiz, { recursive: true, force: true }))

describe('guardas-pr: R04 (supabase/functions)', () => {
  it('sin cambios en supabase/ → pasa', () => {
    escribir('src/a.ts', 'x'); commit('a')
    expect(correr().status).toBe(0)
  })
  it('mutación: tocar un archivo de supabase/functions → cae con mensaje que dice cómo arreglarlo', () => {
    escribir('supabase/functions/x/index.ts', 'export const a = 1'); commit('toca edge')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/R04/)
    expect(r.salida).toMatch(/ítem 11/)
    expect(r.salida).toMatch(/ok-dueno-edge/)
  })
  it('la etiqueta ok-dueno-edge levanta la guarda (y otras etiquetas no)', () => {
    escribir('supabase/functions/y/index.ts', 'export {}'); commit('nueva edge')
    expect(correr({ GATE_LABELS: 'otra,ok-dueno-edge' }).status).toBe(0)
    expect(correr({ GATE_LABELS: 'ok-dueno-checks' }).status).toBe(1)
  })
})

describe('guardas-pr: R14 (migraciones que ya existían)', () => {
  it('agregar una migración nueva → pasa', () => {
    escribir('supabase/migrations/195_nueva.sql', 'select 3;'); commit('nueva')
    expect(correr().status).toBe(0)
  })
  it('mutación: editar un .sql existente → cae', () => {
    escribir('supabase/migrations/100_otra.sql', 'select 99;'); commit('edita')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/R14.*modifica supabase\/migrations\/100_otra\.sql/)
    expect(r.salida).toMatch(/migración NUEVA/)
  })
  it('mutación: borrar un .sql existente → cae', () => {
    rmSync(join(raiz, 'supabase/migrations/100_otra.sql')); commit('borra')
    expect(correr().status).toBe(1)
  })
  it('mutación: renombrar un .sql existente sin registro → cae', () => {
    renameSync(join(raiz, 'supabase/migrations/100_otra.sql'), join(raiz, 'supabase/migrations/160_otra.sql')); commit('renombra')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/renombra/)
  })
  it('renumeración registrada con «origen» (096 → 153) → pasa', () => {
    renameSync(join(raiz, 'supabase/migrations/096_alias.sql'), join(raiz, 'supabase/migrations/153_alias.sql')); commit('pase')
    expect(correr().status).toBe(0)
  })
  it('renumeración a un número distinto del registrado → cae', () => {
    renameSync(join(raiz, 'supabase/migrations/096_alias.sql'), join(raiz, 'supabase/migrations/154_alias.sql')); commit('pase mal')
    expect(correr().status).toBe(1)
  })
})

describe('guardas-pr: sin base', () => {
  it('sin GATE_BASE ni origin/main → se salta y lo dice', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GATE_ROOT: raiz } })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/sin base/)
  })
})

describe('guardas-pr: funciones puras', () => {
  it('parsearNameStatus entiende renombres', () => {
    expect(parsearNameStatus('R100\ta.sql\tb.sql\nM\tc.sql')).toEqual([
      { estado: 'R', ruta: 'b.sql', anterior: 'a.sql' }, { estado: 'M', ruta: 'c.sql' },
    ])
  })
  it('evaluar sin cambios → sin problemas', () => {
    expect(evaluar({ cambios: [], etiquetas: [], registro: JSON.parse(readFileSync(join(raiz, 'supabase/migraciones-reservadas.json'), 'utf8')) })).toEqual([])
  })
})
