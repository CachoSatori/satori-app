// Batería del Club por tramos (10-nov): control ESTÁTICO de que cada tramo se puede correr solo.
// Cada tramo va en su propio request (bateria_club.py), con el mismo preámbulo. Si un bloque lee un dato de `_ids` que
// crea otro tramo, o crea una función pg_temp que otro tramo usa, el tramo deja de ser autosuficiente: esta prueba lo
// dice antes de correr nada contra staging.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..', '..')
const BATERIA = readFileSync(join(RAIZ, 'scripts/sql/075_pruebas_staging.sql'), 'utf8')
const MUTACIONES = JSON.parse(readFileSync(join(RAIZ, 'scripts/sql/mutaciones_r7.json'), 'utf8')) as Record<string, { antes_de: string }>
const RE_MARCA = /^-- ════════ TRAMO (\d+): .*? ════════$/gm

interface Partes { pre: string; tramos: { n: number; cuerpo: string }[] }

export function partir(txt: string): Partes {
  const marcas = [...txt.matchAll(RE_MARCA)]
  const fin = txt.indexOf("select json_agg(json_build_object('p', prueba")
  return {
    pre: txt.slice(0, marcas[0]?.index ?? 0),
    tramos: marcas.map((m, k) => ({ n: Number(m[1]), cuerpo: txt.slice(m.index, k + 1 < marcas.length ? marcas[k + 1].index : fin) })),
  }
}

const escritas = (t: string) => new Set([...t.matchAll(/insert into _ids[^;]*;/g)].flatMap(m => [...m[0].matchAll(/\('([a-z_0-9]+)',/g)].map(x => x[1])))
const leidas = (t: string) => new Set([...t.matchAll(/\bk\s*=\s*'([a-z_0-9]+)'/g)].map(m => m[1]))

/** Problemas de autosuficiencia: claves de `_ids` que un tramo lee y nadie crea en el preámbulo ni en ese tramo, y
 *  funciones pg_temp creadas fuera del preámbulo. */
export function problemas(txt: string): string[] {
  const { pre, tramos } = partir(txt)
  const out: string[] = []
  const delPre = escritas(pre)
  for (const { n, cuerpo } of tramos) {
    const propias = escritas(cuerpo)
    for (const k of leidas(cuerpo)) if (!delPre.has(k) && !propias.has(k)) out.push(`tramo ${n} lee _ids '${k}' y no la crea ni el preámbulo ni el tramo`)
    for (const m of cuerpo.matchAll(/create (?:or replace )?function (pg_temp\.\w+)/g)) out.push(`tramo ${n} crea ${m[1]} (va en el preámbulo)`)
  }
  return out
}

describe('batería del Club por tramos (10-nov)', () => {
  const { pre, tramos } = partir(BATERIA)

  it('tiene marcas de tramo en orden (1, 2, 3…), al menos 2, y ningún bloque en el preámbulo', () => {
    expect(tramos.length).toBeGreaterThanOrEqual(2)
    expect(tramos.map(t => t.n)).toEqual(tramos.map((_, i) => i + 1))
    expect(pre).not.toMatch(/^-- ═══ /m)
    for (const t of tramos) expect(t.cuerpo).toMatch(/^-- ═══ /m)
  })

  it('cada tramo es autosuficiente: lee de _ids solo lo que crea el preámbulo o él mismo, y no crea funciones pg_temp', () => {
    expect(problemas(BATERIA)).toEqual([])
  })

  it('cada ancla de mutación aparece una sola vez, en un solo tramo', () => {
    for (const [nombre, m] of Object.entries(MUTACIONES)) {
      const donde = tramos.filter(t => t.cuerpo.includes(m.antes_de))
      expect(donde.length, nombre).toBe(1)
      expect(BATERIA.split(m.antes_de).length - 1, nombre).toBe(1)
    }
  })

  it('el control avisa si un bloque que lee _ids pasa a otro tramo (caso armado)', () => {
    const malo = [
      'begin;', "do $$ begin insert into _ids values ('base', 'x'); end $$;",
      '-- ════════ TRAMO 1: uno ════════', '-- ═══ 1. crea ═══', "do $$ begin insert into _ids values ('cupon', 'y'); end $$;",
      '-- ════════ TRAMO 2: dos ════════', "-- ═══ 2. lee ═══", "do $$ declare v text := (select v from _ids where k = 'cupon'); begin end $$;",
      "create function pg_temp.ayuda() returns int language sql as $f$ select 1 $f$;",
      "select json_agg(json_build_object('p', prueba)) from _res;",
    ].join('\n')
    expect(problemas(malo)).toEqual([
      "tramo 2 lee _ids 'cupon' y no la crea ni el preámbulo ni el tramo",
      'tramo 2 crea pg_temp.ayuda (va en el preámbulo)',
    ])
  })
})
