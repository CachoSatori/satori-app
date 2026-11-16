-- Rollback de la 176 (origen club 122): saca los 5 envoltorios de la 176 (club_buscar, club_resolver,
-- club_socios_por_confirmar, club_socio_solicitudes_abiertas, club_retos_listar), devuelve cada <nombre>__nucleo a su
-- nombre (el cuerpo es el original: la 176 no lo tocó) con los permisos de antes (EXECUTE para authenticated, sin public
-- ni anon), borra club_ve_ficha, devuelve el mensaje de club_exigir_local_de a «Sin permiso en ese local» (el de la 172)
-- y las políticas RLS del Club a su condición de antes (solo por rol). NO toca la 170 ni la 172. No toca datos. Borra la
-- fila 176 del ledger.
-- Vuelve lo de antes: el manager otra vez ve en las listas (y por SELECT directo) las fichas de todos los locales.
-- Orden: ANTES que scripts/sql/172_rollback.sql y el de la 170.
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
     where n.nspname = 'public' and p.proname = any (array[
       'club_buscar__nucleo', 'club_resolver__nucleo', 'club_socios_por_confirmar__nucleo',
       'club_socio_solicitudes_abiertas__nucleo', 'club_retos_listar__nucleo'])
  loop
    v_ident := pg_get_function_identity_arguments(r.oid);
    execute format('drop function if exists public.%I(%s)', r.nom, v_ident);
    execute format('alter function public.%I(%s) rename to %I', r.proname, v_ident, r.nom);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.nom, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);
  end loop;
end $$;

drop function if exists public.club_ve_ficha(text);

-- club_exigir_local_de: el de la 172
create or replace function public.club_exigir_local_de(p_location text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Solo el manager. Los demás roles siguen igual que hoy: cada función ya decide si los deja entrar.
  if public.get_my_role() is distinct from 'manager'::public.user_role then
    return;
  end if;
  -- Objeto inexistente: nada que proteger; el núcleo contesta su «no encontrado» de siempre.
  if p_location is null then
    return;
  end if;
  if not public.club_puede_ver_local(p_location) then
    raise exception 'Sin permiso en ese local' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.club_exigir_local_de(text) from public, anon, authenticated;
grant execute on function public.club_exigir_local_de(text) to service_role;
comment on function public.club_exigir_local_de(text) is
  '172: para el manager, corta con 42501 si el local del objeto (miembro, cupón, movimiento…) no es suyo (club_puede_ver_local). Sin objeto (null) o con otro rol no hace nada.';

-- RLS: la condición de antes (solo por rol)
alter policy club_staff_select on public.club_miembros
  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));
alter policy club_staff_select on public.club_negocios
  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));
alter policy club_staff_select on public.club_movimientos
  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));
alter policy club_staff_select on public.club_visitas
  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));
alter policy club_roles_staff on public.club_miembro_roles
  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));
alter policy club_alertas_gerencia on public.club_alertas
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_comparacion_gerencia on public.club_comparacion_vieja
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_cruces_gerencia on public.club_cruces_manuales
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_cruces_hist_gerencia on public.club_cruces_manuales_historial
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_cupones_gerencia on public.club_cupones
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_cupones_contactos_gerencia on public.club_cupones_contactos
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_exc_gerencia on public.club_excepciones_resueltas
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_contacto_gerencia on public.club_miembros_contacto
  using (get_my_role() is not null and get_my_role() in ('owner','manager'))
  with check (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_pases_gerencia on public.club_pases
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_primeros90_ver on public.club_primeros90
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_resena_socio_ver on public.club_resena_socio
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));
alter policy club_retos_ganados_ver on public.club_retos_ganados
  using (get_my_role() is not null and get_my_role() in ('owner','manager'));

delete from supabase_migrations.schema_migrations where version = '176';

commit;
