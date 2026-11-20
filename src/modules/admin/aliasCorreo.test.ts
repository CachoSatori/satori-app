// Mig 195: correo base POR LOCAL, en la base (decisión del dueño 20-nov). Alias, validación, local elegido y paridad
// del patrón con el check de la migración. Correos ficticios (@ejemplo.com).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aliasCorreoEjemplo, esCorreoBaseValido, localDelAlias, validarCorreoBase,
  FALTA_CORREO_LOCAL, MAX_CORREO_BASE, PATRON_CORREO_BASE, type LocalCorreo,
} from './aliasCorreo'

const largo = (n: number) => `${'a'.repeat(n - '@ejemplo.com'.length)}@ejemplo.com`

describe('aliasCorreoEjemplo', () => {
  it('arma «base+nombre@dominio» con el correo del local', () => {
    expect(aliasCorreoEjemplo('local@ejemplo.com')).toBe('local+nombre@ejemplo.com')
    expect(aliasCorreoEjemplo('mi.local_2@sub.ejemplo.co')).toBe('mi.local_2+nombre@sub.ejemplo.co')
  })
  it('sin correo base, o inválido → null (la pantalla pide cargarlo)', () => {
    for (const v of [undefined, null, '', '  ', 'sin-arroba', 'a@b', 'x+y@ejemplo.com', ' local@ejemplo.com', 'a b@ejemplo.com', largo(MAX_CORREO_BASE + 1)]) {
      expect(aliasCorreoEjemplo(v), String(v)).toBeNull()
    }
    expect(aliasCorreoEjemplo(largo(MAX_CORREO_BASE))).not.toBeNull()
  })
  it('el texto de falta manda a Admin → Locales', () => {
    expect(FALTA_CORREO_LOCAL).toBe('Cargá el correo del local en Admin → Locales')
  })
})

describe('validarCorreoBase (Admin → Locales)', () => {
  it('recorta, y vacío = borrar (null)', () => {
    expect(validarCorreoBase('  local@ejemplo.com ')).toEqual({ ok: true, valor: 'local@ejemplo.com' })
    expect(validarCorreoBase('')).toEqual({ ok: true, valor: null })
    expect(validarCorreoBase('   ')).toEqual({ ok: true, valor: null })
  })
  it('rechaza «+», formato roto y largo de más, con su mensaje', () => {
    expect(validarCorreoBase('a+b@ejemplo.com')).toMatchObject({ ok: false, error: expect.stringMatching(/«\+»/) })
    for (const v of ['sin-arroba', 'a@b', 'a@@ejemplo.com', 'a b@ejemplo.com', '@ejemplo.com', 'a@.com']) {
      expect(validarCorreoBase(v), v).toMatchObject({ ok: false, error: expect.stringMatching(/Revisá el correo/) })
    }
    expect(validarCorreoBase(largo(MAX_CORREO_BASE + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/254/) })
    expect(validarCorreoBase(largo(MAX_CORREO_BASE)).ok).toBe(true)
  })
  it('lo que acepta el formulario lo acepta el alias (misma regla)', () => {
    for (const v of ['local@ejemplo.com', 'a.b-c%d@x.ejemplo.org']) {
      const r = validarCorreoBase(v)
      expect(r.ok && r.valor !== null && esCorreoBaseValido(r.valor)).toBe(true)
    }
  })
})

describe('localDelAlias: el local activo', () => {
  const L = (id: string, is_active = true, correo_base: string | null = null): LocalCorreo => ({ id, name: `Local ${id}`, is_active, correo_base })
  const locales = [L('zeta'), L('santa-teresa'), L('nosara'), L('apagado', false)]
  it('el elegido en la app, si está encendido', () => {
    expect(localDelAlias(locales, 'nosara')?.id).toBe('nosara')
  })
  it('elegido apagado o inexistente → el local por defecto de la caja', () => {
    expect(localDelAlias(locales, 'apagado')?.id).toBe('santa-teresa')
    expect(localDelAlias(locales, null)?.id).toBe('santa-teresa')
    expect(localDelAlias(locales, 'no-existe')?.id).toBe('santa-teresa')
  })
  it('sin el de por defecto → el primer encendido por id; sin encendidos → null', () => {
    expect(localDelAlias([L('zeta'), L('beta')], null)?.id).toBe('beta')
    expect(localDelAlias([L('apagado', false)], 'apagado')).toBeNull()
    expect(localDelAlias([], null)).toBeNull()
  })
})

describe('paridad con la migración 195', () => {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/195_locations_correo_base.sql'), 'utf8')
  it('el check de la base usa el MISMO patrón y el mismo largo que la app', () => {
    expect(sql).toContain(`correo_base ~ '${PATRON_CORREO_BASE.source}'`)
    expect(sql).toContain(`char_length(correo_base) <= ${MAX_CORREO_BASE}`)
  })
  it('la migración no trae datos: ningún INSERT/UPDATE ni un correo que no sea de ejemplo', () => {
    const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(codigo).not.toMatch(/\b(insert|update)\b/i)
    expect(codigo.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
  it('no toca políticas: la columna queda bajo la RLS de locations (091/151)', () => {
    expect(sql).not.toMatch(/\b(create|drop|alter)\s+policy\b/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
  })
})
