// Mig 201 — compras F1, hallazgos 257/258. Lee la migración y su vuelta atrás y frena:
//   · que el resumen cambie el orden de un arreglo que la pantalla lee por posición;
//   · que la vuelta atrás no deje las funciones de la Edge y el resumen EXACTOS como la 199;
//   · que una función de la Edge quede ejecutable por usuarios o pierda SECURITY DEFINER / search_path;
//   · que la ruta del XML en Storage deje de llevar el sha (258).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { rutaXml } from '../fe/sobreFe'

const raiz = path.resolve(__dirname, '../../..')
const leer = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')
const sql = leer('supabase/migrations/201_fe_versiones_revisar.sql')
const s199 = leer('supabase/migrations/199_fe_ingesta.sql')
const rollback = leer('scripts/sql/201_rollback.sql')
const codigo = sql.replace(/--.*$/gm, '')
const plano = (s: string) => s.replace(/\s+/g, ' ')

/** El bloque `create function public.<f>(` … hasta su `grant execute` (incluido), tal cual. */
function bloque(fuente: string, f: string): string {
  const i = fuente.search(new RegExp(`create (or replace )?function public\\.${f}\\(`))
  expect(i, f).toBeGreaterThan(-1)
  const fin = fuente.indexOf('grant execute on function public.' + f, i)
  return fuente.slice(i, fuente.indexOf('\n', fin)).replace(/^create (or replace )?function/, 'create function')
}

describe('mig 201 — contrato', () => {
  it('el resumen mantiene el orden de los arreglos de la 199', () => {
    const p = plano(codigo)
    expect(p).toContain("'dias', coalesce((select jsonb_agg(jsonb_build_array(d.dia, d.nuevo, d.duplicado, d.revisar, d.no_comprobante, d.sin_xml, d.error)")
    expect(p).toContain('jsonb_build_array(l.fuente, l.ultimo_en)')
    expect(p).toContain('jsonb_build_array(r.estado_parseo, r.motivo, r.n)')
    expect(p).toContain('jsonb_build_array(e.ts, e.resultado, e.motivo, e.fin)')
  })
  it.each(['fe_ingestar', 'fe_respuesta_registrar', 'fe_ingesta_resumen'])('la vuelta atrás deja %s IGUAL a la 199', f => {
    expect(bloque(rollback, f)).toBe(bloque(s199, f))
  })
  it('la vuelta atrás borra lo que la 201 crea', () => {
    for (const t of ['fe_comprobante_versiones', 'fe_respuesta_versiones', 'fe_emisores_conocidos']) {
      expect(rollback).toContain(`drop table if exists public.${t};`)
    }
    expect(rollback).toContain('drop function if exists public.fe_motivo_sumar(text, text);')
    for (const c of ['huella', 'estado', 'motivo']) expect(rollback).toContain(`drop column if exists ${c}`)
  })
  it('las funciones de la Edge: SECURITY DEFINER, search_path fijo, solo service_role', () => {
    for (const f of ['fe_ingestar', 'fe_respuesta_registrar']) {
      const b = plano(bloque(codigo, f))
      expect(b).toContain('security definer set search_path = public, pg_temp')
      expect(codigo).toContain(`revoke all on function public.${f}(jsonb) from public, anon, authenticated;`)
      expect(codigo).toContain(`grant execute on function public.${f}(jsonb) to service_role;`)
    }
    expect(codigo).not.toMatch(/grant [^;]*on function public\.fe_(ingestar|respuesta_registrar|motivo_sumar)[^;]*(authenticated|anon)/)
    expect(codigo).not.toMatch(/on conflict \(clave\) do nothing/)
  })
  it('258: la ruta de Storage termina en /<sha>.xml, la misma forma que exige fe_ingestar', () => {
    const sha = '0f'.repeat(32)
    const ruta = rutaXml('5' + '0'.repeat(49), sha)
    expect(ruta.slice(-69)).toBe(`/${sha}.xml`)
    expect(codigo).toContain("right(v_path, 69) <> '/' || v_sha || '.xml'")
  })
})
