-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 179 (origen club 124) — «Reservar» del portal del socio abre el OpenTable de SU local                          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema. Decisión del dueño (16-nov, opción A, por el chat): el botón «Reservar» de «Mi Club» (club-web,
-- PR #210) abre el link de reserva del LOCAL DEL SOCIO, el mismo que se edita en Club → Promociones
-- (club_cumple_config.reserva_url, mig 173; Nosara tiene su propio OpenTable). El link está armado para que OpenTable
-- registre el canal de entrada: se usa TAL CUAL (no se reconstruye ni se le quitan parámetros).
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. club_reserva_url_ok(text) (interna, sin EXECUTE para la API): https, de OpenTable (opentable.com y subdominios, o
--     una variante regional: .ca, .co.uk, .com.mx, .com.au…), sin usuario ni puerto, ≤ 300 caracteres.
--  2. club_cumple_config_guardar: la de la 173 byte a byte + rechaza un link de reserva que no sea de OpenTable.
--  3. club_portal (el envoltorio de la 167): igual + `socio.reserva_url` = el link del local del socio
--     (club_miembros.location_id) si su fila de club_cumple_config existe, tiene link y es de OpenTable; si no, null
--     (club-web usa el rid por defecto). Solo dentro de `socio` (quien no es socio no recibe nada nuevo). club_portal_datos
--     (157) no se toca.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata, ni tablas, ni datos: los links ya guardados quedan como están (los que no sean de OpenTable no se borran;
--    el portal simplemente no los devuelve y el próximo guardado los rechaza). Al final un aviso (NOTICE) los cuenta.
--  · Ni permisos: club_portal sigue con EXECUTE para anon/authenticated (como hoy); la nueva es interna.
--  · Ni sagrados, ni los envoltorios de la 170/172/176 (club_cumple_config_guardar llama a club_exigir_local, como en la 173).
--
-- Va DESPUÉS de la 178 (otra rama del 16-nov). Necesita la 167 y la 173 (aborta si faltan).
-- Pruebas: scripts/sql/179_pruebas.sql (+ 179_pruebas.py; transacción descartada). Rollback: scripts/sql/179_rollback.sql.
begin;

do $$
begin
  if to_regprocedure('public.club_portal_datos(text)') is null
     or to_regprocedure('public.club_resena_socio_toca(uuid)') is null
     or to_regprocedure('public.club_cumple_config_guardar(jsonb,text)') is null
     or to_regclass('public.club_cumple_config') is null then
    raise exception '179: faltan la 167 (club_portal_datos) o la 173 (club_cumple_config)';
  end if;
end $$;

-- ── 1. ¿Es un link de reserva de OpenTable? ──────────────────────────────────────────────────────────────────────
-- Host: opentable.<dominio regional> o cualquier subdominio (www., restref., …). Después del host solo / ? # o el final:
-- así «https://opentable.com@otro.test/», «https://opentable.com.otro.test/» y «https://otroopentable.com/» no pasan.
create or replace function public.club_reserva_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_url, '') <> '' and length(p_url) <= 300
     and p_url ~* '^https://([a-z0-9-]+\.)*opentable\.(com|ca|de|es|fr|it|ie|jp|nl|hk|sg|ae|co\.uk|co\.nz|co\.th|com\.au|com\.mx|com\.tw)([/?#][^\s<>"]*)?$'
$$;
revoke all on function public.club_reserva_url_ok(text) from public, anon, authenticated;
comment on function public.club_reserva_url_ok(text) is
  '179: link de reserva de OpenTable (https, opentable.com o variante regional y sus subdominios, ≤ 300). Interna: la usan club_cumple_config_guardar y club_portal.';

