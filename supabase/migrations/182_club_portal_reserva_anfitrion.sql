-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 182 (origen club 127) — «Reservar una mesa» para TODO anfitrión en el portal                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema. Decisión del dueño (16-nov 13:38, por el chat): «Reservar una mesa» en la pestaña del
-- anfitrión del portal para TODO anfitrión, no solo para el que además es socio. Hoy club_portal (180) devuelve el link
-- de reservas del local (club_config.reserva_url) solo dentro de `socio`; un anfitrión que no es socio no recibe nada y
-- club-web no le puede mostrar la tarjeta.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. club_portal: la de la 180 byte a byte + la clave de arriba `reserva_url` SOLO cuando la persona es anfitrión
--     (`anfitrion` = true: un rol que no es socio, activo). Valor: el mismo link que ya recibe el socio, el de su local
--     (club_miembros.location_id → club_config.reserva_url, con el mismo filtro club_reserva_url_ok de la 179); sin link
--     del local → null. A quien no es anfitrión (socio puro) no le llega ninguna clave nueva: su portal queda idéntico.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni tablas, ni columnas, ni datos, ni plata, ni sagrados. Ningún dato personal nuevo: es el link público de OpenTable
--    del restaurante, el mismo que ya ve el socio y la página del cupón.
--  · Ni permisos: club_portal sigue con EXECUTE para anon/authenticated (como hoy), mismo portón x-club-web
--    (club_portal_datos), SECURITY DEFINER y search_path de siempre. Ninguna función nueva.
--  · Compatible hacia atrás: `socio.reserva_url` sigue igual (el club-web de prod lo lee); la clave nueva el club-web de
--    prod la ignora.
--
-- Número: la 181 la tomó otra rama del 16-nov (`club_tope_almuerzo_cena`, ya en el ledger de staging a las 13:47 CR);
-- esta va como 182. No depende de la 181 ni la toca (la 181 no cambia club_portal: md5 del cuerpo igual al de la 180
-- en staging). En prod va DESPUÉS de la 181 si la 181 entra primero (Branching no aplica una versión menor).
-- Va DESPUÉS de la 180 (necesita club_config.reserva_url y club_reserva_url_ok; aborta si faltan). Pruebas:
-- scripts/sql/182_pruebas.sql (+ 182_pruebas.py; transacción descartada). Rollback: scripts/sql/182_rollback.sql.
begin;

do $$
begin
  if to_regprocedure('public.club_portal_datos(text)') is null
     or to_regprocedure('public.club_reserva_url_ok(text)') is null
     or to_regprocedure('public.club_resena_socio_toca(uuid)') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.club_config'::regclass
                     and attname = 'reserva_url' and not attisdropped) then
    raise exception '182: faltan la 167 (club_portal_datos), la 179 (club_reserva_url_ok) o la 180 (club_config.reserva_url)';
  end if;
end $$;

-- ── 1. Portal: + `reserva_url` arriba para el anfitrión ──────────────────────────────────────────────────────────
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
  v_url text;
begin
  v_j := public.club_portal_datos(p_token);   -- portón, formato del token y socio activo: igual que siempre
  select m.id, m.location_id into v_id, v_loc from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo';
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  -- 167: la reseña de Google del local de la última visita, cada N visitas con beneficio (a todos, sin premio)
  v_j := v_j || jsonb_build_object('resena', case when v_r.url is not null
                                                  then jsonb_build_object('url', v_r.url, 'local', v_r.local_nombre) end);
  -- 179/180: el OpenTable del local de la persona (Club → Locales), tal cual; sin link o no OpenTable → null
  select g.reserva_url into v_url from public.club_config g
   where g.location_id = v_loc and public.club_reserva_url_ok(g.reserva_url);
  -- 179/180: «Reservar» de «Mi Club» (socio)
  if jsonb_typeof(v_j->'socio') = 'object' then
    v_j := jsonb_set(v_j, '{socio,reserva_url}', coalesce(to_jsonb(v_url), 'null'::jsonb));
  end if;
  -- 182: «Reservar una mesa» de la pestaña del anfitrión, para TODO anfitrión (sea socio o no). Solo al anfitrión.
  if v_j->'anfitrion' = 'true'::jsonb then
    v_j := v_j || jsonb_build_object('reserva_url', v_url);
  end if;
  return v_j;
end;
$$;
comment on function public.club_portal(text) is
  '167 + 179 + 180 + 182: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null) + `socio.reserva_url` '
  '(el OpenTable del local del socio, de club_config.reserva_url, tal cual, o null) + `reserva_url` arriba, solo para el '
  'anfitrión (el mismo link de su local, o null). El resto del portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_portal(text)', 'EXECUTE') then
    raise exception '182: club-web tiene que poder llamar a club_portal';
  end if;
  if has_function_privilege('anon', 'public.club_portal_datos(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_reserva_url_ok(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_reserva_url_ok(text)', 'EXECUTE') then
    raise exception '182: las internas no se abren a la API';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.club_portal(text)'::regprocedure) then
    raise exception '182: club_portal sigue SECURITY DEFINER';
  end if;
end
$$;

commit;
