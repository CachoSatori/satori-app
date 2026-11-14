-- Rollback de la 167 (origen 113): club_portal vuelve a ser la de antes (la 150 o la 157, la que estaba: se le devuelve el
-- nombre a club_portal_datos, sin tocar su cuerpo) con el mismo permiso a anon y authenticated; salen el envoltorio,
-- club_portal_resena, club_resena_socio_toca, la tabla club_resena_socio (se pierden las marcas de pedido/cierre/clic: no
-- hay plata ni datos personales) y las dos columnas de club_config_global (resena_socio_cada y resena_socio_espera_dias).
-- Las filas de club_auditoria con cambios de esas columnas quedan (club_auditoria es de solo inserción: es historial).
-- Borra la fila 167 del ledger (la 113 nunca se aplicó con ese número).
-- Si se corre en prod, en el mismo momento sale el .sql de main (skill §6).
-- Orden: primero el código de club-web (revert del merge), así el portal deja de pintar la tarjeta y de marcar.
begin;

drop function if exists public.club_portal_resena(text, text);

do $$
begin
  if to_regprocedure('public.club_portal_datos(text)') is not null then
    drop function if exists public.club_portal(text);
    alter function public.club_portal_datos(text) rename to club_portal;
  end if;
end
$$;
comment on function public.club_portal(text) is null;
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

drop function if exists public.club_resena_socio_toca(uuid);
drop table if exists public.club_resena_socio;

alter table public.club_config_global drop constraint if exists club_config_global_resena_socio_cada_chk;
alter table public.club_config_global drop constraint if exists club_config_global_resena_socio_espera_chk;
alter table public.club_config_global drop column if exists resena_socio_cada;
alter table public.club_config_global drop column if exists resena_socio_espera_dias;

delete from supabase_migrations.schema_migrations where version = '167';

do $$
begin
  if to_regprocedure('public.club_portal(text)') is null
     or position('club_portal_datos' in (select prosrc from pg_proc where oid = 'public.club_portal(text)'::regprocedure)) > 0 then
    raise exception '167 rollback: club_portal no quedó como la de antes';
  end if;
  if not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE') then
    raise exception '167 rollback: club-web (anon) perdió el portal';
  end if;
  if to_regclass('public.club_resena_socio') is not null or to_regprocedure('public.club_portal_resena(text,text)') is not null then
    raise exception '167 rollback: quedaron objetos de la 167';
  end if;
end
$$;

commit;
