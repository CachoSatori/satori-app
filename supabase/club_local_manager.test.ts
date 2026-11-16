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
//
// 172 (origen club 118, hallazgo 231): segunda tanda con la misma receta (ENVUELTAS_172; las por id chequean el local
// del objeto con club_exigir_local_de). Las mismas reglas valen para sus envoltorios en las migraciones > 172.
//
// Y una guardia general (sinChequeoDeLocal): falla con TODA función SECURITY DEFINER con parámetro p_location que, al
// final de todas las migraciones, tenga EXECUTE para authenticated (por defecto en Supabase, salvo revoke) y no chequee
// el local: ni envoltorio de la 170/172, ni llamada a club_exigir_local / club_exigir_local_de / club_puede_ver_local /
// puede_ver_local (091) / club_locales_de_reporte, ni delega con p_location en una envuelta (DELEGAN), ni es solo del
// owner (SIN_MANAGER). Una función nueva con p_location tiene que entrar por uno de esos caminos.
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
export const ENVUELTAS_172 = [
  'club_reporte_equipo', 'club_primeros90_config_ver', 'club_reto_en_visita',
  'club_miembro_contacto_ver', 'club_miembro_codigo', 'club_miembro_token', 'club_miembro_regenerar_codigo',
  'club_pase_token', 'club_rol_activar_anfitrion', 'club_socio_confirmar', 'club_resolver_miembro',
  'club_canje', 'club_canje_aprobado', 'club_tarjeta_manual', 'club_cupon_usar',
  'club_canje_aviso', 'club_sin_cruce_candidatas', 'club_sin_cruce_elegir', 'club_pendiente_resolver', 'club_alerta_revisar',
]
/** 176: listas sin local que el manager recorre. El envoltorio llama al núcleo y FILTRA (no hay chequeo antes). */
export const ENVUELTAS_176 = [
  'club_buscar', 'club_resolver', 'club_socios_por_confirmar', 'club_socio_solicitudes_abiertas', 'club_retos_listar',
]
/** Funciones con p_location sin chequeo propio que llaman primero, con p_location, a una envuelta (que chequea). */
export const DELEGAN: Record<string, string> = {
  club_excepciones_abiertas: 'club_excepciones',
  club_reporte_exportar: 'club_reporte_mes',
  club_socio_alta_caja_v2: 'club_socio_alta_caja',
  club_socio_validar_v2: 'club_socio_validar',
  club_miembro_guardar_v2: 'club_miembro_guardar',
}
/** Funciones con p_location que solo deja entrar al owner (el manager ni llega). */
export const SIN_MANAGER = ['club_reporte_cerrar', 'club_contactos_ofertas_exportar', 'club_primeros90_config_guardar']
/** Los chequeos mismos (reciben el local; no son operaciones del Club). */
const HELPERS = new Set(['club_puede_ver_local', 'club_exigir_local', 'club_exigir_local_de', 'puede_ver_local', 'club_locales_de_reporte'])
const LLAMA_CHEQUEO =
  /\b(?:public\.)?(?:club_exigir_local_de|club_exigir_local|club_puede_ver_local|puede_ver_local|club_locales_de_reporte)\s*\(/i
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
export function definiciones(sql: string): { nombre: string; cuerpo: string; i: number }[] {
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${ID}\s*\(`, 'gi')
  const marcas = [...sql.matchAll(re)]
  return marcas.map((m, i) => ({
    nombre: m[1].toLowerCase(),
    i: m.index ?? 0,
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

/** Paréntesis balanceados desde `desde` (que apunta a un «(»): el texto de adentro. */
function entreParentesis(t: string, desde: number): string {
  let n = 0
  for (let i = desde; i < t.length; i++) {
    if (t[i] === '(') n++
    else if (t[i] === ')' && --n === 0) return t.slice(desde + 1, i)
  }
  return t.slice(desde + 1)
}

/** Cuerpo entre dólares (`as $tag$ … $tag$`) y el resto (atributos) de una definición. */
function partes(def: string): { cuerpo: string; atributos: string } {
  const m = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(def)
  if (!m) return { cuerpo: '', atributos: def }
  const ini = m.index + m[0].length
  const fin = def.indexOf(m[1], ini)
  return fin < 0 ? { cuerpo: def.slice(ini), atributos: def.slice(0, m.index) }
    : { cuerpo: def.slice(ini, fin), atributos: def.slice(0, m.index) + def.slice(fin + m[1].length) }
}

type Def = { archivo: string; args: string; secdef: boolean; cuerpo: string }

/**
 * Recorre las migraciones EN ORDEN y devuelve las funciones SECURITY DEFINER con p_location que quedan con EXECUTE para
 * authenticated sin chequear el local del manager. `envueltas`: número de migración → funciones que esa migración
 * convierte en envoltorio (desde ahí cuentan como chequeadas).
 */
export function sinChequeoDeLocal(archivos: { archivo: string; sql: string }[], envueltas: Map<number, string[]>): string[] {
  const defs = new Map<string, Def>()
  const acl = new Map<string, boolean>()   // ¿authenticated tiene EXECUTE?
  const envuelta = new Set<string>()
  for (const { archivo, sql } of archivos) {
    type Ev = { i: number; f: () => void }
    const evs: Ev[] = []
    for (const d of definiciones(sql)) {
      const i0 = d.i
      const iPar = d.cuerpo.indexOf('(', d.cuerpo.search(new RegExp(String.raw`function\s+${ID}`, 'i')))
      const args = entreParentesis(d.cuerpo, iPar)
      const { cuerpo, atributos } = partes(d.cuerpo.slice(iPar + args.length + 2))
      // la definición termina en el primer «;» después del cuerpo: lo que sigue (grants) no son atributos
      const attrs = atributos.split(';')[0]
      evs.push({ i: i0, f: () => {
        if (!defs.has(d.nombre)) acl.set(d.nombre, true)   // Supabase: EXECUTE por defecto para anon/authenticated
        defs.set(d.nombre, { archivo, args, secdef: /security\s+definer/i.test(attrs), cuerpo })
      } })
    }
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${ID}\s*\(`, 'gi'))) {
      const n = m[1].toLowerCase()
      evs.push({ i: m.index ?? 0, f: () => { defs.delete(n); acl.delete(n) } })
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+function\s+${ID}\s*\([^)]*\)\s*rename\s+to\s+"?(\w+)"?`, 'gi'))) {
      const [de, a] = [m[1].toLowerCase(), m[2].toLowerCase()]
      evs.push({ i: m.index ?? 0, f: () => {
        const d = defs.get(de)
        if (d) { defs.set(a, d); acl.set(a, acl.get(de) ?? true) }
        defs.delete(de); acl.delete(de)
      } })
    }
    for (const m of sql.matchAll(new RegExp(String.raw`\b(grant|revoke)\s+(?:execute|all)(?:\s+privileges)?\s+on\s+function\s+${ID}\s*\([^)]*\)\s*(?:to|from)\s+([^;]+);`, 'gi'))) {
      const n = m[2].toLowerCase()
      const roles = m[3].toLowerCase()
      const tocaAuth = /\bauthenticated\b/.test(roles)
      const grant = m[1].toLowerCase() === 'grant'
      evs.push({ i: m.index ?? 0, f: () => {
        if (grant && (tocaAuth || /\bpublic\b/.test(roles))) acl.set(n, true)
        else if (!grant && tocaAuth) acl.set(n, false)
      } })
    }
    evs.sort((a, b) => a.i - b.i).forEach(e => e.f())
    for (const n of envueltas.get(Number(archivo.split('_')[0])) ?? []) envuelta.add(n)
  }
  const malas: string[] = []
  for (const [n, d] of defs) {
    if (!d.secdef || !/\bp_location\b/i.test(d.args) || !acl.get(n) || envuelta.has(n) || HELPERS.has(n)) continue
    if (LLAMA_CHEQUEO.test(d.cuerpo)) continue
    const destino = DELEGAN[n]
    if (destino && envuelta.has(destino)
        && new RegExp(String.raw`public\.${destino}\s*\([^;]*\bp_location\b`, 'i').test(d.cuerpo)) continue
    if (SIN_MANAGER.includes(n) && /<>\s*'owner'/.test(d.cuerpo) && !/'manager'/.test(d.cuerpo)) continue
    malas.push(`${d.archivo}: ${n} (SECURITY DEFINER, p_location, EXECUTE para authenticated) no chequea el local del manager`)
  }
  return malas.sort()
}

/**
 * 176: un envoltorio de lista redefinido después tiene que repetir su cuerpo de la 176 (llama al núcleo y filtra); no se
 * renombra ni se borra sin rehacerlo. Y toda política nueva o cambiada de una tabla club_* que deje entrar al manager
 * tiene que mirar el local (mis_locales / club_puede_ver_local / club_ve_ficha).
 */
export function violaciones176(archivos: { archivo: string; sql: string }[], cuerpos: Map<string, string>): string[] {
  const malas: string[] = []
  for (const { archivo, sql } of archivos) {
    const rehechas = new Set<string>()
    for (const d of definiciones(sql)) {
      const c = cuerpos.get(d.nombre)
      if (!c) continue
      if (!norm(d.cuerpo).includes(norm(c))) malas.push(`${archivo}: redefine el envoltorio ${d.nombre} (cambiá ${d.nombre}__nucleo, no el envoltorio)`)
      else rehechas.add(d.nombre)
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+function\s+${ID}\s*\([^)]*\)\s*rename`, 'gi'))) {
      if (cuerpos.has(m[1].toLowerCase())) malas.push(`${archivo}: renombra el envoltorio ${m[1].toLowerCase()}`)
    }
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${ID}\s*\(`, 'gi'))) {
      const n = m[1].toLowerCase()
      if (cuerpos.has(n) && !rehechas.has(n)) malas.push(`${archivo}: borra el envoltorio ${n} sin rehacerlo`)
    }
    for (const m of sql.matchAll(/(?:create|alter)\s+policy\s+"?(\w+)"?\s+on\s+(?:"?public"?\s*\.\s*)?"?(club_\w+)"?([^;]*);/gi)) {
      if (/'manager'/i.test(m[3]) && !/\b(mis_locales|club_puede_ver_local|club_ve_ficha)\s*\(/i.test(m[3])) {
        malas.push(`${archivo}: la política ${m[1]} de ${m[2]} deja entrar al manager sin mirar el local`)
      }
    }
  }
  return malas
}

describe('170 y 172 · el manager solo en sus locales', () => {
  const CHEQUEOS = chequeosDeLa170(leer('170_club_local_manager.sql'))
  const CHEQUEOS_172 = chequeosDeLa170(leer('172_club_local_manager_2.sql'))
  const ENVUELTAS = new Map([[170, ENVUELTAS_170], [172, ENVUELTAS_172]])
  const migraciones = (hasta = Infinity) => readdirSync(DIR)
    .filter(f => /^\d+_.+\.sql$/.test(f) && Number(f.split('_')[0]) <= hasta)
    .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]) || a.localeCompare(b))
    .map(f => ({ archivo: f, sql: leer(f) }))

  it('la 170 envuelve exactamente la lista, y las de edición por id chequean el local del objeto', () => {
    expect([...CHEQUEOS.keys()].sort()).toEqual([...ENVUELTAS_170].sort())
    expect(CHEQUEOS.get('club_reporte_mes')).toBe(CHEQUEO_POR_DEFECTO)
    expect(CHEQUEOS.get('club_negocio_guardar')).toMatch(/where n\.id = p_id/)
    expect(CHEQUEOS.get('club_miembro_guardar')).toMatch(/where m\.id = p_id/)
    expect(CHEQUEOS.get('club_miembro_guardar')).toMatch(/where n\.id = p_negocio_id\)\); end if;$/)
  })

  it('la 172 envuelve exactamente su lista; las por id miran el local del objeto (no p_location)', () => {
    expect([...CHEQUEOS_172.keys()].sort()).toEqual([...ENVUELTAS_172].sort())
    expect(CHEQUEOS_172.get('club_reporte_equipo')).toBe(CHEQUEO_POR_DEFECTO)
    expect(CHEQUEOS_172.get('club_primeros90_config_ver')).toBe(CHEQUEO_POR_DEFECTO)
    expect(CHEQUEOS_172.get('club_reto_en_visita')).toMatch(/club_visitas_socio v where v\.id = p_visita/)
    for (const n of ENVUELTAS_172.filter(x => !['club_reporte_equipo', 'club_primeros90_config_ver', 'club_reto_en_visita'].includes(x))) {
      const c = CHEQUEOS_172.get(n) ?? ''
      expect(c, n).toMatch(/^perform public\.club_exigir_local_de\(\(select \w+\.location_id from public\.club_\w+ \w+ where /)
      expect(c, n).not.toMatch(/p_location/)
    }
    expect(CHEQUEOS_172.get('club_cupon_usar')).toMatch(/upper\(btrim\(coalesce\(p_codigo, ''\)\)\)/)
    expect(ENVUELTAS_172.filter(n => ENVUELTAS_170.includes(n))).toEqual([])
  })

  it('ninguna migración posterior rompe un envoltorio (170 desde la 171; 172 desde la 173)', () => {
    expect(violaciones(migraciones().filter(m => Number(m.archivo.split('_')[0]) > 170), CHEQUEOS)).toEqual([])
    expect(violaciones(migraciones().filter(m => Number(m.archivo.split('_')[0]) > 172), CHEQUEOS_172)).toEqual([])
  })

  it('176: envuelve exactamente sus 5 listas, cada una llama a su núcleo y filtra; ninguna posterior las rompe', () => {
    const CUERPOS_176 = chequeosDeLa170(leer('176_club_local_manager_listas.sql'))
    expect([...CUERPOS_176.keys()].sort()).toEqual([...ENVUELTAS_176].sort())
    for (const [n, c] of CUERPOS_176) {
      expect(c, n).toContain(`public.${n}__nucleo(`)
      expect(c, n).toMatch(/club_ve_ficha|club_exigir_local_de/)
    }
    expect(CUERPOS_176.get('club_resolver')).not.toMatch(/'socio'/)   // el QR del socio no se corta (Club compartido)
    // club_buscar: el filtro va DENTRO del núcleo, antes del «limit 20» (si no, el manager ve vacío con >20 ajenas)
    const nucleoBuscar = leer('176_club_local_manager_listas.sql').split('create or replace function public.club_buscar__nucleo(')[1] ?? ''
    const iFiltro = nucleoBuscar.indexOf('public.club_ve_ficha(m.location_id)')
    expect(iFiltro).toBeGreaterThan(0)
    expect(iFiltro).toBeLessThan(nucleoBuscar.indexOf('limit 20'))
    expect(ENVUELTAS_176.filter(n => [...ENVUELTAS_170, ...ENVUELTAS_172].includes(n))).toEqual([])
    expect(violaciones176(migraciones().filter(m => Number(m.archivo.split('_')[0]) > 176), CUERPOS_176)).toEqual([])
    // y la guardia muerde
    const v = (sql: string) => violaciones176([{ archivo: '177_x.sql', sql }], CUERPOS_176)
    expect(v('create or replace function public.club_buscar(p_q text) returns setof int as $$ select 1 $$;')).toHaveLength(1)
    expect(v('drop function public.club_retos_listar();')).toHaveLength(1)
    expect(v('alter function public.club_resolver(text) rename to x;')).toHaveLength(1)
    expect(v("alter policy club_staff_select on public.club_miembros using (get_my_role() in ('owner','manager'));")).toHaveLength(1)
    expect(v("create policy p on public.club_negocios for select using (get_my_role() = 'manager' and location_id = any (public.mis_locales()));")).toEqual([])
    expect(v('create or replace function public.club_buscar__nucleo(p_q text) returns setof int as $$ select 1 $$;')).toEqual([])
  })

  it('176: la RLS del Club que deja entrar al manager mira el local en la 176', () => {
    const sql = leer('176_club_local_manager_listas.sql')
    const pols = [...sql.matchAll(/alter\s+policy\s+(\w+)\s+on\s+public\.(club_\w+)([^;]*);/gi)]
    expect(pols.map(m => m[2]).sort()).toEqual([
      'club_alertas', 'club_comparacion_vieja', 'club_cruces_manuales', 'club_cruces_manuales_historial', 'club_cupones',
      'club_cupones_contactos', 'club_excepciones_resueltas', 'club_miembro_roles', 'club_miembros', 'club_miembros_contacto',
      'club_movimientos', 'club_negocios', 'club_pases', 'club_primeros90', 'club_resena_socio', 'club_retos_ganados',
      'club_visitas'])
    for (const m of pols) expect(m[3], m[2]).toMatch(/mis_locales\(\)/)
    expect(violaciones176([{ archivo: '176_club_local_manager_listas.sql', sql }], new Map())).toEqual([])
  })

  it('ninguna función SECURITY DEFINER con p_location y EXECUTE para authenticated queda sin chequear el local', () => {
    expect(sinChequeoDeLocal(migraciones(), ENVUELTAS)).toEqual([])
  })

  it('la guardia general muerde: hasta la 171 encuentra exactamente las 3 del hallazgo 231', () => {
    const malas = sinChequeoDeLocal(migraciones(171), ENVUELTAS)
    expect(malas.map(m => m.split(': ')[1].split(' ')[0]).sort()).toEqual(
      ['club_primeros90_config_ver', 'club_reporte_equipo', 'club_reto_en_visita'])
    // y sin la 170 vuelven las 26 de entonces (las 24 con p_location que no delegan ni chequean por otro lado)
    expect(sinChequeoDeLocal(migraciones(169), new Map()).length).toBeGreaterThanOrEqual(24)
  })

  it('las listas DELEGAN y SIN_MANAGER no se pudren: cada una existe con p_location y su destino está envuelto', () => {
    const todas = migraciones().map(m => m.sql).join('\n')
    for (const n of [...Object.keys(DELEGAN), ...SIN_MANAGER]) {
      expect(todas, n).toMatch(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${n}\s*\([^)]*p_location`, 'i'))
    }
    for (const d of Object.values(DELEGAN)) expect([...ENVUELTAS_170, ...ENVUELTAS_172]).toContain(d)
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
    it('cae: un envoltorio de la 172 redefinido después sin su chequeo (o con el de p_location)', () => {
      const v172 = (sql: string) => violaciones([{ archivo: '173_x.sql', sql }], CHEQUEOS_172)
      expect(v172('create or replace function public.club_reporte_equipo(p_mes date, p_location text) returns jsonb as $$ select null::jsonb $$;')).toHaveLength(1)
      expect(v172(env('club_miembro_contacto_ver', 'perform public.club_exigir_local(p_location);'))).toHaveLength(1)
      expect(v172(env('club_miembro_contacto_ver', CHEQUEOS_172.get('club_miembro_contacto_ver') ?? ''))).toEqual([])
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
    it('una función nueva con p_location no es envoltorio (violaciones no la mira) pero la guardia general SÍ la frena', () => {
      const otra = 'create or replace function public.club_otra(p_location text) returns int language sql security definer as $$ select 1 $$;'
      expect(v(otra)).toEqual([])
      const g = (sql: string) => sinChequeoDeLocal([...migraciones(), { archivo: '999_x.sql', sql }], ENVUELTAS)
      expect(g(otra)).toEqual(['999_x.sql: club_otra (SECURITY DEFINER, p_location, EXECUTE para authenticated) no chequea el local del manager'])
      // con grant explícito, con el atributo antes del cuerpo y con comillas
      expect(g('create function "public"."club_otra2"(p_mes date, p_location text default null) returns int\n' +
        'language plpgsql\nsecurity definer set search_path = public as $f$ begin return 1; end $f$;\n' +
        'revoke all on function public.club_otra2(date, text) from public, anon;\n' +
        'grant execute on function public.club_otra2(date, text) to authenticated;')).toHaveLength(1)
      // revocar y volver a dar EXECUTE
      expect(g(otra + '\nrevoke all on function public.club_otra(text) from public, anon, authenticated;\n' +
        'grant execute on function public.club_otra(text) to authenticated;')).toHaveLength(1)
    })
    it('la guardia general deja pasar: con chequeo, sin EXECUTE para authenticated, security invoker, sin p_location', () => {
      const g = (sql: string) => sinChequeoDeLocal([...migraciones(), { archivo: '999_x.sql', sql }], ENVUELTAS)
      const cuerpo = (c: string) => `create or replace function public.club_otra(p_location text) returns int language plpgsql security definer as $f$ begin ${c} return 1; end $f$;`
      expect(g(cuerpo('perform public.club_exigir_local(p_location);'))).toEqual([])
      expect(g(cuerpo('if not public.puede_ver_local(p_location) then raise exception \'x\'; end if;'))).toEqual([])
      expect(g(cuerpo('perform public.club_exigir_local_de((select m.location_id from public.club_miembros m));'))).toEqual([])
      expect(g(cuerpo('') + '\nrevoke all on function public.club_otra(text) from public, anon, authenticated;')).toEqual([])
      expect(g('create function public.club_otra(p_location text) returns int language sql as $$ select 1 $$;')).toEqual([])
      expect(g('create function public.club_otra(p_local text) returns int language sql security definer as $$ select 1 $$;')).toEqual([])
    })
    it('la guardia general frena si un DELEGAN deja de pasar p_location o un SIN_MANAGER abre al manager', () => {
      const g = (sql: string) => sinChequeoDeLocal([...migraciones(), { archivo: '999_x.sql', sql }], ENVUELTAS)
      expect(g("create or replace function public.club_reporte_exportar(p_mes date, p_location text default null, p_formato text default 'csv') " +
        "returns text language plpgsql security definer as $f$ begin return public.club_reporte_mes(p_mes, null)::text; end $f$;")).toHaveLength(1)
      expect(g("create or replace function public.club_reporte_cerrar(p_mes date, p_motivo text default null, p_location text default null) " +
        "returns jsonb language plpgsql security definer as $f$ begin if get_my_role() not in ('owner','manager') then return null; end if; return null; end $f$;")).toHaveLength(1)
    })
  })
})
