// (19-nov, ronda 2 del #304) El evento `edited` de un PR corre el Gate COMPLETO. Un `if` a nivel de job que lo salte deja el
// check en «Skipped», y un job saltado cuenta como «Success» para un check requerido; además la concurrency cancelaría el Gate en curso.
// Por eso ci.yml (job «gate») y checks-protegidos.yml (job «guarda») NO llevan `if` a nivel de job.
// Mutación nombrada: volver a poner `if:` bajo `gate:` o `guarda:` → cae; sacar `edited` de `types` → cae (se perdería el re-apuntado de base).
// (20-nov, menores del #304) Un `if:` a nivel de PASO salta el paso y el job termina «Success» igual: también cae. Y el comentario
// del bloque `on:` no puede volver a prometer un `if` que el job no tiene (quedó desactualizado tras la ronda 2 del #304).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const wf = (f: string) => readFileSync(resolve(__dirname, '../../.github/workflows', f), 'utf8')

/** Líneas `if:` a nivel de job (4 espacios) dentro del job `id`. */
export function ifsDeJob(yml: string, id: string): string[] {
  const l = yml.split('\n')
  const ini = l.findIndex(x => x === `  ${id}:`)
  if (ini < 0) throw new Error(`no hay job ${id}`)
  const fin = l.findIndex((x, i) => i > ini && /^ {0,2}\S/.test(x))
  return l.slice(ini + 1, fin < 0 ? undefined : fin).filter(x => /^ {4}if:/.test(x))
}

/** Líneas `if:` a nivel de paso (dentro de `steps:`, con o sin guion) dentro del job `id`. */
export function ifsDePaso(yml: string, id: string): string[] {
  const l = yml.split('\n')
  const ini = l.findIndex(x => x === `  ${id}:`)
  if (ini < 0) throw new Error(`no hay job ${id}`)
  const fin = l.findIndex((x, i) => i > ini && /^ {0,2}\S/.test(x))
  return l.slice(ini + 1, fin < 0 ? undefined : fin).filter(x => /^ {6,}(?:- +)?if:/.test(x))
}

/** Comentarios del bloque `on:` (líneas con sangría hasta la siguiente línea de primer nivel). */
export function comentariosDeOn(yml: string): string[] {
  const l = yml.split('\n')
  const ini = l.findIndex(x => x === 'on:')
  if (ini < 0) throw new Error('no hay bloque on:')
  const fin = l.findIndex((x, i) => i > ini && /^\S/.test(x))
  return l.slice(ini + 1, fin < 0 ? undefined : fin).filter(x => /^\s*#/.test(x))
}

describe.each([['ci.yml', 'gate'], ['checks-protegidos.yml', 'guarda']])('%s: `edited` corre completo', (archivo, job) => {
  const t = wf(archivo)
  it('escucha `edited`', () => {
    expect(t).toMatch(/types:\s*\[[^\]]*\bedited\b[^\]]*\]/)
  })
  it(`el job «${job}» no tiene \`if\` a nivel de job`, () => {
    expect(ifsDeJob(t, job)).toEqual([])
  })
  it(`el job «${job}» no tiene \`if\` a nivel de paso`, () => {
    expect(ifsDePaso(t, job)).toEqual([])
  })
  it('el comentario del bloque `on:` no habla de un `if` (el job no tiene)', () => {
    expect(comentariosDeOn(t).filter(c => /`if`|\bif:/.test(c))).toEqual([])
  })
})

it('control: la guarda sí detecta un `if` de job', () => {
  expect(ifsDeJob('jobs:\n  gate:\n    name: G\n    if: ${{ x }}\n    runs-on: u\n  otro:\n    if: y\n', 'gate')).toHaveLength(1)
})

it('control: la guarda sí detecta un `if` de paso (con y sin guion) y no confunde el de job', () => {
  const y = 'jobs:\n  gate:\n    if: a\n    steps:\n      - name: X\n        if: ${{ b }}\n        run: x\n      - if: c\n        run: y\n  otro:\n    steps:\n      - if: d\n'
  expect(ifsDePaso(y, 'gate')).toHaveLength(2)
  expect(ifsDeJob(y, 'gate')).toHaveLength(1)
})

it('control: los comentarios de `on:` se leen hasta la siguiente línea de primer nivel', () => {
  const y = 'name: X\non:\n  pull_request:\n    # edited: ver el `if` del job\n    types: [edited]\n# afuera\npermissions:\n  # tampoco\n'
  expect(comentariosDeOn(y)).toEqual(['    # edited: ver el `if` del job'])
})
