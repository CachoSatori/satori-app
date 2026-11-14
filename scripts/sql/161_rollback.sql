-- 161_rollback (origen 107) · Vuelta atrás de supabase/migrations/161_club_cohortes_ranking.sql.
-- Saca las tres funciones (cohortes, ranking y la interna de locales). No toca datos: la 161 no creó tablas ni columnas.
-- Las filas de club_auditoria ('ver_cohortes', 'ver_ranking_socios', 'exporte_ranking_socios_csv') QUEDAN: la auditoría
-- es de solo inserción; son rastro, no estado.
-- En el mismo momento, un PR que saca el .sql de la 161 de main (si queda, Branching la vuelve a aplicar).
begin;

drop function if exists public.club_ranking_socios(date, date, text, boolean);
drop function if exists public.club_cohortes_socios(text);
drop function if exists public.club_locales_de_reporte(text);

do $$
begin
  if to_regprocedure('public.club_ranking_socios(date, date, text, boolean)') is not null
     or to_regprocedure('public.club_cohortes_socios(text)') is not null
     or to_regprocedure('public.club_locales_de_reporte(text)') is not null then
    raise exception '161_rollback: alguna función sigue';
  end if;
end $$;

commit;
