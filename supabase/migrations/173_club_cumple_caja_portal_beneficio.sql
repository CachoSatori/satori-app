-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 173 (origen club 119) — Cumpleaños en el alta en caja y en el portal (una vez) + beneficio configurable + aviso ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema y cortesías. Decisiones firmadas por el dueño (15-nov, por el chat):
--  · D-cumple-1 = A: el cumpleaños (día y mes, sin año, con permiso explícito para un beneficio) se carga también en el
--    ALTA EN CAJA (el cajero marca el permiso solo si la persona dice que sí) y el socio que no lo dio lo agrega UNA vez
--    desde su portal. Cambiarlo después: solo por pedido (club_socio_cumple_corregir del owner, como hoy).
--  · D-cumple-2: beneficio de cumpleaños CONFIGURABLE por local (owner y manager de su local): activo, texto, mínimo de
--    personas, días antes y después, uno por mesa, solo con reserva y link de reserva. Sirve para otras cosas cambiando
--    el texto. Aviso en el Inicio de owner/manager con WhatsApp por socio y marca «enviado» (una por socio y año).
--  · En caja el beneficio es una cortesía «CORTESÍA CLUB» (₡0) del local, como las demás: el tablero (160) ya la cuenta
--    a costo por factura del Club. No hay plata nueva: solo se elige el artículo (club_cortesias) en la configuración.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. Aviso v1.3 (ES/EN): «Sus derechos» dice que el cumpleaños se agrega una vez desde el portal; «Para qué», que el
--     aviso por WhatsApp incluye el beneficio de cumpleaños. Huellas en club_avisos_privacidad, default y locales → v1.3.
--  2. club_miembros_contacto.cumple_portal_en: cuándo lo agregó desde el portal (la «una vez»; no se borra nunca).
--  3. Guardia club_contacto_cumple_guardia (159) rehecha: además de la autoalta, deja CARGAR el cumpleaños a quien no lo
--     tiene solo desde una función de la base que lo pide explícito (club.cumple_carga = 'alta_caja' o 'portal', variable
--     de la transacción, y corriendo como el dueño de las funciones). La marca del portal solo la pone el portal.
--  4. club_socio_alta_caja_v3: la v2 (159) + cumpleaños opcional con permiso. Valida ANTES del alta.
--  5. club_portal_cumple / club_portal_cumple_agregar (club-web, portón x-club-web): estado sin la fecha y agregarlo una vez.
--  6. club_cumple_config (una fila por local; apagado por defecto) + club_cumple_config_ver / _guardar (owner y manager
--     de su local; cada cambio a club_auditoria). El PR de Google Wallet lee de acá `beneficio` y `reserva_url`.
--  7. club_cumple_envios (miembro, año del cumpleaños): la marca «enviado». club_cumple_proximos (Inicio) y
--     club_cumple_enviar (marca + devuelve el WhatsApp para armar el mensaje; auditado sin el dato).
--  8. club_cumple_en_caja (Escanear): ¿hoy cae en la ventana de su cumpleaños? Devuelve el beneficio y el artículo de
--     cortesía, NUNCA la fecha.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata ni movimientos: no registra usos ni cambia club_socio_visita. La cortesía la marca el cajero en el PoS.
--  · Ni sagrados, ni envoltorios de la 170/172 (las funciones nuevas con p_location llaman a club_exigir_local).
--  · club_portal, club_miembro_contacto_ver y el exporte siguen sin devolver el cumpleaños.
--
-- ⚠ ORDEN: como la 159, club-web manda `acepto: 'v1.3'` y la base rechaza un alta con otra versión. Esta migración
-- (Branching) y el deploy de club-web y de la app van en el MISMO merge, con el local sin altas en curso.
-- Pruebas: scripts/sql/173_pruebas.sql (+ 173_pruebas.py; transacción descartada). Rollback: scripts/sql/173_rollback.sql.
begin;

do $$
begin
  if to_regprocedure('public.club_exigir_local(text)') is null
     or to_regprocedure('public.club_socio_alta_caja_v2(text,text,text,boolean,boolean,text)') is null
     or to_regprocedure('public.club_contacto_cumple_guardia()') is null then
    raise exception '173: faltan la 159 o la 170 (club_socio_alta_caja_v2, la guardia del cumpleaños, club_exigir_local)';
  end if;
