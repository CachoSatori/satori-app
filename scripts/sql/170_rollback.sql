-- Rollback de la 170 (origen club 116): saca los envoltorios, devuelve cada <nombre>__nucleo a su nombre (el cuerpo es
-- el original: la 170 no lo tocó) con los permisos de antes (EXECUTE para authenticated, sin public ni anon), y borra
-- club_exigir_local y club_puede_ver_local. No toca datos. Borra la fila 170 del ledger.
-- Vuelve el hallazgo: el manager otra vez puede pedir cualquier local por la API.
-- Si se corre en prod, en el MISMO momento sale el .sql de main en un PR (regla 10 / satori-migraciones-y-prod §6): si
-- queda, Branching la vuelve a aplicar.
begin;

do $$
declare
  r record;
  v_ident text;
begin
  for r in
    select p.oid, p.proname, left(p.proname, length(p.proname) - length('__nucleo')) as nom
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'club\_%\_\_nucleo'
  loop
    v_ident := pg_get_function_identity_arguments(r.oid);
    execute format('drop function if exists public.%I(%s)', r.nom, v_ident);
    execute format('alter function public.%I(%s) rename to %I', r.proname, v_ident, r.nom);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.nom, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);
  end loop;
end $$;

drop function if exists public.club_exigir_local(text);
drop function if exists public.club_puede_ver_local(text);

delete from supabase_migrations.schema_migrations where version = '170';

commit;
