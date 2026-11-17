// Destinatario sin correo por defecto en el código (firma del dueño, 16-nov-2026). Datos ficticios.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { destinatarioDe, FALTA_DESTINATARIO } from './destinatario.ts'

describe('destinatarioDe', () => {
  it('sin secreto, vacío o sin forma de correo → vacío (no se manda)', () => {
    for (const v of [undefined, null, '', '   ', 'sin-arroba', 'a@b', 'a@b.c, d@e.f']) expect(destinatarioDe(v)).toBe('')
  })
  it('con un correo → el correo, sin espacios', () => {
    const ficticio = ['reportes', 'ejemplo.test'].join('@')  // dominio reservado, armado en ejecución
    expect(destinatarioDe(`  ${ficticio} `)).toBe(ficticio)
  })
})

describe('guarda estática de index.ts', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  it('no hay ningún correo escrito en el código', () => {
    expect(src).not.toMatch(/['"`][^'"`\s]+@(?!resend\.dev)[^'"`\s]+\.[a-z]{2,}['"`]/i)
    expect(codigo).toMatch(/const TO_EMAIL\s+= destinatarioDe\(Deno\.env\.get\('REPORT_TO_EMAIL'\)\)/)
    expect(codigo).not.toMatch(/REPORT_TO_EMAIL'\)\s*\?\?/)
  })
  it('sin destinatario: loguea «falta destinatario», responde error y corta ANTES de leer el cierre y de Resend', () => {
    expect(FALTA_DESTINATARIO).toBe('falta destinatario')
    expect(codigo).toMatch(/if \(!TO_EMAIL\) \{\s*console\.error\(JSON\.stringify\(\{ etapa: FALTA_DESTINATARIO/)
    expect(codigo).toMatch(/code: 'falta_destinatario'/)
    const corte = codigo.indexOf('if (!TO_EMAIL)')
    expect(corte).toBeGreaterThan(0)
    expect(corte).toBeLessThan(codigo.indexOf(".from('cash_cierres_dia')"))
    expect(corte).toBeLessThan(codigo.indexOf('api.resend.com'))
  })
})
