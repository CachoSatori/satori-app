// Contrato de la 202 (`pos_familia_nombre_guardar`) contra su lector en la app. Lee el .sql (como contrato198): si alguien
// le abre la puerta a otro rol, le deja tocar la categoría o el orden, o cambia los nombres de los parámetros, cae acá
// antes que en staging. La batería SQL (scripts/sql/202_pruebas.sql) prueba lo mismo contra una base de verdad.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const leer = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const SQL = leer('supabase/migrations/202_pos_familia_nombre.sql')
const API = leer('src/shared/api/posNdf.ts')
const cuerpo = SQL.slice(SQL.indexOf('create function public.pos_familia_nombre_guardar'), SQL.indexOf('$function$;') + 11)

describe('202 · pos_familia_nombre_guardar', () => {
  it('firma: (p_local text, p_familia integer, p_nombre text) returns text, y la app manda esos tres nombres', () => {
    expect(cuerpo).toMatch(/pos_familia_nombre_guardar\(p_local text, p_familia integer, p_nombre text\)\nreturns text/)
    expect(API).toContain("sb.rpc('pos_familia_nombre_guardar', { p_local: local, p_familia: familia, p_nombre: nombre })")
  })
  it('SECURITY DEFINER con search_path fijo', () => {
    expect(cuerpo).toMatch(/security definer\nset search_path = public, pg_temp\n/)
  })
  it('solo el owner (el resto 42501); anon y public sin execute', () => {
    expect(cuerpo).toContain("if v_rol is distinct from 'owner' then\n    raise exception 'No autorizado' using errcode = '42501';")
    expect(cuerpo).not.toMatch(/'manager'|'contador'/)
    expect(SQL).toContain('revoke all on function public.pos_familia_nombre_guardar(text, integer, text) from public, anon;')
    expect(SQL).not.toMatch(/grant execute on function public\.pos_familia_nombre_guardar[^;]*\banon\b/)
  })
  it('escribe SOLO el nombre de una fila que ya existe: no inserta, no borra, no toca categoría ni orden', () => {
    const escrituras = cuerpo.match(/\b(insert|update|delete)\b[^;]*;/gi) ?? []
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0]).toMatch(/^update public\.pos_familias f set nombre = v_nom\s+where f\.local = p_local and f\.familia = p_familia;$/)
  })
  it('el código (sin comentarios) no nombra pos_ndf_*, product_map ni la tabla de ajustes', () => {
    const codigo = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(codigo).not.toMatch(/pos_ndf_|product_map|pos_producto_ajustes/)
  })
  it('registrada como 202 en el bloque operacion2', () => {
    const reg = JSON.parse(leer('supabase/migraciones-reservadas.json')) as { migraciones?: Record<string, { bloque: string; nombre: string }> } & Record<string, unknown>
    const todas = JSON.stringify(reg)
    expect(todas).toMatch(/"202":\{"nombre":"pos_familia_nombre","bloque":"operacion2"/)
  })
})
