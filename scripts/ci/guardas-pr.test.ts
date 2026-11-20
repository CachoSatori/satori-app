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

describe('guardas-pr: R04 (supabase/config.toml)', () => {
  it('mutación: tocar supabase/config.toml → cae', () => {
    escribir('supabase/config.toml', 'a = 1'); commit('config')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/R04.*config\.toml/)
  })
})

describe('guardas-pr: R04 con supabase/config.toml presente (ítem 11)', () => {
  const OK = '[functions.x]\nverify_jwt = true\n'
  it('config en regla (cada función con su verify_jwt) → pasa, también para un PR que solo toca código de Edge', () => {
    escribir('supabase/config.toml', OK); commit('config')
    expect(correr().status).toBe(0)
    git('tag', '-f', 'base')
    escribir('supabase/functions/x/index.ts', 'export const b = 2'); commit('toca edge')
    expect(correr().status).toBe(0)
  })
  it('mutación: una función sin su [functions.<slug>] → cae y nombra la carpeta', () => {
    escribir('supabase/config.toml', OK); escribir('supabase/functions/nueva/index.ts', 'export {}'); commit('nueva sin bloque')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/R04: supabase\/functions\/nueva\//)
  })
  it('mutación: verify_jwt ausente en el bloque → cae', () => {
    escribir('supabase/config.toml', '[functions.x]\n'); commit('sin verify_jwt')
    expect(correr().status).toBe(1)
  })
  it('mutación: ingest-ndf o club-pase con verify_jwt = true → cae (401 en cada llamada)', () => {
    escribir('supabase/functions/ingest-ndf/index.ts', 'export {}')
    escribir('supabase/config.toml', OK + '[functions.ingest-ndf]\nverify_jwt = true\n'); commit('ingest true')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/ingest-ndf.*verify_jwt = false/)
    escribir('supabase/config.toml', OK + '[functions.ingest-ndf]\nverify_jwt = false\n'); commit('ingest false')
    expect(correr().status).toBe(0)
  })
  it('mutación: bloque sin carpeta → cae', () => {
    escribir('supabase/config.toml', OK + '[functions.fantasma]\nverify_jwt = true\n'); commit('huerfano')
    expect(correr().status).toBe(1)
  })
  it('lista blanca: [remotes] escrito con puntos o en línea, entrypoint y enabled → cae; project_id arriba → pasa', () => {
    const casos = [
      'remotes.prod.project_id = "ref-ficticio"\n' + OK,
      'remotes = { prod = { project_id = "ref-ficticio" } }\n' + OK,
      OK + '[functions.x.remotes]\nproject_id = "ref-ficticio"\n',
      '[functions.x]\nverify_jwt = true\nentrypoint = "./otro.ts"\n',
      '[functions.x]\nverify_jwt = true\nenabled = false\n',
      '[functions.x]\nverify_jwt = true\nfunctions.x.enabled = false\n',
      '[[functions.x]]\nverify_jwt = true\n',
      'functions = { x = { verify_jwt = true } }\n',
    ]
    casos.forEach((texto, i) => {
      escribir('supabase/config.toml', texto); commit(`caso ${i}`)
      const r = correr()
      expect(r.status, `caso ${i}: ${texto}`).toBe(1)
      expect(r.salida).toMatch(/R04: supabase\/config\.toml/)
    })
    escribir('supabase/config.toml', 'project_id = "satori-app"\n' + OK); commit('project_id')
    expect(correr().status).toBe(0)
  })
  it('mutación: [remotes.*] → cae (aplicaría [auth]/[api] a otro proyecto)', () => {
    escribir('supabase/config.toml', OK + '[remotes.prod]\nproject_id = "ref-ficticio"\n'); commit('remotes')
    const r = correr()
    expect(r.status).toBe(1)
    expect(r.salida).toMatch(/remotes/)
  })
})

describe('guardas-pr: PR atrasado (la base es la cabeza ACTUAL de main, HEAD^1 de la fusión)', () => {
  // main avanza con una Edge y una migración DESPUÉS de que el PR salió; el PR solo toca src/. El CI corre sobre la fusión.
  function armar() {
    git('switch', '-q', '-c', 'pr')
    escribir('src/solo.ts', 'x'); commit('pr: solo src')
    git('switch', '-q', 'main')
    escribir('supabase/functions/x/index.ts', 'export const nuevo = 1')
    escribir('supabase/migrations/190_entro_a_main.sql', 'select 5;'); commit('main avanza')
    git('merge', '-q', '--no-ff', '-m', 'fusion', 'pr')
  }
  it('con base = HEAD^1 de la fusión → pasa; con el base.sha viejo habría dado falso R04', () => {
    armar()
    const viejo = git('rev-parse', 'base').stdout.trim()
    expect(correr({ GATE_BASE: viejo }).status).toBe(1) // el falso positivo que se corrige
    const base = git('rev-parse', 'HEAD^1').stdout.trim()
    expect(correr({ GATE_BASE: base }).status).toBe(0)
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
  const sinBase = (env: Record<string, string> = {}) =>
    spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GATE_ROOT: raiz, ...env } })
  it('sin GATE_BASE ni origin/main (local o push a main) → se salta, con AVISO', () => {
    const r = sinBase()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^guardas-pr: AVISO sin base/m)
  })
  it('mutación: en el CI de un PR, sin base es FAIL (no se salta en silencio)', () => {
    const r = sinBase({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request' })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/FALLA/)
  })
  it('en el CI de un push a main (sin base por diseño) → se salta con AVISO, no falla', () => {
    const r = sinBase({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/AVISO sin base/)
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
