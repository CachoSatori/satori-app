-- 205_rollback · vuelve EXACTO a la 198: `pos_catalogo_registrar` con el cuerpo de la 198, sin `pos_catalogo_reparar`
-- ni `pos_catalogo_fallas` / `pos_catalogo_reparaciones`. Correr en UNA transacción (begin … commit; la batería la incrusta en la suya). GUARDA: solo corre si el disparador en la base es el de la 205.
-- ANTES (en prod, con firma): guardar las filas de `pos_catalogo_fallas` (select * … a un CSV fuera del repo): se borran.
-- Si la 205 ya está en el ledger de prod, su .sql se queda (regla 10) y esto va como migración nueva.
do $deshacer205$
declare
  v_reg text;
begin
  select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_reg
    from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure;
  if v_reg is distinct from '7cc9af6883242326a8aab0d20b004cb7' or to_regclass('public.pos_catalogo_fallas') is null
     or to_regclass('public.pos_catalogo_reparaciones') is null then
    raise exception '205_rollback: el disparador en la base no es el de la 205 (%): se para sin tocar nada', left(coalesce(v_reg, '-'), 8);
  end if;
  raise notice '205_rollback: se borran % fallas (% abiertas)', (select count(*) from public.pos_catalogo_fallas),
    (select count(*) from public.pos_catalogo_fallas where resuelta_en is null);
end
$deshacer205$;

drop function public.pos_catalogo_reparar(text);

create or replace function public.pos_catalogo_registrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  begin
    perform public.pos_catalogo_absorber(array(select distinct ticket_id from nuevas));
  exception when others then
    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;
revoke all on function public.pos_catalogo_registrar() from public, anon, authenticated;
comment on function public.pos_catalogo_registrar() is null;

drop table public.pos_catalogo_fallas;
drop table public.pos_catalogo_reparaciones;
