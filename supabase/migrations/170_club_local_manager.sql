-- 170 (origen club 116) · Seguridad: el manager solo lee y opera el Club en SUS locales.
--
-- Hallazgo (verificador del #183, preexistente en main): las funciones del Club SECURITY DEFINER que reciben el local
-- (`p_location`) resuelven el local con club_local() pero no miran si es uno de los locales del usuario. Un manager de
-- un local podía leer (excepciones, reportes, alertas, pendientes, facturas) y escribir (promos, cortesías, marcadores,
-- alta de socio, visita) en otro local pasando el id a mano por la API.
--
-- Arreglo, con el menor cambio y sin tocar lógica de plata:
--   · club_puede_ver_local(local): owner y contador ACTIVOS → todos; manager activo → solo los de mis_locales() (091);
--     el resto → ninguno. Es la regla de puede_ver_local (091) con el rol adentro.
--   · club_exigir_local(local): SOLO para el manager: resuelve el local como lo hace cada función (club_local(…, false):
--     sin dato, el único local con el Club encendido) y, si no es suyo, corta con 42501. Para cualquier otro rol no hace
--     nada: owner, contador, cajero, salonero y anon siguen exactamente igual que hoy (cada función ya chequea su rol).
--   · Cada función afectada queda como un ENVOLTORIO: la original se renombra a <nombre>__nucleo (mismo cuerpo, byte a
--     byte; sin EXECUTE para public/anon/authenticated) y la nueva <nombre>, con la MISMA firma, defaults, resultado,
--     volatilidad y los mismos EXECUTE que tenía la original, llama a club_exigir_local y después al núcleo. No se copia ni se reescribe ningún cuerpo.
--   · club_negocio_guardar y club_miembro_guardar, al editar (p_id con dato), chequean el local del objeto (no el que
--     viene en p_location): si no, un manager editaba un negocio o un miembro de otro local por id. club_miembro_guardar
--     chequea además el local del negocio al que se cuelga el anfitrión.
--
-- Cubiertas sin envoltorio propio (llaman por nombre a una envuelta, así que pasan por el chequeo):
--   club_excepciones_abiertas → club_excepciones · club_reporte_exportar → club_reporte_mes.
-- Fuera (ya cerradas): club_reporte_cerrar y club_contactos_ofertas_exportar (solo owner); club_premios_generar y los
-- helpers internos (sin EXECUTE para authenticated).
--
-- RECETA para cambiar una función envuelta DESPUÉS de la 170 (y para rebasear un PR que la redefine): se cambia el
-- NÚCLEO, no el envoltorio: `create or replace function public.<nombre>__nucleo(<misma firma>) …` con el cuerpo nuevo
-- (conserva su ACL: sin EXECUTE para authenticated). Un `create or replace function public.<nombre>(` con el cuerpo
-- completo REEMPLAZA el envoltorio y se pierde el chequeo. supabase/club_local_manager.test.ts falla si una migración
-- > 170 redefine, renombra o borra un envoltorio (salvo que repita exactamente su chequeo de esta lista) o le da EXECUTE
-- a la API sobre un núcleo. Si cambia la firma: drop del envoltorio y del núcleo y se rehace el par con esta receta.
--
-- Pruebas: scripts/sql/170_pruebas.sql (+ 170_pruebas.py; transacción con rollback). Rollback: scripts/sql/170_rollback.sql.
begin;

-- ── 1. ¿El usuario actual ve este local? ───────────────────────────────────────────────────────────────────────────
create or replace function public.club_puede_ver_local(p_location text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_location is null then false
    when public.get_my_role() in ('owner', 'contador') then true                 -- get_my_role(): null si está inactivo (069)
    when public.get_my_role() = 'manager' then p_location = any (public.mis_locales())
    else false
  end
$$;
revoke all on function public.club_puede_ver_local(text) from public, anon;
grant execute on function public.club_puede_ver_local(text) to authenticated, service_role;
comment on function public.club_puede_ver_local(text) is
  '170: ¿el usuario ve este local del Club? owner/contador activos: todos; manager activo: solo mis_locales() (091); resto: ninguno.';

-- ── 2. El chequeo que corre al principio de cada función envuelta ──────────────────────────────────────────────────
create or replace function public.club_exigir_local(p_location text)
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
  -- Igual que cada función: sin dato, el único local con el Club encendido («todos mis locales» = solo los suyos).
  if not public.club_puede_ver_local(public.club_local(p_location, false)) then
    raise exception 'Sin permiso en ese local' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.club_exigir_local(text) from public, anon, authenticated;
grant execute on function public.club_exigir_local(text) to service_role;
comment on function public.club_exigir_local(text) is
  '170: para el manager, corta con 42501 si el local (resuelto con club_local) no es suyo. Para otros roles no hace nada.';

-- ── 3. Envoltorios ─────────────────────────────────────────────────────────────────────────────────────────────────
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
        ('public.club_pendientes_listar(text)',                         null::text),
        ('public.club_pedidos_abiertos(text)',                          null),
        ('public.club_facturas_recientes(text)',                        null),
        ('public.club_excepciones(date,date,text,text)',                null),
        ('public.club_excepcion_resolver(text,text,text,text)',         null),
        ('public.club_reporte_mes(date,text,boolean)',                  null),
        ('public.club_comparacion_cargar(jsonb,text)',                  null),
        ('public.club_comparacion(date,date,text)',                     null),
        ('public.club_reporte_altas(date,date,text)',                   null),
        ('public.club_reporte_visitas(date,date,text)',                 null),
        ('public.club_reporte_descuentos(date,date,text)',              null),
        ('public.club_alertas_prioritarias(text)',                      null),
        ('public.club_promociones_listar(text)',                        null),
        ('public.club_promocion_guardar(uuid,jsonb,text)',              null),
        ('public.club_productos(text,text)',                            null),
        ('public.club_cortesias_listar(text)',                          null),
        ('public.club_cortesia_guardar(uuid,text,text,boolean,text)',   null),
        ('public.club_marcadores_listar(text)',                         null),
        ('public.club_marcador_guardar(uuid,text,text,numeric,boolean,text)', null),
        ('public.club_descuentos_tipo_listar(text)',                    null),
        ('public.club_descuento_tipo_guardar(uuid,text,numeric,boolean,text)', null),
        ('public.club_socio_alta_caja(text,text,text,boolean,text)',    null),
        ('public.club_socio_validar(uuid,boolean,text)',                null),
        ('public.club_socio_visita(uuid,jsonb,uuid,text)',              null),
        -- edición por id: el local del objeto; alta: el elegido
        ('public.club_negocio_guardar(uuid,text,text,boolean,text)',
         'perform public.club_exigir_local(case when p_id is not null then coalesce((select n.location_id from public.club_negocios n where n.id = p_id), p_location) '
         'else p_location end);'),
        -- y el negocio al que se cuelga el anfitrión también tiene que ser de un local del manager
        ('public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)',
         'perform public.club_exigir_local(case when p_id is not null then coalesce((select m.location_id from public.club_miembros m where m.id = p_id), p_location) '
         'else coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)) end); '
         'if p_negocio_id is not null and exists (select 1 from public.club_negocios n where n.id = p_negocio_id) then '
         'perform public.club_exigir_local((select n.location_id from public.club_negocios n where n.id = p_negocio_id)); end if;')
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
      raise exception '170: % no es SECURITY DEFINER', r.fn;
    end if;
    if to_regproc('public.' || v_nom || '__nucleo') is not null then
      raise exception '170: ya existe public.%__nucleo', v_nom;
    end if;

    -- quién tiene EXECUTE hoy: el envoltorio queda con exactamente los mismos permisos
    select coalesce(array_agg(distinct g.rolname order by g.rolname), array[]::text[]) into v_gran
      from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
     where p.oid = r.fn and a.privilege_type = 'EXECUTE' and g.rolname <> current_user;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = r.fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '170: % tiene EXECUTE para PUBLIC', r.fn;
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
      '170: envoltorio. Chequea el local (club_exigir_local: el manager, solo sus locales) y llama a '
      || v_nom || '__nucleo (la función original, sin cambios).');
  end loop;
end $$;

commit;
