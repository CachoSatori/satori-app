-- Vuelta atrás de la 187 (club_reto_un_local). Devuelve el tope por año de la 169 (todos los locales), saca el trigger,
-- su función y el CHECK, y borra la fila 187 del ledger.
-- No toca datos: los retos quedan como estén (con un local cada uno, que también vale sin la 187). EN EL MISMO MOMENTO:
-- un PR que saca supabase/migrations/187_club_reto_un_local.sql de main (si queda, Branching la vuelve a aplicar; regla 10).
begin;

-- club_retos_reglas vuelve a la de la 169 (tope de 3 armados por año, todos los locales juntos), con guarda de md5
do $$
declare
  v_fn  constant regprocedure := 'public.club_retos_reglas()'::regprocedure;
  v_def text := pg_get_functiondef('public.club_retos_reglas()'::regprocedure);
  v_viejo constant text := $n$   where r.armado_en is not null and r.id <> new.id and extract(year from r.desde)::int = v_anio
     and r.locales && new.locales;   -- 187: el tope es POR LOCAL (un reto es de un solo local)
  if v_n >= 3 then
    raise exception 'Ya hay 3 retos armados en % en «%»: es el máximo por año y local', v_anio,
      coalesce((select c.nombre from public.club_config c where c.location_id = new.locales[1]), new.locales[1])
      using errcode = 'P0001';
$n$;
  v_nuevo constant text := $v$   where r.armado_en is not null and r.id <> new.id and extract(year from r.desde)::int = v_anio;
  if v_n >= 3 then
    raise exception 'Ya hay 3 retos armados en %: es el máximo por año', v_anio using errcode = 'P0001';
$v$;
begin
  if md5(v_def) <> 'badac2f48c64e3c57db7af170be173d0' then
    raise exception '187 rollback: club_retos_reglas no es la de la 187 (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
  if md5(pg_get_functiondef(v_fn)) <> '000ef92116630f046136fc56a90f5b6f' then
    raise exception '187 rollback: club_retos_reglas quedó con md5 % (se esperaba la de la 169)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;

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
