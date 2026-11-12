-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 159 (origen 101) — Aviso de privacidad del Club v1.2 + D6 A: mayor de 18 y cumpleaños en el alta ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Toca esquema y datos personales: no se mergea sin la firma del dueño. Creada como 101 (bloque CLUB, 12-nov, como
-- 152); prod va por la 155 y 156–158 son de #174/#176/#177, así que va como 159 del bloque de PASE (regla 3), origen 101.
-- Decisión firmada: D6 A (14-nov) — alta del Local Club con «mayor de 18» obligatorio y cumpleaños día/mes opcional con
-- permiso explícito para usarlo en beneficios, junto con el aviso v1.2 (el #140).
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--  1. Aviso v1.2 («usted» + edad + cumpleaños, ES y EN): registra su huella en club_avisos_privacidad (inmutable), lo
--     pone como default y pasa los locales de v1.1 a v1.2. Quien aceptó v1.1 queda con v1.1 en su fila.
--  2. club_miembro_roles.mayor_edad_en (timestamptz): cuándo confirmó ser mayor de 18 en el alta. Sin datos viejos: las
--     altas anteriores quedan en null (no se inventa un consentimiento).
--  3. club_miembros_contacto.cumple_dia / cumple_mes / cumple_permiso_en: todos null o todos cargados (el permiso es la
--     condición para guardar el dato); día/mes válidos con el 29-feb permitido; sin año.
--  4. Trigger diferido club_roles_mayor_edad_chk: un alta de socio por caja o autoalta (INSERT del rol, o `desde` que
--     cambia en una re-alta) sin mayor_edad_en se RECHAZA al confirmar la transacción, venga de la función que venga.
--  5. Trigger club_contacto_cumple_guardia: el cumpleaños se carga SOLO en el alta (fila de contacto creada en la misma
--     transacción, por una función de la base). Después no lo cambia nadie salvo el owner, con
--     club_socio_cumple_corregir (nota obligatoria; auditado sin el dato). Borrarlo siempre se puede. Ni anon, ni el
--     portal, ni un manager lo editan (la app ya no puede escribir la tabla directo: no tiene SELECT para el WHERE).
--  6. Trigger club_roles_baja_borra_cumple: cuando el rol de socio pasa a baja (portal, gerencia, cualquier vía), el
--     cumpleaños se borra (el aviso lo dice: «Si se da de baja, lo borramos»).
--  7. club_socio_autoalta(jsonb): copia EXACTA de la 150 + exige `mayor_edad` = true y valida el cumpleaños opcional;
--     guarda mayor_edad_en y, solo para una persona NUEVA, el cumpleaños. Si el teléfono ya existía (solicitud), no toca nada.
--  8. club_socio_alta_caja_v2(…, p_mayor_edad, …): nueva. Exige «es mayor de 18» y llama a club_socio_alta_caja (la
--     vigente: la de la 150 o la de la 156, sin tocarla) en la misma transacción. Se le quita el EXECUTE directo a la de
--     5 argumentos (la app llama a la v2); si alguien la llama igual, el trigger del punto 4 rechaza el alta.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--  · Ni plata, ni movimientos, ni socios existentes. club_socio_alta_caja NO se reescribe (la reescribe la 156, #174).
--  · Ninguna función devuelve el cumpleaños (ni club_portal, ni club_miembro_contacto_ver, ni el exporte). La auditoría
--    del contacto (club_auditar_trg) sigue con booleanos; la guardia agrega «cumple_corregido/borrado» sin el valor.
--
-- ⚠ ORDEN: club-web manda `acepto: 'v1.2'` y `mayor_edad: true`, y la app llama a club_socio_alta_caja_v2. La base
-- rechaza un alta con otra versión o sin edad. Esta migración (Branching) y el deploy de club-web y de la app tienen que
-- entrar en el MISMO merge, con el local sin altas en curso.
-- Pruebas: scripts/sql/159_pruebas.sql (transacción descartada). Rollback: scripts/sql/159_rollback.sql.

-- ── 1. Aviso v1.2 ──────────────────────────────────────────────────────────────────────────────
insert into public.club_avisos_privacidad (version, sha256_es, sha256_en) values
  ('v1.2', '755d3ac1c19bf0d679f6e7844bcf950aec4803abd2098616d0c2b6b897e256dc', 'a83ec65f5cc5eecb1a9d9a1c59c13af9b222110931c01d0b873c990404a306cf')
on conflict (version) do nothing;

alter table public.club_config alter column aviso_privacidad_version set default 'v1.2';
-- El historial de club_config (club_config_auditar) deja una fila por local con el cambio de versión.
update public.club_config set aviso_privacidad_version = 'v1.2' where aviso_privacidad_version = 'v1.1';

-- ── 2 y 3. Columnas ────────────────────────────────────────────────────────────────────────────
alter table public.club_miembro_roles add column if not exists mayor_edad_en timestamptz;
comment on column public.club_miembro_roles.mayor_edad_en is
  'D6 A (159): cuándo la persona confirmó ser mayor de 18 en el alta del Local Club (autoalta o caja). Null en altas anteriores a la 159.';

alter table public.club_miembros_contacto add column if not exists cumple_dia smallint;
alter table public.club_miembros_contacto add column if not exists cumple_mes smallint;
alter table public.club_miembros_contacto add column if not exists cumple_permiso_en timestamptz;
alter table public.club_miembros_contacto drop constraint if exists club_contacto_cumple_valido;
alter table public.club_miembros_contacto add constraint club_contacto_cumple_valido check (
  ((cumple_dia is null) = (cumple_mes is null) and (cumple_dia is null) = (cumple_permiso_en is null))
  and (cumple_mes is null or (cumple_mes between 1 and 12
       and cumple_dia between 1 and case when cumple_mes = 2 then 29 when cumple_mes in (4, 6, 9, 11) then 30 else 31 end)));
comment on column public.club_miembros_contacto.cumple_dia is
  'D6 A (159): día del cumpleaños (sin año), opcional, solo con permiso (cumple_permiso_en). Dato personal: no se devuelve fuera de la base.';

-- ── 4. Mayor de 18: la base rechaza el alta sin la confirmación ─────────────────────────────────
create or replace function public.club_roles_mayor_edad_chk()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.club_miembro_roles%rowtype;
begin
  if new.rol <> 'socio' then return null; end if;
  -- solo un alta (fila nueva o re-alta, que mueve `desde`) o un intento de borrar la confirmación
  if tg_op = 'UPDATE' and old.desde is not distinct from new.desde and old.mayor_edad_en is not distinct from new.mayor_edad_en then
    return null;
  end if;
  -- diferido: se mira la fila como queda al final de la transacción (club_socio_crear la inserta y después la completa)
  select * into r from public.club_miembro_roles where miembro_id = new.miembro_id and rol = 'socio';
  if not found then return null; end if;
  if r.estado <> 'baja' and r.alta_por in ('caja', 'autoalta') and r.mayor_edad_en is null then
    raise exception 'Falta confirmar que es mayor de 18 años: el Local Club es solo para mayores de edad' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
drop trigger if exists club_roles_mayor_edad_trg on public.club_miembro_roles;
create constraint trigger club_roles_mayor_edad_trg after insert or update on public.club_miembro_roles
  deferrable initially deferred
  for each row execute function public.club_roles_mayor_edad_chk();

-- ── 5. Cumpleaños: se carga en el alta; después solo el owner lo corrige; borrarlo siempre se puede ─
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
  -- en el alta: la fila de contacto nace en esta transacción y la escribe una función de la base (no la app ni el portal)
  if not v_tenia and current_user = 'postgres' and new.created_at = now() then
    return new;
  end if;
  if coalesce(public.get_my_role()::text, '') = 'owner' then
    return new;
  end if;
  raise exception 'El cumpleaños no se cambia después del alta: lo corrige solo el owner' using errcode = '42501';
end;
$$;
drop trigger if exists club_contacto_cumple_guardia_trg on public.club_miembros_contacto;
create trigger club_contacto_cumple_guardia_trg before insert or update on public.club_miembros_contacto
  for each row execute function public.club_contacto_cumple_guardia();

-- Rastro de los cambios DESPUÉS del alta, sin el dato (la guardia NO es definer a propósito: mira current_user; el
-- rastro va aparte, como definer, porque club_auditar está cerrada a authenticated).
create or replace function public.club_contacto_cumple_auditar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.cumple_dia is null then return null; end if;   -- cargarlo en el alta no es un cambio
  if (new.cumple_dia, new.cumple_mes, new.cumple_permiso_en) is not distinct from (old.cumple_dia, old.cumple_mes, old.cumple_permiso_en) then
    return null;
  end if;
  perform public.club_auditar(case when new.cumple_dia is null then 'cumple_borrado' else 'cumple_corregido' end,
                              'club_miembros_contacto', new.miembro_id, jsonb_build_object('tenia', true),
                              jsonb_build_object('tiene', new.cumple_dia is not null));
  return null;
end;
$$;
drop trigger if exists club_contacto_cumple_auditar_trg on public.club_miembros_contacto;
create trigger club_contacto_cumple_auditar_trg after update on public.club_miembros_contacto
  for each row execute function public.club_contacto_cumple_auditar();

-- Corrección del owner (pedido del socio por escrito, como dice el aviso): día/mes nuevos, o null para borrarlo.
-- La app no la muestra todavía (decisión abierta); se llama por RPC con JWT de owner. Nota obligatoria, auditada sin el dato.
create or replace function public.club_socio_cumple_corregir(p_miembro uuid, p_dia int, p_mes int, p_nota text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_nota text := btrim(coalesce(p_nota, ''));
begin
  if public.get_my_role() is null or public.get_my_role() <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nota) < 5 then
    raise exception 'Falta la nota: anotá quién lo pidió y por qué' using errcode = 'P0001';
  end if;
  if (p_dia is null) <> (p_mes is null) then
    raise exception 'Día y mes van juntos (o los dos vacíos para borrarlo)' using errcode = 'P0001';
  end if;
  update public.club_miembros_contacto
     set cumple_dia = p_dia, cumple_mes = p_mes,
         cumple_permiso_en = case when p_dia is null then null else coalesce(cumple_permiso_en, now()) end, updated_at = now()
   where miembro_id = p_miembro;
  if not found then raise exception 'Miembro no encontrado' using errcode = 'P0001'; end if;
  perform public.club_auditar('cumple_corregir', 'club_miembros_contacto', p_miembro, null, jsonb_build_object('nota', v_nota));
  return true;
end;
$$;
revoke all on function public.club_socio_cumple_corregir(uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.club_socio_cumple_corregir(uuid, int, int, text) to authenticated;

-- ── 6. Baja del socio → se borra el cumpleaños ─────────────────────────────────────────────────
create or replace function public.club_roles_baja_borra_cumple()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.rol = 'socio' and new.estado = 'baja' and old.estado is distinct from 'baja' then
    update public.club_miembros_contacto set cumple_dia = null, cumple_mes = null, cumple_permiso_en = null, updated_at = now()
     where miembro_id = new.miembro_id and cumple_dia is not null;
  end if;
  return null;
end;
$$;
drop trigger if exists club_roles_baja_borra_cumple_trg on public.club_miembro_roles;
create trigger club_roles_baja_borra_cumple_trg after update of estado on public.club_miembro_roles
  for each row execute function public.club_roles_baja_borra_cumple();

-- ── 7. Autoalta (club-web /alta): copia exacta de la 150 + edad y cumpleaños (marcado «159») ──────
create or replace function public.club_socio_autoalta(p_datos jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_loc  text;
  v_cfg  public.club_config%rowtype;
  v_nom  text := btrim(coalesce(p_datos->>'nombre', ''));
  v_tel  text;
  v_ref  uuid;
  v_id   uuid;
  v_tok  text;
  v_hoy  int;
  v_cdia int;   -- 159
  v_cmes int;   -- 159
begin
  if not public.club_web_ok() then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  -- LC-ML: el local lo manda club-web (`local`); sin él, el único local con el Club activo
  v_loc := public.club_local(nullif(btrim(coalesce(p_datos->>'local', '')), ''), true);
  select * into v_cfg from public.club_config where location_id = v_loc;
  if jsonb_typeof(p_datos) <> 'object' or length(v_nom) not between 2 and 80
     or coalesce(p_datos->>'acepto', '') <> v_cfg.aviso_privacidad_version then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  -- 159 (D6 A): mayor de 18 obligatorio (booleano true, no un texto)
  if (p_datos->'mayor_edad') is distinct from 'true'::jsonb then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  -- 159 (D6 A): cumpleaños opcional; si viene algo, día y mes enteros válidos (29-feb sí) y el permiso en true
  if p_datos ? 'cumple_dia' or p_datos ? 'cumple_mes' or p_datos ? 'cumple_permiso' then
    if jsonb_typeof(p_datos->'cumple_dia') is distinct from 'number' or jsonb_typeof(p_datos->'cumple_mes') is distinct from 'number'
       or (p_datos->'cumple_permiso') is distinct from 'true'::jsonb
       or (p_datos->>'cumple_dia') !~ '^[0-9]{1,2}$' or (p_datos->>'cumple_mes') !~ '^[0-9]{1,2}$' then
      raise exception 'Datos no válidos' using errcode = 'P0001';
    end if;
    v_cdia := (p_datos->>'cumple_dia')::int;
    v_cmes := (p_datos->>'cumple_mes')::int;
    if v_cmes not between 1 and 12
       or v_cdia not between 1 and (case when v_cmes = 2 then 29 when v_cmes in (4, 6, 9, 11) then 30 else 31 end) then
      raise exception 'Datos no válidos' using errcode = 'P0001';
    end if;
  end if;
  begin v_tel := public.club_norm_telefono(p_datos->>'whatsapp'); exception when others then v_tel := null; end;
  if v_tel is null then raise exception 'Datos no válidos' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('club_socio_autoalta:' || v_loc, 0));
  v_hoy := (select count(*) from public.club_miembro_roles r join public.club_miembros m on m.id = r.miembro_id
             where m.location_id = v_loc and r.rol = 'socio' and r.alta_por = 'autoalta'
               and r.desde >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')
         + (select count(*) from public.club_socio_solicitudes q where q.location_id = v_loc
             and q.creada_en >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica');
  if v_hoy >= v_cfg.socio_autoalta_max_dia then
    raise exception 'Demasiadas altas hoy' using errcode = 'P0001';
  end if;
  -- CLAUDE-HALL-04: al llegar al 80 % del cupo diario, una alerta (una por día) para gerencia.
  if v_hoy + 1 >= ceil(v_cfg.socio_autoalta_max_dia * 0.8)
     and not exists (select 1 from public.club_alertas a where a.location_id = v_loc and a.tipo = 'autoalta_cupo'
                      and a.creado_en >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica') then
    insert into public.club_alertas (location_id, tipo, detalle)
    values (v_loc, 'autoalta_cupo', jsonb_build_object('altas_hoy', v_hoy + 1, 'cupo', v_cfg.socio_autoalta_max_dia));
  end if;
  select m.id into v_ref from public.club_miembros m
   where m.codigo = upper(btrim(coalesce(p_datos->>'ref', ''))) and m.estado = 'activo'
     and exists (select 1 from public.club_miembro_roles r where r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo');
  perform pg_advisory_xact_lock(hashtextextended('club_socio_tel:' || v_tel, 0));
  -- CLAUDE-HALL-02: si el teléfono ya existe, la autoalta NO toca nada (ni roles, ni estado, ni baja, ni aviso):
  -- deja una solicitud que la caja valida en persona y responde lo mismo que siempre.
  -- 159: tampoco guarda la edad ni el cumpleaños (la caja confirma la edad en persona si hace un alta nueva).
  v_id := public.club_miembro_por_telefono(v_tel);
  if v_id is not null then
    insert into public.club_socio_solicitudes (location_id, miembro_id, aviso_version, referido_por)
    values (v_loc, v_id, v_cfg.aviso_privacidad_version, nullif(v_ref, v_id))
    on conflict (miembro_id) where atendida_en is null do nothing;
    return jsonb_build_object('ok', true);
  end if;
  v_id := public.club_socio_crear(v_nom, v_tel, null, 'pendiente', 'autoalta', v_ref, v_cfg.aviso_privacidad_version, v_loc);
  -- 159: la confirmación de edad y, si lo dio con permiso, el cumpleaños (la fila de contacto nació en esta transacción)
  update public.club_miembro_roles set mayor_edad_en = now() where miembro_id = v_id and rol = 'socio';
  if v_cdia is not null then
    update public.club_miembros_contacto set cumple_dia = v_cdia, cumple_mes = v_cmes, cumple_permiso_en = now()
     where miembro_id = v_id;
  end if;
  select token_portal into v_tok from public.club_miembros where id = v_id;
  return jsonb_build_object('ok', true, 'portal', public.club_url() || '/p/' || v_tok);
end;
$$;

revoke all on function public.club_socio_autoalta(jsonb) from public, anon, authenticated;
grant execute on function public.club_socio_autoalta(jsonb) to anon, authenticated;

-- ── 8. Alta en caja con «es mayor de 18» (envuelve a la vigente, sin reescribirla) ──────────────
create or replace function public.club_socio_alta_caja_v2(p_nombre text, p_whatsapp text, p_email text, p_verifico_residencia boolean,
                                                          p_mayor_edad boolean, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_r jsonb;
begin
  -- mismo chequeo de rol que la de 5 argumentos (antes de mirar los datos, para no dar pistas a quien no puede)
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if coalesce(p_mayor_edad, false) is not true then
    raise exception 'Falta «es mayor de 18»: confirmá su edad antes del alta (el Local Club es solo para mayores)' using errcode = 'P0001';
  end if;
  v_r := public.club_socio_alta_caja(p_nombre, p_whatsapp, p_email, p_verifico_residencia, p_location);
  update public.club_miembro_roles set mayor_edad_en = now() where miembro_id = (v_r->>'miembro_id')::uuid and rol = 'socio';
  return v_r;
end;
$$;

revoke all on function public.club_socio_alta_caja_v2(text, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.club_socio_alta_caja_v2(text, text, text, boolean, boolean, text) to authenticated;
-- la de 5 argumentos queda solo como implementación interna (la llama la v2, que corre como su dueño)
revoke all on function public.club_socio_alta_caja(text, text, text, boolean, text) from public, anon, authenticated;

-- Las funciones de trigger no se llaman por RPC
revoke all on function public.club_roles_mayor_edad_chk() from public, anon, authenticated;
revoke all on function public.club_contacto_cumple_guardia() from public, anon, authenticated;
revoke all on function public.club_roles_baja_borra_cumple() from public, anon, authenticated;
revoke all on function public.club_contacto_cumple_auditar() from public, anon, authenticated;
