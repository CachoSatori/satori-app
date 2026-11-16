-- Rollback de la 172 (origen club 118): saca los 20 envoltorios de la 172, devuelve cada <nombre>__nucleo a su nombre
-- (el cuerpo es el original: la 172 no lo tocó) con los permisos de antes (EXECUTE para authenticated, sin public ni
-- anon), y borra club_exigir_local_de. NO toca los envoltorios de la 170 ni sus helpers. No toca datos. Borra la fila 172
-- del ledger.
-- Vuelve el hallazgo 231: el manager otra vez puede pedir el local o el objeto de otro local por la API en estas 20.
-- Orden: ANTES que scripts/sql/170_rollback.sql (ese renombra todos los club_*__nucleo).
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
       'club_reporte_equipo__nucleo', 'club_primeros90_config_ver__nucleo', 'club_reto_en_visita__nucleo',
       'club_miembro_contacto_ver__nucleo', 'club_miembro_codigo__nucleo', 'club_miembro_token__nucleo',
       'club_miembro_regenerar_codigo__nucleo', 'club_pase_token__nucleo', 'club_rol_activar_anfitrion__nucleo',
       'club_socio_confirmar__nucleo', 'club_resolver_miembro__nucleo', 'club_canje__nucleo', 'club_canje_aprobado__nucleo',
       'club_tarjeta_manual__nucleo', 'club_cupon_usar__nucleo', 'club_canje_aviso__nucleo',
       'club_sin_cruce_candidatas__nucleo', 'club_sin_cruce_elegir__nucleo', 'club_pendiente_resolver__nucleo',
       'club_alerta_revisar__nucleo'])
  loop
    v_ident := pg_get_function_identity_arguments(r.oid);
    execute format('drop function if exists public.%I(%s)', r.nom, v_ident);
    execute format('alter function public.%I(%s) rename to %I', r.proname, v_ident, r.nom);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.nom, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);
  end loop;
end $$;

drop function if exists public.club_exigir_local_de(text);

delete from supabase_migrations.schema_migrations where version = '172';

commit;
