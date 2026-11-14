// 170 (origen club 116): las funciones del Club que reciben el local quedan como ENVOLTORIO (chequeo de local del
// manager + llamada a <nombre>__nucleo). Receta para cambiarlas después de la 170 (y para rebasear un PR que las
// redefine): se cambia el NÚCLEO (`create or replace function public.<nombre>__nucleo(…)`), no el envoltorio.
//
// Falla si:
//   · la 170 no envuelve exactamente la lista de abajo (si se agrega o saca una, se actualiza la lista y la batería);
//   · una migración con número > 170:
//       – redefine el envoltorio público (`<nombre>`, con o sin comillas) sin repetir EXACTAMENTE su chequeo de la 170
//         (para las de edición por id, el local del objeto) antes de llamar a `<nombre>__nucleo`;
//       – lo renombra (`alter function … rename`) o lo borra sin rehacerlo en el mismo archivo;
//       – le da EXECUTE a authenticated, anon o public sobre un `__nucleo`.
//   Redefinir el `__nucleo` está permitido: es el camino limpio.
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
const CHEQUEO_POR_DEFECTO = 'perform public.club_exigir_local(p_location);'

const DIR = join(__dirname, 'migrations')
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8')
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/\s*([(),;])\s*/g, '$1').trim()

/** Lista de la 170: función → chequeo (concatena los literales SQL contiguos; sin chequeo propio, el de por defecto). */
export function chequeosDeLa170(sql: string): Map<string, string> {
  const m = new Map<string, string>()
  const re = /\('public\.(club_\w+)\([^)]*\)',\s*((?:'(?:[^']|'')*'\s*)+|null(?:::text)?)\s*\)/g
  for (const x of sql.matchAll(re)) {
    const lit = x[2].startsWith('null') ? CHEQUEO_POR_DEFECTO
      : [...x[2].matchAll(/'((?:[^']|'')*)'/g)].map(p => p[1].replace(/''/g, "'")).join('')
    m.set(x[1], lit)
  }
  return m
}

// identificador con o sin comillas, con o sin esquema: public.x · "public"."x" · "x"
const ID = String.raw`(?:"?public"?\s*\.\s*)?"?([A-Za-z_][\w$]*)"?`

