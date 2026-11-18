-- Vuelta atrás de la 186 (club_cumple_deshacer_envio). Borra las tres funciones nuevas y la fila 186 del ledger.
-- No toca datos: club_cumple_envios queda como esté (las marcas borradas por un «deshacer» quedan en club_auditoria,
-- acción cumple_deshacer_envio, con la fila completa en «antes»). EN EL MISMO MOMENTO: un PR que saca
-- supabase/migrations/186_club_cumple_deshacer_envio.sql de main (si queda, Branching la vuelve a aplicar; regla 10).
begin;

drop function if exists public.club_cumple_deshacer_envio(uuid, text, text);
drop function if exists public.club_cumple_enviados(text);
drop function if exists public.club_cumple_enviados_lista(text, date);
delete from supabase_migrations.schema_migrations where version = '186';

do $$
begin
  if to_regprocedure('public.club_cumple_deshacer_envio(uuid,text,text)') is not null
     or to_regprocedure('public.club_cumple_enviados(text)') is not null
     or to_regprocedure('public.club_cumple_enviados_lista(text,date)') is not null then
    raise exception '186 rollback: quedó alguna función de la 186';
  end if;
end $$;

commit;
