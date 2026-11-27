// Mig 203 — «Es un proveedor real · recordar». Lee la migración, la 201 y la vuelta atrás y frena:
//   · que el motivo que quita la 203 (y que filtra la pantalla) deje de ser EXACTAMENTE el que escribe fe_ingestar (201);
//   · que la guarda md5 de la 203 no sea la del cuerpo de fe_ingestar / fe_motivo_sumar del archivo de la 201;
//   · que las funciones pierdan SECURITY DEFINER / search_path, queden para anon o sin chequeo de rol;
//   · que la vuelta atrás no borre lo que la 203 crea;
//   · que la pantalla llame a otra función o con otro parámetro.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MOTIVO_EMISOR } from '../fe/emisoresPendientes'

const raiz = path.resolve(__dirname, '../../..')
const leer = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')
const s203 = leer('supabase/migrations/203_fe_emisor_recordar.sql')
const s201 = leer('supabase/migrations/201_fe_versiones_revisar.sql')
const rollback = leer('scripts/sql/203_rollback.sql')
const api = leer('src/shared/api/feEmisores.ts')
const plano = (s: string) => s.replace(/\s+/g, ' ')

/** md5 del prosrc sin espacios, como lo mide la guarda en la base. */
function md5Cuerpo(fuente: string, f: string): string {
  const i = fuente.search(new RegExp(`function public\\.${f}\\(`))
  expect(i, f).toBeGreaterThan(-1)
  const a = fuente.indexOf('$function$', i) + '$function$'.length
  const b = fuente.indexOf('$function$', a)
  return createHash('md5').update(fuente.slice(a, b).replace(/\s/g, '')).digest('hex')
}

describe('mig 203 — contrato', () => {
  it('el motivo de emisor no conocido es el mismo texto en la 201, la 203 y la pantalla', () => {
    expect(s201).toContain(`else '${MOTIVO_EMISOR}' end);`)
    expect(s203).toContain(`m_emisor constant text := '${MOTIVO_EMISOR}';`)
    expect(s201).toContain("concat_ws(' · ', p_nuevo") // el separador que parten la 203 y agruparPendientes
  })
  it('la guarda de la 203 usa el md5 del archivo de la 201', () => {
    expect(s203).toContain(`('fe_ingestar',     '${md5Cuerpo(s201, 'fe_ingestar')}')`)
    expect(s203).toContain(`('fe_motivo_sumar', '${md5Cuerpo(s201, 'fe_motivo_sumar')}')`)
  })
  it.each(['fe_emisor_recordar', 'fe_emisor_desactivar'])('%s: SECURITY DEFINER, search_path fijo, solo authenticated, rol chequeado', f => {
    const i = s203.indexOf(`create function public.${f}(`)
    const cuerpo = plano(s203.slice(i, s203.indexOf(`grant execute on function public.${f}`, i)))
    expect(cuerpo).toContain('security definer set search_path = public, pg_temp')
    expect(cuerpo).toContain("using errcode = '42501'")
    expect(s203).toContain(`revoke all on function public.${f}(text) from public, anon, authenticated;`)
    expect(s203).toContain(`grant execute on function public.${f}(text) to authenticated;`)
    expect(s203).not.toMatch(new RegExp(`grant [^;]*on function public\\.${f}[^;]*anon`))
  })
  it('recordar lo pueden owner y contador; desactivar solo owner', () => {
    expect(s203).toContain("v_rol not in ('owner', 'contador') then\n    raise exception 'Solo el owner y el contador recuerdan")
    expect(s203).toContain("if v_uid is null or v_rol is distinct from 'owner' then\n    raise exception 'Solo el owner desactiva")
  })
  it('no escribe fe_ingesta_bitacora (alimenta «Última ingesta»)', () => {
    expect(s203.replace(/--.*$/gm, '')).not.toMatch(/insert into public\.fe_ingesta_bitacora/)
  })
  it('la vuelta atrás borra lo que la 203 crea', () => {
    expect(rollback).toContain('drop function if exists public.fe_emisor_recordar(text);')
    expect(rollback).toContain('drop function if exists public.fe_emisor_desactivar(text);')
    expect(rollback).toContain('drop table if exists public.fe_emisores_bitacora;')
    for (const c of ['nombre', 'origen', 'aprobado_por', 'aprobado_en']) expect(rollback).toContain(`drop column if exists ${c}`)
  })
  it('la pantalla llama a las funciones de la 203 con p_cedula', () => {
    expect(api).toContain("sb.rpc('fe_emisor_recordar', { p_cedula: cedula })")
    expect(api).toContain("sb.rpc('fe_emisor_desactivar', { p_cedula: cedula })")
    expect(s203).toContain('create function public.fe_emisor_recordar(p_cedula text)')
    expect(s203).toContain('create function public.fe_emisor_desactivar(p_cedula text)')
  })
})
