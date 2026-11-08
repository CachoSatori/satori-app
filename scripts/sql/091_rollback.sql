-- Rollback de la 091 (multilocal fase 0). Saca las políticas por local, la función, profile_locations y las
-- columnas location_id. `locations` se borra SOLO si nadie más la referencia (en staging la usa el PoS propio, 022).
begin;
do $$
declare t text;
begin
  foreach t in array array['cash_sessions', 'cash_movements', 'cash_cierres_dia', 'tip_sessions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_por_local', t);
    execute format('drop index if exists public.%I', t || '_location_idx');
    execute format('alter table public.%I drop column if exists location_id', t);
  end loop;
end $$;
drop function if exists public.puede_ver_local(text);
drop function if exists public.mis_locales();
drop table if exists public.profile_locations;
do $$
begin
  if to_regclass('public.locations') is not null
     and not exists (select 1 from pg_constraint c where c.confrelid = 'public.locations'::regclass and c.contype = 'f') then
    drop table public.locations;
  else
    drop policy if exists locations_select_activos on public.locations;
    drop policy if exists locations_write_owner on public.locations;
  end if;
end $$;
delete from supabase_migrations.schema_migrations where version = '091';
commit;
