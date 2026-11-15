-- Rollback de la 173 (origen club 119): cumpleaños en caja y portal + beneficio configurable + aviso v1.3. Hacerlo
-- JUNTO con volver club-web y la app a la versión anterior (git revert del merge): si no, club-web manda v1.3 (la base la
-- rechaza) y la app llama a club_socio_alta_caja_v3, que ya no existe. Orden inverso al de la migración.
-- Datos: se BORRAN la configuración del beneficio, las marcas «enviado» y la marca del portal (cumple_portal_en). Los
-- cumpleaños ya cargados (en caja o en el portal) SE QUEDAN: los cubre la guardia de la 159 y el aviso v1.2 («Si nos da
-- su cumpleaños con su permiso»). La fila 'v1.3' de club_avisos_privacidad NO se borra (tabla inmutable por trigger).
-- Va ANTES que el rollback de la 172 y de la 170. Borra la fila 173 del ledger. Si se corre en prod, en el mismo momento
-- sale el .sql de la 173 de main (si queda, Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

-- 8 y 7. caja, Inicio, WhatsApp y fechas
drop function if exists public.club_cumple_en_caja(uuid, text);
drop function if exists public.club_cumple_en_caja_dia(uuid, text, date);
drop function if exists public.club_cumple_enviar(uuid, text);
drop function if exists public.club_cumple_marcar(uuid, text, date);
drop function if exists public.club_cumple_proximos(text);
drop function if exists public.club_cumple_lista(text, date);
drop table if exists public.club_cumple_envios;
drop function if exists public.club_cumple_en_ventana(int, int, date, int, int);
drop function if exists public.club_cumple_proximo(int, int, date);
drop function if exists public.club_cumple_fecha(int, int, int);

-- 6. configuración
drop function if exists public.club_cumple_config_guardar(jsonb, text);
drop function if exists public.club_cumple_config_ver(text);
drop function if exists public.club_cumple_cfg_json(public.club_cumple_config);
drop function if exists public.club_cumple_cfg(text);
drop table if exists public.club_cumple_config;

-- 5 y 4. portal y alta en caja v3
drop function if exists public.club_portal_cumple_agregar(text, int, int, boolean);
drop function if exists public.club_portal_cumple(text);
drop function if exists public.club_socio_alta_caja_v3(text, text, text, boolean, boolean, int, int, boolean, text);

-- 3. la guardia EXACTA de la 159
create or replace function public.club_contacto_cumple_guardia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tenia boolean := tg_op = 'UPDATE' and old.cumple_dia is not null;
  v_tiene boolean := new.cumple_dia is not null or new.cumple_mes is not null or new.cumple_permiso_en is not null;
begin
  if tg_op = 'UPDATE' and (new.cumple_dia, new.cumple_mes, new.cumple_permiso_en)
                          is not distinct from (old.cumple_dia, old.cumple_mes, old.cumple_permiso_en) then
    return new;
  end if;
  if not v_tiene then   -- borrarlo (baja, retiro del permiso): siempre (el rastro lo deja club_contacto_cumple_auditar)
    return new;
  end if;
  -- en el alta: la fila de contacto nace en esta transacción y la escribe la autoalta (corre como SU dueño, sea cual sea
  -- el rol: postgres, supabase_admin…; verificador 14-nov), no la app ni el portal
  if not v_tenia and new.created_at = now()
     and current_user = (select pg_get_userbyid(p.proowner) from pg_proc p
                          where p.oid = to_regprocedure('public.club_socio_autoalta(jsonb)')) then
    return new;
  end if;
  if coalesce(public.get_my_role()::text, '') = 'owner' then
    return new;
  end if;
  raise exception 'El cumpleaños no se cambia después del alta: lo corrige solo el owner' using errcode = '42501';
end;
$$;
revoke all on function public.club_contacto_cumple_guardia() from public, anon, authenticated;
drop function if exists public.club_cumple_valido(int, int);

-- 2. la marca del portal
alter table public.club_miembros_contacto drop column if exists cumple_portal_en;

-- 1. aviso: vuelve a pedir v1.2
alter table public.club_config alter column aviso_privacidad_version set default 'v1.2';
update public.club_config set aviso_privacidad_version = 'v1.2' where aviso_privacidad_version = 'v1.3';

-- 0. ledger
delete from supabase_migrations.schema_migrations where version = '173';

commit;
