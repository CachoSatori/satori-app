// Control del gate: ninguna marca (`.claude/*.local`) ni `.claude/settings.local.json` versionada, y `.gitignore` las cubre.
// Así ninguna rama puede traer una marca que `git switch` / `git reset --hard` escriba en .claude/ (ver guardia.mjs).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { marcasVersionadas, sinIgnorar } from './marcas-versionadas.mjs'

const RAIZ = resolve(__dirname, '..', '..')
const EJEMPLOS = ['.claude/sha-firmado.local', '.claude/ok-dueno-noche.local', '.claude/turno-prod.local', '.claude/migracion-firmada.local',
  '.claude/otra-marca.local', '.claude/settings.local.json']

describe('marcas versionadas (repo real)', () => {
  it('git ls-files de .claude/*.local y settings.local.json da vacío', () => {
    expect(marcasVersionadas(RAIZ)).toEqual([])
  })
  it('.gitignore ignora las marcas y settings.local.json', () => {
    expect(sinIgnorar(RAIZ, EJEMPLOS)).toEqual([])
  })
})

describe('el control muerde (repo temporal)', () => {
  let dir: string
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'marcas-'))
    git('init', '-q')
    mkdirSync(join(dir, '.claude'))
    copyFileSync(join(RAIZ, '.gitignore'), join(dir, '.gitignore'))
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}\n')
    git('add', '.gitignore', '.claude/settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sin marcas en el índice: vacío', () => {
    writeFileSync(join(dir, '.claude', 'sha-firmado.local'), 'x\n') // existe pero ignorada
    git('add', '.')
    expect(marcasVersionadas(dir)).toEqual([])
  })
  it('una marca agregada al índice con -f: la detecta', () => {
    writeFileSync(join(dir, '.claude', 'ok-dueno-noche.local'), 'x\n')
    git('add', '-f', '.claude/ok-dueno-noche.local')
    expect(marcasVersionadas(dir)).toEqual(['.claude/ok-dueno-noche.local'])
  })
  it('settings.local.json agregado con -f: lo detecta', () => {
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{}\n')
    git('add', '-f', '.claude/settings.local.json')
    expect(marcasVersionadas(dir)).toEqual(['.claude/settings.local.json'])
  })
  it('sin la regla en .gitignore, sinIgnorar la nombra', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
    expect(sinIgnorar(dir, ['.claude/sha-firmado.local', '.claude/settings.local.json'])).toEqual(['.claude/sha-firmado.local', '.claude/settings.local.json'])
  })
})
