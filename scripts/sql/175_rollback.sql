-- Rollback de la 175 (origen club 121): beneficio de cumpleaños una vez por año. Hacerlo JUNTO con volver la app a la
-- versión anterior (git revert del merge): si no, la caja llama a club_cumple_usar, que ya no existe (el recuadro de
-- cumpleaños sigue, sin el «ya lo usó»). Va ANTES que el rollback de la 173. Borra la fila 175 del ledger. Si se corre en
-- prod, en el mismo momento sale el .sql de la 175 de main (regla 10 / satori-migraciones-y-prod §6).
-- DATOS: si ya hay marcas en club_cumple_usos (uso real), ABORTA: con actividad real no se borra; se apaga el beneficio
-- en Club → Promociones y se arregla con una migración nueva.
begin;

do $$
begin
  if to_regclass('public.club_cumple_usos') is not null and exists (select 1 from public.club_cumple_usos) then
    raise exception '175 rollback: hay marcas de cumpleaños (uso real): no se borran. Apagá el beneficio y arreglá con una migración nueva';
  end if;
end $$;

-- 6 y 5. reportes y lista
drop function if exists public.club_cumple_usos_resumen(date, date, text);
drop function if exists public.club_cumple_usos_resumen_rango(date, date, text);
drop function if exists public.club_cumple_usos_listar(date, date, text);
-- 4 y 3. deshacer y marcar
drop function if exists public.club_cumple_uso_deshacer(uuid, text);
drop function if exists public.club_cumple_usar(uuid, text);
drop function if exists public.club_cumple_usar_dia(uuid, text, date);

-- 2. la caja EXACTA de la 173 (sin «ya_uso»)
create or replace function public.club_cumple_en_caja_dia(p_miembro uuid, p_location text, p_hoy date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cfg public.club_cumple_config%rowtype := public.club_cumple_cfg(p_location);
  v_c   public.club_miembros_contacto%rowtype;
begin
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = p_miembro;
  if not v_cfg.activo or v_c.cumple_dia is null or v_c.cumple_permiso_en is null
     -- socio de ESTE local (verificador, 15-nov): uno de otro local recibe lo mismo que «sin beneficio» (no revela nada)
     or not exists (select 1 from public.club_miembros m where m.id = p_miembro and m.estado = 'activo' and m.location_id = p_location)
     or not exists (select 1 from public.club_miembro_roles r where r.miembro_id = p_miembro and r.rol = 'socio' and r.estado = 'activo')
     or public.club_cumple_en_ventana(v_c.cumple_dia, v_c.cumple_mes, p_hoy, v_cfg.dias_antes, v_cfg.dias_despues) is null then
    return jsonb_build_object('aplica', false);
  end if;
  return jsonb_build_object('aplica', true) || (public.club_cumple_cfg_json(v_cfg) - 'reserva_url' - 'actualizado_en' - 'location_id');
end;
$$;
revoke all on function public.club_cumple_en_caja_dia(uuid, text, date) from public, anon, authenticated;

-- 1. tabla y guardia
drop table if exists public.club_cumple_usos;
drop function if exists public.club_cumple_usos_guardia();

-- 0. ledger
delete from supabase_migrations.schema_migrations where version = '175';

commit;