end $$;

-- ── 1. Aviso v1.3 ────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.club_avisos_privacidad (version, sha256_es, sha256_en) values
  ('v1.3', '6d9ef4f4fbcc6823d197bb6011324ecb4d1604e61a34e4f40c0e8503abbe523d', '504ed876f636cfe284adbee827f966518c7d1ae1c7c21a321a7a3cffd6d90a15')
on conflict (version) do nothing;
alter table public.club_config alter column aviso_privacidad_version set default 'v1.3';
update public.club_config set aviso_privacidad_version = 'v1.3' where aviso_privacidad_version = 'v1.2';

-- ── 2. La «una vez» del portal ───────────────────────────────────────────────────────────────────────────────────
alter table public.club_miembros_contacto add column if not exists cumple_portal_en timestamptz;
comment on column public.club_miembros_contacto.cumple_portal_en is
  '173 (D-cumple-1 A): cuándo el socio agregó su cumpleaños desde el portal. Con fecha, el portal ya no deja agregarlo otra vez. No se borra (ni con la baja).';

-- Día y mes válidos (29-feb sí), para las funciones de abajo
create or replace function public.club_cumple_valido(p_dia int, p_mes int)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_dia is not null and p_mes is not null and p_mes between 1 and 12
     and p_dia between 1 and (case when p_mes = 2 then 29 when p_mes in (4, 6, 9, 11) then 30 else 31 end)
$$;

-- ── 3. Guardia (159 + 173) ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.club_contacto_cumple_guardia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tenia   boolean := tg_op = 'UPDATE' and old.cumple_dia is not null;
  v_tiene   boolean := new.cumple_dia is not null or new.cumple_mes is not null or new.cumple_permiso_en is not null;
  -- corre como el dueño de las funciones del Club (postgres, supabase_admin…; el mismo criterio de la 159)
  v_base    boolean := current_user = (select pg_get_userbyid(p.proowner) from pg_proc p
                                        where p.oid = to_regprocedure('public.club_socio_autoalta(jsonb)'));
  -- 173: la función que carga el cumpleaños lo dice explícito (variable de la transacción; la API no la puede poner)
  v_carga   text := coalesce(current_setting('club.cumple_carga', true), '');
  v_portal_antes timestamptz := case when tg_op = 'UPDATE' then old.cumple_portal_en end;
begin
  -- 173: la marca del portal la pone solo el portal, una vez (de null a una fecha); nadie la cambia ni la borra
  if new.cumple_portal_en is distinct from v_portal_antes
     and not (v_portal_antes is null and v_base and v_carga = 'portal') then
    raise exception 'La marca del cumpleaños del portal no se cambia' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.cumple_dia, new.cumple_mes, new.cumple_permiso_en)
                          is not distinct from (old.cumple_dia, old.cumple_mes, old.cumple_permiso_en) then
    return new;
  end if;
  if not v_tiene then   -- borrarlo (baja, retiro del permiso): siempre (el rastro lo deja club_contacto_cumple_auditar)
    return new;
  end if;
  -- 159: en el alta web, la fila de contacto nace en esta transacción y la escribe la autoalta
  if not v_tenia and new.created_at = now() and v_base then
    return new;
  end if;
  -- 173: a quien NO lo tiene, solo el alta en caja (club_socio_alta_caja_v3) o el portal (club_portal_cumple_agregar)
  if not v_tenia and v_base and v_carga in ('alta_caja', 'portal') then
    return new;
  end if;
  if coalesce(public.get_my_role()::text, '') = 'owner' then
    return new;
  end if;
  raise exception 'El cumpleaños no se cambia después del alta: lo corrige solo el owner' using errcode = '42501';
end;
$$;
revoke all on function public.club_contacto_cumple_guardia() from public, anon, authenticated;

