-- Vuelta atrás de la 187 (club_reto_un_local). Saca el trigger, su función y el CHECK, y borra la fila 187 del ledger.
-- No toca datos: los retos quedan como estén (con un local cada uno, que también vale sin la 187). EN EL MISMO MOMENTO:
-- un PR que saca supabase/migrations/187_club_reto_un_local.sql de main (si queda, Branching la vuelve a aplicar; regla 10).
begin;

drop trigger if exists club_retos_a_un_local_trg on public.club_retos;
drop function if exists public.club_retos_a_un_local();
alter table public.club_retos drop constraint if exists club_retos_un_local;
delete from supabase_migrations.schema_migrations where version = '187';

do $$
begin
  if to_regprocedure('public.club_retos_a_un_local()') is not null
     or exists (select 1 from pg_constraint where conname = 'club_retos_un_local')
     or exists (select 1 from pg_trigger where tgname = 'club_retos_a_un_local_trg') then
    raise exception '187 rollback: quedó algo de la 187';
  end if;
end $$;

commit;
