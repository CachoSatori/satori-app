-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 180 (origen club 125) — El link de reservas (OpenTable) es de CADA LOCAL y se edita en Club → Locales           ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema. Pedido del dueño (16-nov 08:02): el link de reservas de OpenTable es de cada local y es para
-- TODOS (no solo el cumpleaños). Hoy vive en club_cumple_config.reserva_url (173, tarjeta «Cumpleaños» de Promociones) y
-- lo usa club_portal (179) para «Reservar». Pasa a la configuración del LOCAL (club_config, la misma fila que ya tiene el
-- link de reseña de Google de la 158 y el mapa), que se edita en Club → Locales (solo owner: policy club_config_update).
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. club_config.reserva_url (text, null): el link de reservas del local, TAL CUAL (OpenTable registra el canal de
--     entrada por sus parámetros; no se reconstruye).
--  2. Trigger club_config_reserva_url_trg (BEFORE INSERT OR UPDATE OF reserva_url): en UPDATE, vacío → null y rechaza lo
--     que no sea https de OpenTable con la interna de la 179 (club_reserva_url_ok). No puede ser un CHECK: un CHECK corre
--     la función con los permisos de quien escribe (authenticated no tiene EXECUTE sobre la interna, y no se le abre). En
--     INSERT lo deja en null: un local nuevo (club_local_crear con «copiar de») NO hereda el OpenTable de otro local.
--  3. Copia: cada local toma el link que tenía en club_cumple_config si es de OpenTable (club_reserva_url_ok). Los que no
--     lo son no se copian (aviso NOTICE con cuántos): el local queda sin link hasta que el owner lo cargue en Locales.
--  4. club_cumple_config.reserva_url queda DEPRECADA, sin uso: no se borra en esta migración (vuelta atrás simple), nadie
--     la lee y el guardado de Promociones ya no la escribe. Se borra en una migración futura.
--  5. club_cumple_cfg_json (173): `reserva_url` = el del local (club_config). Con eso club_cumple_config_ver (Promociones,
--     ahora solo lectura), club_cumple_proximos y club_cumple_enviar (el WhatsApp de cumpleaños del Inicio) leen el del
--     local sin tocarlas. club_cumple_en_caja ya lo quitaba (173/175).
--  6. club_cumple_config_guardar: la de la 179 + ignora `reserva_url` del formulario (no escribe la columna vieja) y
--     «solo con reserva» exige el link del LOCAL («cargalo en Club → Locales»). Sigue con club_exigir_local (receta 170/172).
--  7. club_portal: la de la 179, leyendo el link de club_config (mismo filtro club_reserva_url_ok).
--  8. club_cupon_ver (pública, página del cupón del turista): la de la 158 + `local.reserva` (el link del local del
--     cupón si es de OpenTable; si no, null). Solo esa clave nueva, dentro de `local` (que ya trae nombre, dirección y
--     mapa del mismo local). Nada más se expone.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata, ni sagrados, ni permisos: lo ejecutable por anon/authenticated queda igual (la función del trigger y la
--    interna, sin EXECUTE para la API). club_config sigue editable solo por el owner (RLS de la 150).
--  · Ni club_portal_datos, ni club_cupon_resena_clic, ni club_local_crear.
--
-- Va DESPUÉS de la 179 (necesita club_reserva_url_ok; aborta si falta). Pruebas: scripts/sql/180_pruebas.sql
-- (+ 180_pruebas.py; transacción descartada). Rollback: scripts/sql/180_rollback.sql.
begin;

do $$
begin
  if to_regprocedure('public.club_reserva_url_ok(text)') is null
     or to_regprocedure('public.club_cumple_cfg_json(public.club_cumple_config)') is null
     or to_regprocedure('public.club_cupon_ver(text)') is null
     or to_regclass('public.club_cumple_config') is null then
    raise exception '180: faltan la 179 (club_reserva_url_ok) o la 173 (club_cumple_config)';
  end if;
end $$;

