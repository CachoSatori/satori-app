// SAL-AUD-01 (mig 083): nadie lee `employees` con select('*') ni pide columnas de planilla.
// Test ESTÁTICO sobre el código: recorre src/ y supabase/functions/ buscando cada
// `.from('employees')` y mira la cadena hasta el siguiente `;` o línea en blanco.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPLOYEE_COLUMNS, PLANILLA_KEYS } from './employeeColumns'

const RAIZ = join(__dirname, '..', '..', '..')
const SENSIBLES = [...PLANILLA_KEYS, 'nombre_homebanking', 'banco', 'cuenta_iban_alias']

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) return []
    if (statSync(p).isDirectory()) return archivos(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

/** Cada consulta a employees: el texto desde `.from('employees')` hasta el fin de la cadena. */
function consultas(): { archivo: string; texto: string }[] {
  const out: { archivo: string; texto: string }[] = []
  for (const dir of ['src', join('supabase', 'functions')]) {
    for (const a of archivos(join(RAIZ, dir))) {
      const s = readFileSync(a, 'utf8')
      const re = /\.from\(\s*['"]employees['"]\s*\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(s))) {
        const resto = s.slice(m.index)
        const fin = resto.search(/;|\n\s*\n/)
        out.push({ archivo: a.slice(RAIZ.length + 1), texto: resto.slice(0, fin === -1 ? 400 : fin) })
      }
    }
  }
  return out
}

describe('employees: select explícito, sin planilla', () => {
  const qs = consultas()

  it('encuentra las consultas (si no, el test no está mirando nada)', () => {
    expect(qs.length).toBeGreaterThanOrEqual(8)
  })

  it('ningún select("*") ni select() vacío sobre employees', () => {
    const malas = qs.filter(q => /\.select\(\s*(['"]\*['"])?\s*\)/.test(q.texto))
    expect(malas.map(q => `${q.archivo}: ${q.texto.replace(/\s+/g, ' ').slice(0, 120)}`)).toEqual([])
  })

  it('ninguna consulta a employees nombra una columna de planilla', () => {
    const malas = qs.filter(q => SENSIBLES.some(c => new RegExp(`\\b${c}\\b`).test(q.texto)))
    expect(malas.map(q => q.archivo)).toEqual([])
  })

  it('EMPLOYEE_COLUMNS no incluye columnas de planilla', () => {
    const cols = EMPLOYEE_COLUMNS.split(',').map(c => c.trim())
    for (const c of SENSIBLES) expect(cols).not.toContain(c)
    expect(cols).toEqual(expect.arrayContaining(['id', 'full_name', 'role', 'profile_id', 'is_active']))
  })
})
