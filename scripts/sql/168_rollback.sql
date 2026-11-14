-- Rollback de la 168 (origen 114): club_socio_visita y club_pase_datos vuelven a ser las de antes (se les devuelve el
-- nombre a club_socio_visita_base y club_pase_datos_base, sin tocar su cuerpo), con los mismos permisos; salen
-- club_portal_avance, las funciones club_primeros90_*, la tabla club_primeros90 y las columnas nuevas
-- (club_config_global.primeros90_*, club_config.primeros90_cortesia_id, club_miembros.sin_avance).
-- Las filas de club_auditoria y club_config_historial con esos cambios quedan (son historial de solo inserción).
-- Borra la fila 168 del ledger (la 114 nunca se aplicó con ese número).
--
-- ⚠ SKILL satori-migraciones-y-prod §6: si se corre en prod, EN EL MISMO MOMENTO sale el .sql de main en un PR propio
-- (si queda, Branching la vuelve a aplicar; si sale sin este rollback, Branching falla). Orden: primero el revert del
-- código (caja y club-web), así nadie llama a club_portal_avance ni espera la cortesía.
-- ⚠ CON CORTESÍAS YA GANADAS (alguna fila en club_primeros90) NO SE CORRE: aborta sin tocar nada. Con actividad real no
-- se borra: se APAGA (Club → Promociones → «Cortesía especial de bienvenida» → apagado; o sacar la cortesía del local) y
-- se arregla con una migración nueva. Así no se pierde qué socio ya la ganó o la usó (es plata).
-- Aborta también si los envoltorios ya no están (alguien pisó club_socio_visita o club_pase_datos, por ejemplo una 157
-- aplicada DESPUÉS de esta): devolverle el nombre a la base dejaría la caja o el pase rotos.
begin;

do $$
begin
  -- GUARDA-168 (inicio)
  if to_regclass('public.club_primeros90') is not null and exists (select 1 from public.club_primeros90) then
    raise exception '168 rollback: hay cortesías de los primeros 90 días ya ganadas (club_primeros90 no está vacía): no se borra; se apaga y se arregla con una migración nueva';
  end if;
  if to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is not null
     and position('club_socio_visita_base(' in coalesce((select prosrc from pg_proc
                    where oid = to_regprocedure('public.club_socio_visita(uuid,jsonb,uuid,text)')), '')) = 0 then
    raise exception '168 rollback: club_socio_visita ya no envuelve a club_socio_visita_base: parar y revisar a mano';
  end if;
  if to_regprocedure('public.club_pase_datos_base(uuid)') is not null
     and position('club_pase_datos_base(' in coalesce((select prosrc from pg_proc
                    where oid = to_regprocedure('public.club_pase_datos(uuid)')), '')) = 0 then
    raise exception '168 rollback: club_pase_datos ya no envuelve a club_pase_datos_base: parar y revisar a mano';
  end if;
  -- GUARDA-168 (fin)
end
$$;

drop function if exists public.club_portal_avance(text);
drop function if exists public.club_primeros90_config_guardar(boolean, uuid, text);
drop function if exists public.club_primeros90_config_ver(text);

do $$
begin
  if to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is not null then
    drop function if exists public.club_socio_visita(uuid, jsonb, uuid, text);
    alter function public.club_socio_visita_base(uuid, jsonb, uuid, text) rename to club_socio_visita;
  end if;
  if to_regprocedure('public.club_pase_datos_base(uuid)') is not null then
    drop function if exists public.club_pase_datos(uuid);
    alter function public.club_pase_datos_base(uuid) rename to club_pase_datos;
  end if;
end
$$;
comment on function public.club_socio_visita(uuid, jsonb, uuid, text) is null;
comment on function public.club_pase_datos(uuid) is null;
revoke all on function public.club_socio_visita(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.club_socio_visita(uuid, jsonb, uuid, text) to authenticated;
revoke all on function public.club_pase_datos(uuid) from public, anon, authenticated;
grant execute on function public.club_pase_datos(uuid) to service_role;

drop function if exists public.club_primeros90_en_visita(uuid, jsonb);
drop function if exists public.club_primeros90_avance(uuid);
drop function if exists public.club_primeros90_visitas(uuid, date, int);
drop function if exists public.club_primeros90_alta(uuid);
drop table if exists public.club_primeros90;

alter table public.club_config_global drop constraint if exists club_config_global_primeros90_chk;
alter table public.club_config_global drop column if exists primeros90_activo;
alter table public.club_config_global drop column if exists primeros90_visitas;
alter table public.club_config_global drop column if exists primeros90_dias;
alter table public.club_config_global drop column if exists primeros90_vence_dias;
alter table public.club_config drop column if exists primeros90_cortesia_id;
alter table public.club_miembros drop column if exists sin_avance;

delete from supabase_migrations.schema_migrations where version = '168';

do $$
begin
  if to_regprocedure('public.club_socio_visita(uuid,jsonb,uuid,text)') is null
     or position('club_socio_visita_base' in (select prosrc from pg_proc where oid = 'public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) > 0 then
    raise exception '168 rollback: club_socio_visita no quedó como la de antes';
  end if;
  if to_regprocedure('public.club_pase_datos(uuid)') is null
     or position('club_pase_datos_base' in (select prosrc from pg_proc where oid = 'public.club_pase_datos(uuid)'::regprocedure)) > 0 then
    raise exception '168 rollback: club_pase_datos no quedó como la de antes';
  end if;
  if not has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE') then
    raise exception '168 rollback: la caja perdió club_socio_visita';
  end if;
  if to_regclass('public.club_primeros90') is not null or to_regprocedure('public.club_portal_avance(text)') is not null then
    raise exception '168 rollback: quedaron objetos de la 168';
  end if;
end
$$;

commit;