-- ── 4. Alta en caja con cumpleaños (envuelve a la v2, sin tocarla) ────────────────────────────────────────────────
create or replace function public.club_socio_alta_caja_v3(p_nombre text, p_whatsapp text, p_email text, p_verifico_residencia boolean,
                                                          p_mayor_edad boolean, p_cumple_dia int, p_cumple_mes int,
                                                          p_cumple_permiso boolean, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_r      jsonb;
  v_id     uuid;
  v_cumple text := 'no_dio';
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  -- el cumpleaños se valida ANTES del alta: con un error, no queda nada a medias
  if p_cumple_dia is not null or p_cumple_mes is not null then
    if not public.club_cumple_valido(p_cumple_dia, p_cumple_mes) then
      raise exception 'Cumpleaños no válido: elegí un día y un mes que existan (o dejalo vacío)' using errcode = 'P0001';
    end if;
    if coalesce(p_cumple_permiso, false) is not true then
      raise exception 'Para guardar el cumpleaños marcá que dio permiso; si no lo da, dejalo vacío' using errcode = 'P0001';
    end if;
  elsif coalesce(p_cumple_permiso, false) then
    raise exception 'Marcaste el permiso del cumpleaños pero falta el día y el mes' using errcode = 'P0001';
  end if;
  v_r := public.club_socio_alta_caja_v2(p_nombre, p_whatsapp, p_email, p_verifico_residencia, p_mayor_edad, p_location);
  v_id := (v_r->>'miembro_id')::uuid;
  if p_cumple_dia is not null then
    if exists (select 1 from public.club_miembros_contacto c where c.miembro_id = v_id and c.cumple_dia is not null) then
      v_cumple := 'ya_tenia';   -- una persona que ya existía (p. ej. anfitrión) y lo tenía: no se cambia acá
    else
      perform set_config('club.cumple_carga', 'alta_caja', true);
      update public.club_miembros_contacto
         set cumple_dia = p_cumple_dia, cumple_mes = p_cumple_mes, cumple_permiso_en = now(), updated_at = now()
       where miembro_id = v_id and cumple_dia is null;
      v_cumple := case when found then 'guardado' else 'sin_contacto' end;
      perform set_config('club.cumple_carga', '', true);
    end if;
  end if;
  return v_r || jsonb_build_object('cumple', v_cumple);
end;
$$;
revoke all on function public.club_socio_alta_caja_v3(text, text, text, boolean, boolean, int, int, boolean, text) from public, anon, authenticated;
grant execute on function public.club_socio_alta_caja_v3(text, text, text, boolean, boolean, int, int, boolean, text) to authenticated;

-- ── 5. Portal (club-web): estado sin la fecha y agregarlo UNA vez ────────────────────────────────────────────────
create or replace function public.club_portal_cumple(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok   text := lower(btrim(coalesce(p_token, '')));
  v_id    uuid;
  v_socio boolean;
  v_c     public.club_miembros_contacto%rowtype;
begin
  if not public.club_web_ok() then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  if v_tok !~ '^[0-9a-f]{64}$' then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  v_socio := exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_id and r.rol = 'socio' and r.estado <> 'baja');
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = v_id;
  return jsonb_build_object('socio', v_socio, 'tiene', v_c.cumple_dia is not null,
                            'puede_agregar', v_socio and v_c.miembro_id is not null and v_c.cumple_dia is null and v_c.cumple_portal_en is null);
end;
$$;
revoke all on function public.club_portal_cumple(text) from public, anon, authenticated;
grant execute on function public.club_portal_cumple(text) to anon, authenticated;

create or replace function public.club_portal_cumple_agregar(p_token text, p_dia int, p_mes int, p_permiso boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok text := lower(btrim(coalesce(p_token, '')));
  v_id  uuid;
  v_c   public.club_miembros_contacto%rowtype;
begin
  if not public.club_web_ok() then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  if v_tok !~ '^[0-9a-f]{64}$' then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found or not exists (select 1 from public.club_miembro_roles r
                               where r.miembro_id = v_id and r.rol = 'socio' and r.estado <> 'baja') then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if p_permiso is not true or not public.club_cumple_valido(p_dia, p_mes) then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = v_id for update;
  if not found then raise exception 'Datos no válidos' using errcode = 'P0001'; end if;
  if v_c.cumple_portal_en is not null or v_c.cumple_dia is not null then
    raise exception 'Cumpleaños ya cargado' using errcode = 'P0001';
  end if;
  perform set_config('club.cumple_carga', 'portal', true);
  update public.club_miembros_contacto
     set cumple_dia = p_dia, cumple_mes = p_mes, cumple_permiso_en = now(), cumple_portal_en = now(), updated_at = now()
   where miembro_id = v_id;
  perform set_config('club.cumple_carga', '', true);
  perform public.club_auditar('cumple_portal', 'club_miembros_contacto', v_id, null, jsonb_build_object('tiene', true));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.club_portal_cumple_agregar(text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.club_portal_cumple_agregar(text, int, int, boolean) to anon, authenticated;

-- ── 6. Configuración del beneficio, por local ────────────────────────────────────────────────────────────────────
create table if not exists public.club_cumple_config (
  location_id     text primary key references public.club_config(location_id),
  activo          boolean not null default false,
  beneficio       text not null default 'postre de cortesía' check (length(btrim(beneficio)) between 3 and 120),
  min_personas    int not null default 5 check (min_personas between 1 and 50),
  dias_antes      int not null default 7 check (dias_antes between 0 and 30),
  dias_despues    int not null default 7 check (dias_despues between 0 and 30),
  uno_por_mesa    boolean not null default true,
  solo_reserva    boolean not null default true,
  reserva_url     text check (reserva_url ~ '^https://[^\s<>"]{4,}$' and length(reserva_url) <= 300),
  cortesia_id     uuid references public.club_cortesias(id),
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);
alter table public.club_cumple_config enable row level security;
revoke all on public.club_cumple_config from public, anon, authenticated;
comment on table public.club_cumple_config is
  '173 (D-cumple-2): beneficio de cumpleaños del Local Club por local. Lo editan owner y manager de su local (club_cumple_config_guardar). '
  'El PR de Google Wallet (Edge club-pase, service_role) lee `beneficio` y `reserva_url` de acá. En caja va como la cortesía `cortesia_id` (CORTESÍA CLUB, ₡0).';
-- Una fila por local que ya existe (apagada). OpenTable rid 1347736 por defecto (público); se edita por local.
insert into public.club_cumple_config (location_id, reserva_url)
select c.location_id, 'https://www.opentable.com/restref/client/?rid=1347736' from public.club_config c
on conflict (location_id) do nothing;

-- La fila del local (o la de por defecto si el local se creó después), sin permisos: la usan las funciones de abajo
create or replace function public.club_cumple_cfg(p_location text)
returns public.club_cumple_config
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare r public.club_cumple_config%rowtype;
begin
  select * into r from public.club_cumple_config k where k.location_id = p_location;
  if not found then
    r.location_id := p_location; r.activo := false; r.beneficio := 'postre de cortesía'; r.min_personas := 5;
    r.dias_antes := 7; r.dias_despues := 7; r.uno_por_mesa := true; r.solo_reserva := true;
    r.reserva_url := 'https://www.opentable.com/restref/client/?rid=1347736';
  end if;
  return r;
end;
$$;
revoke all on function public.club_cumple_cfg(text) from public, anon, authenticated;

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

create or replace function public.club_cumple_config_ver(p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  return public.club_cumple_cfg_json(public.club_cumple_cfg(p_location));
end;
$$;
revoke all on function public.club_cumple_config_ver(text) from public, anon, authenticated;
grant execute on function public.club_cumple_config_ver(text) to authenticated;

-- p_datos: {activo, beneficio, min_personas, dias_antes, dias_despues, uno_por_mesa, solo_reserva, reserva_url, cortesia_id}
-- Todos obligatorios (la pantalla manda el formulario entero); cortesia_id y reserva_url pueden ir en null.
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

-- ── 7. Fechas (día de Costa Rica), marca «enviado», Inicio y WhatsApp ─────────────────────────────────────────────
-- El cumpleaños de un año: el 29-feb en un año no bisiesto se festeja el 28-feb.
create or replace function public.club_cumple_fecha(p_dia int, p_mes int, p_anio int)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_mes = 2 and p_dia = 29
                   and not (p_anio % 4 = 0 and (p_anio % 100 <> 0 or p_anio % 400 = 0))
              then make_date(p_anio, 2, 28) else make_date(p_anio, p_mes, p_dia) end
$$;
-- El próximo cumpleaños desde p_hoy (hoy incluido): cruza el fin de año
create or replace function public.club_cumple_proximo(p_dia int, p_mes int, p_hoy date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int) >= p_hoy
              then public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int)
              else public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int + 1) end
$$;
-- El cumpleaños cuya ventana [cumple − antes, cumple + después] contiene a p_hoy (el más cercano), o null. Mira el año
-- anterior, el actual y el siguiente: el 3 de enero cae en la ventana de un cumpleaños del 30 de diciembre.
create or replace function public.club_cumple_en_ventana(p_dia int, p_mes int, p_hoy date, p_antes int, p_despues int)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select f from (select public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int + k) as f
                   from generate_series(-1, 1) k) x
   where p_hoy between f - p_antes and f + p_despues
   order by abs(f - p_hoy), f limit 1
$$;

create table if not exists public.club_cumple_envios (
  miembro_id  uuid not null references public.club_miembros(id) on delete cascade,
  anio        int not null check (anio between 2026 and 2200),
  location_id text not null,
  enviado_por uuid,
  enviado_en  timestamptz not null default now(),
  primary key (miembro_id, anio)
);
alter table public.club_cumple_envios enable row level security;
revoke all on public.club_cumple_envios from public, anon, authenticated;
comment on table public.club_cumple_envios is
  '173: marca «enviado» del saludo de cumpleaños (WhatsApp desde el Inicio). Una por socio y AÑO DEL CUMPLEAÑOS (un cumpleaños del 2-ene avisado el 28-dic es del año siguiente).';

-- Lista del Inicio (sin permisos: la llama club_cumple_proximos; p_hoy fijo para las pruebas)
create or replace function public.club_cumple_lista(p_location text, p_hoy date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cfg as (select * from public.club_cumple_cfg(p_location)),
  s as (
    select m.id, m.nombre, f.cumple, (f.cumple - p_hoy) as faltan, c.telefono is not null as con_whatsapp
      from public.club_miembros m
      join public.club_miembro_roles r on r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo'
      join public.club_miembros_contacto c on c.miembro_id = m.id and c.cumple_dia is not null and c.cumple_permiso_en is not null
      cross join cfg
      cross join lateral (select public.club_cumple_proximo(c.cumple_dia, c.cumple_mes, p_hoy) as cumple) f
     where m.location_id = p_location and m.estado = 'activo' and cfg.activo
       and f.cumple <= p_hoy + cfg.dias_antes
       and not exists (select 1 from public.club_cumple_envios e
                        where e.miembro_id = m.id and e.anio = extract(year from f.cumple)::int))
  select public.club_cumple_cfg_json(public.club_cumple_cfg(p_location)) || jsonb_build_object(
           'hoy', p_hoy,
           'socios', coalesce((select jsonb_agg(jsonb_build_object('miembro_id', s.id, 'nombre', s.nombre, 'faltan', s.faltan,
                                                                  'con_whatsapp', s.con_whatsapp)
                                                order by s.faltan, s.nombre) from s), '[]'::jsonb))
$$;
revoke all on function public.club_cumple_lista(text, date) from public, anon, authenticated;

create or replace function public.club_cumple_proximos(p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  return public.club_cumple_lista(p_location, (now() at time zone 'America/Costa_Rica')::date);
end;
$$;
revoke all on function public.club_cumple_proximos(text) from public, anon, authenticated;
grant execute on function public.club_cumple_proximos(text) to authenticated;

-- Marca «enviado» + los datos para armar el WhatsApp (sin permisos: la llama club_cumple_enviar; p_hoy fijo en pruebas)
create or replace function public.club_cumple_marcar(p_miembro uuid, p_location text, p_hoy date)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_cfg public.club_cumple_config%rowtype := public.club_cumple_cfg(p_location);
  v_m   public.club_miembros%rowtype;
  v_c   public.club_miembros_contacto%rowtype;
  v_f   date;
begin
  if not v_cfg.activo then
    raise exception 'El beneficio de cumpleaños está apagado en este local (Club → Promociones)' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros m where m.id = p_miembro and m.location_id = p_location and m.estado = 'activo' for update;
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = p_miembro;
  if v_m.id is null or v_c.cumple_dia is null or v_c.cumple_permiso_en is null
     or not exists (select 1 from public.club_miembro_roles r where r.miembro_id = p_miembro and r.rol = 'socio' and r.estado = 'activo') then
    raise exception 'Ese socio ya no está en la lista: recargá el Inicio' using errcode = 'P0001';
  end if;
  if v_c.telefono is null then
    raise exception 'Ese socio no tiene WhatsApp cargado' using errcode = 'P0001';
  end if;
  v_f := public.club_cumple_proximo(v_c.cumple_dia, v_c.cumple_mes, p_hoy);
  if v_f > p_hoy + v_cfg.dias_antes then
    raise exception 'Ese socio ya no está en la lista: recargá el Inicio' using errcode = 'P0001';
  end if;
  insert into public.club_cumple_envios (miembro_id, anio, location_id, enviado_por)
  values (p_miembro, extract(year from v_f)::int, p_location, auth.uid())
  on conflict (miembro_id, anio) do nothing;
  if not found then
    raise exception 'Ya se le mandó el saludo de cumpleaños de este año' using errcode = 'P0001';
  end if;
  perform public.club_auditar('cumple_enviar', 'club_cumple_envios', p_miembro, null,
                              jsonb_build_object('anio', extract(year from v_f)::int, 'local', p_location));
  return public.club_cumple_cfg_json(v_cfg) || jsonb_build_object(
    'nombre', v_m.nombre, 'whatsapp', v_c.telefono, 'cumple', v_f,
    'desde', v_f - v_cfg.dias_antes, 'hasta', v_f + v_cfg.dias_despues);
end;
$$;
revoke all on function public.club_cumple_marcar(uuid, text, date) from public, anon, authenticated;

create or replace function public.club_cumple_enviar(p_miembro uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  return public.club_cumple_marcar(p_miembro, p_location, (now() at time zone 'America/Costa_Rica')::date);
end;
$$;
revoke all on function public.club_cumple_enviar(uuid, text) from public, anon, authenticated;
grant execute on function public.club_cumple_enviar(uuid, text) to authenticated;

-- ── 8. Caja: ¿hoy cae en la ventana de su cumpleaños? (sin la fecha) ─────────────────────────────────────────────
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
     or not exists (select 1 from public.club_miembros m where m.id = p_miembro and m.estado = 'activo')
     or not exists (select 1 from public.club_miembro_roles r where r.miembro_id = p_miembro and r.rol = 'socio' and r.estado = 'activo')
     or public.club_cumple_en_ventana(v_c.cumple_dia, v_c.cumple_mes, p_hoy, v_cfg.dias_antes, v_cfg.dias_despues) is null then
    return jsonb_build_object('aplica', false);
  end if;
  return jsonb_build_object('aplica', true) || (public.club_cumple_cfg_json(v_cfg) - 'reserva_url' - 'actualizado_en' - 'location_id');
end;
$$;
revoke all on function public.club_cumple_en_caja_dia(uuid, text, date) from public, anon, authenticated;

create or replace function public.club_cumple_en_caja(p_miembro uuid, p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, true);
  return public.club_cumple_en_caja_dia(p_miembro, p_location, (now() at time zone 'America/Costa_Rica')::date);
end;
$$;
revoke all on function public.club_cumple_en_caja(uuid, text) from public, anon, authenticated;
grant execute on function public.club_cumple_en_caja(uuid, text) to authenticated;

revoke all on function public.club_cumple_valido(int, int) from public, anon, authenticated;
revoke all on function public.club_cumple_fecha(int, int, int) from public, anon, authenticated;
revoke all on function public.club_cumple_proximo(int, int, date) from public, anon, authenticated;
revoke all on function public.club_cumple_en_ventana(int, int, date, int, int) from public, anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if exists (select 1 from public.club_config where aviso_privacidad_version = 'v1.2') then
    raise exception '173: los locales tienen que quedar con el aviso v1.3';
  end if;
  if exists (select 1 from public.club_cumple_config where activo) then
    raise exception '173: el beneficio de cumpleaños tiene que quedar APAGADO (lo enciende owner o manager)';
  end if;
  if not has_function_privilege('authenticated', 'public.club_socio_alta_caja_v3(text,text,text,boolean,boolean,int,int,boolean,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_portal_cumple_agregar(text,int,int,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_proximos(text)', 'EXECUTE') then
    raise exception '173: la caja, club-web y el Inicio tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('authenticated', 'public.club_cumple_marcar(uuid,text,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_cumple_lista(text,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_cumple_en_caja_dia(uuid,text,date)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.club_cumple_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_cumple_envios', 'SELECT')
     or has_table_privilege('anon', 'public.club_cumple_envios', 'INSERT') then
    raise exception '173: las internas y las tablas no se abren a la API';
  end if;
end
$$;

commit;
