// Contrato de la mig 194 (Mi Rendimiento: el equipo en agregados). Lee el SQL tal cual está en el repo y verifica
// lo que no se puede romper sin que nadie lo note: permisos, search_path, que no salga nada fuera de la lista blanca,
// el umbral anti-identificación y que el espejo de personas coincida con `personasNdf.ts`.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PERSONAS_NDF } from '../ndf/personasNdf'

const SQL = readFileSync(resolve(__dirname, '../../../supabase/migrations/194_mi_rendimiento_equipo.sql'), 'utf8')
const CODIGO = SQL.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
const ROLLBACK = readFileSync(resolve(__dirname, '../../../scripts/sql/194_rollback.sql'), 'utf8')

const API = ['pos_mi_rendimiento_equipo(text, date, date)', 'pos_mi_competencia(text, text)']
const INTERNAS = ['pos_persona_clave(text, date)', 'pos_rend_base(text, date, date)', 'pos_rend_productos(text, date, date)', 'pos_rend_yo(text)']

/** El cuerpo de una función (de su `create` al siguiente `create` o al final). */
function cuerpo(nombre: string): string {
  const i = CODIGO.indexOf(`create or replace function public.${nombre}(`)
  expect(i, nombre).toBeGreaterThan(-1)
  const j = CODIGO.indexOf('create or replace function', i + 10)
  return CODIGO.slice(i, j === -1 ? undefined : j)
}

describe('194 · permisos y forma', () => {
  it('las seis funciones tienen search_path fijo; las que leen tablas son security definer', () => {
    for (const f of [...API, ...INTERNAS]) {
      const c = cuerpo(f.split('(')[0])
      expect(c, f).toContain('set search_path = public, pg_temp')
      if (!f.startsWith('pos_persona_clave')) expect(c, f).toContain('security definer')
    }
  })

  it('API: sin EXECUTE para public ni anon, con EXECUTE para authenticated', () => {
    for (const f of API) {
      expect(CODIGO).toContain(`revoke all on function public.${f} from public, anon;`)
      expect(CODIGO).toContain(`grant execute on function public.${f} to authenticated;`)
    }
  })

  it('internas: sin EXECUTE para public, anon NI authenticated', () => {
    for (const f of INTERNAS) {
      expect(CODIGO).toContain(`revoke all on function public.${f} from public, anon, authenticated;`)
      expect(CODIGO).not.toContain(`grant execute on function public.${f} to authenticated`)
    }
  })

  it('el rol se valida ADENTRO (42501) y el manager queda en sus locales', () => {
    const yo = cuerpo('pos_rend_yo')
    expect(yo).toMatch(/v_rol not in \('owner', 'contador', 'manager', 'salonero', 'barman', 'barback', 'runner', 'cocina'\)/)
    expect(yo).toContain("v_rol = 'manager' and not (p_local = any (public.mis_locales()))")
    expect(yo).toContain("errcode = '42501'")
    expect(cuerpo('pos_mi_rendimiento_equipo')).toContain('v_yo := public.pos_rend_yo(p_local);')
    expect(cuerpo('pos_mi_competencia')).toContain('v_yo := public.pos_rend_yo(p_local);')
  })

  it('no toca tablas ni policies (regla 6): solo funciones', () => {
    expect(CODIGO).not.toMatch(/\b(create|alter|drop)\s+(table|policy|view)\b/i)
    expect(CODIGO).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i)
  })

  it('umbral anti-identificación K = 4 en las dos funciones de la API', () => {
    expect(CODIGO.match(/k_min constant integer := 4;/g)).toHaveLength(2)
  })

  it('lista blanca: lo que devuelve la función del equipo son solo estas claves', () => {
    const c = cuerpo('pos_mi_rendimiento_equipo')
    const claves = new Set([...c.matchAll(/'([a-z_]+)',\s/g)].map(m => m[1]).filter(k => !['bebida', 'closed', 'owner', 'contador'].includes(k)))
    expect([...claves].sort()).toEqual([
      'beb_pax', 'comida_pax', 'de', 'desde', 'dow', 'equipo', 'general', 'hasta', 'icp_equipo', 'k_min', 'mediana',
      'mi_posicion', 'motivo', 'pax', 'pax_dia', 'personas', 'por_dow', 'posicion', 'prom_pax', 'prom_ticket',
      'promedio', 'ranking', 'yo',
    ].sort())
    // Ni logins, ni claves de persona, ni nombres en la salida.
    expect(c).not.toMatch(/'(clave|login|nombre|salonero_login|full_name)'/)
  })

  it('la vuelta atrás borra exactamente las seis', () => {
    for (const f of [...API, ...INTERNAS]) expect(ROLLBACK).toContain(`drop function if exists public.${f.replace(/, /g, ', ')};`)
  })
})

describe('194 · espejo de personasNdf.ts (alias y vigencias)', () => {
  const filas = [...cuerpo('pos_persona_clave').matchAll(/\('([^']+)',\s*'([^']+)',\s*(date '([\d-]+)'|null::date),\s*(date '([\d-]+)'|null::date)\)/g)]
    .map(m => ({ cod: m[1], clave: m[2], desde: (m[4] ?? null) as string | null, hasta: (m[6] ?? null) as string | null }))

  it('cada código con alias o con vigencia de la tabla de la app está en la base, igual', () => {
    const esperadas = PERSONAS_NDF
      .filter(p => p.codigos.length > 1 || p.vigencias)
      .flatMap(p => p.codigos.map(c => ({
        cod: c, clave: p.id, desde: p.vigencias?.[c]?.desde ?? null, hasta: p.vigencias?.[c]?.hasta ?? null,
      })))
    const orden = (xs: typeof filas) => [...xs].sort((a, b) => a.cod.localeCompare(b.cod))
    expect(orden(filas)).toEqual(orden(esperadas))
  })
})

describe('194 · la app llama a las funciones con los nombres y parámetros de la base', () => {
  const API_TS = readFileSync(resolve(__dirname, './rendimientoEquipo.ts'), 'utf8')
  it('pos_mi_rendimiento_equipo(p_local, p_desde, p_hasta) y pos_mi_competencia(p_local, p_comp)', () => {
    expect(API_TS).toContain("sb.rpc('pos_mi_rendimiento_equipo', { p_local: local, p_desde: desde, p_hasta: hasta })")
    expect(API_TS).toContain("sb.rpc('pos_mi_competencia', { p_local: local, p_comp: compId })")
    expect(CODIGO).toContain('function public.pos_mi_rendimiento_equipo(p_local text, p_desde date, p_hasta date)')
    expect(CODIGO).toContain('function public.pos_mi_competencia(p_local text, p_comp text)')
  })
})
