-- 161_rollback (origen 107) · Vuelta atrás de supabase/migrations/161_club_cohortes_ranking.sql.
-- Saca las cuatro funciones (cohortes, ranking y las internas de locales y de rastro). No toca datos: la 161 no creó tablas ni columnas.
-- Las filas de club_auditoria ('ver_cohortes', 'ver_ranking_socios', 'exporte_ranking_socios_csv') QUEDAN: la auditoría
-- es de solo inserción; son rastro, no estado.
-- Borra la fila 161 del ledger. El .sql de la 161 se QUEDA en main (regla 10 / satori-migraciones-y-prod §6): lo que se borra es su fila del ledger.
begin;

drop function if exists public.club_ranking_socios(date, date, text, boolean, uuid);
drop function if exists public.club_cohortes_socios(text, uuid);
drop function if exists public.club_locales_de_reporte(text);
drop function if exists public.club_auditar_lectura(text, text, uuid, jsonb);

do $$
begin
  if to_regprocedure('public.club_ranking_socios(date, date, text, boolean, uuid)') is not null
     or to_regprocedure('public.club_cohortes_socios(text, uuid)') is not null
     or to_regprocedure('public.club_locales_de_reporte(text)') is not null
     or to_regprocedure('public.club_auditar_lectura(text, text, uuid, jsonb)') is not null then
    raise exception '161_rollback: alguna función sigue';
  end if;
end $$;

delete from supabase_migrations.schema_migrations where version = '161';
commit;
