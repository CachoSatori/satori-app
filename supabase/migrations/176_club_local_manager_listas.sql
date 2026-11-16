-- 176 (origen club 122) · El manager ve en las LISTAS del Club solo los socios y fichas de sus locales.
--
-- Decisión del dueño (15-nov): igual que al operar (170/172), en las listas el manager ve solo lo de sus locales
-- (mis_locales(), 091: profile_locations; sin asignación, Santa Teresa). Owner y contador: todos los locales, igual que
-- hoy. Cajero: igual que hoy, sin filtro (el dueño aceptó el cruce: un socio de Nosara puede venir a Santa Teresa).
-- Lo que la 172 dejó afuera (lo dijo su verificador):
--   · club_buscar, club_resolver, club_socios_por_confirmar, club_socio_solicitudes_abiertas, club_retos_listar;
--   · la lectura directa por RLS de las tablas del Club, que hoy deja ver todos los locales por rol.
--
-- Arreglo:
--   1. club_ve_ficha(local) (nueva, interna): true para cualquier rol que no sea manager; para el manager,
--      club_puede_ver_local (170). Es el filtro de las listas.
--   2. club_exigir_local_de (172) corta con 42501 «Ficha de otro local» (antes «Sin permiso en ese local»): la app lo
--      muestra como «Esta ficha es de otro local…» en vez de «pedile a un manager» (que al manager no le dice nada).
--      club_exigir_local (170, por p_location) sigue con «Sin permiso en ese local».
--   3. Las cinco funciones, con la RECETA de la 170/172: la original pasa a <nombre>__nucleo (mismo cuerpo, byte a
--      byte, salvo club_buscar__nucleo: ver 3b; sin EXECUTE para la API) y la nueva <nombre>, con la MISMA firma,
--      resultado, volatilidad y EXECUTE, llama al núcleo y FILTRA lo que devuelve (no hay un local que chequear antes: son listas):
--        club_buscar, club_socios_por_confirmar, club_socio_solicitudes_abiertas → saca las filas cuyo miembro es de
--          otro local (para el manager);
--        club_retos_listar → para el manager, solo los retos con algún local suyo, y en «cortesias» solo sus locales;
--        club_resolver → para el manager, un cupón, QR de anfitrión o código de canje de una ficha de otro local corta
--          con «Ficha de otro local» (club_exigir_local_de: el local del miembro; el del cupón para el cupón, como la
--          172). El QR del SOCIO (/s/) NO se filtra: el socio vale en todos los locales encendidos («Club compartido»)
--          y la visita va al local de la caja (club_socio_visita, 170).
--   4. RLS: las políticas SELECT (y la ALL de club_miembros_contacto) que hoy dejan entrar al manager suman, SOLO para
--      el manager, «la fila es de mis_locales()» (por location_id; por el miembro donde la tabla no tiene local o lo
--      tiene nulo). Los demás roles: misma condición que hoy, sin cambios. club_config y club_config_global quedan como
--      están (configuración, no fichas; los selectores ya filtran por rol). Las funciones SECURITY DEFINER no pasan
--      por RLS (dueño de las tablas): reportes, tablero, ranking y caja siguen igual.
--
-- RECETA después de la 176 (igual que la 170/172): se cambia el NÚCLEO, no el envoltorio.
-- supabase/club_local_manager.test.ts falla si una migración > 176 redefine, renombra o borra uno de estos cinco
-- envoltorios sin repetir su filtro, o le da EXECUTE a la API sobre un núcleo.
--
-- Va DESPUÉS de la 172 (usa club_exigir_local_de y club_puede_ver_local; aborta si faltan) y de la 173–175.
-- Vuelta atrás: scripts/sql/176_rollback.sql (antes que el de la 172). Pruebas: scripts/sql/176_pruebas.sql (+ .py).
begin;

