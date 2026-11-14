-- 162_rollback (origen 108) · Vuelta atrás de supabase/migrations/162_club_embudo_anfitrion.sql.
-- Saca la función del embudo y su interna de auditoría. No toca datos: la 162 no creó tablas ni columnas.
-- Las filas de club_auditoria ('ver_embudo_anfitrion', 'exporte_embudo_anfitrion_csv') QUEDAN: la auditoría es de solo
-- inserción; son rastro, no estado.
-- Borra la fila 162 del ledger. Si se corre en prod, en el mismo momento sale el .sql de la 162 de main (si queda, Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

drop function if exists public.club_embudo_anfitrion(date, text, boolean, uuid);
drop function if exists public.club_embudo_auditar_lectura(text, text, uuid, jsonb);

do $$
begin
  if to_regprocedure('public.club_embudo_anfitrion(date, text, boolean, uuid)') is not null
     or to_regprocedure('public.club_embudo_auditar_lectura(text, text, uuid, jsonb)') is not null then
    raise exception '162_rollback: alguna función sigue';
  end if;
end $$;

delete from supabase_migrations.schema_migrations where version = '162';
commit;
