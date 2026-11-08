-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 091 — Multilocal fuera del Club, FASE 0: catálogo, columna de local y RLS por local.    ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ BORRADOR. NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL. Las decisiones del plan
--   (docs/MULTILOCAL-plan-caja.md §14) que usa esta migración son [PROVISORIAS]: Ismael no las firmó.
--   Ver docs/MULTILOCAL-fase0.md.
--
-- ── QUÉ HACE (y nada más) ──────────────────────────────────────────────────────────────────
--   1. Catálogo ÚNICO de locales: `public.locations` [PROVISORIA, decisión 1]. Es la misma tabla de la mig 022 del
--      PoS propio (en staging ya existe, con santa-teresa y nosara); en prod no existe y se crea igual. No se renombra
--      ninguna columna existente: lo nuevo se llama `location_id` y donde ya hay `local` (pos_ndf_*, BioTime) queda
--      `local` [PROVISORIA, decisión 11].
--   2. `location_id text not null default 'santa-teresa'` (FK a locations) en las tablas de caja y propinas que lo
--      necesitan: cash_sessions, cash_movements, cash_cierres_dia y tip_sessions. Es un DEFAULT constante: Postgres no
--      reescribe la tabla y TODAS las filas de hoy quedan en santa-teresa. tip_entries, movement_deletions y
--      movement_edits NO llevan columna: cuelgan de una fila que ya la tiene.
--   3. `profile_locations` (qué locales ve un usuario), `mis_locales()` y `puede_ver_local(local)`:
--        · owner y contador ven todos [PROVISORIA, decisión 2];
--        · el resto (manager, cajero, …) ve los locales de su fila en profile_locations; SIN filas, ve santa-teresa
--          (así nadie pierde acceso hoy, sin cargar nada).
--   4. RLS por local con políticas RESTRICTIVAS nuevas (se suman con AND a las de hoy, que NO se tocan) en las 4
--      tablas. Con un solo local y sin filas en profile_locations, cada usuario ve exactamente lo mismo que hoy.
--
-- ── QUÉ NO HACE (fases con firma: ver docs/MULTILOCAL-fase0.md) ─────────────────────────────
--   · Nada del cierre ni del pozo: el único de cash_cierres_dia sigue siendo (session_date); cerrar_dia_completo,
--     deshacer_cierre_dia y el client_op_id del ajuste no cambian (decisión 10: firma de sagrados).
--   · Nada de cajas físicas, banco, proveedores, puntos de propina ni pozo de propinas por local (decisiones 4–7).
--   · Ningún archivo sagrado (cashUtils, tipCalculations, cierrePozo, pozo, computeTotals/posFiscal, el cierre).
--   · Ninguna pantalla: la app no manda location_id y toma el default.
--   · Las funciones SECURITY DEFINER (el cierre, el borrado en cascada) corren como dueño de las tablas y no pasan
--     por estas políticas: no cambian.
--
-- Pruebas: scripts/sql/091_pruebas.sql (staging, transacción descartada: Santa Teresa idéntica). Rollback:
-- scripts/sql/091_rollback.sql.

begin;

-- ── 1. Catálogo ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.locations (
  id          text primary key,              -- slug estable ('santa-teresa')
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.locations (id, name) values ('santa-teresa', 'Satori Santa Teresa') on conflict (id) do nothing;

alter table public.locations enable row level security;
drop policy if exists locations_select_activos on public.locations;
create policy locations_select_activos on public.locations for select to authenticated
  using (get_my_role() is not null);
drop policy if exists locations_write_owner on public.locations;
create policy locations_write_owner on public.locations for all to authenticated
  using (get_my_role() = 'owner') with check (get_my_role() = 'owner');

-- ── 2. Columna de local (default santa-teresa) ──────────────────────────────────────────────
alter table public.cash_sessions     add column if not exists location_id text not null default 'santa-teresa' references public.locations(id);
alter table public.cash_movements    add column if not exists location_id text not null default 'santa-teresa' references public.locations(id);
alter table public.cash_cierres_dia  add column if not exists location_id text not null default 'santa-teresa' references public.locations(id);
alter table public.tip_sessions      add column if not exists location_id text not null default 'santa-teresa' references public.locations(id);

create index if not exists cash_sessions_location_idx    on public.cash_sessions (location_id);
create index if not exists cash_movements_location_idx   on public.cash_movements (location_id);
create index if not exists cash_cierres_dia_location_idx on public.cash_cierres_dia (location_id);
create index if not exists tip_sessions_location_idx     on public.tip_sessions (location_id);

-- ── 3. Qué locales ve cada usuario ──────────────────────────────────────────────────────────
create table if not exists public.profile_locations (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  location_id text not null references public.locations(id),
  principal   boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (profile_id, location_id)
);
create unique index if not exists profile_locations_un_principal on public.profile_locations (profile_id) where principal;

alter table public.profile_locations enable row level security;
drop policy if exists profile_locations_select on public.profile_locations;
create policy profile_locations_select on public.profile_locations for select to authenticated
  using (profile_id = auth.uid() or get_my_role() in ('owner', 'contador'));
drop policy if exists profile_locations_write_owner on public.profile_locations;
create policy profile_locations_write_owner on public.profile_locations for all to authenticated
  using (get_my_role() = 'owner') with check (get_my_role() = 'owner');

-- Los locales que ve el usuario actual, como lista. SECURITY DEFINER: lee profile_locations y locations sin depender
-- de su RLS. En las políticas se llama como `(select public.mis_locales())`: Postgres la evalúa UNA vez por consulta
-- (no por fila).
create or replace function public.mis_locales()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when get_my_role() is null then array[]::text[]                                        -- sin sesión o inactiva
    when get_my_role() in ('owner', 'contador')                                            -- [PROVISORIA, decisión 2]
      then coalesce((select array_agg(l.id order by l.id) from public.locations l), array[]::text[])
    when exists (select 1 from public.profile_locations pl where pl.profile_id = auth.uid())
      then (select array_agg(pl.location_id order by pl.location_id) from public.profile_locations pl
             where pl.profile_id = auth.uid())
    else array['santa-teresa']                                                             -- sin asignación: el de siempre
  end
$$;
revoke all on function public.mis_locales() from public, anon;
grant execute on function public.mis_locales() to authenticated, service_role;

-- Para la app (y para leer las políticas): ¿el usuario actual ve este local?
create or replace function public.puede_ver_local(p_local text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p_local = any (public.mis_locales()) $$;
revoke all on function public.puede_ver_local(text) from public, anon;
grant execute on function public.puede_ver_local(text) to authenticated, service_role;

-- ── 4. RLS por local: RESTRICTIVAS (AND con las de hoy, que no se tocan) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['cash_sessions', 'cash_movements', 'cash_cierres_dia', 'tip_sessions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_por_local', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (location_id = any ((select public.mis_locales()))) with check (location_id = any ((select public.mis_locales())))',
      t || '_por_local', t);
  end loop;
end $$;

commit;