do $$
begin
  if to_regprocedure('public.club_exigir_local_de(text)') is null or to_regprocedure('public.club_puede_ver_local(text)') is null then
    raise exception '176: falta la 170/172 (club_exigir_local_de / club_puede_ver_local)';
  end if;
end $$;

-- ── 1. El filtro de las listas ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.club_ve_ficha(p_location text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_my_role() is distinct from 'manager'::public.user_role
      or public.club_puede_ver_local(p_location)
$$;
revoke all on function public.club_ve_ficha(text) from public, anon, authenticated;
grant execute on function public.club_ve_ficha(text) to service_role;
comment on function public.club_ve_ficha(text) is
  '176: filtro de las listas del Club. Manager: solo fichas de sus locales (club_puede_ver_local); cualquier otro rol: true.';

-- ── 2. El mensaje del chequeo por id (172): «Ficha de otro local» ─────────────────────────────────────────────────
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
    raise exception 'Ficha de otro local' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.club_exigir_local_de(text) from public, anon, authenticated;
grant execute on function public.club_exigir_local_de(text) to service_role;
comment on function public.club_exigir_local_de(text) is
  '172/176: para el manager, corta con 42501 «Ficha de otro local» si el local del objeto (miembro, cupón, movimiento…) no es suyo (club_puede_ver_local). Sin objeto (null) o con otro rol no hace nada.';

-- ── 3. Envoltorios que filtran ─────────────────────────────────────────────────────────────────────────────────────
-- (función, cuerpo del envoltorio). supabase/club_local_manager.test.ts lee esta lista: un envoltorio redefinido
-- después tiene que repetir su filtro.
do $$
declare
  r       record;
  v_nom   text;
  v_args  text;
  v_ident text;
  v_res   text;
  v_vol   text;
  v_gran  text[];
  v_g     text;
begin
  for r in
    select v.fn::regprocedure as fn, v.cuerpo
      from (values
        ('public.club_buscar(text)',
         'begin return query select b.* from public.club_buscar__nucleo(p_q => p_q) b '
         'where public.club_ve_ficha((select m.location_id from public.club_miembros m where m.id = b.id)); end'),
        ('public.club_socios_por_confirmar()',
         'begin return query select b.* from public.club_socios_por_confirmar__nucleo() b '
         'where public.club_ve_ficha((select m.location_id from public.club_miembros m where m.id = b.miembro_id)); end'),
        ('public.club_socio_solicitudes_abiertas()',
         'begin return query select b.* from public.club_socio_solicitudes_abiertas__nucleo() b '
         'where public.club_ve_ficha((select m.location_id from public.club_miembros m where m.id = b.miembro_id)); end'),
        ('public.club_retos_listar()',
         'declare v jsonb := public.club_retos_listar__nucleo(); begin '
         'if public.get_my_role() is distinct from ''manager''::public.user_role then return v; end if; '
         'return jsonb_set(v, ''{retos}'', coalesce((select jsonb_agg(case when jsonb_typeof(e->''cortesias'') = ''object'' '
         'then jsonb_set(e, ''{cortesias}'', coalesce((select jsonb_object_agg(k.key, k.value) from jsonb_each(e->''cortesias'') k '
         'where public.club_ve_ficha(k.key)), ''{}''::jsonb)) else e end order by t.o) '
         'from jsonb_array_elements(v->''retos'') with ordinality t(e, o) '
         'where exists (select 1 from jsonb_array_elements_text(e->''locales'') l where public.club_ve_ficha(l))), ''[]''::jsonb)); end'),
        ('public.club_resolver(text)',
         'declare v jsonb := public.club_resolver__nucleo(p_texto => p_texto); begin '
         'if v->>''tipo'' in (''referente'', ''canje'') then '
         'perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id::text = v->''datos''->>''id'')); '
         'elsif v->>''tipo'' = ''cupon'' then '
         'perform public.club_exigir_local_de((select c.location_id from public.club_cupones c where c.codigo = v->''datos''->>''codigo'')); '
         'end if; return v; end')
      ) v(fn, cuerpo)
  loop
    select p.proname, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
           pg_get_function_result(p.oid),
           case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end
      into v_nom, v_args, v_ident, v_res, v_vol
      from pg_proc p
     where p.oid = r.fn;

    if not (select p.prosecdef from pg_proc p where p.oid = r.fn) then
      raise exception '176: % no es SECURITY DEFINER', r.fn;
    end if;
    if to_regproc('public.' || v_nom || '__nucleo') is not null then
      raise exception '176: ya existe public.%__nucleo', v_nom;
    end if;

    -- quién tiene EXECUTE hoy: el envoltorio queda con exactamente los mismos permisos
    select coalesce(array_agg(distinct g.rolname order by g.rolname), array[]::text[]) into v_gran
      from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
     where p.oid = r.fn and a.privilege_type = 'EXECUTE' and g.rolname <> current_user;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = r.fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '176: % tiene EXECUTE para PUBLIC', r.fn;
    end if;

    execute format('alter function %s rename to %I', r.fn, v_nom || '__nucleo');
    -- el núcleo deja de ser llamable por la API (conserva el EXECUTE de service_role/postgres si lo tenía)
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nom || '__nucleo', v_ident);

    execute format(
      'create function public.%I(%s) returns %s language plpgsql %s security definer set search_path = public, pg_temp '
      'as $f$ %s $f$',
      v_nom, v_args, v_res, v_vol, r.cuerpo);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', v_nom, v_ident);
    foreach v_g in array v_gran loop
      execute format('grant execute on function public.%I(%s) to %I', v_nom, v_ident, v_g);
    end loop;
    execute format('comment on function public.%I(%s) is %L', v_nom, v_ident,
      '176: envoltorio. Llama a ' || v_nom || '__nucleo (la función original, sin cambios) y, para el manager, deja solo '
      || 'las fichas de sus locales (club_ve_ficha / club_exigir_local_de).');
  end loop;