-- ── 2. Guardado de Promociones (173 + el dominio) ────────────────────────────────────────────────────────────────
create or replace function public.club_cumple_config_guardar(p_datos jsonb, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes public.club_cumple_config%rowtype;
  v_n     public.club_cumple_config%rowtype;
  v_k     public.club_cortesias%rowtype;
  v_url   text;
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  if jsonb_typeof(p_datos) is distinct from 'object'
     or jsonb_typeof(p_datos->'activo') is distinct from 'boolean' or jsonb_typeof(p_datos->'uno_por_mesa') is distinct from 'boolean'
     or jsonb_typeof(p_datos->'solo_reserva') is distinct from 'boolean'
     or jsonb_typeof(p_datos->'min_personas') is distinct from 'number' or jsonb_typeof(p_datos->'dias_antes') is distinct from 'number'
     or jsonb_typeof(p_datos->'dias_despues') is distinct from 'number' or jsonb_typeof(p_datos->'beneficio') is distinct from 'string'
     or (p_datos->>'min_personas') !~ '^[0-9]{1,2}$' or (p_datos->>'dias_antes') !~ '^[0-9]{1,2}$'
     or (p_datos->>'dias_despues') !~ '^[0-9]{1,2}$' then
    raise exception 'Datos incompletos: recargá la pantalla y volvé a guardar' using errcode = 'P0001';
  end if;
  v_antes := public.club_cumple_cfg(p_location);
  v_n := v_antes;
  v_n.activo := (p_datos->>'activo')::boolean;
  v_n.beneficio := btrim(p_datos->>'beneficio');
  v_n.min_personas := (p_datos->>'min_personas')::int;
  v_n.dias_antes := (p_datos->>'dias_antes')::int;
  v_n.dias_despues := (p_datos->>'dias_despues')::int;
  v_n.uno_por_mesa := (p_datos->>'uno_por_mesa')::boolean;
  v_n.solo_reserva := (p_datos->>'solo_reserva')::boolean;
  v_url := nullif(btrim(coalesce(p_datos->>'reserva_url', '')), '');
  v_n.reserva_url := v_url;
  v_n.cortesia_id := nullif(p_datos->>'cortesia_id', '')::uuid;
  if length(v_n.beneficio) not between 3 and 120 then
    raise exception 'El beneficio va de 3 a 120 letras (por ejemplo «postre de cortesía»)' using errcode = 'P0001';
  end if;
  if v_n.min_personas not between 1 and 50 then
    raise exception 'El mínimo de personas va de 1 a 50' using errcode = 'P0001';
  end if;
  if v_n.dias_antes not between 0 and 30 or v_n.dias_despues not between 0 and 30 then
    raise exception 'Los días antes y después van de 0 a 30' using errcode = 'P0001';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s<>"]{4,}$' or length(v_url) > 300) then
    raise exception 'El link de reserva tiene que empezar con https:// (copialo del navegador)' using errcode = 'P0001';
  end if;
  -- 179: además, de OpenTable (opentable.com y sus subdominios o variantes regionales). Se guarda TAL CUAL (con sus
  -- parámetros: OpenTable registra por ahí el canal de entrada); no se reconstruye.
  if v_url is not null and not public.club_reserva_url_ok(v_url) then
    raise exception 'El link de reserva tiene que ser de OpenTable (https://www.opentable.com/…): copialo tal cual del navegador' using errcode = 'P0001';
  end if;
  if v_n.solo_reserva and v_url is null then
    raise exception 'Con «solo con reserva» hace falta el link de reserva' using errcode = 'P0001';
  end if;
  if v_n.cortesia_id is not null then
    select * into v_k from public.club_cortesias k where k.id = v_n.cortesia_id and k.location_id = p_location;
    if not found then raise exception 'Esa cortesía no es de este local: recargá la lista' using errcode = 'P0001'; end if;
    if not v_k.activa then raise exception 'Esa cortesía está inactiva: activala primero' using errcode = 'P0001'; end if;
  end if;
  if v_n.activo and v_n.cortesia_id is null then
    raise exception 'Para encenderlo, elegí el artículo de cortesía que marca la caja' using errcode = 'P0001';
  end if;
  insert into public.club_cumple_config as k (location_id, activo, beneficio, min_personas, dias_antes, dias_despues,
                                              uno_por_mesa, solo_reserva, reserva_url, cortesia_id, actualizado_por, actualizado_en)
  values (p_location, v_n.activo, v_n.beneficio, v_n.min_personas, v_n.dias_antes, v_n.dias_despues,
          v_n.uno_por_mesa, v_n.solo_reserva, v_n.reserva_url, v_n.cortesia_id, auth.uid(), now())
  on conflict (location_id) do update set
    activo = excluded.activo, beneficio = excluded.beneficio, min_personas = excluded.min_personas,
    dias_antes = excluded.dias_antes, dias_despues = excluded.dias_despues, uno_por_mesa = excluded.uno_por_mesa,
    solo_reserva = excluded.solo_reserva, reserva_url = excluded.reserva_url, cortesia_id = excluded.cortesia_id,
    actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
  v_n := public.club_cumple_cfg(p_location);
  perform public.club_auditar('cumple_config', 'club_cumple_config', null,
    public.club_cumple_cfg_json(v_antes) - 'cortesia' - 'actualizado_en' || jsonb_build_object('cortesia_id', v_antes.cortesia_id),
    public.club_cumple_cfg_json(v_n) - 'cortesia' - 'actualizado_en' || jsonb_build_object('cortesia_id', v_n.cortesia_id));
  return public.club_cumple_cfg_json(v_n);
end;
$$;
revoke all on function public.club_cumple_config_guardar(jsonb, text) from public, anon, authenticated;
grant execute on function public.club_cumple_config_guardar(jsonb, text) to authenticated;

-- ── 3. Portal del socio: el link de reserva de SU local ──────────────────────────────────────────────────────────
-- El envoltorio de la 167 (club_portal_datos + `resena`) + `socio.reserva_url`. club_portal_datos queda igual.
create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_j   jsonb;
  v_id  uuid;
  v_loc text;
  v_r   record;
begin
  v_j := public.club_portal_datos(p_token);   -- portón, formato del token y socio activo: igual que siempre
  select m.id, m.location_id into v_id, v_loc from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo';
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  -- 167: la reseña de Google del local de la última visita, cada N visitas con beneficio (a todos, sin premio)
  v_j := v_j || jsonb_build_object('resena', case when v_r.url is not null
                                                  then jsonb_build_object('url', v_r.url, 'local', v_r.local_nombre) end);
  -- 179: «Reservar» de «Mi Club» → el OpenTable del local del socio, tal cual; sin fila, sin link o no OpenTable → null
  if jsonb_typeof(v_j->'socio') = 'object' then
    v_j := jsonb_set(v_j, '{socio,reserva_url}',
                     coalesce(to_jsonb((select k.reserva_url from public.club_cumple_config k
                                         where k.location_id = v_loc and public.club_reserva_url_ok(k.reserva_url))), 'null'::jsonb));
  end if;
  return v_j;
end;
$$;
comment on function public.club_portal(text) is
  '167 + 179: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null) + `socio.reserva_url` (el OpenTable '
  'del local del socio, tal cual, o null). El resto del portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare v_n int;
begin
  if not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_config_guardar(jsonb,text)', 'EXECUTE') then
    raise exception '179: club-web y Promociones tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('anon', 'public.club_reserva_url_ok(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_reserva_url_ok(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_cumple_config_guardar(jsonb,text)', 'EXECUTE') then
    raise exception '179: la interna y el guardado no se abren a anon';
  end if;
  if not public.club_reserva_url_ok('https://www.opentable.com/restref/client/?rid=1347736') then
    raise exception '179: el link por defecto de la 173 tiene que pasar';
  end if;
  select count(*) into v_n from public.club_cumple_config where reserva_url is not null and not public.club_reserva_url_ok(reserva_url);
  if v_n > 0 then
    raise notice '179: % local(es) con un link de reserva que no es de OpenTable: el portal no lo usa (rid por defecto) hasta que se corrija en Promociones', v_n;
  end if;
end
$$;

commit;