-- ── 1. La columna del local ──────────────────────────────────────────────────────────────────────────────────────
alter table public.club_config add column if not exists reserva_url text;
comment on column public.club_config.reserva_url is
  '180: link de reservas (OpenTable) del local, tal cual. Lo carga el owner en Club → Locales. Lo usan «Reservar» del '
  'portal del socio (club_portal), la página del cupón (club_cupon_ver → local.reserva) y el WhatsApp de cumpleaños. '
  'Solo https de OpenTable (trigger club_config_reserva_url_trg con club_reserva_url_ok).';

-- ── 2. Validación (trigger, no CHECK: ver arriba) ────────────────────────────────────────────────────────────────
create or replace function public.club_config_reserva_url_validar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.reserva_url := null;   -- un local nuevo no hereda el OpenTable de otro (club_local_crear «copiar de»)
    return new;
  end if;
  new.reserva_url := nullif(btrim(coalesce(new.reserva_url, '')), '');
  if new.reserva_url is not null and not public.club_reserva_url_ok(new.reserva_url) then
    raise exception 'El link de reservas tiene que ser de OpenTable (https://www.opentable.com/…): copialo tal cual del navegador'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.club_config_reserva_url_validar() from public, anon, authenticated;
drop trigger if exists club_config_reserva_url_trg on public.club_config;
create trigger club_config_reserva_url_trg before insert or update of reserva_url on public.club_config
  for each row execute function public.club_config_reserva_url_validar();

-- ── 3. Copia desde Promociones (solo los de OpenTable; queda en club_config_historial por el trigger de la 150) ─────
update public.club_config c
   set reserva_url = k.reserva_url
  from public.club_cumple_config k
 where k.location_id = c.location_id
   and c.reserva_url is null
   and public.club_reserva_url_ok(k.reserva_url);

-- ── 4. La columna vieja: deprecada, sin uso ──────────────────────────────────────────────────────────────────────
comment on column public.club_cumple_config.reserva_url is
  '180: DEPRECADA, sin uso. El link de reservas es del local: club_config.reserva_url (Club → Locales). Quedó con el valor '
  'que tenía al aplicar la 180 (para la vuelta atrás); nadie la lee ni la escribe. Se borra en una migración futura.';
comment on table public.club_cumple_config is
  '173 (D-cumple-2): beneficio de cumpleaños del Local Club por local. Lo editan owner y manager de su local (club_cumple_config_guardar). '
  'En caja va como la cortesía `cortesia_id` (CORTESÍA CLUB, ₡0). 180: el link de reservas ya no es de acá: club_config.reserva_url.';

-- ── 5. El JSON de la configuración de cumpleaños: el link del LOCAL ──────────────────────────────────────────────
create or replace function public.club_cumple_cfg_json(r public.club_cumple_config)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'location_id', r.location_id, 'activo', r.activo, 'beneficio', r.beneficio, 'min_personas', r.min_personas,
    'dias_antes', r.dias_antes, 'dias_despues', r.dias_despues, 'uno_por_mesa', r.uno_por_mesa,
    'solo_reserva', r.solo_reserva,
    -- 180: el link de reservas es del local (Club → Locales), no de esta fila
    'reserva_url', (select g.reserva_url from public.club_config g
                     where g.location_id = r.location_id and public.club_reserva_url_ok(g.reserva_url)),
    'cortesia', (select jsonb_build_object('id', k.id, 'codigo', k.codigo_producto, 'nombre', k.nombre, 'activa', k.activa)
                   from public.club_cortesias k where k.id = r.cortesia_id and k.location_id = r.location_id),
    'lista_para_caja', exists (select 1 from public.club_cortesias k where k.id = r.cortesia_id and k.location_id = r.location_id and k.activa),
    'actualizado_en', r.actualizado_en)
$$;
revoke all on function public.club_cumple_cfg_json(public.club_cumple_config) from public, anon, authenticated;