end $$;

-- ── 3b. club_buscar: el filtro va DENTRO del núcleo, antes del «limit 20» ──────────────────────────────────────────
-- Verificador del #204: con el filtro solo en el envoltorio, el núcleo cortaba en 20 ANTES de filtrar (un manager con
-- más de 20 coincidencias de otro local veía la lista vacía) y la auditoría anotaba las filas sin filtrar. ÚNICA función
-- de la 176 cuyo núcleo deja de ser idéntico a la versión vigente (la de la 150): mismo cuerpo + UNA condición
-- (club_ve_ficha: para owner, contador y cajero es true, igual que hoy). El envoltorio conserva su filtro (no cambia nada).
create or replace function public.club_buscar__nucleo(p_q text)
returns table (id uuid, nombre text, negocio text, tipo text, estado text, personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_q    text := public.club_norm_texto(p_q);
  v_dig  boolean;
  v_tope int;
  v_n    int;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_dig := v_q ~ '^[0-9]{4}$';
  if not v_dig and length(v_q) < 3 then
    raise exception 'Escribí al menos 3 letras o los últimos 4 dígitos del teléfono' using errcode = 'P0001';
  end if;
  select coalesce(min(c.buscar_tope_minuto), 30) into v_tope from public.club_config c where c.club_activo;
  perform pg_advisory_xact_lock(hashtextextended('club_buscar:' || auth.uid()::text, 0));
  if (select count(*) from public.club_auditoria a
       where a.actor = auth.uid() and a.accion = 'buscar' and a.en > now() - interval '1 minute') >= v_tope then
    raise exception 'Demasiadas búsquedas seguidas: esperá un minuto' using errcode = 'P0001';
  end if;
  return query
    select m.id, m.nombre, n.nombre, m.tipo, m.estado, s.personas, s.creditos
      from public.club_miembros m
      left join public.club_negocios n on n.id = m.negocio_id
      left join public.club_saldos s on s.miembro_id = m.id
     where m.tipo in ('referente','concierge_pm','equipo')
       and public.club_ve_ficha(m.location_id)   -- 176: el manager, solo sus locales (ANTES del limit y de la auditoría)
       and case when v_dig then
             exists (select 1 from public.club_miembros_contacto c
                      where c.miembro_id = m.id and right(c.telefono, 4) = v_q)
           else
             public.club_norm_texto(m.nombre) like '%' || v_q || '%'
             or public.club_norm_texto(n.nombre) like '%' || v_q || '%'
           end
     order by (m.estado = 'activo') desc, m.nombre
     limit 20;
  get diagnostics v_n = row_count;   -- las filas que devolvió el RETURN QUERY
  perform public.club_auditar('buscar', 'club_miembros', null, null,
    jsonb_build_object('por', case when v_dig then 'digitos_telefono' else 'texto' end, 'filas', v_n));
end;
$$;
revoke all on function public.club_buscar__nucleo(text) from public, anon, authenticated;

-- ── 4. RLS: el manager lee directo solo filas de sus locales ───────────────────────────────────────────────────────
-- Cada política conserva su condición de hoy y suma, solo para el manager, el local. (select …) = se evalúa una vez
-- por consulta, no por fila.
alter policy club_staff_select on public.club_miembros using (
  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_staff_select on public.club_negocios using (
  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

-- el movimiento de un local suyo o de un miembro suyo (así el saldo de club_saldos de sus miembros queda completo)
alter policy club_staff_select on public.club_movimientos using (
  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])
       or exists (select 1 from public.club_miembros m
                   where m.id = club_movimientos.miembro_id and m.location_id = any ((select public.mis_locales())::text[]))));

