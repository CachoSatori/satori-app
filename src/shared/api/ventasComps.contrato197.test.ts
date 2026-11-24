// Mig 197 — Competencias de Ventas: el contador solo mira (D18). Lee la migración y su vuelta atrás: frena que una versión
// futura vuelva a dejar escribir al contador en la base, o que la base y la app (ROLES_EDITAN_COMPETENCIAS) se separen.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ROLES_EDITAN_COMPETENCIAS } from '../permisosCompetencias'

const raiz = path.resolve(__dirname, '../../..')
const leer = (f: string) => fs.readFileSync(path.join(raiz, f), 'utf8')
const sinComentarios = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()
const m197 = sinComentarios(leer('supabase/migrations/197_ventas_comps_sin_contador.sql'))
/** Sin el `comment on policy … is '…';` (su texto nombra al contador y la lectura a propósito). */
const m197Codigo = m197.replace(/comment on policy ventas_comps_write on public\.ventas_comps is '[^']*';/, '')
const rollback = sinComentarios(leer('scripts/sql/197_rollback.sql'))

describe('mig 197 — escritura de ventas_comps solo owner y manager', () => {
  it('reemplaza ventas_comps_write (idempotente) con owner y manager en USING y WITH CHECK', () => {
    expect(m197).toContain('drop policy if exists ventas_comps_write on public.ventas_comps;')
    expect(m197).toContain(
      "create policy ventas_comps_write on public.ventas_comps for all to authenticated" +
      " using ((select public.get_my_role()) in ('owner', 'manager'))" +
      " with check ((select public.get_my_role()) in ('owner', 'manager'));")
  })

  it('el contador no aparece en el código de la migración (sí en los comentarios y el texto de la política)', () => {
    expect(m197Codigo).not.toBe(m197)   // el comment on policy está y se sacó
    expect(m197Codigo).not.toMatch(/contador/)
  })

  it('enciende la RLS de la tabla y no toca la lectura ni otras tablas', () => {
    expect(m197).toContain('alter table public.ventas_comps enable row level security;')
    expect(m197Codigo).not.toMatch(/ventas_comps_read/)
    expect(m197).not.toMatch(/disable row level security/)
    const tablas = [...m197.matchAll(/ on public\.(\w+)/g)].map(x => x[1])
    expect(new Set(tablas)).toEqual(new Set(['ventas_comps']))
  })

  it('la base deja escribir a los mismos roles que la app (ROLES_EDITAN_COMPETENCIAS)', () => {
    const roles = /using \(\(select public\.get_my_role\(\)\) in \(([^)]*)\)\)/.exec(m197)?.[1]
    expect(roles?.split(',').map(r => r.trim().replace(/'/g, '')).sort()).toEqual([...ROLES_EDITAN_COMPETENCIAS].sort())
  })
})

describe('mig 197 — vuelta atrás', () => {
  it('deja la política como prod antes de la 197 (owner, manager y contador) y no toca el ledger', () => {
    expect(rollback).toContain(
      "create policy ventas_comps_write on public.ventas_comps for all to authenticated" +
      " using (public.get_my_role() in ('owner', 'manager', 'contador'))" +
      " with check (public.get_my_role() in ('owner', 'manager', 'contador'));")
    expect(rollback).not.toMatch(/schema_migrations|ventas_comps_read|row level security/i)
  })
})
