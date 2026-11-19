// (19-nov, ronda 2 del #304) El evento `edited` de un PR corre el Gate COMPLETO. Un `if` a nivel de job que lo salte deja el
// check en «Skipped», y un job saltado cuenta como «Success» para un check requerido; además la concurrency cancelaría el Gate en curso.
// Por eso ci.yml (job «gate») y checks-protegidos.yml (job «guarda») NO llevan `if` a nivel de job.
// Mutación nombrada: volver a poner `if:` bajo `gate:` o `guarda:` → cae; sacar `edited` de `types` → cae (se perdería el re-apuntado de base).
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

describe.each([['ci.yml', 'gate'], ['checks-protegidos.yml', 'guarda']])('%s: `edited` corre completo', (archivo, job) => {
  const t = wf(archivo)
  it('escucha `edited`', () => {
    expect(t).toMatch(/types:\s*\[[^\]]*\bedited\b[^\]]*\]/)
  })
  it(`el job «${job}» no tiene \`if\` a nivel de job`, () => {
    expect(ifsDeJob(t, job)).toEqual([])
  })
})

it('control: la guarda sí detecta un `if` de job', () => {
  expect(ifsDeJob('jobs:\n  gate:\n    name: G\n    if: ${{ x }}\n    runs-on: u\n  otro:\n    if: y\n', 'gate')).toHaveLength(1)
})