alter policy club_staff_select on public.club_visitas using (
  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_roles_staff on public.club_miembro_roles using (
  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or exists (select 1 from public.club_miembros m
                   where m.id = club_miembro_roles.miembro_id and m.location_id = any ((select public.mis_locales())::text[]))));

alter policy club_alertas_gerencia on public.club_alertas using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_comparacion_gerencia on public.club_comparacion_vieja using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_cruces_gerencia on public.club_cruces_manuales using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_cruces_hist_gerencia on public.club_cruces_manuales_historial using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_cupones_gerencia on public.club_cupones using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_cupones_contactos_gerencia on public.club_cupones_contactos using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or exists (select 1 from public.club_cupones c
                   where c.id = club_cupones_contactos.cupon_id and c.location_id = any ((select public.mis_locales())::text[]))));

alter policy club_exc_gerencia on public.club_excepciones_resueltas using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_contacto_gerencia on public.club_miembros_contacto
  using (
    get_my_role() is not null and get_my_role() in ('owner','manager')
    and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
         or location_id = any ((select public.mis_locales())::text[])))
  with check (
    get_my_role() is not null and get_my_role() in ('owner','manager')
    and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
         or location_id = any ((select public.mis_locales())::text[])));

alter policy club_pases_gerencia on public.club_pases using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or exists (select 1 from public.club_miembros m
                   where m.id = club_pases.miembro_id and m.location_id = any ((select public.mis_locales())::text[]))));

-- local nulo: el del miembro
alter policy club_primeros90_ver on public.club_primeros90 using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])
       or (location_id is null and exists (select 1 from public.club_miembros m
                   where m.id = club_primeros90.miembro_id and m.location_id = any ((select public.mis_locales())::text[])))));

alter policy club_resena_socio_ver on public.club_resena_socio using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])));

alter policy club_retos_ganados_ver on public.club_retos_ganados using (
  get_my_role() is not null and get_my_role() in ('owner','manager')
  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role
       or location_id = any ((select public.mis_locales())::text[])
       or (location_id is null and exists (select 1 from public.club_miembros m
                   where m.id = club_retos_ganados.miembro_id and m.location_id = any ((select public.mis_locales())::text[])))));

commit;
