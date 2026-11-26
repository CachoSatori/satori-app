// Mig 199 — compras F1. Lee la migración (patrón de contrato198) y frena:
//   · que cambie el orden de un arreglo que la pantalla lee por posición;
//   · que la vuelta atrás se olvide de algo que la 199 crea;
//   · que una función de la Edge quede ejecutable por usuarios, o una tabla escribible por la API;
//   · que el parser mande un campo que fe_ingestar no lee (o al revés): el dato se perdería en silencio.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { haceCuanto, parsearResumenIngesta } from '../fe/resumenIngesta'
import { parsearFe } from '../fe/parseFe'
import { xmlFicticio } from '../fe/fixturasFe.testutil'

const raiz = path.resolve(__dirname, '../../..')
const sql = fs.readFileSync(path.join(raiz, 'supabase/migrations/199_fe_ingesta.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(raiz, 'scripts/sql/199_rollback.sql'), 'utf8')
const codigo = sql.replace(/--.*$/gm, '')
const plano = (s: string) => s.replace(/\s+/g, ' ')

describe('mig 199 — forma de fe_ingesta_resumen (la pantalla lee por posición)', () => {
  it('dias: [dia, nuevo, duplicado, revisar, no_comprobante, sin_xml, error]', () => {
    expect(plano(codigo)).toContain("'dias', coalesce((select jsonb_agg(jsonb_build_array(d.dia, d.nuevo, d.duplicado, d.revisar, d.no_comprobante, d.sin_xml, d.error)")
  })
  it('latidos: [fuente, ultimo_en] · revisar: [estado, motivo, n] · errores: [ts, resultado, motivo, fin]', () => {
    const p = plano(codigo)
    expect(p).toContain('jsonb_build_array(l.fuente, l.ultimo_en)')
    expect(p).toContain('jsonb_build_array(r.estado_parseo, r.motivo, r.n)')
    expect(p).toContain('jsonb_build_array(e.ts, e.resultado, e.motivo, e.fin)')
  })
  it('parsearResumenIngesta lee ese orden', () => {
    const r = parsearResumenIngesta({
      latidos: [['santa-teresa', '2026-11-30T15:00:00Z']],
      dias: [['2026-11-30', 6, 1, 2, 0, 1, 3]],
      revisar: [['receptor_distinto', 'cédula del receptor no configurada', 1]],
      errores: [['2026-11-30T15:00:00Z', 'error', 'XML ilegible: x', null]],
      ultima: '2026-11-30T15:00:00Z',
    })
    expect(r.dias[0]).toEqual({ dia: '2026-11-30', nuevo: 6, duplicado: 1, revisar: 2, no_comprobante: 0, sin_xml: 1, error: 3 })
    expect(r.latidos[0]).toEqual({ fuente: 'santa-teresa', ultimo_en: '2026-11-30T15:00:00Z' })
    expect(r.revisar[0].n).toBe(1)
    expect(r.errores[0].fin_clave).toBeNull()
  })
  it('respuesta vacía o rara no tira', () => {
    expect(parsearResumenIngesta(null)).toEqual({ latidos: [], dias: [], revisar: [], errores: [], ultima: null })
  })
})

describe('mig 199 — permisos', () => {
  it('las cuatro funciones de la Edge: revoke a usuarios, execute solo a service_role', () => {
    for (const f of ['fe_ingestar(jsonb)', 'fe_respuesta_registrar(jsonb)', 'fe_bitacora_anotar(text, text, text, text, text)', 'fe_latido(text)']) {
      expect(codigo).toContain(`revoke all on function public.${f} from public, anon, authenticated;`)
      expect(codigo).toContain(`grant execute on function public.${f} to service_role;`)
    }
  })
  it('a authenticated solo se le da select (y en fe_receptores, insert/update de tres columnas)', () => {
    const grants = [...codigo.matchAll(/grant ([^;]+) to authenticated;/g)].map(m => plano(m[1]))
    expect(grants).toEqual([
      'select on table public.fe_receptores, public.fe_comprobantes, public.fe_lineas, public.fe_respuestas, public.fe_ingesta_bitacora, public.fe_ingesta_latido',
      'insert (cedula, location_id, activo), update (location_id, activo) on table public.fe_receptores',
      'execute on function public.fe_ingesta_resumen(integer)',
    ])
  })
  it('el bucket nace privado', () => {
    expect(plano(codigo)).toContain("values ('fe-xml', 'fe-xml', false, 1048576)")
  })
})

describe('mig 199 — la vuelta atrás borra todo lo que crea', () => {
  it('cada tabla y función creada tiene su drop', () => {
    const tablas = [...codigo.matchAll(/create table (public\.\w+)/g)].map(m => m[1])
    const funciones = [...codigo.matchAll(/create function (public\.\w+)\(/g)].map(m => m[1])
    expect(tablas).toHaveLength(6)
    expect(funciones).toHaveLength(6)
    for (const t of tablas) expect(rollback).toContain(`drop table if exists ${t};`)
    for (const f of funciones) expect(rollback).toContain(`drop function if exists ${f}(`)
  })
  // Batería en staging del 25-nov: un `delete from storage.buckets` en el .sql lo frena storage.protect_delete (42501) y
  // para la vuelta atrás entera. El bucket se vacía y se borra por la API de Storage, como paso aparte (PASE-199 §6).
  it('no toca storage.buckets ni storage.objects por SQL (el bucket va por la API de Storage)', () => {
    const sentencias = rollback.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(sentencias).not.toMatch(/storage\.(buckets|objects)/i)
  })
})

describe('mig 199 ↔ parser: los campos coinciden', () => {
  const r = parsearFe(xmlFicticio())
  if (r.clase !== 'comprobante') throw new Error('fixture')
  const fn = codigo.slice(codigo.indexOf('create function public.fe_ingestar('), codigo.indexOf('create function public.fe_respuesta_registrar('))
  it('cada campo del comprobante que manda el parser lo lee fe_ingestar', () => {
    const leidos = new Set([...fn.matchAll(/c ->> '(\w+)'/g)].map(m => m[1]))
    expect(Object.keys(r.comprobante).filter(k => !leidos.has(k))).toEqual([])
  })
  it('cada campo de la línea que manda el parser lo lee fe_ingestar', () => {
    const leidos = new Set([...fn.matchAll(/l ->> '(\w+)'/g)].map(m => m[1]))
    expect(Object.keys(r.lineas[0]).filter(k => !leidos.has(k))).toEqual([])
  })
})

describe('haceCuanto', () => {
  const ahora = new Date('2026-11-30T18:00:00Z')
  it('minutos, horas, días y alerta pasadas 6 h', () => {
    expect(haceCuanto('2026-11-30T17:52:00Z', ahora)).toEqual({ texto: 'hace 8 min', alerta: false })
    expect(haceCuanto('2026-11-30T13:00:00Z', ahora)).toEqual({ texto: 'hace 5 h', alerta: false })
    expect(haceCuanto('2026-11-30T11:59:00Z', ahora)).toEqual({ texto: 'hace 6 h', alerta: true })
    expect(haceCuanto('2026-11-27T18:00:00Z', ahora)).toEqual({ texto: 'hace 3 d', alerta: true })
    expect(haceCuanto(null, ahora)).toEqual({ texto: 'nunca', alerta: true })
  })
})
