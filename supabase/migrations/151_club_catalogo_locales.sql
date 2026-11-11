-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 100 — Club: el catálogo de locales es public.locations (opción a del catálogo único).   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ SIN APLICAR. ORDEN EN PROD (Grok 127): 085 → 089 → 090 → 091 → 092 → pase del Club.
--   Supabase no aplica una migración con número menor que la última aplicada: la 100 NO se mergea antes que la 091 y
--   la 092. Necesita la 075 del Club (usa club_config).
--   DECISIÓN (CLUB-AUD-100, 09-nov): en el pase del Club, la 075 entra como 150 y ESTA como 151, en ese orden y en el
--   mismo pase (regla 3 de ESTADO.md: se renombran al bloque de pase, con su «origen»: 075 → 150, 100 → 151). No se
--   juntan en un solo archivo: cada una conserva su prueba y su vuelta atrás, y el rollback de la 100 no toca la 075.
--   El contenido es idempotente respecto de la 091 (las dos crean `locations` y sus políticas igual).
--
-- Origen: propuesta de caja `scripts/sql/091_propuesta_club_catalogo.sql` (rama claude/multilocal-fase0 @ a9b9607),
-- decisión del dueño del 08-nov (opción a: un solo catálogo de locales). Se ACEPTA con tres cambios:
--   1. RLS en `locations` también acá, igual que la 091. Si esta migración llega a prod ANTES que la 091, la tabla
--      nacería sin RLS y con los privilegios por defecto de `postgres` (authenticated = todo): cualquier usuario con
--      sesión podría escribir el catálogo.
--   2. El alta en el catálogo va en un TRIGGER antes del INSERT en club_config, no solo en `club_local_crear`. El alta
--      documentada de un local también es un INSERT directo (RUNBOOK «Encender un local», el migrador y 4 casos de la
--      batería): con la FK y el cambio solo en la función, esos caminos fallarían con 23503. Con el trigger, todos
--      pasan por el catálogo, y `club_local_crear` de la 075 no se copia acá (no hay dos versiones de la función).
--   3. Rollback propio (scripts/sql/100_rollback.sql) que NO borra `locations` ni sus filas: el catálogo es de caja
--      también.
-- Igual que la propuesta: santa-teresa asegurada, los locales que hoy están solo en club_config entran al catálogo
-- INACTIVOS para caja (el owner los activa), un local que ya existe en el catálogo se reutiliza tal cual (nombre y
-- estado de caja no cambian) y FK club_config.location_id → locations(id).
--
-- Pruebas: scripts/sql/100_pruebas.sql (staging, una transacción que termina en ROLLBACK). Rollback:
-- scripts/sql/100_rollback.sql.

begin;

-- ── 1. Catálogo (misma definición y políticas que la 091 y la 022) ──────────────────────────────
create table if not exists public.locations (
  id          text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.locations enable row level security;
drop policy if exists locations_select_activos on public.locations;
create policy locations_select_activos on public.locations for select to authenticated
  using (get_my_role() is not null);
drop policy if exists locations_write_owner on public.locations;
create policy locations_write_owner on public.locations for all to authenticated
  using (get_my_role() = 'owner') with check (get_my_role() = 'owner');
revoke all on public.locations from anon;

insert into public.locations (id, name) values ('santa-teresa', 'Satori Santa Teresa') on conflict (id) do nothing;

-- ── 2. Los locales que hoy están solo en el Club entran al catálogo, INACTIVOS para caja ────────
insert into public.locations (id, name, is_active)
select c.location_id, coalesce(nullif(btrim(c.nombre), ''), c.location_id), false
  from public.club_config c
on conflict (id) do nothing;

-- ── 3. Todo alta en club_config pasa primero por el catálogo (función, INSERT directo, migrador) ─
create or replace function public.club_config_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Un local nuevo entra INACTIVO para caja; si ya existe (un local de caja), se reutiliza sin tocarlo.
  insert into public.locations (id, name, is_active)
  values (new.location_id, coalesce(nullif(btrim(new.nombre), ''), new.location_id), false)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.club_config_catalogo() from public, anon, authenticated;

drop trigger if exists club_config_catalogo_trg on public.club_config;
create trigger club_config_catalogo_trg before insert on public.club_config
  for each row execute function public.club_config_catalogo();

-- ── 4. FK club_config → locations ───────────────────────────────────────────────────────────────
alter table public.club_config drop constraint if exists club_config_location_fk;
alter table public.club_config add constraint club_config_location_fk
  foreign key (location_id) references public.locations(id);

commit;
