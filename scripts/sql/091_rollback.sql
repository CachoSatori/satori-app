-- Rollback de la 091 (multilocal fase 0). Saca las políticas por local, la función, profile_locations y las
-- columnas location_id. `locations` se borra SOLO si nadie más la referencia (en staging la usa el PoS propio, 022).
begin;
-- Grok 137: la misma guarda que la vuelta atrás del PASE-091 §7. Si algo de esto no se cumple, FRENA sin tocar nada:
-- borrar la columna perdería a qué local pertenece una fila, o quedaría un local que solo existía por la 091.
do $$ begin
  if to_regclass('public.profile_locations') is not null and exists (select 1 from public.profile_locations) then
    raise exception '091 rollback: profile_locations tiene filas (alguien asignó locales): no se toca nada';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'location_id'
               and table_name in ('cash_sessions','cash_movements','cash_cierres_dia','tip_sessions')) then
    if exists (select 1 from public.cash_sessions    where location_id <> 'santa-teresa')
       or exists (select 1 from public.cash_movements   where location_id <> 'santa-teresa')
       or exists (select 1 from public.cash_cierres_dia where location_id <> 'santa-teresa')
       or exists (select 1 from public.tip_sessions     where location_id <> 'santa-teresa') then
      raise exception '091 rollback: hay filas fuera de santa-teresa: no se toca nada';
    end if;
  end if;
  if to_regclass('public.locations') is not null
     and (select coalesce(array_agg(id order by id), '{}') from public.locations) <> array['santa-teresa'] then
    raise exception '091 rollback: locations no tiene solo santa-teresa: no se toca nada';
  end if;
end $$;
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
