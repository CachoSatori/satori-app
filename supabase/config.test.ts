// Gate de supabase/config.toml (ítem 11 / SEC-02b).
//
// · Cada Edge Function del repo tiene su sección [functions.<nombre>] con verify_jwt explícito: si
//   falta, Branching la despliega con el default (true) sin que nadie lo haya decidido.
// · ingest-ndf, el día que llegue a main, va con verify_jwt = false EN EL MISMO PR: el agente del PoS
//   manda x-ingest-secret, no un JWT; con true recibe 401 en cada ciclo (decisión de Ismael, 08/11).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = __dirname
const toml = readFileSync(join(RAIZ, 'config.toml'), 'utf8')

/** verify_jwt de cada [functions.X] (true/false), o undefined si la sección no lo dice. */
function verifyJwt(): Record<string, boolean | undefined> {
  const out: Record<string, boolean | undefined> = {}
  let actual: string | null = null
  for (const linea of toml.split('\n')) {
    const l = linea.replace(/#.*/, '').trim()
    const sec = /^\[functions\.([A-Za-z0-9_-]+)\]$/.exec(l)
    if (sec) { actual = sec[1]; out[actual] = undefined; continue }
    if (/^\[/.test(l)) { actual = null; continue }
    const v = /^verify_jwt\s*=\s*(true|false)$/.exec(l)
    if (v && actual) out[actual] = v[1] === 'true'
  }
  return out
}

function funciones(): string[] {
  const dir = join(RAIZ, 'functions')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => !f.startsWith('_') && !f.startsWith('.') && statSync(join(dir, f)).isDirectory())
}

describe('config.toml · verify_jwt por función', () => {
  const cfg = verifyJwt()

  it('cada función del repo tiene verify_jwt explícito', () => {
    const sin = funciones().filter(f => typeof cfg[f] !== 'boolean')
    expect(sin, 'agregá [functions.<nombre>] con verify_jwt en config.toml').toEqual([])
  })

  it('ingest-ndf: si está en el repo, verify_jwt = false (si no, el agente del PoS recibe 401)', () => {
    if (!funciones().includes('ingest-ndf')) return
    expect(cfg['ingest-ndf']).toBe(false)
  })
})
