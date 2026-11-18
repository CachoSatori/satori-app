// Guardas estáticas de la Edge (repo público, R18, R03): index.ts usa lo nuevo, el destino sale SOLO del
// secreto REPORT_TO_EMAIL, no hay correos escritos, no se lee `ventas_dias` ni `employees`, y el envío
// lleva los adjuntos.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { destinatarioDe } from './destinatario.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const leer = (f: string) => readFileSync(join(AQUI, f), 'utf8')
const sinComentarios = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const idx = sinComentarios(leer('index.ts'))
const fuentes = readdirSync(AQUI).filter(f => /\.(ts|js)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'pruebas.fixtures.ts')

describe('guardas de ventas-dia-contador', () => {
  it('destino: solo el secreto REPORT_TO_EMAIL (el de los reportes automáticos), sin valor por defecto', () => {
    expect(idx).toMatch(/const TO_EMAIL\s+= destinatarioDe\(Deno\.env\.get\('REPORT_TO_EMAIL'\)\)/)
    expect(idx).not.toMatch(/REPORT_TO_EMAIL'\)\s*\?\?/)
    expect(idx).toMatch(/if \(!TO_EMAIL\) throw new Error\(FALTA_DESTINATARIO\)/)
    expect(destinatarioDe(undefined)).toBe('')
  })
  it('ningún correo escrito en el código (salvo el remitente de Resend)', () => {
    for (const f of fuentes) expect(leer(f), f).not.toMatch(/[^\s'"`<]+@(?!resend\.dev)[a-z0-9-]+\.[a-z]{2,}/i)
  })
  it('ventas solo del PoS (R18) y sin leer employees', () => {
    for (const f of fuentes) {
      expect(leer(f), f).not.toMatch(/from\(\s*['"]ventas_(dias|hist)['"]/)
      expect(leer(f), f).not.toMatch(/from\(\s*['"]employees['"]/)
    }
    expect(leer('lecturaPos.ts')).toMatch(/'pos_ndf_tickets'/)
    expect(leer('lecturaPos.ts')).toMatch(/\.eq\('estado', 'C'\)/)
  })
  it('index.ts usa procesar + diasDelPos y manda los adjuntos a Resend', () => {
    expect(idx).toMatch(/await procesar\(body, \{/)
    expect(idx).toMatch(/leerDias: \(rango, local\) => diasDelPos\(supabase, rango, local\)/)
    expect(idx).toMatch(/attachments: c\.attachments\.map\(a => \(\{ filename: a\.filename, content: a\.content \}\)\)/)
    // auth SEC-02: service_role u owner activo
    expect(idx).toMatch(/\.eq\('role', 'owner'\)\.eq\('is_active', true\)/)
    // el error de Resend no se copia a la respuesta ni al log con su cuerpo (podría traer el destinatario)
    expect(idx).not.toMatch(/Resend: \$\{JSON\.stringify/)
  })
})
