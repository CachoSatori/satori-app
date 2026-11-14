-- 160_rollback (origen 106) · Vuelta atrás de supabase/migrations/160_club_tablero_plata.sql.
-- Saca la función del tablero y la columna del % de cortesías. No toca datos de plata ni del PoS.
-- Las filas de club_auditoria ('ver_tablero') y de club_config_historial ('cortesia_costo_pct') QUEDAN: las dos tablas
-- son registros de solo lectura para la app (la auditoría es de solo inserción); son rastro, no estado.
-- Borra la fila 160 del ledger. El .sql de la 160 se QUEDA en main (regla 10 / satori-migraciones-y-prod §6): lo que se borra es su fila del ledger.
begin;

drop function if exists public.club_tablero_mes(date, text);
alter table public.club_config drop column if exists cortesia_costo_pct;

do $$
begin
  if to_regprocedure('public.club_tablero_mes(date, text)') is not null then
    raise exception '160_rollback: la función sigue';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'club_config' and column_name = 'cortesia_costo_pct') then
    raise exception '160_rollback: la columna sigue';
  end if;
end $$;

delete from supabase_migrations.schema_migrations where version = '160';
commit;
