// Destinatario sin correo por defecto en el código (firma del dueño, 16-nov-2026). Datos ficticios.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { destinatarioDe, FALTA_DESTINATARIO, remitenteDe } from './destinatario.ts'

describe('destinatarioDe', () => {
  it('sin secreto, vacío o sin forma de correo → vacío (no se manda)', () => {
    for (const v of [undefined, null, '', '   ', 'sin-arroba', 'a@b', 'a@b.c, d@e.f']) expect(destinatarioDe(v)).toBe('')
  })
  it('con un correo → el correo, sin espacios', () => {
    const ficticio = ['reportes', 'ejemplo.test'].join('@')  // dominio reservado, armado en ejecución
    expect(destinatarioDe(`  ${ficticio} `)).toBe(ficticio)
  })
})

describe('remitenteDe', () => {
  const dir = ['no-responder', 'ejemplo.test'].join('@')   // dominio reservado, armado en ejecución
  it('«Nombre <dir>» o «dir» → normalizado', () => {
    expect(remitenteDe(`  Satori <${dir}> `)).toBe(`Satori <${dir}>`)
    expect(remitenteDe(`<${dir}>`)).toBe(dir)
    expect(remitenteDe(dir)).toBe(dir)
  })
  it('sin secreto o sin forma de correo → vacío (no se manda)', () => {
    for (const v of [undefined, null, '', 'Satori', 'Satori <sin-arroba>', `Satori <${dir}>, otro <${dir}>`]) expect(remitenteDe(v)).toBe('')
  })
})

describe('guarda estática de index.ts', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  it('no hay ningún correo escrito en el código', () => {
    expect(src).not.toMatch(/['"`][^'"`\s]+@(?!resend\.dev)[^'"`\s]+\.[a-z]{2,}['"`]/i)
    expect(codigo).toMatch(/const TO_EMAIL\s+= destinatarioDe\(Deno\.env\.get\('REPORT_TO_EMAIL'\)\)/)
    expect(codigo).not.toMatch(/REPORT_TO_EMAIL'\)\s*\?\?/)
    expect(codigo).toMatch(/const FROM_EMAIL\s+= remitenteDe\(Deno\.env\.get\('REMITENTE_CORREOS'\)\)/)
    expect(codigo).toMatch(/hayRemitente: !!FROM_EMAIL,/)
  })
  it('sin destinatario: loguea «falta destinatario», responde error y corta ANTES de leer el cierre y de Resend', () => {
    // El flujo vive en proceso.ts (probado también en proceso.test.ts); index.ts le pasa si hay destinatario.
    expect(FALTA_DESTINATARIO).toBe('falta destinatario')
    expect(codigo).toMatch(/hayDestinatario: !!TO_EMAIL,/)
    const proc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'proceso.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(proc).toMatch(/if \(!d\.hayDestinatario\) \{\s*d\.log\(\{ etapa: FALTA_DESTINATARIO/)
    expect(proc).toMatch(/code: 'falta_destinatario'/)
    const corte = proc.indexOf('if (!d.hayDestinatario)')
    expect(corte).toBeGreaterThan(0)
    expect(corte).toBeLessThan(proc.indexOf('d.leerCierre('))
    expect(corte).toBeLessThan(proc.indexOf('d.resumen('))
    expect(corte).toBeLessThan(proc.indexOf('d.enviar('))
    const corteRem = proc.indexOf('if (!d.hayRemitente)')
    expect(corteRem).toBeGreaterThan(0)
    expect(corteRem).toBeLessThan(proc.indexOf('d.leerCierre('))
  })
})
