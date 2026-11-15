-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 158 (origen 105) — Reseña de Google después del cupón (ítem #13 de la spec del Club v2).        ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Cambia el esquema y una función PÚBLICA del Club: no se mergea sin el OK del dueño. Sin plata.
-- Firma del dueño: 14-nov (decisión 2 de la spec: «sale ya, antes de la temporada alta»).
-- Creada como 105 (bloque CLUB); prod va por la 155, así que va como 158 del bloque de PASE (regla 3), con origen 105.
-- En cola al crearla: 152 (← 101, #140), 156 (← 103, #174) y la de D7 (rama claude/club-equipo-sin-creditos, que
-- toma 157 ← 104). Si al mergear alguna de esas cambió de número, esta se renumera a la siguiente libre.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · club_config.resena_url (text, null por defecto): el link de reseña de Google del local. Lo carga SOLO el owner en
--     «Locales» (la policy club_config_update de la 150 ya es solo owner; queda en club_config_historial por el trigger
--     club_config_auditar). El CHECK solo acepta direcciones de Google: maps.app.goo.gl/…, g.page/…,
--     google.com/maps…, search.google.com/local/writereview?… (https, sin espacios ni comillas, ≤ 500).
--   · club_cupones.resena_clic_en (timestamptz, null): la PRIMERA vez que el turista tocó «Escribir una reseña en
--     Google» desde su cupón. Sin datos personales: solo la hora, en el cupón (embudo por anfitrión).
--   · club_cupon_ver (pública, la que lee la página del cupón): copia EXACTA de la 150 (md5 de pg_get_functiondef
--     d6f98caf… en prod y en staging, leído el 14-nov) + UNA clave nueva `resena`: el link del local, solo si el cupón
--     está USADO y se usó hace menos de 7 días; si no, null. Las claves de antes no cambian.
--   · club_cupon_resena_clic(text) (NUEVA, pública como club_cupon_ver): marca resena_clic_en una sola vez, solo en un
--     cupón usado hace menos de 7 días de un local con link cargado. Mismo portón (club_web_ok: solo con el header de
--     club-web) y mismo formato del código. No devuelve nada del cupón: {ok:true}.
--   · Permisos: club_cupon_ver igual que en la 150 (anon y authenticated). club_cupon_resena_clic: revoke a public y
--     grant execute a anon y authenticated, igual que club_cupon_ver (la página del cupón es anónima y entra por la API
--     de club-web con la anon key + x-club-web). No se abre nada más a anon: ni tablas ni columnas.
--
-- ── POLÍTICA DE GOOGLE (se respeta en el diseño) ───────────────────────────────────────────────
-- Se le pide a TODOS los cupones usados (no se filtra por satisfacción), sin premio, y el personal no la pide.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni plata, ni saldos, ni créditos, ni club_cupon_usar. La reseña a socios cada N visitas es otro PR.
--
-- Pruebas: scripts/sql/158_pruebas.sql (+ 158_pruebas.py; solo staging, transacción descartada).
-- Rollback: scripts/sql/158_rollback.sql (club_cupon_ver de la 150 byte a byte, sin la función ni las columnas).

begin;

alter table public.club_config  add column if not exists resena_url     text;
alter table public.club_cupones add column if not exists resena_clic_en timestamptz;

alter table public.club_config drop constraint if exists club_config_resena_url_google;
alter table public.club_config add constraint club_config_resena_url_google check (
  resena_url is null or (
    length(resena_url) <= 500
    and resena_url ~ '^https://(maps\.app\.goo\.gl/[^[:space:]"<>\\]+|g\.page/[^[:space:]"<>\\]+|(www\.)?google\.com/maps([/?][^[:space:]"<>\\]*)?|search\.google\.com/local/writereview\?[^[:space:]"<>\\]+)$'
  ));
comment on column public.club_config.resena_url is
  '158: link de reseña de Google del local (solo owner, en Locales). Solo direcciones de Google (CHECK club_config_resena_url_google).';
comment on column public.club_cupones.resena_clic_en is
  '158: primera vez que el turista tocó «Escribir una reseña en Google» desde su cupón usado. Sin datos personales.';

-- Ver un cupón (PÚBLICA: anon y authenticated). Solo estado, vence_en y el nombre de pila del referente.
-- Si el referente está dado de baja o el cupón fue anulado, se informa como «vencido» (no se puede usar).
-- 158: + `resena` (link de Google del local) solo con el cupón usado hace menos de 7 días.
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

-- 158: marca de clic en «Escribir una reseña en Google» (PÚBLICA, como club_cupon_ver). Solo la primera vez, solo en un
-- cupón usado hace menos de 7 días de un local con link cargado. Un cupón que no cumple no se marca y responde igual.
create or replace function public.club_cupon_resena_clic(p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.club_cupones c where c.codigo = v_cod) then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  update public.club_cupones c
     set resena_clic_en = now()
   where c.codigo = v_cod
     and c.estado = 'usado'
     and c.usado_en > now() - interval '7 days'
     and c.resena_clic_en is null
     and exists (select 1 from public.club_config g where g.location_id = c.location_id and g.resena_url is not null);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.club_cupon_ver(text)         from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text)      to anon, authenticated;
revoke all on function public.club_cupon_resena_clic(text) from public, anon, authenticated;
grant execute on function public.club_cupon_resena_clic(text) to anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.club_cupon_ver(text)'::regprocedure;
  if position($q$'resena', case when v_c.estado = 'usado' and v_c.usado_en > now() - interval '7 days'$q$ in v_src) = 0 then
    raise exception '158: club_cupon_ver no devuelve la reseña con la condición de 7 días';
  end if;
  if not (select bool_and(prosecdef) from pg_proc
           where oid in ('public.club_cupon_ver(text)'::regprocedure, 'public.club_cupon_resena_clic(text)'::regprocedure)) then
    raise exception '158: las dos funciones tienen que ser SECURITY DEFINER';
  end if;
  if not has_function_privilege('anon', 'public.club_cupon_resena_clic(text)', 'EXECUTE') then
    raise exception '158: club-web (anon) tiene que poder marcar el clic';
  end if;
  if has_column_privilege('anon', 'public.club_config', 'resena_url', 'SELECT')
     or has_column_privilege('anon', 'public.club_cupones', 'resena_clic_en', 'SELECT') then
    raise exception '158: anon no lee columnas del Club';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_config_resena_url_google'
                  and conrelid = 'public.club_config'::regclass) then
    raise exception '158: falta el CHECK de la dirección de Google';
  end if;
end
$$;

commit;
