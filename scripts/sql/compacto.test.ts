// `--compacto` de los armadores de baterías (scripts/sql/*_pruebas.py) NO cambia los cuerpos dollar-quoted.
// Incidente 26-nov: el compacto borraba los comentarios de adentro de los cuerpos; la huella md5 de la 200 pasaba de
// 636d3776 a 4efd18f4 y la batería 202 en staging se frenó con «los cuerpos en la base no son los de la 200».
// La huella se calcula como la guarda de la base: md5 del cuerpo sin ningún espacio (regexp_replace(prosrc, '\s', '', 'g')).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '../..')
const md5 = (s: string) => createHash('md5').update(s.replace(/\s/g, '')).digest('hex')
const armar = (n: string, ...extra: string[]) =>
  execFileSync('python3', ['-I', join(RAIZ, `scripts/sql/${n}_pruebas.py`), '--armar', ...extra], { encoding: 'utf8', maxBuffer: 64 << 20 })

/** Cuerpos $$ … $$ (texto crudo) de las migraciones NNN_*.sql: lo que la guarda de la base compara por md5. */
const cuerposMig = (n: string) =>
  readdirSync(join(RAIZ, 'supabase/migrations')).filter((f) => f.startsWith(`${n}_`))
    .flatMap((f) => [...readFileSync(join(RAIZ, 'supabase/migrations', f), 'utf8').matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]))

/** Completo y compacto: (1) cada cuerpo de las migraciones `migs` que está en el completo está, letra por letra, en el
 *  compacto; (2) el escáner del módulo (`--cuerpos`) da la misma lista de huellas, en orden. Devuelve las huellas
 *  de los cuerpos de `migs` que se encontraron. */
function mismasHuellas(n: string, migs: string[] = [n]) {
  const completo = armar(n), compacto = armar(n, '--compacto')
  const vistos = migs.flatMap(cuerposMig).filter((c) => completo.includes(c))
  for (const c of vistos) expect(compacto.includes(c), `${n}: cuerpo ${md5(c).slice(0, 8)} cambió en el compacto`).toBe(true)
  const esc = (sql: string) => execFileSync('python3', ['-I', join(RAIZ, 'scripts/sql/sql_compacto.py'), '--cuerpos'], { input: sql, encoding: 'utf8' })
  const ec = esc(completo)
  expect(ec.trim().split('\n').length).toBeGreaterThan(5)
  expect(esc(compacto)).toBe(ec)
  return new Set(vistos.map(md5))
}

const compactar = (sql: string) =>
  execFileSync('python3', ['-I', join(RAIZ, 'scripts/sql/sql_compacto.py')], { input: sql, encoding: 'utf8' })

describe('sql_compacto: qué saca y qué deja', () => {
  it('saca comentarios, vacías y sangría afuera; adentro de $$, $function$, strings y /* */ deja todo tal cual', () => {
    const sql = [
      '-- encabezado',
      '',
      '   select 1;   ',
      'create function f() returns int language plpgsql as $function$',
      'begin',
      '  -- comentario de adentro',
      '',
      '  return 1;',
      'end $function$;',
      "do $$ begin perform 1; -- al final",
      '    -- otro de adentro',
      'end $$;',
      "select 'uno",
      '-- esto es texto, no comentario',
      "dos';",
      '/* bloque',
      '-- adentro del bloque',
      '*/ select 2;',
      'select $1, a$b$c from t; -- $1 y a$b no abren cuerpos',
      '-- fin',
    ].join('\n')
    expect(compactar(sql)).toBe([
      'select 1;',
      'create function f() returns int language plpgsql as $function$',
      'begin',
      '  -- comentario de adentro',
      '',
      '  return 1;',
      'end $function$;',
      'do $$ begin perform 1; -- al final',
      '    -- otro de adentro',
      'end $$;',
      "select 'uno",
      '-- esto es texto, no comentario',
      "dos';",
      '/* bloque',
      '-- adentro del bloque',
      '*/ select 2;',
      'select $1, a$b$c from t; -- $1 y a$b no abren cuerpos',
    ].join('\n'))
  })
})

describe('--compacto no cambia la huella de ningún cuerpo', () => {
  it('200: los cuerpos de la 200 (636d3776 · 98dae10d) salen iguales en completo y compacto', () => {
    const comp = mismasHuellas('200')
    expect([...comp].sort()).toEqual(['636d3776826384ff46ed87a1cfe0db25', '98dae10d63e704afd7ff02930e655bbd'])
  })

  it('202: los cuerpos de la 200 y de la 202 salen iguales en completo y compacto', () => {
    const comp = mismasHuellas('202', ['200', '202'])
    expect(comp.size).toBe(4)
    for (const h of ['636d3776826384ff46ed87a1cfe0db25', '98dae10d63e704afd7ff02930e655bbd']) expect(comp, h).toContain(h)
  })

  it.each(['191', '192', '198', '199', '201', '203'])('%s: mismas huellas en completo y compacto', (n) => {
    mismasHuellas(n)
  })
})
