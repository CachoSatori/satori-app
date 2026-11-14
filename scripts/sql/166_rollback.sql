-- 166_rollback (origen 112) · Vuelta atrás de supabase/migrations/166_club_grupo_control.sql.
-- Saca las funciones de campañas y las dos tablas (club_campanas, club_campana_asignaciones) con sus triggers.
-- ⚠ Borrar las tablas borra los sorteos. Solo se corre si NO hay campañas reales (el piloto todavía no las usa). Con
-- campañas reales ya no se borra: se quita la pestaña de la app y se arregla con una migración nueva (skill de
-- migraciones, §6). Este script frena si encuentra alguna campaña.
-- Las filas de club_auditoria ('campana_crear', 'campana_sumar', 'exporte_campana_csv', 'ver_campana_*') QUEDAN: la
-- auditoría es de solo inserción; son rastro, no estado.
-- En el mismo momento, un PR que saca el .sql de la 166 de main (si queda, Branching la vuelve a aplicar).
begin;

do $$
begin
  if to_regclass('public.club_campanas') is not null
     and exists (select 1 from public.club_campanas c where c.location_id !~ '^p166-') then
    raise exception '166_rollback: hay campañas reales; no se borran (arreglar con una migración nueva)';
  end if;
end $$;

drop function if exists public.club_campana_reporte(uuid, uuid);
drop function if exists public.club_campana_lista(uuid, boolean, uuid);
drop function if exists public.club_campanas_listar(text);
drop function if exists public.club_campana_sumar_nuevos(uuid);
drop function if exists public.club_campana_crear(text, text, numeric, text);
drop function if exists public.club_campana_tamanos(uuid);
drop function if exists public.club_campana_sumar(uuid);
drop function if exists public.club_campana_saldos(text);
drop function if exists public.club_campana_auditar_lectura(text, uuid, jsonb);
drop function if exists public.club_campana_de_owner(uuid);
drop table if exists public.club_campana_asignaciones;
drop table if exists public.club_campanas;
drop function if exists public.club_campana_inmutable();
drop function if exists public.club_campana_asignar_trg();
drop function if exists public.club_campana_sorteo(text, uuid, uuid);

do $$
begin
  if to_regclass('public.club_campanas') is not null or to_regclass('public.club_campana_asignaciones') is not null
     or to_regprocedure('public.club_campana_reporte(uuid, uuid)') is not null
     or to_regprocedure('public.club_campana_crear(text, text, numeric, text)') is not null
     or to_regprocedure('public.club_campana_sorteo(text, uuid, uuid)') is not null then
    raise exception '166_rollback: algo de la 166 sigue';
  end if;
end $$;

commit;
