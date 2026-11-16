// Baterías SQL (16-nov): control ESTÁTICO de que el ASSERT final de cada batería puede abortar.
// El bloque `do $$ … raise exception 'NNN-FALLAN: …' … end $$` no puede llevar `exception when others`: si lo lleva, se
// traga su propio raise y la batería termina en ROLLBACK limpio aunque haya casos caídos (pasó con el caso 18 de la 173).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname)

/** Bloques `do $$ … $$;` que levantan «-FALLAN» y además atrapan `others` (el ASSERT se tragaría a sí mismo). */
export function assertsTragados(sql: string): string[] {
  const bloques = sql.match(/do \$\$[\s\S]*?end\s*\$\$;/gi) ?? []
  return bloques
    .filter(b => /-FALLAN/.test(b) && /exception\s+when\s+others/i.test(b))
    .map(b => b.match(/'(\w+)-FALLAN/)?.[1] ?? '?')
}

describe('ASSERT final de las baterías SQL', () => {
  const archivos = readdirSync(DIR).filter(f => f.endsWith('.sql'))

  it('ningún ASSERT «-FALLAN» atrapa sus propias excepciones', () => {
    const malos = archivos.flatMap(f => assertsTragados(readFileSync(join(DIR, f), 'utf8')).map(n => `${f} (${n})`))
    expect(malos).toEqual([])
  })

  it('el detector muerde: un ASSERT con «exception when others» se marca', () => {
    const malo = `do $$ begin if true then raise exception '999-FALLAN: %', 'x'; end if;
exception when others then insert into _r (caso) values ('x'); end $$;`
    const sano = `do $$ begin if true then raise exception '999-FALLAN: %', 'x'; end if; end $$;`
    expect(assertsTragados(malo)).toEqual(['999'])
    expect(assertsTragados(sano)).toEqual([])
  })

  it('la 181 avisa caso por caso, resume «pasaron X / fallaron Y» y exige sus 13 casos', () => {
    const t = readFileSync(join(DIR, '181_pruebas.sql'), 'utf8')
    expect(t).toMatch(/raise warning '181 FALLA % — %'/)
    expect(t).toMatch(/raise notice '181 RESUMEN: pasaron % \/ fallaron % de %'/)
    expect(t).toMatch(/raise exception '181-FALLAN: % · pasaron % \/ fallaron %'/)
    expect(t).toMatch(/v_esp constant int := 13;/)
  })

  it('la 173 avisa caso por caso y resume «pasaron X / fallaron Y»', () => {
    const t = readFileSync(join(DIR, '173_pruebas.sql'), 'utf8')
    expect(t).toMatch(/raise warning '173 FALLA % — %'/)
    expect(t).toMatch(/raise notice '173 RESUMEN: pasaron % \/ fallaron % de %'/)
    expect(t).toMatch(/raise exception '173-FALLAN: % · pasaron % \/ fallaron %'/)
  })
})
