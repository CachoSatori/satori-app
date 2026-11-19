// (19-nov, menores del #301) El evento `edited` de un PR también se dispara al cambiar el título o el cuerpo: ahí no hay nada
// nuevo que juzgar. ci.yml (Gate) y checks-protegidos.yml reaccionan a `edited` SOLO si cambió la base (`changes.base`).
// Mutación: sacar la condición `changes.base` del `if` del job → cae; sacar `edited` de `types` → cae (se perdería el re-apuntado de base).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const wf = (f: string) => readFileSync(resolve(__dirname, '../../.github/workflows', f), 'utf8')

describe.each([['ci.yml', 'gate'], ['checks-protegidos.yml', 'guarda']])('%s: `edited` solo con cambio de base', (archivo, job) => {
  const t = wf(archivo)
  it('escucha `edited`', () => {
    expect(t).toMatch(/types:\s*\[[^\]]*\bedited\b[^\]]*\]/)
  })
  it(`el job «${job}» tiene un \`if\` que deja pasar \`edited\` solo si viene \`changes.base\``, () => {
    const bloque = t.slice(t.indexOf(`\n  ${job}:`))
    const si = /^\s{4}if:\s*(.+)$/m.exec(bloque)?.[1] ?? ''
    expect(si).toContain("github.event.action != 'edited'")
    expect(si).toContain('github.event.changes.base != null')
  })
})
