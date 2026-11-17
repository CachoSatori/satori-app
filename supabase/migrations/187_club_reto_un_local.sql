-- 187 (bloque de pase) · Retos por local: un reto pertenece a UN local; el owner ve todos.
--
-- Backlog del Club firmado por el dueño (16-nov), arreglo 3 de 4. Hasta ahora (mig 169) un reto podía tener varios
-- locales y sus contadores (ganados, usados, disponibles) sumaban todos: el manager de un local veía, en un reto
-- compartido, lo de los otros locales (lo marcó el verificador de la 176). Con un local por reto, el filtro de la 176
-- («solo los retos con algún local suyo») deja al manager exactamente los retos de su local, con los números de su
-- local; el owner sigue viendo todos. Para dos locales se arman dos retos (cada uno con su premio, fechas y meta).
--
-- Qué hace (NO reemplaza ninguna función existente → R13 no aplica):
--   1. Pre-chequeo: si ya hay retos con más de un local, ABORTA sin tocar nada (prod el 17-nov: 0 retos).
--   2. CHECK club_retos_un_local: cardinality(locales) = 1. Es la garantía (vale aunque se escriba por fuera).
--   3. Trigger club_retos_a_un_local_trg (BEFORE INSERT / UPDATE OF locales; nombre con «a_» para correr ANTES que
--      club_retos_reglas_trg): devuelve un mensaje claro «Un reto es de un solo local: elegí uno» (P0001), que
--      club_reto_guardar deja pasar tal cual (su manejador solo traduce check_violation y similares).
-- Lo que NO cambia: el tope de 3 retos armados por año sigue contando todos los locales juntos (cambiarlo a «por local»
-- es una decisión del dueño, aparte); club_retos_listar, club_reto_guardar/_armar/_terminar/_borrar, el portal y la caja.
--
-- Va después de la 186. Vuelta atrás: scripts/sql/187_rollback.sql. Pruebas: scripts/sql/187_pruebas.sql (+ .py).
begin;

do $$
begin
  if to_regclass('public.club_retos') is null or to_regprocedure('public.club_reto_guardar(uuid,jsonb)') is null then
    raise exception '187: falta la 169 (club_retos / club_reto_guardar)';
  end if;
  if to_regprocedure('public.club_retos_a_un_local()') is not null
     or exists (select 1 from pg_constraint where conname = 'club_retos_un_local') then
    raise exception '187: ya existe club_retos_a_un_local o el CHECK club_retos_un_local: se para sin tocar nada';
  end if;
  if exists (select 1 from public.club_retos r where cardinality(r.locales) <> 1) then
    raise exception '187: hay % reto(s) con más de un local (o ninguno): se para sin tocar nada; separarlos a mano antes',
      (select count(*) from public.club_retos r where cardinality(r.locales) <> 1);
  end if;
end $$;

alter table public.club_retos add constraint club_retos_un_local check (cardinality(locales) = 1);

create function public.club_retos_a_un_local()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if cardinality(new.locales) is distinct from 1 then
    raise exception 'Un reto es de un solo local: elegí uno (para otro local, armá otro reto)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.club_retos_a_un_local() from public, anon, authenticated;
comment on function public.club_retos_a_un_local() is
  '187: un reto pertenece a un solo local (mensaje claro antes del CHECK club_retos_un_local).';

create trigger club_retos_a_un_local_trg before insert or update of locales on public.club_retos
  for each row execute function public.club_retos_a_un_local();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_retos_un_local' and convalidated)
     or not exists (select 1 from pg_trigger where tgname = 'club_retos_a_un_local_trg' and tgrelid = 'public.club_retos'::regclass)
     or has_function_privilege('authenticated', 'public.club_retos_a_un_local()', 'execute') then
    raise exception '187: el CHECK, el trigger o sus permisos no quedaron como se esperaba';
  end if;
end $$;

commit;