/** Cada `create [or replace] function <id>(` del archivo con su texto (hasta la próxima función). */
export function definiciones(sql: string): { nombre: string; cuerpo: string }[] {
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${ID}\s*\(`, 'gi')
  const marcas = [...sql.matchAll(re)]
  return marcas.map((m, i) => ({
    nombre: m[1].toLowerCase(),
    cuerpo: sql.slice(m.index ?? 0, i + 1 < marcas.length ? marcas[i + 1].index : sql.length),
  }))
}

export function violaciones(archivos: { archivo: string; sql: string }[], chequeos: Map<string, string>): string[] {
  const malas: string[] = []
  for (const { archivo, sql } of archivos) {
    const rehechas = new Set<string>()
    for (const d of definiciones(sql)) {
      const chequeo = chequeos.get(d.nombre)
      if (!chequeo) continue
      const cuerpo = norm(d.cuerpo)
      const iChequeo = cuerpo.indexOf(norm(chequeo))
      const iNucleo = cuerpo.indexOf(`public.${d.nombre}__nucleo(`)
      if (iChequeo < 0 || iNucleo < 0 || iChequeo > iNucleo) {
        malas.push(`${archivo}: redefine el envoltorio ${d.nombre} (cambiá ${d.nombre}__nucleo, no el envoltorio)`)
      } else rehechas.add(d.nombre)
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+function\s+${ID}\s*\([^)]*\)\s*rename`, 'gi'))) {
      if (chequeos.has(m[1].toLowerCase())) malas.push(`${archivo}: renombra el envoltorio ${m[1].toLowerCase()}`)
    }
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${ID}\s*\(`, 'gi'))) {
      const n = m[1].toLowerCase()
      if (chequeos.has(n) && !rehechas.has(n)) malas.push(`${archivo}: borra el envoltorio ${n} sin rehacerlo`)
    }
    const reGrant = new RegExp(String.raw`grant\s+(?:execute|all)[^;]*?on\s+function\s+${ID}\s*\([^)]*\)\s*to\s+([^;]+);`, 'gi')
    for (const m of sql.matchAll(reGrant)) {
      if (m[1].toLowerCase().endsWith('__nucleo') && /\b(authenticated|anon|public)\b/i.test(m[2])) {
        malas.push(`${archivo}: da EXECUTE a la API sobre ${m[1].toLowerCase()}`)
      }
    }
  }
  return malas
}

describe('170 · el manager solo en sus locales', () => {
  const CHEQUEOS = chequeosDeLa170(leer('170_club_local_manager.sql'))

  it('la 170 envuelve exactamente la lista, y las de edición por id chequean el local del objeto', () => {
    expect([...CHEQUEOS.keys()].sort()).toEqual([...ENVUELTAS_170].sort())
    expect(CHEQUEOS.get('club_reporte_mes')).toBe(CHEQUEO_POR_DEFECTO)
    expect(CHEQUEOS.get('club_negocio_guardar')).toMatch(/where n\.id = p_id/)
    expect(CHEQUEOS.get('club_miembro_guardar')).toMatch(/where m\.id = p_id/)
    expect(CHEQUEOS.get('club_miembro_guardar')).toMatch(/where n\.id = p_negocio_id\)\); end if;$/)
  })

  it('ninguna migración posterior a la 170 rompe un envoltorio', () => {
    const posteriores = readdirSync(DIR)
      .filter(f => /^\d+_.+\.sql$/.test(f) && Number(f.split('_')[0]) > 170)
      .map(f => ({ archivo: f, sql: leer(f) }))
    expect(violaciones(posteriores, CHEQUEOS)).toEqual([])
  })

  describe('la guardia muerde', () => {
    const v = (sql: string) => violaciones([{ archivo: '171_x.sql', sql }], CHEQUEOS)
    const env = (nombre: string, chequeo: string, args = 'p_location text') =>
      `create or replace function public.${nombre}(${args}) returns int language plpgsql as $f$ begin ${chequeo} ` +
      `return public.${nombre}__nucleo(p_location => p_location); end $f$;`

    it('cae: el cuerpo completo del envoltorio, sin chequeo', () => {
      expect(v('create or replace function public.club_reporte_mes(p_mes date) returns int as $$ select 1 $$;')).toHaveLength(1)
    })
    it('cae: edición por id con el chequeo de p_location (el caso del verificador)', () => {
      expect(v(env('club_miembro_guardar', 'perform public.club_exigir_local(p_location);'))).toHaveLength(1)
      expect(v(env('club_negocio_guardar', 'perform public.club_exigir_local(p_location);'))).toHaveLength(1)
    })
    it('cae: chequeo agregado pero sin llamar al núcleo (cuerpo completo con la línea)', () => {
      expect(v('create or replace function public.club_reporte_mes(p_location text) returns int language plpgsql as $f$ begin ' +
        'perform public.club_exigir_local(p_location); return 1; end $f$;')).toHaveLength(1)
    })
    it('cae: nombres entre comillas', () => {
      expect(v('create or replace function "public"."club_reporte_mes"(p_mes date) returns int as $$ select 1 $$;')).toHaveLength(1)
      expect(v('CREATE FUNCTION "club_socio_visita"(p uuid) returns int as $$ select 1 $$;')).toHaveLength(1)
      expect(v('create or replace function public . "club_productos" (p text) returns int as $$ select 1 $$;')).toHaveLength(1)
    })
    it('cae: renombrar o borrar el envoltorio', () => {
      expect(v('alter function public.club_socio_visita(uuid, jsonb, uuid, text) rename to club_socio_visita_base;')).toHaveLength(1)
      expect(v('alter function "public"."club_socio_visita"(uuid,jsonb,uuid,text) rename to x;')).toHaveLength(1)
      expect(v('drop function if exists public.club_reporte_mes(date, text, boolean);')).toHaveLength(1)
    })
    it('cae: darle EXECUTE a la API sobre un núcleo', () => {
      expect(v('grant execute on function public.club_reporte_mes__nucleo(date, text, boolean) to authenticated;')).toHaveLength(1)
      expect(v('grant all on function "public"."club_productos__nucleo"(text,text) to service_role, anon;')).toHaveLength(1)
    })
    it('pasa: redefinir el núcleo (la receta), y darle EXECUTE a service_role', () => {
      expect(v('create or replace function public.club_miembro_guardar__nucleo(p_id uuid) returns uuid as $$ select p_id $$;\n' +
        'grant execute on function public.club_miembro_guardar__nucleo(uuid) to service_role;')).toEqual([])
    })
    it('pasa: rehacer el envoltorio con su chequeo exacto (otro espaciado), también tras un drop', () => {
      expect(v(env('club_reporte_mes', 'perform   public.club_exigir_local( p_location ) ;'))).toEqual([])
      const chequeo = CHEQUEOS.get('club_miembro_guardar') ?? ''
      expect(v('drop function public.club_miembro_guardar(uuid);\n' + env('club_miembro_guardar', chequeo.replace(/ /g, '\n  ')))).toEqual([])
    })
    it('pasa: funciones que no son envoltorios', () => {
      expect(v('create or replace function public.club_otra(p_location text) returns int as $$ select 1 $$;')).toEqual([])
    })
  })
})
