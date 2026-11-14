// 170 (origen club 116): las funciones del Club que reciben el local quedan como ENVOLTORIO (chequeo de local del
// manager + llamada a <nombre>__nucleo). Una migración posterior que haga `create or replace` de una de ellas reemplaza
// el envoltorio y el manager vuelve a poder pedir cualquier local por la API, sin que nada avise.
//
// Falla si:
//   · la 170 no envuelve exactamente la lista de abajo (si se agrega o saca una, se actualiza la lista y la batería);
//   · una migración con número > 170 redefine una función envuelta y no llama a public.club_exigir_local en esa
//     definición (o redefine un núcleo, que tiene que quedar como la original).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

export const ENVUELTAS_170 = [
  'club_pendientes_listar', 'club_pedidos_abiertos', 'club_facturas_recientes', 'club_excepciones', 'club_excepcion_resolver',
  'club_reporte_mes', 'club_comparacion_cargar', 'club_comparacion', 'club_reporte_altas', 'club_reporte_visitas',
  'club_reporte_descuentos', 'club_alertas_prioritarias', 'club_promociones_listar', 'club_promocion_guardar', 'club_productos',
  'club_cortesias_listar', 'club_cortesia_guardar', 'club_marcadores_listar', 'club_marcador_guardar',
  'club_descuentos_tipo_listar', 'club_descuento_tipo_guardar', 'club_socio_alta_caja', 'club_socio_validar',
  'club_socio_visita', 'club_negocio_guardar', 'club_miembro_guardar',
]

const DIR = join(__dirname, 'migrations')
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8')

/** Cada `create [or replace] function public.<nombre>(` del archivo con su cuerpo (hasta la próxima función). */
export function definiciones(sql: string): { nombre: string; cuerpo: string }[] {
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi
  const marcas = [...sql.matchAll(re)]
  return marcas.map((m, i) => ({
    nombre: m[1].toLowerCase(),
    cuerpo: sql.slice(m.index ?? 0, i + 1 < marcas.length ? marcas[i + 1].index : sql.length),
  }))
}

export function redefinicionesSinChequeo(archivos: { archivo: string; sql: string }[]): string[] {
  const malas: string[] = []
  for (const { archivo, sql } of archivos) {
    for (const d of definiciones(sql)) {
      if (ENVUELTAS_170.includes(d.nombre) && !/public\.club_exigir_local\s*\(/.test(d.cuerpo)) {
        malas.push(`${archivo}: ${d.nombre} sin public.club_exigir_local`)
      }
      if (d.nombre.endsWith('__nucleo')) malas.push(`${archivo}: redefine el núcleo ${d.nombre}`)
    }
  }
  return malas
}

describe('170 · el manager solo en sus locales', () => {
  it('la 170 envuelve exactamente la lista', () => {
    const sql = leer('170_club_local_manager.sql')
    const enLa170 = [...sql.matchAll(/\('public\.(club_\w+)\(/g)].map(m => m[1])
    expect([...enLa170].sort()).toEqual([...ENVUELTAS_170].sort())
  })

  it('ninguna migración posterior a la 170 redefine una función envuelta sin el chequeo de local', () => {
    const posteriores = readdirSync(DIR)
      .filter(f => /^\d+_.+\.sql$/.test(f) && Number(f.split('_')[0]) > 170)
      .map(f => ({ archivo: f, sql: leer(f) }))
    expect(redefinicionesSinChequeo(posteriores)).toEqual([])
  })

  it('la regla muerde: una redefinición sin el chequeo cae y con el chequeo pasa', () => {
    const sin = 'create or replace function public.club_reporte_visitas(p_desde date) returns int as $$ select 1 $$;'
    const con = 'create or replace function public.club_reporte_visitas(p_desde date) returns int as $$ begin ' +
      'perform public.club_exigir_local(null); return 1; end $$;'
    const otra = 'create or replace function public.club_otra(p_location text) returns int as $$ select 1 $$;'
    expect(redefinicionesSinChequeo([{ archivo: '171_x.sql', sql: sin + '\n' + otra }])).toHaveLength(1)
    expect(redefinicionesSinChequeo([{ archivo: '171_x.sql', sql: con }])).toEqual([])
    expect(redefinicionesSinChequeo([{ archivo: '171_x.sql', sql: 'create function public.club_socio_visita__nucleo() returns int as $$ select 1 $$;' }])).toHaveLength(1)
  })
})
