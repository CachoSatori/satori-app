-- 172 (origen club 118) · Seguridad: el manager solo lee y opera el Club en SUS locales — segunda tanda (hallazgo 231).
--
-- Hallazgo 231 (auditoría externa, severidad media): la 170 envolvió 26 funciones con p_location, pero quedaron afuera
-- tres funciones nuevas (157, 168 y 169) que resuelven el local con club_local(p_location, false) + rol owner/manager
-- sin mirar si el local es del manager, y un grupo de funciones que operan sobre un objeto POR ID (miembro, cupón,
-- movimiento, pendiente, alerta) sin mirar el local del objeto. Un manager de un local podía, pasando el id o el local a
-- mano por la API: ver el ranking del equipo, la configuración de «Primeros 90» o entregar el premio de un reto en otro
-- local; ver el teléfono, el link del portal o el código de un miembro de otro local; regenerarlos; activar un anfitrión,
-- confirmar un socio, aprobar personas pendientes, revisar alertas, elegir facturas «sin cruce», canjear o sumar
-- personas a un anfitrión de otro local.
--
-- Arreglo: la MISMA receta de la 170 (envoltorio + <nombre>__nucleo con el cuerpo byte a byte, sin EXECUTE para la API).
--   · Con p_location: perform public.club_exigir_local(p_location); (la de la 170).
--   · Por id: el local DEL OBJETO, con club_exigir_local_de(local) (nueva): solo para el manager; si el objeto no existe
--     (local null) no hace nada y el núcleo contesta su «no encontrado» de siempre; si existe y su local no es de
--     club_puede_ver_local (170) → 42501 «Sin permiso en ese local». Para cualquier otro rol no hace nada: owner,
--     contador, cajero y anon siguen exactamente igual que hoy.
--   · club_reto_en_visita: el local de la VISITA (como la 170 en la edición por id); si la visita no existe, p_location.
--
-- Envueltas acá (20):
--   con p_location: club_reporte_equipo (157) · club_primeros90_config_ver (168) · club_reto_en_visita (169, por la visita)
--   por miembro:    club_miembro_contacto_ver · club_miembro_codigo · club_miembro_token · club_miembro_regenerar_codigo ·
--                   club_pase_token · club_rol_activar_anfitrion · club_socio_confirmar · club_resolver_miembro ·
--                   club_canje · club_canje_aprobado · club_tarjeta_manual
--   por cupón:      club_cupon_usar (el local del cupón, por su código)
--   por movimiento: club_canje_aviso · club_sin_cruce_candidatas · club_sin_cruce_elegir
--   por pendiente:  club_pendiente_resolver · por alerta: club_alerta_revisar
--
-- Ya cubiertas sin envoltorio propio (llaman con p_location a una envuelta de la 170 antes de hacer nada):
--   club_excepciones_abiertas → club_excepciones · club_reporte_exportar → club_reporte_mes ·
--   club_socio_alta_caja_v2 → club_socio_alta_caja · club_socio_validar_v2 → club_socio_validar ·
--   club_miembro_guardar_v2 → club_miembro_guardar.
-- Ya chequeaban el local (091, puede_ver_local / club_locales_de_reporte): club_tablero_mes, club_alertas_inicio,
--   club_embudo_anfitrion, club_ranking_socios, club_cohortes_socios, club_campana_crear, club_campanas_listar.
-- Fuera (sin manager): solo owner (club_reporte_cerrar, club_contactos_ofertas_exportar, club_primeros90_config_guardar,
--   campañas, retos guardar/armar/terminar/borrar, ajuste, vencer, cumpleaños, local_crear); anon por token (portal,
--   cupón, autoalta, pase).
-- QUEDAN (no entran en la receta: listas sin local que el manager recorre; filtrarlas cambia el cuerpo → PR aparte):
--   club_buscar, club_resolver (QR/código en caja), club_socios_por_confirmar, club_socio_solicitudes_abiertas,
--   club_retos_listar; y la lectura directa por RLS de club_movimientos, club_negocios, club_miembro_roles y
--   club_alertas (políticas por rol, sin local).
--
-- RECETA después de la 172 (igual que la 170): se cambia el NÚCLEO, no el envoltorio. supabase/club_local_manager.test.ts
-- lee esta lista y falla si una migración > 172 redefine, renombra o borra uno de estos envoltorios, o le da EXECUTE a la
-- API sobre un núcleo; y falla con cualquier función SECURITY DEFINER con p_location y EXECUTE para authenticated que no
-- chequee el local.
--
-- Va DESPUÉS de la 170 (usa club_exigir_local y club_puede_ver_local; aborta si faltan). Vuelta atrás: primero
-- scripts/sql/172_rollback.sql y recién después, si hiciera falta, el de la 170.
-- Pruebas: scripts/sql/172_pruebas.sql (+ 172_pruebas.py; transacción con rollback).
begin;

do $$
begin
  if to_regprocedure('public.club_exigir_local(text)') is null or to_regprocedure('public.club_puede_ver_local(text)') is null then
    raise exception '172: falta la 170 (club_exigir_local / club_puede_ver_local)';
  end if;
end $$;

-- ── 1. El chequeo por id: el local del objeto ──────────────────────────────────────────────────────────────────────
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

