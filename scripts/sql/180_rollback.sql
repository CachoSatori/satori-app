-- Rollback de la 180 (origen club 125): link de reservas por local. Vuelve club_cupon_ver a la 158, club_portal y
-- club_cumple_config_guardar a la 179 y club_cumple_cfg_json a la 173 (byte a byte), y antes devuelve a
-- club_cumple_config.reserva_url el link que cada local tenga en Locales (así no se pierde lo cargado después de la 180).
-- Después borra el trigger, su función y club_config.reserva_url. club-web sin la 180 sigue andando (sin `local.reserva`
-- la página del cupón no muestra «Reservar una mesa»; el portal cae al rid por defecto si no hay link).
-- Borra la fila 180 del ledger. Si se corre en prod, en el mismo momento sale el .sql de la 180 de main (si queda,
-- Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

-- 0. lo cargado en Locales vuelve a Promociones (solo links de OpenTable, que cumplen el CHECK de la 173)
update public.club_cumple_config k
   set reserva_url = c.reserva_url
  from public.club_config c
 where c.location_id = k.location_id
   and public.club_reserva_url_ok(c.reserva_url)
   and k.reserva_url is distinct from c.reserva_url;

-- 8. club_cupon_ver: la de la 158
create or replace function public.club_cupon_ver(p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
  v_c   public.club_cupones%rowtype;
  v_m   public.club_miembros%rowtype;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  select * into v_c from public.club_cupones c where c.codigo = v_cod;
  if not found then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros m where m.id = v_c.referente_id;
  return jsonb_build_object(
    'estado', case
                when v_c.estado = 'usado' then 'usado'
                when v_c.estado = 'anulado' or v_m.estado <> 'activo' or v_c.vence_en <= now() then 'vencido'
                else 'vigente' end,
    'vence_en', v_c.vence_en,
    'referente', public.club_nombre_pila(v_m.nombre),
    -- LC-ML: el local del cupón sale de club_config (nombre, dirección y mapa), no de club-web
    'local', (select jsonb_build_object('id', c.location_id, 'nombre', coalesce(c.nombre, c.location_id), 'direccion', c.direccion,
                                       'mapa', c.mapa_url) from public.club_config c where c.location_id = v_c.location_id),
    -- 158: la reseña de Google, solo después de usar el cupón y durante 7 días (a todos: sin filtrar por satisfacción)
    'resena', case when v_c.estado = 'usado' and v_c.usado_en > now() - interval '7 days'
                   then (select c.resena_url from public.club_config c where c.location_id = v_c.location_id) end);
end;
$$;
revoke all on function public.club_cupon_ver(text) from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text) to anon, authenticated;

-- 7. club_portal: la de la 179
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

-- 6. club_cumple_config_guardar: la de la 179
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

-- 5. club_cumple_cfg_json: la de la 173
create or replace function public.club_cumple_cfg_json(r public.club_cumple_config)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'location_id', r.location_id, 'activo', r.activo, 'beneficio', r.beneficio, 'min_personas', r.min_personas,
    'dias_antes', r.dias_antes, 'dias_despues', r.dias_despues, 'uno_por_mesa', r.uno_por_mesa,
    'solo_reserva', r.solo_reserva, 'reserva_url', r.reserva_url,
    'cortesia', (select jsonb_build_object('id', k.id, 'codigo', k.codigo_producto, 'nombre', k.nombre, 'activa', k.activa)
                   from public.club_cortesias k where k.id = r.cortesia_id and k.location_id = r.location_id),
    'lista_para_caja', exists (select 1 from public.club_cortesias k where k.id = r.cortesia_id and k.location_id = r.location_id and k.activa),
    'actualizado_en', r.actualizado_en)
$$;
revoke all on function public.club_cumple_cfg_json(public.club_cumple_config) from public, anon, authenticated;

-- 4. comentarios de la 173
comment on column public.club_cumple_config.reserva_url is null;
comment on table public.club_cumple_config is
  '173 (D-cumple-2): beneficio de cumpleaños del Local Club por local. Lo editan owner y manager de su local (club_cumple_config_guardar). '
  'El PR de Google Wallet (Edge club-pase, service_role) lee `beneficio` y `reserva_url` de acá. En caja va como la cortesía `cortesia_id` (CORTESÍA CLUB, ₡0).';

-- 2 y 1. trigger, su función y la columna del local
drop trigger if exists club_config_reserva_url_trg on public.club_config;
drop function if exists public.club_config_reserva_url_validar();
alter table public.club_config drop column if exists reserva_url;

delete from supabase_migrations.schema_migrations where version = '180';

commit;
