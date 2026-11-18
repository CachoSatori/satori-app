// Mig 191 — misma forma que la 067 (la app no cambia de llamada) y el criterio «cada uno ve lo suyo» en el SQL.
// Lee la migración: frena que una versión futura vuelva a abrir las facturas de otros o cuele columnas.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(__dirname, '../../../supabase/migrations')
const m067 = fs.readFileSync(path.join(dir, '067_pos_ventas_lectura_equipo.sql'), 'utf8')
const m191 = fs.readFileSync(path.join(dir, '191_pos_ventas_solo_lo_suyo.sql'), 'utf8')
const sinComentarios = (s: string) => s.replace(/--.*$/gm, '')

/** Las columnas del `returns table (...)` de una función (paréntesis balanceados, sin comentarios). */
function columnas(sql: string, fn: string): string[] {
  const i = sql.indexOf(`create or replace function public.${fn}(`)
  expect(i).toBeGreaterThanOrEqual(0)
  const limpio = sinComentarios(sql.slice(i))
  const desde = limpio.indexOf('returns table (') + 'returns table ('.length
  let prof = 1, j = desde
  for (; j < limpio.length && prof > 0; j++) { if (limpio[j] === '(') prof++; else if (limpio[j] === ')') prof-- }
  return limpio.slice(desde, j - 1).split(',').map(l => l.trim().split(/\s+/)[0]).filter(Boolean)
}

/** El cuerpo `as $$ … $$` de una función. */
function cuerpo(sql: string, fn: string): string {
  const i = sql.indexOf(`create or replace function public.${fn}(`)
  const a = sql.indexOf('$$', i) + 2
  return sinComentarios(sql.slice(a, sql.indexOf('$$', a)))
}

describe('mig 191 — misma forma que la 067', () => {
  for (const fn of ['pos_ventas_tickets_rango', 'pos_ventas_lineas', 'pos_ventas_latido']) {
    it(`${fn}: mismas columnas, en el mismo orden`, () => {
      expect(columnas(m191, fn)).toEqual(columnas(m067, fn))
    })
  }
})

describe('mig 191 — cada uno ve lo suyo', () => {
  const PERSONAL = "yo.rol in ('salonero', 'barman', 'barback', 'runner', 'cocina')"
  for (const fn of ['pos_ventas_tickets_rango', 'pos_ventas_lineas']) {
    it(`${fn}: el personal, solo por su login; el manager, solo sus locales`, () => {
      const c = cuerpo(m191, fn).replace(/\s+/g, ' ')
      expect(c).toContain(`${PERSONAL} and btrim(t.salonero_login) = any (yo.logins)`)
      expect(c).toContain("(yo.rol = 'manager' and t.local = any (yo.locs))")
      expect(c).toContain("yo.rol in ('owner', 'contador')")
      expect(c).not.toMatch(/get_my_role\(\) = any \(array\[/)   // el chequeo de rol viejo (todos ven todo)
    })
  }

  it('pos_nombres_por_login devuelve SOLO login y nombre, y solo para gerencia', () => {
    expect(columnas(m191, 'pos_nombres_por_login')).toEqual(['pos_login', 'nombre'])
    const c = cuerpo(m191, 'pos_nombres_por_login').replace(/\s+/g, ' ')
    expect(c).toContain("public.get_my_role() in ('owner', 'manager', 'contador')")
    expect(c).not.toMatch(/hourly|salary|banco|iban|homebanking|biotime|telefono|cedula|correo|email/i)
  })

  it('search_path fijo en todas, y revoke a public/anon (pos_mis_logins además a authenticated)', () => {
    const codigo = sinComentarios(m191)
    expect((codigo.match(/security definer\s+set search_path = public, pg_temp/g) ?? []).length).toBe(5)
    expect(codigo).toContain('revoke all on function public.pos_nombres_por_login() from public, anon;')
    expect(codigo).toContain('revoke all on function public.pos_mis_logins() from public, anon, authenticated;')
    expect(codigo).not.toMatch(/create policy|alter table/i)   // regla 6: pos_ndf_* sin policy nueva; employees tampoco
  })
})