-- ── 6. Guardado de Promociones (179 sin el link: ya no se edita acá) ─────────────────────────────────────────────
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
  -- 180: `reserva_url` del formulario se ignora (el link es del local, en Locales); la columna vieja no se escribe
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
  if v_n.solo_reserva and not exists (select 1 from public.club_config g
                                       where g.location_id = p_location and public.club_reserva_url_ok(g.reserva_url)) then
    raise exception 'Con «solo con reserva» hace falta el link de reservas del local: lo carga el owner en Club → Locales' using errcode = 'P0001';
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
                                              uno_por_mesa, solo_reserva, cortesia_id, actualizado_por, actualizado_en)
  values (p_location, v_n.activo, v_n.beneficio, v_n.min_personas, v_n.dias_antes, v_n.dias_despues,
          v_n.uno_por_mesa, v_n.solo_reserva, v_n.cortesia_id, auth.uid(), now())
  on conflict (location_id) do update set
    activo = excluded.activo, beneficio = excluded.beneficio, min_personas = excluded.min_personas,
    dias_antes = excluded.dias_antes, dias_despues = excluded.dias_despues, uno_por_mesa = excluded.uno_por_mesa,
    solo_reserva = excluded.solo_reserva, cortesia_id = excluded.cortesia_id,
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

-- ── 7. Portal del socio: el link de SU local, ahora de club_config ───────────────────────────────────────────────
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
  -- 179/180: «Reservar» de «Mi Club» → el OpenTable del local del socio (Club → Locales), tal cual; sin link → null
  if jsonb_typeof(v_j->'socio') = 'object' then
    v_j := jsonb_set(v_j, '{socio,reserva_url}',
                     coalesce(to_jsonb((select g.reserva_url from public.club_config g
                                         where g.location_id = v_loc and public.club_reserva_url_ok(g.reserva_url))), 'null'::jsonb));
  end if;
  return v_j;
end;
$$;
comment on function public.club_portal(text) is
  '167 + 179 + 180: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null) + `socio.reserva_url` (el '
  'OpenTable del local del socio, de club_config.reserva_url, tal cual, o null). El resto del portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

-- ── 8. Página del cupón: + local.reserva ─────────────────────────────────────────────────────────────────────────
-- Ver un cupón (PÚBLICA: anon y authenticated). Solo estado, vence_en y el nombre de pila del referente.
-- Si el referente está dado de baja o el cupón fue anulado, se informa como «vencido» (no se puede usar).
-- 158: + `resena` (link de Google del local) solo con el cupón usado hace menos de 7 días.
-- 180: + `local.reserva` (link de reservas del local del cupón, si es de OpenTable).
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
    -- 180: + `reserva` (OpenTable del local, tal cual; null si no tiene o no es de OpenTable)
    'local', (select jsonb_build_object('id', c.location_id, 'nombre', coalesce(c.nombre, c.location_id), 'direccion', c.direccion,
                                       'mapa', c.mapa_url,
                                       'reserva', case when public.club_reserva_url_ok(c.reserva_url) then c.reserva_url end)
                from public.club_config c where c.location_id = v_c.location_id),
    -- 158: la reseña de Google, solo después de usar el cupón y durante 7 días (a todos: sin filtrar por satisfacción)
    'resena', case when v_c.estado = 'usado' and v_c.usado_en > now() - interval '7 days'
                   then (select c.resena_url from public.club_config c where c.location_id = v_c.location_id) end);
end;
$$;
revoke all on function public.club_cupon_ver(text) from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text) to anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare v_n int;
begin
  if not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_cupon_ver(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_config_guardar(jsonb,text)', 'EXECUTE') then
    raise exception '180: club-web y Promociones tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('anon', 'public.club_config_reserva_url_validar()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_config_reserva_url_validar()', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_reserva_url_ok(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_reserva_url_ok(text)', 'EXECUTE') then
    raise exception '180: la función del trigger y la interna no se abren a la API';
  end if;
  if exists (select 1 from public.club_config c join public.club_cumple_config k on k.location_id = c.location_id
              where public.club_reserva_url_ok(k.reserva_url) and c.reserva_url is distinct from k.reserva_url) then
    raise exception '180: la copia del link de reservas no coincide con Promociones';
  end if;
  select count(*) into v_n from public.club_cumple_config k
   where k.reserva_url is not null and not public.club_reserva_url_ok(k.reserva_url);
  if v_n > 0 then
    raise notice '180: % local(es) tenían en Promociones un link de reservas que no es de OpenTable: no se copió; cargarlo en Club → Locales', v_n;
  end if;
end
$$;

commit;