-- ── 2. Envoltorios ─────────────────────────────────────────────────────────────────────────────────────────────────
-- (función, chequeo). Sin chequeo propio: perform public.club_exigir_local(p_location);. El chequeo usa los parámetros
-- de la función. supabase/club_local_manager.test.ts lee esta lista: un envoltorio redefinido después tiene que repetirlo.
do $$
declare
  r       record;
  v_nom   text;
  v_args  text;
  v_ident text;
  v_res   text;
  v_vol   text;
  v_set   boolean;
  v_call  text;
  v_body  text;
  v_gran  text[];
  v_g     text;
begin
  for r in
    select v.fn::regprocedure as fn, coalesce(v.chequeo, 'perform public.club_exigir_local(p_location);') as chequeo
      from (values
        -- con p_location
        ('public.club_reporte_equipo(date,text)',                       null::text),
        ('public.club_primeros90_config_ver(text)',                     null),
        -- el local de la visita (el núcleo además exige que sea el del parámetro)
        ('public.club_reto_en_visita(uuid,text)',
         'perform public.club_exigir_local(coalesce((select v.location_id from public.club_visitas_socio v where v.id = p_visita), p_location));'),
        -- por miembro
        ('public.club_miembro_contacto_ver(uuid)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_miembro_codigo(uuid)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_id));'),
        ('public.club_miembro_token(uuid)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_id));'),
        ('public.club_miembro_regenerar_codigo(uuid)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_id));'),
        ('public.club_pase_token(uuid,text)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_rol_activar_anfitrion(uuid,text,text)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_socio_confirmar(uuid,text)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_resolver_miembro(uuid)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_id));'),
        ('public.club_canje(uuid,text,numeric,text,uuid,jsonb)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_canje_aprobado(uuid,numeric,text,uuid,jsonb,text)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        ('public.club_tarjeta_manual(uuid,integer,text,uuid,jsonb)',
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));'),
        -- por cupón (el mismo código normalizado que usa el núcleo)
        ('public.club_cupon_usar(text,integer,text,uuid,jsonb)',
         'perform public.club_exigir_local_de((select c.location_id from public.club_cupones c where c.codigo = upper(btrim(coalesce(p_codigo, '''')))));'),
        -- por movimiento
        ('public.club_canje_aviso(uuid)',
         'perform public.club_exigir_local_de((select x.location_id from public.club_movimientos x where x.id = p_movimiento));'),
        ('public.club_sin_cruce_candidatas(uuid,text)',
         'perform public.club_exigir_local_de((select x.location_id from public.club_movimientos x where x.id = p_movimiento));'),
        ('public.club_sin_cruce_elegir(uuid,text,text)',
         'perform public.club_exigir_local_de((select x.location_id from public.club_movimientos x where x.id = p_movimiento));'),
        -- por pendiente y por alerta
        ('public.club_pendiente_resolver(uuid,boolean,text)',
         'perform public.club_exigir_local_de((select pp.location_id from public.club_personas_pendientes pp where pp.id = p_id));'),
        ('public.club_alerta_revisar(bigint,text)',
         'perform public.club_exigir_local_de((select a.location_id from public.club_alertas a where a.id = p_id));')
      ) v(fn, chequeo)
  loop
    select p.proname, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
           pg_get_function_result(p.oid), p.proretset,
           case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
           string_agg(format('%I => %I', a.n, a.n), ', ' order by a.i)
      into v_nom, v_args, v_ident, v_res, v_set, v_vol, v_call
      from pg_proc p
      cross join lateral unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)])))
                 with ordinality a(n, m, i)
     where p.oid = r.fn and a.m in ('i', 'b')
     group by p.oid, p.proname, p.proretset, p.provolatile;

    if not (select p.prosecdef from pg_proc p where p.oid = r.fn) then
      raise exception '172: % no es SECURITY DEFINER', r.fn;
    end if;
    if to_regproc('public.' || v_nom || '__nucleo') is not null then
      raise exception '172: ya existe public.%__nucleo', v_nom;
    end if;

    -- quién tiene EXECUTE hoy: el envoltorio queda con exactamente los mismos permisos
    select coalesce(array_agg(distinct g.rolname order by g.rolname), array[]::text[]) into v_gran
      from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
     where p.oid = r.fn and a.privilege_type = 'EXECUTE' and g.rolname <> current_user;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = r.fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '172: % tiene EXECUTE para PUBLIC', r.fn;
    end if;

    execute format('alter function %s rename to %I', r.fn, v_nom || '__nucleo');
    -- el núcleo deja de ser llamable por la API (conserva el EXECUTE de service_role/postgres si lo tenía)
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nom || '__nucleo', v_ident);

    v_body := case when v_set
      then format('return query select * from public.%I(%s);', v_nom || '__nucleo', v_call)
      else format('return public.%I(%s);', v_nom || '__nucleo', v_call) end;

    execute format(
      'create function public.%I(%s) returns %s language plpgsql %s security definer set search_path = public, pg_temp '
      'as $f$ begin %s %s end $f$',
      v_nom, v_args, v_res, v_vol, r.chequeo, v_body);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', v_nom, v_ident);
    foreach v_g in array v_gran loop
      execute format('grant execute on function public.%I(%s) to %I', v_nom, v_ident, v_g);
    end loop;
    execute format('comment on function public.%I(%s) is %L', v_nom, v_ident,
      '172: envoltorio. Chequea el local (el manager, solo sus locales; por id, el local del objeto) y llama a '
      || v_nom || '__nucleo (la función original, sin cambios).');
  end loop;
end $$;

commit;
