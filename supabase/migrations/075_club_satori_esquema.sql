-- ============================================================================
-- 075_club_satori_esquema.sql — Club Satori F1a: esquema, RLS y funciones
-- ----------------------------------------------------------------------------
-- Spec: docs/club-satori/SPEC.md (§3 modelo, §5.1 vencimiento, §6 seguridad).
-- ⚠️ SOLO STAGING hasta el piloto. El PR no se mergea a `main` antes del piloto:
--    Branching aplicaría esta migración en prod.
--
-- Principios:
--  · Multi-local GENÉRICO (LC-ML): `location_id text not null` SIN FK y SIN default; los locales son filas de
--    `club_config` (alta con un INSERT o desde la app). Ningún local escrito en esta migración; ninguna inserción
--    asume un local (ver la sección LC-ML).
--  · Libro mayor de solo inserción (`club_movimientos`): el saldo se calcula,
--    nunca se edita. Unidad del saldo = PERSONAS; los créditos se derivan.
--  · Nada abierto a `anon`: revoke all en todas las tablas. Las únicas puertas
--    públicas son `club_cupon_crear` y `club_portal` (SECURITY DEFINER, con
--    validación de cada campo).
--  · Ninguna escritura directa desde el cliente (salvo contactos para
--    owner/manager y config para owner): todo entra por funciones.
--  · Guardas NULL-seguras (SEC-01b): `r is null or r not in (...)` → raise.
--  · EXECUTE: revoke de public/anon/authenticated y grant explícito.
-- Idempotente. Rollback: scripts/sql/075_rollback.sql (borra todo lo club_*).
-- ============================================================================

begin;

-- CLUB-AUD-12: la 075 asume la 069 (get_my_role mira profiles.is_active). Sin ella, una cuenta
-- inactiva conserva permisos: se aborta antes de crear nada.
do $$ begin
  if to_regprocedure('public.get_my_role()') is null
     or position('is_active' in pg_get_functiondef('public.get_my_role()'::regprocedure)) = 0 then
    raise exception 'La 075 requiere la 069 (get_my_role con is_active)' using errcode = 'P0001';
  end if;
end $$;

-- ── 0. Helpers ──────────────────────────────────────────────────────────────

-- Código sin caracteres ambiguos (sin 0/O ni 1/I). 32 símbolos → byte mod 32 sin sesgo.
create or replace function public.club_gen_codigo(p_largo int)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_largo);
  v_out text := '';
  i int;
begin
  for i in 0 .. p_largo - 1 loop
    v_out := v_out || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- Número para los mensajes de la caja: «2» y «1,5» (no «2.0» ni «1.5»).
create or replace function public.club_num(p numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select replace(trim_scale(p)::text, '.', ',') $$;

-- Créditos derivados de un saldo en personas: floor(p/ppc) + 0,5 si el resto ≥ ppc/2.
create or replace function public.club_creditos(p_personas bigint, p_ppc int)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_personas is null or p_personas <= 0 or p_ppc is null or p_ppc <= 0 then 0::numeric
    else floor(p_personas::numeric / p_ppc)
         + case when mod(p_personas, p_ppc) * 2 >= p_ppc then 0.5 else 0 end
  end;
$$;

-- Personas que faltan para el próximo MEDIO crédito (múltiplo de ppc/2: con ppc=6, de 3 en 3).
-- 0→3 · 4→2 · 5→1 · 6→3. Si ppc es impar, el medio se redondea hacia arriba.
create or replace function public.club_personas_proximo(p_personas bigint, p_ppc int)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_ppc is null or p_ppc <= 0 then null
    else (ceil(p_ppc / 2.0)::int - mod(greatest(coalesce(p_personas, 0), 0), ceil(p_ppc / 2.0)::int))::int
  end;
$$;

-- Factura del PoS normalizada: sin espacios (ni internos) y en mayúsculas. '' si viene vacía.
create or replace function public.club_norm_factura(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
$$;

-- ── 1. Tablas ───────────────────────────────────────────────────────────────

create table if not exists public.club_config (
  location_id                text primary key,
  valor_credito_crc          int          not null default 18000 check (valor_credito_crc > 0),
  personas_por_credito       int          not null default 6     check (personas_por_credito > 0),
  canje_min                  numeric(4,1) not null default 1     check (canje_min > 0),
  canje_paso                 numeric(4,1) not null default 0.5   check (canje_paso > 0),
  max_creditos_por_visita    numeric(4,1) not null default 2     check (max_creditos_por_visita > 0),
  cupon_dias                 int          not null default 5     check (cupon_dias between 1 and 60),
  cupones_max_dia_referente  int          not null default 30    check (cupones_max_dia_referente > 0),
  solo_salon                 boolean      not null default true,
  vencimiento_meses          int          not null default 12    check (vencimiento_meses > 0),
  aviso_dias                 int[]        not null default '{30,7}',
  pm_pct                     numeric(5,2) not null default 10    check (pm_pct >= 0 and pm_pct <= 100),
  pm_pausado                 boolean      not null default true,
  created_at                 timestamptz  not null default now(),
  updated_at                 timestamptz  not null default now()
);

-- (LC-ML) Los locales NO se cargan acá: alta de cada local con el INSERT documentado en el RUNBOOK (paso 4b).

create table if not exists public.club_negocios (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null,
  nombre      text not null check (length(btrim(nombre)) between 1 and 120),
  tipo        text not null default 'otro'
              check (tipo in ('hotel','tienda','host','delivery','concierge','otro')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- F1b: origen del negocio (la migración re-ejecutable borra solo los suyos).
alter table public.club_negocios
  add column if not exists origen text not null default 'app' check (origen in ('app','migracion'));

-- Único por local, sin distinguir mayúsculas, tildes ni espacios sobrantes.
create unique index if not exists club_negocios_nombre_norm_uq
  on public.club_negocios (
    location_id,
    lower(translate(regexp_replace(btrim(nombre), '\s+', ' ', 'g'),
                    'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))
  );

create table if not exists public.club_miembros (
  id           uuid primary key default gen_random_uuid(),
  location_id  text not null,
  tipo         text not null
               check (tipo in ('referente','concierge_pm','equipo','socio','turista')),
  nombre       text not null check (length(btrim(nombre)) between 1 and 120),
  negocio_id   uuid references public.club_negocios(id),
  codigo       text not null unique default public.club_gen_codigo(8)
               check (codigo ~ '^[A-HJ-NP-Z2-9]{8}$'),
  token_portal text not null unique default encode(extensions.gen_random_bytes(32), 'hex')
               check (token_portal ~ '^[0-9a-f]{64}$'),
  estado       text not null default 'activo' check (estado in ('activo','baja')),
  origen       text not null default 'app' check (origen in ('app','migracion')),
  legacy_id    text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists club_miembros_loc_idx on public.club_miembros (location_id, estado);

-- Contactos separados: la caja no los ve. Solo owner y manager.
create table if not exists public.club_miembros_contacto (
  miembro_id      uuid primary key references public.club_miembros(id) on delete cascade,
  location_id     text not null,
  telefono        text check (telefono ~ '^\+[1-9][0-9]{6,14}$'),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  optin_whatsapp  boolean not null default false,
  optin_email     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.club_cupones (
  id                 uuid primary key default gen_random_uuid(),
  location_id        text not null,
  referente_id       uuid not null references public.club_miembros(id),
  codigo             text not null unique default public.club_gen_codigo(10)
                     check (codigo ~ '^[A-HJ-NP-Z2-9]{10}$'),
  estado             text not null default 'vigente' check (estado in ('vigente','usado','anulado')),
  creado_en          timestamptz not null default now(),
  vence_en           timestamptz not null,
  usado_en           timestamptz,
  usado_por          uuid,
  factura_pos        text,
  personas           int check (personas between 1 and 30),
  created_at         timestamptz not null default now(),
  check ((estado = 'usado') = (usado_en is not null))
);
create index if not exists club_cupones_ref_dia_idx on public.club_cupones (referente_id, creado_en);

-- CLUB-AUD-01: el contacto del turista (opt-in) va en una tabla aparte que solo ven owner y manager.
-- En club_cupones el cajero y el contador veían WhatsApp y email (grant de tabla + RLS de staff).
create table if not exists public.club_cupones_contactos (
  cupon_id   uuid primary key references public.club_cupones(id),
  nombre     text check (length(nombre) <= 80),
  whatsapp   text check (whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  email      text check (length(email) <= 254),
  optin      boolean not null default false,
  created_at timestamptz not null default now(),
  check (whatsapp is not null or email is not null)
);
-- LC-PRIV (Grok 63, 08-nov): el turista que deja contacto acepta el aviso de privacidad; queda la versión y cuándo.
alter table public.club_cupones_contactos add column if not exists aviso_version text
  check (aviso_version ~ '^v[0-9A-Za-z.-]{1,30}$');
alter table public.club_cupones_contactos add column if not exists aviso_aceptado_en timestamptz;
-- Bases donde club_cupones todavía tiene las columnas de contacto: se mueven y se borran.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'club_cupones' and column_name = 'contacto_whatsapp') then
    execute $m$insert into public.club_cupones_contactos (cupon_id, nombre, whatsapp, email, optin, created_at)
               select c.id, c.contacto_nombre, c.contacto_whatsapp, c.contacto_email, c.contacto_optin, c.creado_en
                 from public.club_cupones c
                where c.contacto_whatsapp is not null or c.contacto_email is not null
               on conflict (cupon_id) do nothing$m$;
    alter table public.club_cupones drop column if exists contacto_nombre, drop column if exists contacto_whatsapp,
                                    drop column if exists contacto_email, drop column if exists contacto_optin;
  end if;
end $$;

create table if not exists public.club_movimientos (
  id                    uuid primary key default gen_random_uuid(),
  location_id           text not null,
  miembro_id            uuid not null references public.club_miembros(id),
  tipo                  text not null
                        check (tipo in ('tarjeta','canje','vencimiento','ajuste','restitucion')),
  personas              int not null check (personas <> 0),
  creditos              numeric(4,1),
  personas_por_credito  int not null check (personas_por_credito > 0),
  valor_credito_crc     int not null check (valor_credito_crc > 0),
  factura_pos           text,
  cupon_id              uuid unique references public.club_cupones(id),
  fecha_visita          timestamptz not null default now(),
  registrado_en         timestamptz not null default now(),
  registrado_por        uuid,
  origen                text not null default 'app' check (origen in ('app','migracion')),
  client_op_id          uuid unique,
  legacy_ids            text[],
  nota                  text,
  created_at            timestamptz not null default now(),
  -- créditos solo en canje, y siempre en canje
  check ((tipo = 'canje') = (creditos is not null)),
  -- signo por tipo
  check (case tipo
           when 'tarjeta'     then personas > 0
           when 'restitucion' then personas > 0
           when 'canje'       then personas < 0
           when 'vencimiento' then personas < 0
           else true end)
);
create index if not exists club_mov_miembro_idx on public.club_movimientos (miembro_id, fecha_visita);
create index if not exists club_mov_app_fecha_idx on public.club_movimientos (location_id, fecha_visita) where origen = 'app';  -- AUD-13

create table if not exists public.club_pm_pagos (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null,
  miembro_id        uuid not null references public.club_miembros(id),
  monto_crc         numeric(12,2) not null check (monto_crc > 0),
  pagado_en         timestamptz not null default now(),
  cash_movement_id  uuid,          -- vínculo al movimiento de caja (sin FK: no se toca cash_movements)
  registrado_por    uuid,
  nota              text,
  origen            text not null default 'app' check (origen in ('app','migracion')),
  legacy_ids        text[],
  created_at        timestamptz not null default now()
);

create table if not exists public.club_pm_cargos (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null,
  miembro_id        uuid not null references public.club_miembros(id),
  factura_pos       text,
  subtotal_crc      numeric(12,2) check (subtotal_crc >= 0),
  pct               numeric(5,2)  check (pct >= 0 and pct <= 100),
  monto_crc         numeric(12,2) not null check (monto_crc >= 0),
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente','aprobado','pagado','anulado')),
  pagado_en         timestamptz,
  pago_id           uuid references public.club_pm_pagos(id),
  cash_movement_id  uuid,          -- sin FK: no se toca cash_movements
  origen            text not null default 'app' check (origen in ('app','migracion')),
  legacy_ids        text[],
  created_at        timestamptz not null default now()
);

-- Anulación de cargos PM con fecha (D2: el PM de las cuentas borradas se anula en la fecha de la baja).
alter table public.club_pm_cargos add column if not exists anulado_en timestamptz;

-- F3: se crea vacía.
create table if not exists public.club_visitas (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  miembro_id      uuid not null references public.club_miembros(id),
  factura_pos     text,
  monto_neto      numeric(12,2),
  personas        int,
  platos          jsonb,
  origen          text not null default 'qr' check (origen in ('qr','manual')),
  registrado_por  uuid,
  fecha           timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- CLUB-AUD-42: el modo `pruebas` (borrar o editar el libro y la auditoría) solo existe en una base MARCADA como
-- staging. La marca es una fila en club_entorno que se inserta a mano y solo en staging
-- (scripts/sql/club_marcar_staging.sql, con el ref escrito); la 075 no la crea, así que en prod no hay modo pruebas.
create table if not exists public.club_entorno (
  nombre     text primary key check (nombre = 'staging'),
  marcado_en timestamptz not null default now()
);
alter table public.club_entorno enable row level security;
revoke all on public.club_entorno from public, anon, authenticated;
create or replace function public.club_modo_pruebas()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select current_user = 'postgres'
     and coalesce(current_setting('club.libro_mantenimiento', true), '') = 'pruebas'
     and exists (select 1 from public.club_entorno where nombre = 'staging')
$$;

-- Libro de solo inserción (auditoría ronda 3, §5.5): ni UPDATE ni DELETE ni TRUNCATE, tampoco para el dueño
-- de la tabla. Única excepción, solo para el rol `postgres` y declarada en la transacción:
--   · `set local club.libro_mantenimiento = 'migracion'` → borrar filas origen='migracion' (el migrador, al
--     volver a migrar);
--   · `= 'pruebas'` → las pruebas de staging (siempre en una transacción con ROLLBACK) y la limpieza de
--     datos sintéticos. CLUB-AUD-42: solo si la base está marcada como staging (club_entorno).
create or replace function public.club_mov_solo_insercion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_modo text := coalesce(current_setting('club.libro_mantenimiento', true), '');
begin
  if public.club_modo_pruebas()
     or (current_user = 'postgres' and v_modo = 'migracion' and tg_op = 'DELETE' and old.origen = 'migracion') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'club_movimientos es de solo inserción: para corregir, un ajuste o una restitución' using errcode = 'P0001';
end;
$$;
drop trigger if exists club_mov_solo_insercion_trg on public.club_movimientos;
create trigger club_mov_solo_insercion_trg before update or delete on public.club_movimientos
  for each row execute function public.club_mov_solo_insercion();
create or replace function public.club_mov_sin_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.club_modo_pruebas() then   -- CLUB-AUD-42: solo en una base marcada como staging
    return null;
  end if;
  raise exception 'club_movimientos es de solo inserción' using errcode = 'P0001';
end;
$$;
drop trigger if exists club_mov_sin_truncate_trg on public.club_movimientos;
create trigger club_mov_sin_truncate_trg before truncate on public.club_movimientos
  for each statement execute function public.club_mov_sin_truncate();

-- CLUB-AUD-25: auditoría de solo inserción. Quién (auth.uid() y su rol), qué y el antes y el después.
-- Sin secretos ni datos de contacto: del miembro se omiten `codigo` y `token_portal` (solo se anota si
-- cambiaron); de los contactos, solo qué campos cambiaron.
create table if not exists public.club_auditoria (
  id         bigint generated always as identity primary key,
  en         timestamptz not null default now(),
  actor      uuid,
  rol        text,
  accion     text not null,
  tabla      text not null,
  objeto_id  uuid,
  antes      jsonb,
  despues    jsonb
);
create index if not exists club_auditoria_objeto_idx on public.club_auditoria (objeto_id, en);
alter table public.club_auditoria enable row level security;
revoke all on public.club_auditoria from public, anon, authenticated;
grant select on public.club_auditoria to authenticated;
drop policy if exists club_auditoria_owner on public.club_auditoria;
create policy club_auditoria_owner on public.club_auditoria for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() = 'owner');
create or replace function public.club_auditoria_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.club_modo_pruebas() then   -- CLUB-AUD-42: solo en una base marcada como staging
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'club_auditoria es de solo inserción' using errcode = 'P0001';
end;
$$;
drop trigger if exists club_auditoria_inmutable_trg on public.club_auditoria;
create trigger club_auditoria_inmutable_trg before update or delete on public.club_auditoria
  for each row execute function public.club_auditoria_inmutable();

create or replace function public.club_auditar(p_accion text, p_tabla text, p_objeto uuid, p_antes jsonb, p_despues jsonb)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.club_auditoria (actor, rol, accion, tabla, objeto_id, antes, despues)
  values (auth.uid(), (select p.role::text from public.profiles p where p.id = auth.uid()), p_accion, p_tabla, p_objeto, p_antes, p_despues);
$$;

create or replace function public.club_auditar_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes   jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_accion  text := lower(tg_op);
  v_id      uuid;
begin
  if tg_table_name = 'club_miembros' then
    v_id := coalesce(new.id, old.id);
    if tg_op = 'UPDATE' then
      v_accion := case
        when old.estado = 'baja' and new.estado = 'activo' then 'reactivacion'
        when old.estado = 'activo' and new.estado = 'baja' then 'baja'
        when old.codigo is distinct from new.codigo or old.token_portal is distinct from new.token_portal then 'regenerar_codigo'
        else 'edicion' end;
      if v_antes = v_despues then return null; end if;
    elsif tg_op = 'INSERT' then
      v_accion := 'alta';
    end if;
    v_antes   := v_antes - 'codigo' - 'token_portal' - 'token_pase' - 'codigo_socio';
    v_despues := v_despues - 'codigo' - 'token_portal' - 'token_pase' - 'codigo_socio'
                 || case when tg_op = 'UPDATE' then jsonb_build_object('codigo_cambiado', old.codigo is distinct from new.codigo,
                                                                         'token_cambiado', old.token_portal is distinct from new.token_portal)
                         else '{}'::jsonb end;
  elsif tg_table_name = 'club_miembros_contacto' then
    v_id := coalesce(new.miembro_id, old.miembro_id);
    v_accion := 'contacto_' || lower(tg_op);
    -- sin valores: solo qué cambió
    v_antes := case when tg_op <> 'INSERT' then jsonb_build_object('telefono', old.telefono is not null, 'email', old.email is not null,
                                                                    'optin_whatsapp', old.optin_whatsapp, 'optin_email', old.optin_email) end;
    v_despues := case when tg_op <> 'DELETE' then jsonb_build_object('telefono', new.telefono is not null, 'email', new.email is not null,
                                                                      'optin_whatsapp', new.optin_whatsapp, 'optin_email', new.optin_email,
                                                                      'telefono_cambiado', tg_op = 'UPDATE' and old.telefono is distinct from new.telefono,
                                                                      'email_cambiado', tg_op = 'UPDATE' and old.email is distinct from new.email) end;
  elsif tg_table_name = 'club_negocios' then
    v_id := coalesce(new.id, old.id);
  end if;
  perform public.club_auditar(v_accion, tg_table_name, v_id, v_antes, v_despues);
  return null;
end;
$$;
drop trigger if exists club_auditar_miembros_trg on public.club_miembros;
create trigger club_auditar_miembros_trg after insert or update on public.club_miembros
  for each row execute function public.club_auditar_trg();
drop trigger if exists club_auditar_contacto_trg on public.club_miembros_contacto;
create trigger club_auditar_contacto_trg after insert or update or delete on public.club_miembros_contacto
  for each row execute function public.club_auditar_trg();
drop trigger if exists club_auditar_negocios_trg on public.club_negocios;
create trigger club_auditar_negocios_trg after insert or update on public.club_negocios
  for each row execute function public.club_auditar_trg();

-- ── 2. Vista de saldos (security_invoker: aplica el RLS de quien consulta) ──

create or replace view public.club_saldos
with (security_invoker = true) as
select
  m.id                                                       as miembro_id,
  m.location_id,
  m.tipo,
  m.nombre,
  m.estado,
  coalesce(s.personas, 0)::int                               as personas,
  public.club_creditos(coalesce(s.personas, 0), c.personas_por_credito)        as creditos,
  public.club_personas_proximo(coalesce(s.personas, 0), c.personas_por_credito) as personas_proximo_credito,
  s.ultima_actividad
from public.club_miembros m
left join public.club_config c on c.location_id = m.location_id
left join lateral (
  select sum(mv.personas)                                                   as personas,
         -- CLUB-AUD-10 (decisión de Ismael, 07-nov): la restitución también reinicia el plazo.
         max(mv.fecha_visita) filter (where mv.tipo in ('tarjeta','canje','restitucion')) as ultima_actividad
  from public.club_movimientos mv
  where mv.miembro_id = m.id
) s on true;

-- ── 3. RLS y privilegios de tabla ───────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['club_config','club_negocios','club_miembros','club_miembros_contacto',
                           'club_cupones','club_cupones_contactos','club_movimientos','club_pm_pagos','club_pm_cargos','club_visitas']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    -- authenticated: solo lectura salvo las excepciones de abajo (RLS decide qué filas)
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on public.club_saldos from anon, public, authenticated;
grant select on public.club_saldos to authenticated;

-- Excepciones de escritura directa
grant update on public.club_config to authenticated;                                -- solo owner (policy)
grant insert, update, delete on public.club_miembros_contacto to authenticated;     -- owner/manager (policy)

-- Lectura del staff: owner, manager, cajero, contador
do $$
declare t text;
begin
  foreach t in array array['club_negocios','club_miembros','club_cupones','club_movimientos','club_visitas']
  loop
    execute format('drop policy if exists club_staff_select on public.%I', t);
    execute format($p$create policy club_staff_select on public.%I for select to authenticated
      using (public.get_my_role() is not null
             and public.get_my_role() in ('owner','manager','cajero','contador'))$p$, t);
  end loop;
end $$;

-- Config: lectura del staff, edición solo owner
drop policy if exists club_config_select on public.club_config;
create policy club_config_select on public.club_config for select to authenticated
  using (public.get_my_role() is not null
         and public.get_my_role() in ('owner','manager','cajero','contador'));
drop policy if exists club_config_update on public.club_config;
create policy club_config_update on public.club_config for update to authenticated
  using (public.get_my_role() is not null and public.get_my_role() = 'owner')
  with check (public.get_my_role() is not null and public.get_my_role() = 'owner');

-- Contactos: solo owner y manager (lectura y escritura)
drop policy if exists club_contacto_gerencia on public.club_miembros_contacto;
create policy club_contacto_gerencia on public.club_miembros_contacto for all to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'))
  with check (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- Contactos de turistas (cupones): solo owner y manager, solo lectura (escriben las funciones públicas).
drop policy if exists club_cupones_contactos_gerencia on public.club_cupones_contactos;
create policy club_cupones_contactos_gerencia on public.club_cupones_contactos for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- PM: owner y contador (lectura; las escrituras llegan por funciones en F1c)
do $$
declare t text;
begin
  foreach t in array array['club_pm_cargos','club_pm_pagos']
  loop
    execute format('drop policy if exists club_pm_select on public.%I', t);
    execute format($p$create policy club_pm_select on public.%I for select to authenticated
      using (public.get_my_role() is not null and public.get_my_role() in ('owner','contador'))$p$, t);
  end loop;
end $$;

-- ── 4. Funciones ────────────────────────────────────────────────────────────

-- Saldo en personas de un miembro (interno).
create or replace function public.club_saldo_personas(p_miembro uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(personas), 0)::int from public.club_movimientos where miembro_id = p_miembro;
$$;


-- ── CLUB-AUD-06 (opción A, revisión del 07-nov): una sola puerta pública ───────────────────────────
-- Las 4 funciones públicas exigen el header `x-club-web` con la clave que solo tiene club-web (secreto
-- CLUB_WEB_KEY en Cloudflare). Acá se guarda solo su sha256. Sin el header correcto, responden el MISMO
-- error de siempre (no se distingue). La anon key sola ya no alcanza para llamarlas directo.
create table if not exists public.club_web_clave (
  id          bigint generated always as identity primary key,
  sha256      text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  creada_en   timestamptz not null default now(),
  revocada_en timestamptz
);
alter table public.club_web_clave enable row level security;
revoke all on public.club_web_clave from public, anon, authenticated;

-- ¿El pedido trae la clave vigente? Fail-closed: sin clave cargada, sin header o sin coincidencia → false.
create or replace function public.club_web_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_h text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json->>'x-club-web';
  exception when others then
    return false;
  end;
  if v_h is null or length(v_h) not between 32 and 256 then
    return false;
  end if;
  return exists (select 1 from public.club_web_clave k
                  where k.revocada_en is null and k.sha256 = encode(extensions.digest(v_h, 'sha256'), 'hex'));
end;
$$;

-- Cargar o rotar la clave: SOLO desde el editor SQL de Supabase (postgres), con el sha256 de la clave
-- (nunca la clave). Revoca las anteriores: la vieja deja de valer en ese momento.
create or replace function public.club_web_clave_cargar(p_sha256 text)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_h text := lower(btrim(coalesce(p_sha256, '')));
begin
  if v_h !~ '^[0-9a-f]{64}$' then
    raise exception 'Tiene que ser el sha256 de la clave (64 hex), no la clave' using errcode = 'P0001';
  end if;
  update public.club_web_clave set revocada_en = now() where revocada_en is null and sha256 <> v_h;
  insert into public.club_web_clave (sha256) values (v_h) on conflict (sha256) do update set revocada_en = null;
  return (select count(*)::int from public.club_web_clave where revocada_en is null);
end;
$$;

-- Tarjeta física (CLUB-AUD-26, decisión de Ismael 07-nov): flag por entorno. PROD = false (el piloto oficial
-- es solo con pases de Wallet); STAGING = true para el piloto interno en paralelo (se activa a mano, no acá).
alter table public.club_config add column if not exists tarjeta_manual_activa boolean not null default false;
alter table public.club_config add column if not exists tarjeta_manual_tope_dia int not null default 30
  check (tarjeta_manual_tope_dia between 1 and 300);

-- Tope global por local y por minuto en club_cupon_crear (además del tope por referente y por día).
alter table public.club_config add column if not exists cupones_max_minuto_local int not null default 20
  check (cupones_max_minuto_local between 1 and 1000);
create index if not exists club_cupones_local_creado_idx on public.club_cupones (location_id, creado_en);

-- 4.1 Cupón del turista (PÚBLICA: anon y authenticated).
create or replace function public.club_cupon_crear(p_codigo_referente text, p_contacto jsonb default null)
returns table (codigo text, vence_en timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod     text := upper(btrim(coalesce(p_codigo_referente, '')));
  v_ref     public.club_miembros%rowtype;
  v_cfg     public.club_config%rowtype;
  v_hoy     timestamptz;
  v_usados  int;
  v_nombre  text;
  v_wa      text;
  v_email   text;
  v_optin   boolean := false;
  v_cupon   public.club_cupones%rowtype;
  i int;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;
  -- Código del referente: formato y existencia con el MISMO error (no se distingue).
  if v_cod !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;
  select * into v_ref from public.club_miembros m
   where m.codigo = v_cod and m.estado = 'activo' and m.tipo in ('referente','concierge_pm','equipo');
  if not found then
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;

  perform public.club_local(v_ref.location_id, true);   -- LC-ML: Club activo en el local del anfitrión
  select * into v_cfg from public.club_config where location_id = v_ref.location_id;
  if not found then
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-06: tope global por local y por minuto (red de seguridad aunque se filtre la clave).
  perform pg_advisory_xact_lock(hashtextextended('club_cupon_local:' || v_ref.location_id, 0));
  if (select count(*) from public.club_cupones c
       where c.location_id = v_ref.location_id and c.creado_en >= now() - interval '1 minute') >= v_cfg.cupones_max_minuto_local then
    raise exception 'Demasiados cupones en este momento' using errcode = 'P0001';
  end if;
  -- Tope por referente por día (día de Costa Rica). Lock por referente contra carreras.
  perform pg_advisory_xact_lock(hashtextextended('club_cupon:' || v_ref.id::text, 0));
  v_hoy := date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  select count(*) into v_usados from public.club_cupones c
   where c.referente_id = v_ref.id and c.creado_en >= v_hoy;
  if v_usados >= v_cfg.cupones_max_dia_referente then
    raise exception 'No se pueden generar más cupones hoy' using errcode = 'P0001';
  end if;

  -- Contacto opt-in: cada campo validado y recortado. Nunca se consulta si ya existe.
  if p_contacto is not null then
    if jsonb_typeof(p_contacto) <> 'object' then
      raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
    end if;
    v_nombre := nullif(btrim(regexp_replace(coalesce(p_contacto->>'nombre', ''), '[[:cntrl:]]', '', 'g')), '');
    if v_nombre is not null and length(v_nombre) > 80 then
      raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
    end if;
    v_wa := nullif(regexp_replace(coalesce(p_contacto->>'whatsapp', ''), '[\s\-().]', '', 'g'), '');
    if v_wa is not null then
      if v_wa ~ '^[0-9]{8}$' then v_wa := '+506' || v_wa;          -- CR sin prefijo
      elsif v_wa ~ '^[1-9][0-9]{7,14}$' then v_wa := '+' || v_wa;   -- sin '+'
      end if;
      if v_wa !~ '^\+[1-9][0-9]{6,14}$' then
        raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
      end if;
    end if;
    v_email := nullif(lower(btrim(coalesce(p_contacto->>'email', ''))), '');
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
    end if;
    if p_contacto ? 'optin' then
      if jsonb_typeof(p_contacto->'optin') <> 'boolean' then
        raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
      end if;
      v_optin := (p_contacto->>'optin')::boolean;
    end if;
    -- LC-PRIV (Grok 63): quien deja contacto acepta el aviso vigente del local (la versión exacta)
    if (v_wa is not null or v_email is not null)
       and coalesce(p_contacto->>'acepto', '') is distinct from v_cfg.aviso_privacidad_version then
      raise exception 'Datos de contacto no válidos' using errcode = 'P0001';
    end if;
  end if;

  -- Inserción con reintento si choca el código (muy improbable).
  for i in 1 .. 5 loop
    begin
      insert into public.club_cupones (location_id, referente_id, vence_en)
      values (v_ref.location_id, v_ref.id, now() + make_interval(days => v_cfg.cupon_dias))
      returning * into v_cupon;
      exit;
    exception when unique_violation then
      if i = 5 then raise exception 'No se pudo generar el cupón' using errcode = 'P0001'; end if;
    end;
  end loop;

  if v_wa is not null or v_email is not null then
    insert into public.club_cupones_contactos (cupon_id, nombre, whatsapp, email, optin, aviso_version, aviso_aceptado_en)
    values (v_cupon.id, v_nombre, v_wa, v_email, v_optin, v_cfg.aviso_privacidad_version, now());
  end if;

  codigo := v_cupon.codigo;
  vence_en := v_cupon.vence_en;
  return next;
end;
$$;

-- Piloto (decisiones de Ismael, 06 y 07-nov): la clave de cruce con el PoS es el PEDIDO, no la mesa
-- (con la mesa se confunde cuando se divide la cuenta). La caja elige el pedido abierto del puente;
-- si ya se cerró, elige la factura de la lista de las últimas 2 h. Ya no se tipean dígitos del tiquete.
alter table public.club_movimientos add column if not exists pos_ref jsonb;
alter table public.club_movimientos add column if not exists visita_clave text;
alter table public.club_cupones     add column if not exists pos_ref jsonb;

-- CLUB-AUD-02: una tarjeta por referente y visita (solo las de la app). Antes se listan los duplicados
-- que ya existan y, si hay, la migración FRENA sin borrar nada (hay que resolverlos a mano).
do $$
declare v_n int; v_lista text;
begin
  select count(*), string_agg(format('%s · %s (%s)', miembro_id, visita_clave, n), '; ')
    into v_n, v_lista
    from (select miembro_id, visita_clave, count(*) as n from public.club_movimientos
           where tipo = 'tarjeta' and origen = 'app' and visita_clave is not null
           group by 1, 2 having count(*) > 1) d;
  if v_n > 0 then
    raise exception 'Hay % visitas con más de una tarjeta del mismo referente: %', v_n, left(v_lista, 2000)
      using errcode = 'P0001';
  end if;
end $$;
create unique index if not exists club_mov_tarjeta_miembro_visita_uq
  on public.club_movimientos (miembro_id, visita_clave)
  where tipo = 'tarjeta' and origen = 'app' and visita_clave is not null;
create index if not exists club_mov_visita_tarjeta_idx on public.club_movimientos (location_id, visita_clave)
  where tipo = 'tarjeta' and origen = 'app';

-- Normaliza la referencia al PoS que manda la caja. NULL si no vino; error si es inválida.
--   {modo:'pedido',  pedido[, local]}           → pedido abierto elegido de la lista. Tiene que estar
--                                                  abierto en el puente: se guardan el pedido, la mesa, el
--                                                  total, `abierto_en` (apertura del pedido) y `hora` =
--                                                  hora del escaneo (la del servidor, no la del cliente).
--   {modo:'factura', numero_factura[, local]}   → plan B: factura cerrada de las últimas 2 h (cruce exacto).
-- Devuelve además `visita`: la clave CANÓNICA de la visita (club_visita_canonica, CLUB-AUD-15).
-- CLUB-AUD-18: el local es el del miembro o del cupón (p_location), no el que mande el cliente; si el
-- cliente manda otro, se rechaza.
-- CLUB-AUD-15: la clave de una visita es la misma por cualquier camino (pedido abierto, factura del
-- plan B o factura tipeada): el pedido con su apertura cuando se conoce; si no, la factura.
create or replace function public.club_visita_canonica(p_location text, p_pos jsonb, p_factura text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t      public.pos_ndf_tickets%rowtype;
  v_cl   text;
begin
  if p_pos is not null and p_pos->>'modo' = 'pedido' then
    return format('pedido:%s@%s', p_pos->>'pedido',
                  to_char((p_pos->>'abierto_en')::timestamptz at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'));
  end if;
  if p_pos is not null and p_pos->>'modo' = 'factura' then
    v_cl := ltrim(p_pos->>'numero_factura', '0');
  else
    v_cl := public.club_factura_clave(p_factura);
  end if;
  if v_cl is null then
    return null;
  end if;
  select * into t from public.pos_ndf_tickets x
   where x.local = p_location and ltrim(x.numero_factura, '0') = v_cl and x.estado = 'C'   -- CLUB-AUD-68
   limit 1;
  if found and t.numero_pedido is not null and t.pedido_abierto_en is not null then
    return format('pedido:%s@%s', t.numero_pedido, to_char(t.pedido_abierto_en at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'));
  end if;
  return 'factura:' || v_cl;
end;
$$;

drop function if exists public.club_pos_ref(jsonb);
-- CLUB-AUD-27: ¿el puente está al día? Último ciclo hace menos de 5 minutos Y sin error (el latido de error
-- también actualiza last_poll_at). Sin puente fresco, la lista de pedidos abiertos no es confiable.
create or replace function public.club_puente_fresco(p_location text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.pos_ndf_cursor c
                  where c.local = p_location and c.last_poll_at > now() - interval '5 minutes' and c.last_error is null)
$$;

create or replace function public.club_pos_ref(p jsonb, p_location text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_modo  text;
  v_local text;
  v_ped   text;
  v_clave text;
  v_nf    text;
  o       public.pos_ndf_open%rowtype;
  t       public.pos_ndf_tickets%rowtype;
  r       jsonb;
begin
  if p is null or p = '{}'::jsonb or jsonb_typeof(p) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'Pedido no válido: elegilo de la lista' using errcode = 'P0001';
  end if;
  v_modo  := p->>'modo';
  v_local := p_location;
  if v_local is null or (nullif(btrim(p->>'local'), '') is not null and btrim(p->>'local') <> v_local) then
    raise exception 'Pedido no válido: elegilo de la lista' using errcode = 'P0001';   -- CLUB-AUD-18
  end if;
  if v_modo = 'pedido' then
    v_ped := btrim(coalesce(p->>'pedido', ''));
    v_clave := nullif(btrim(coalesce(p->>'clave', '')), '');
    if v_ped !~ '^[0-9A-Za-z]{1,20}$' or (v_clave is not null and v_clave !~ '^pedido:[0-9A-Za-z:_-]{1,60}$') then
      raise exception 'Pedido no válido: elegilo de la lista' using errcode = 'P0001';
    end if;
    if not public.club_puente_fresco(v_local) then   -- CLUB-AUD-27
      raise exception 'Puente sin datos: elegí la factura' using errcode = 'P0001';
    end if;
    -- CLUB-AUD-31: la clave trae la fecha del pedido (pedido:<fecha>:<n>); el número solo se reinicia cada día.
    -- Sin clave (app vieja), el número tiene que ser único entre los abiertos.
    if v_clave is not null then
      select * into o from public.pos_ndf_open x where x.local = v_local and x.clave = v_clave and x.id_pedido = v_ped;
    else
      if (select count(*) from public.pos_ndf_open x where x.local = v_local and x.id_pedido = v_ped) > 1 then
        raise exception 'Hay más de un pedido abierto con el número %: elegilo de la lista', v_ped using errcode = 'P0001';
      end if;
      select * into o from public.pos_ndf_open x where x.local = v_local and x.id_pedido = v_ped;
    end if;
    if not found then
      raise exception 'El pedido % ya no está abierto: elegí la factura de la lista', v_ped using errcode = 'P0001';
    end if;
    -- `abierto_en` = FAC_Pedidos.FechaRegistra (mig 081). Antes de la 081 el agente ya mandaba esa
    -- misma hora en `updated_at`, por eso es el respaldo.
    r := jsonb_build_object('modo', 'pedido', 'local', v_local, 'pedido', v_ped,
                            'area', nullif(upper(btrim(coalesce(o.area, ''))), ''),
                            'mesa', nullif(upper(btrim(coalesce(o.mesa, ''))), ''),
                            'total', o.monto_estimado_crc, 'visto', o.updated_at,
                            'pax', coalesce(nullif(o.pax, 0), nullif(o.pax_pedido, 0)),
                            'abierto_en', coalesce(o.pedido_abierto_en, o.updated_at), 'hora', now());
    return r || jsonb_build_object('visita', public.club_visita_canonica(v_local, r, null));
  elsif v_modo = 'factura' then
    v_nf := btrim(coalesce(p->>'numero_factura', ''));
    if v_nf !~ '^[0-9]{1,30}$' then
      raise exception 'Factura no válida: elegila de la lista' using errcode = 'P0001';
    end if;
    select * into t from public.pos_ndf_tickets x where x.local = v_local and x.numero_factura = v_nf and x.estado = 'C';
    if not found then
      raise exception 'Esa factura no está en el PoS: tocá «Actualizar» o, si se cobró hace más de 2 horas, avisale al manager' using errcode = 'P0001';
    end if;
    -- La lista muestra las últimas 2 h; 15 min de margen para lo que tarda la caja en confirmar.
    if t.fecha_registra < now() - interval '2 hours 15 minutes' then
      raise exception 'Esa factura tiene más de 2 horas: la resuelve el manager en Excepciones' using errcode = 'P0001';
    end if;
    r := jsonb_build_object('modo', 'factura', 'local', v_local, 'numero_factura', v_nf,
                            'area', nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
                            'mesa', nullif(upper(btrim(coalesce(t.mesa_factura, t.mesa, ''))), ''), 'total', t.total_crc,
                            'pax', nullif(t.pax, 0),
                            'hora_factura', t.fecha_registra, 'hora', now());
    return r || jsonb_build_object('visita', public.club_visita_canonica(v_local, r, null));
  end if;
  raise exception 'Pedido no válido: elegilo de la lista' using errcode = 'P0001';
end;
$$;

-- LC-A4.4 (08-nov): créditos GANADOS pendientes de aprobación del anfitrión nuevo (decisión «1b»).
-- En sus primeros `anfitrion_nuevo_dias` (90) como anfitrión, el cupón que lo hace pasar `anfitrion_tope_mes_crc`
-- (₡25.000) de ganado en el mes NO suma: sus personas quedan acá, pendientes, hasta que un owner o manager distinto de
-- quien registró el cupón las aprueba (→ movimiento `tarjeta` con la misma operación) o las rechaza. DECISIÓN
-- PROVISORIA: va el cupón entero (no se parte la visita en dos movimientos). La alerta ANFITRION_SOBRE_TOPE es de A5.
alter table public.club_config add column if not exists anfitrion_tope_mes_crc numeric not null default 25000 check (anfitrion_tope_mes_crc >= 0);
alter table public.club_config add column if not exists anfitrion_nuevo_dias int not null default 90 check (anfitrion_nuevo_dias between 0 and 730);
create table if not exists public.club_personas_pendientes (
  id                    uuid primary key default gen_random_uuid(),
  location_id           text not null,
  miembro_id            uuid not null references public.club_miembros(id),
  cupon_id              uuid references public.club_cupones(id),
  personas              int not null check (personas between 1 and 30),
  personas_por_credito  int not null,
  valor_credito_crc     numeric not null,
  factura_pos           text,
  pos_ref               jsonb,
  visita_clave          text,
  fecha_visita          timestamptz not null default now(),
  registrado_por        uuid,
  client_op_id          uuid not null unique,
  ganado_mes_crc        numeric not null,          -- lo ganado en el mes ANTES de este cupón (para decidir)
  estado                text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  resuelto_por          uuid,
  resuelto_en           timestamptz,
  nota                  text,
  movimiento_id         uuid references public.club_movimientos(id)
);
create index if not exists club_personas_pend_idx on public.club_personas_pendientes (miembro_id, estado);
create index if not exists club_personas_pend_visita_idx on public.club_personas_pendientes (visita_clave);
alter table public.club_personas_pendientes enable row level security;
revoke all on public.club_personas_pendientes from public, anon, authenticated;


-- CLUB-AUD-02 (decisión de Ismael, 07-nov): un referente tiene UNA tarjeta por visita; dos referentes
-- en la misma visita sí, con Σ personas ≤ pax del pedido. Interna: la llaman club_cupon_usar y
-- club_tarjeta_manual ANTES de bloquear al miembro. Orden global de locks: operación (p_op) → cupón →
-- visita (advisory) → miembro.
--   · Lock por visita: dos tarjetas de la misma mesa no se cuelan a la vez.
--   · Mismo miembro y misma visita → error (y el índice único es la red de seguridad).
--   · Pax: el que trajo el escaneo (pedido abierto o factura del plan B) o, con factura tipeada, el de la
--     factura del puente. Pax desconocido (0 o null) → no se puede controlar acá: queda la excepción
--     PERSONAS_SOBRE_PAX cuando la factura llega con pax.
create or replace function public.club_visita_control(p_location text, p_visita text, p_pos jsonb, p_factura text,
                                                      p_miembro uuid, p_personas int)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pax int;
  v_ya  int;
begin
  if p_visita is null or p_visita = '' then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_visita:' || p_location || ':' || p_visita, 0));
  if exists (select 1 from public.club_movimientos mv
              where mv.miembro_id = p_miembro and mv.tipo = 'tarjeta' and mv.origen = 'app' and mv.visita_clave = p_visita)
     or exists (select 1 from public.club_personas_pendientes pp   -- LC-A4.4: lo pendiente también es «su tarjeta»
                 where pp.miembro_id = p_miembro and pp.estado = 'pendiente' and pp.visita_clave = p_visita) then
    raise exception 'Este referente ya tiene una tarjeta en esta visita: vale una por mesa. Si faltaron personas, pedile al manager que lo corrija' using errcode = 'P0001';
  end if;
  v_pax := nullif((p_pos->>'pax')::int, 0);
  if v_pax is null and p_pos is null and public.club_factura_clave(p_factura) is not null then
    select nullif(t.pax, 0) into v_pax from public.pos_ndf_tickets t
     where t.local = p_location and ltrim(t.numero_factura, '0') = public.club_factura_clave(p_factura) and t.estado = 'C' limit 1;   -- CLUB-AUD-68
  end if;
  if v_pax is not null then
    select coalesce(sum(mv.personas), 0)
           + (select coalesce(sum(pp.personas), 0) from public.club_personas_pendientes pp
               where pp.location_id = p_location and pp.estado = 'pendiente' and pp.visita_clave = p_visita)
      into v_ya from public.club_movimientos mv
     where mv.location_id = p_location and mv.tipo = 'tarjeta' and mv.origen = 'app' and mv.visita_clave = p_visita;
    if v_ya + p_personas > v_pax then
      raise exception 'Supera las personas de la mesa (% pax; ya registradas %). Revisá cuántas personas vinieron con el referente o pedile al manager', v_pax, v_ya using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- 4.2 Usar el cupón en caja → movimiento `tarjeta` del referente.
drop function if exists public.club_cupon_usar(text, int, text, uuid);
-- LC-A4.4: devuelve también `pendientes` (personas retenidas para aprobación; 0 si sumaron). Cambió el tipo de retorno.
do $$ begin
  if exists (select 1 from pg_proc where oid = 'public.club_cupon_usar(text, int, text, uuid, jsonb)'::regprocedure
              and pg_get_function_result(oid) not like '%pendientes%') then
    drop function public.club_cupon_usar(text, int, text, uuid, jsonb);
  end if;
exception when undefined_function then null;
end $$;
create or replace function public.club_cupon_usar(p_codigo text, p_personas int, p_factura text, p_op uuid, p_pos jsonb default null)
returns table (miembro_id uuid, personas int, creditos numeric, pendientes int)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol     public.user_role := public.get_my_role();
  v_cod     text := upper(btrim(coalesce(p_codigo, '')));
  v_fac     text := public.club_norm_factura(p_factura);
  v_pos     jsonb;
  v_sin_pos boolean := p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null';
  v_cupon   public.club_cupones%rowtype;
  v_ref     public.club_miembros%rowtype;
  v_cfg     public.club_config%rowtype;
  v_prev    public.club_movimientos%rowtype;
  v_pend    public.club_personas_pendientes%rowtype;
  v_saldo   int;
  v_ganado  numeric;
  v_nuevo   boolean;
  v_clave   text;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-08: el mismo p_op en paralelo espera y devuelve el replay (no un error).
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));
  -- Idempotencia: la misma operación devuelve el mismo resultado.
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'tarjeta' or v_prev.cupon_id is distinct from
       (select c.id from public.club_cupones c where c.codigo = v_cod) then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(v_prev.miembro_id);
    miembro_id := v_prev.miembro_id; personas := v_saldo;
    creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); pendientes := 0;
    return next; return;
  end if;
  -- LC-A4.4: replay de un cupón que quedó pendiente de aprobación
  select * into v_pend from public.club_personas_pendientes pp where pp.client_op_id = p_op;
  if found then
    select * into v_cfg from public.club_config where location_id = v_pend.location_id;
    v_saldo := public.club_saldo_personas(v_pend.miembro_id);
    miembro_id := v_pend.miembro_id; personas := v_saldo;
    creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    pendientes := case when v_pend.estado = 'pendiente' then v_pend.personas else 0 end;
    return next; return;
  end if;

  if p_personas is null or p_personas < 1 or p_personas > 30 then
    raise exception 'Personas fuera de rango (1 a 30): corregí el número' using errcode = 'P0001';
  end if;
  if v_sin_pos and (v_fac = '' or length(v_fac) > 40) then
    raise exception 'Falta el pedido o la factura: elegí el pedido de la lista' using errcode = 'P0001';
  end if;

  select * into v_cupon from public.club_cupones c where c.codigo = v_cod for update;
  if not found then
    raise exception 'Cupón no encontrado: escaneá de nuevo o escribí los 10 caracteres' using errcode = 'P0001';
  end if;
  if v_cupon.estado <> 'vigente' or v_cupon.usado_en is not null then
    raise exception 'El cupón ya se usó o fue anulado: no suma personas; seguí con la cuenta normal' using errcode = 'P0001';
  end if;
  if v_cupon.vence_en <= now() then
    raise exception 'El cupón está vencido: no suma personas; seguí con la cuenta normal' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-02: control de la visita (lock, una tarjeta por referente, Σ personas ≤ pax).
  perform public.club_local(v_cupon.location_id, true);   -- LC-ML: Club activo en el local del cupón
  v_pos := public.club_pos_ref(p_pos, v_cupon.location_id);   -- CLUB-AUD-18: local del cupón
  perform public.club_visita_control(v_cupon.location_id,
                                     coalesce(v_pos->>'visita', public.club_visita_canonica(v_cupon.location_id, null, v_fac)),
                                     v_pos, v_fac, v_cupon.referente_id, p_personas);
  -- LC-A4 antiautocanje: un cupón no suma en un pedido donde su anfitrión registró visita de socio.
  if exists (select 1 from public.club_visitas_socio vs
              where vs.miembro_id = v_cupon.referente_id
                and vs.visita_clave = coalesce(v_pos->>'visita', public.club_visita_canonica(v_cupon.location_id, null, v_fac))) then
    raise exception 'El anfitrión de este cupón es socio en esta misma mesa: el cupón no suma personas. Seguí con la cuenta normal'
      using errcode = 'P0001';
  end if;
  -- CLUB-AUD-07: el miembro se bloquea (cupón → visita → miembro) y recién ahí se mira si sigue activo:
  -- una baja simultánea ya no deja un miembro de baja con saldo.
  select * into v_ref from public.club_miembros m where m.id = v_cupon.referente_id for update;
  if v_ref.estado <> 'activo' then
    raise exception 'REFERENTE_INACTIVO' using errcode = 'P0001',
      hint = 'Referente dado de baja: seguí con la cuenta sin crédito';
  end if;
  select * into v_cfg from public.club_config where location_id = v_cupon.location_id;

  update public.club_cupones
     set estado = 'usado', usado_en = now(), usado_por = auth.uid(), factura_pos = nullif(v_fac, ''), personas = p_personas, pos_ref = v_pos
   where id = v_cupon.id;

  -- LC-A4.4: anfitrión nuevo que con este cupón pasa el tope del mes → personas pendientes de aprobación.
  v_clave := coalesce(v_pos->>'visita', public.club_visita_canonica(v_cupon.location_id, null, v_fac));
  v_nuevo := exists (select 1 from public.club_miembro_roles rr where rr.miembro_id = v_ref.id and rr.rol <> 'socio'
                      and rr.desde > now() - make_interval(days => v_cfg.anfitrion_nuevo_dias));
  if v_nuevo and v_cfg.anfitrion_tope_mes_crc > 0 then
    v_ganado := ((select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                   where mv.miembro_id = v_ref.id and mv.tipo = 'tarjeta' and mv.personas > 0
                     and mv.fecha_visita >= date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')
                + (select coalesce(sum(pp.personas), 0) from public.club_personas_pendientes pp
                    where pp.miembro_id = v_ref.id and pp.estado = 'pendiente'
                      and pp.fecha_visita >= date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica'))
                * v_cfg.valor_credito_crc / v_cfg.personas_por_credito;
    if v_ganado + p_personas * v_cfg.valor_credito_crc / v_cfg.personas_por_credito > v_cfg.anfitrion_tope_mes_crc then
      insert into public.club_personas_pendientes (location_id, miembro_id, cupon_id, personas, personas_por_credito, valor_credito_crc,
                                                   factura_pos, pos_ref, visita_clave, registrado_por, client_op_id, ganado_mes_crc)
      values (v_cupon.location_id, v_ref.id, v_cupon.id, p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
              nullif(v_fac, ''), v_pos, v_clave, auth.uid(), p_op, v_ganado);
      v_saldo := public.club_saldo_personas(v_ref.id);
      miembro_id := v_ref.id; personas := v_saldo;
      creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); pendientes := p_personas;
      return next; return;
    end if;
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     factura_pos, cupon_id, fecha_visita, registrado_por, origen, client_op_id, pos_ref, visita_clave)
  values
    (v_cupon.location_id, v_ref.id, 'tarjeta', p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     nullif(v_fac, ''), v_cupon.id, now(), auth.uid(), 'app', p_op, v_pos,
     coalesce(v_pos->>'visita', public.club_visita_canonica(v_cupon.location_id, null, v_fac)));

  v_saldo := public.club_saldo_personas(v_ref.id);
  miembro_id := v_ref.id; personas := v_saldo;
  creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); pendientes := 0;
  return next;
end;
$$;

-- LC-A4.4: lista y resolución de las personas pendientes (owner, manager).
create or replace function public.club_pendientes_listar(p_location text default null)
returns table (id uuid, miembro_id uuid, nombre text, personas int, creditos numeric, ganado_mes_crc numeric, fecha_visita timestamptz,
               registrado_por text, puedo_resolver boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select pp.id, pp.miembro_id, m.nombre, pp.personas, public.club_creditos(pp.personas, pp.personas_por_credito), pp.ganado_mes_crc,
           pp.fecha_visita, coalesce(p.full_name, 'Sin perfil'), pp.registrado_por is distinct from auth.uid()
      from public.club_personas_pendientes pp join public.club_miembros m on m.id = pp.miembro_id
      left join public.profiles p on p.id = pp.registrado_por
     where pp.location_id = p_location and pp.estado = 'pendiente'
     order by pp.fecha_visita;
end;
$$;

create or replace function public.club_pendiente_resolver(p_id uuid, p_aprobar boolean, p_nota text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_p    public.club_personas_pendientes%rowtype;
  v_nota text := btrim(coalesce(p_nota, ''));
  v_mov  uuid;
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_aprobar is null then raise exception 'Elegí aprobar o rechazar' using errcode = 'P0001'; end if;
  if length(v_nota) not between 1 and 300 then raise exception 'La nota es obligatoria (hasta 300 caracteres)' using errcode = 'P0001'; end if;
  select * into v_p from public.club_personas_pendientes where id = p_id for update;
  if not found or v_p.estado <> 'pendiente' then raise exception 'Ya no está pendiente: recargá la lista' using errcode = 'P0001'; end if;
  if v_p.registrado_por = auth.uid() then
    raise exception 'Lo registraste vos: lo aprueba otro manager u owner' using errcode = 'P0001';
  end if;
  perform 1 from public.club_miembros where id = v_p.miembro_id for update;
  if p_aprobar then
    -- Grok 93: al aprobar se revalida todo lo que podía cambiar desde el cupón.
    if not exists (select 1 from public.club_miembros m where m.id = v_p.miembro_id and m.estado = 'activo')
       or not exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_p.miembro_id and r.rol <> 'socio' and r.estado = 'activo') then
      raise exception 'El anfitrión ya no está activo: rechazalo (no puede sumar)' using errcode = 'P0001';
    end if;
    if v_p.cupon_id is not null and not exists (select 1 from public.club_cupones c where c.id = v_p.cupon_id and c.estado = 'usado') then
      raise exception 'El cupón ya no está vigente (anulado): rechazalo' using errcode = 'P0001';
    end if;
    -- El cruce solo mira facturas C: la anulada se busca directo (por pedido, por número elegido o por número tipeado),
    -- y cuenta si esa visita no tiene ninguna C (si hay una C, la X fue una refactura y la visita sigue valiendo).
    if exists (select 1 from public.pos_ndf_tickets t
                where t.local = v_p.location_id and t.estado = 'X'
                  and ((v_p.pos_ref->>'modo' = 'pedido' and t.numero_pedido = v_p.pos_ref->>'pedido'
                        and t.fecha_registra >= v_p.fecha_visita - interval '18 hours' and t.fecha_registra < v_p.fecha_visita + interval '18 hours')
                    or (v_p.pos_ref->>'modo' = 'factura' and t.numero_factura = v_p.pos_ref->>'numero_factura')
                    or (v_p.pos_ref is null and public.club_factura_clave(v_p.factura_pos) is not null
                        and ltrim(t.numero_factura, '0') = public.club_factura_clave(v_p.factura_pos))))
       and cardinality(public.club_cruce_facturas(v_p.location_id, v_p.pos_ref, v_p.factura_pos)) = 0 then
      raise exception 'La factura de esa visita está anulada (X): rechazalo' using errcode = 'P0001';
    end if;
    insert into public.club_movimientos
      (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, cupon_id, fecha_visita,
       registrado_por, origen, client_op_id, pos_ref, visita_clave, nota)
    values
      (v_p.location_id, v_p.miembro_id, 'tarjeta', v_p.personas, v_p.personas_por_credito, v_p.valor_credito_crc, v_p.factura_pos,
       v_p.cupon_id, v_p.fecha_visita, v_p.registrado_por, 'app', v_p.client_op_id, v_p.pos_ref, v_p.visita_clave,
       'Aprobado por gerencia (anfitrión nuevo sobre el tope): ' || v_nota)
    returning id into v_mov;
  end if;
  update public.club_personas_pendientes
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, resuelto_por = auth.uid(), resuelto_en = now(),
         nota = v_nota, movimiento_id = v_mov
   where id = p_id;
  perform public.club_auditar(case when p_aprobar then 'pendiente_aprobada' else 'pendiente_rechazada' end, 'club_personas_pendientes',
                              v_p.miembro_id, null, jsonb_build_object('personas', v_p.personas, 'nota', v_nota));
  return true;
end;
$$;

-- 4.3 Canje de créditos (1 / 1,5 / 2 por visita, de a 0,5).
-- R-01 (revisión integral 07-nov; requisitos de la ronda 3 de auditoría, §3): el QR público del referente
-- (/r/) NO alcanza para canjear. El canje exige un CÓDIGO DE CANJE que el referente genera en su portal
-- privado (/p/{token}):
--   · 6 caracteres del alfabeto sin ambigüedad (30 bits), un solo uso, vence a los 10 minutos.
--   · En la base se guarda SOLO su sha256: el código se muestra una vez, en el portal.
--   · Tope de intentos fallidos: 5 en 15 minutos por usuario de la caja y por miembro (club_canje_intentos).
--   · club_canje lo consume atómicamente, en la misma transacción que el movimiento, con el orden de locks
--     op → código → miembro. Mismo p_op = mismo canje; otro p_op con el mismo código = rechazado.
--   · «buscar» (plan B) no habilita el canje: lleva al mismo panel que el /r/ (saldo, sin canje).
--   · Respaldo sin celular: club_canje_aprobado (solo owner o manager, nota obligatoria). Queda como la
--     excepción CANJE_SIN_CODIGO, siempre visible, que no resuelve quien lo aprobó.
-- La tabla vieja (con el código en claro, solo en staging) se reemplaza.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'club_codigos_canje' and column_name = 'codigo') then
    drop table public.club_codigos_canje;
  end if;
end $$;
create table if not exists public.club_codigos_canje (
  id             uuid primary key default gen_random_uuid(),
  location_id    text not null,
  miembro_id     uuid not null references public.club_miembros(id),
  codigo_hash    text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),
  creado_en      timestamptz not null default now(),
  vence_en       timestamptz not null,
  usado_en       timestamptz,
  usado_por      uuid,
  movimiento_id  uuid unique references public.club_movimientos(id),
  invalidado_en  timestamptz,          -- generar uno nuevo invalida el anterior
  check ((usado_en is null) = (movimiento_id is null)),
  check (usado_en is null or invalidado_en is null),
  check (vence_en > creado_en and vence_en <= creado_en + interval '10 minutes')
);
create unique index if not exists club_codigos_canje_vigente_uq on public.club_codigos_canje (miembro_id)
  where usado_en is null and invalidado_en is null;
create index if not exists club_codigos_canje_miembro_idx on public.club_codigos_canje (miembro_id, creado_en);
alter table public.club_codigos_canje enable row level security;
revoke all on public.club_codigos_canje from public, anon, authenticated;   -- nadie lo lee directo

-- Intentos fallidos (código equivocado, vencido, usado o de otro miembro). Solo inserción, nadie lo lee directo.
create table if not exists public.club_canje_intentos (
  id          bigint generated always as identity primary key,
  actor       uuid,
  miembro_id  uuid,
  motivo      text not null,
  en          timestamptz not null default now()
);
create index if not exists club_canje_intentos_actor_idx on public.club_canje_intentos (actor, en);
create index if not exists club_canje_intentos_miembro_idx on public.club_canje_intentos (miembro_id, en);
alter table public.club_canje_intentos enable row level security;
revoke all on public.club_canje_intentos from public, anon, authenticated;

-- Hash del código (normalizado: sin espacios, en mayúscula).
create or replace function public.club_codigo_hash(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select encode(extensions.digest('club-canje:' || upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), 'sha256'), 'hex') $$;

-- ¿Este usuario de caja o este miembro llegaron al tope de intentos fallidos? (5 en 15 minutos)
create or replace function public.club_canje_bloqueado(p_actor uuid, p_miembro uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select count(*) from public.club_canje_intentos i where i.actor = p_actor and i.en > now() - interval '15 minutes') >= 5
      or (p_miembro is not null and
          (select count(*) from public.club_canje_intentos i where i.miembro_id = p_miembro and i.en > now() - interval '15 minutes') >= 5)
$$;

-- Aviso al referente en cada canje (evento para el pase de Wallet, F1e). Mientras tanto, la caja muestra un
-- link wa.me (club_canje_aviso). Solo owner y manager lo leen.
create table if not exists public.club_alertas (
  id             bigint generated always as identity primary key,
  location_id    text not null,
  tipo           text not null check (tipo in ('canje')),
  miembro_id     uuid not null references public.club_miembros(id),
  movimiento_id  uuid unique references public.club_movimientos(id),
  creado_en      timestamptz not null default now(),
  enviado_en     timestamptz,
  canal          text
);
alter table public.club_alertas enable row level security;
revoke all on public.club_alertas from public, anon, authenticated;
grant select on public.club_alertas to authenticated;
drop policy if exists club_alertas_gerencia on public.club_alertas;
create policy club_alertas_gerencia on public.club_alertas for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));
-- CLUB-AUD-74: también alertas de cupo de la autoalta (sin miembro). El canje sigue exigiendo miembro.
alter table public.club_alertas alter column miembro_id drop not null;
alter table public.club_alertas add column if not exists detalle jsonb;
alter table public.club_alertas drop constraint if exists club_alertas_tipo_check;
alter table public.club_alertas add constraint club_alertas_tipo_check check (tipo in ('canje','autoalta_cupo'));
alter table public.club_alertas drop constraint if exists club_alertas_canje_miembro;
alter table public.club_alertas add constraint club_alertas_canje_miembro check (tipo <> 'canje' or miembro_id is not null);

-- Generar el código desde el portal (PÚBLICA, solo con el header de club-web). Tope: 5 por hora por miembro.
-- Orden de locks igual que el canje: códigos vigentes del miembro → miembro.
drop function if exists public.club_canje_codigo_generar(text);
create or replace function public.club_canje_codigo_generar(p_token text)
returns table (codigo text, vence_en timestamptz, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok   text := lower(btrim(coalesce(p_token, '')));
  v_id    uuid;
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_cod   text;
  v_vence timestamptz := now() + interval '10 minutes';
  i       int;
begin
  if not public.club_web_ok() then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select m.id into v_id from public.club_miembros m
   where m.token_portal = v_tok and m.estado = 'activo' and m.tipo in ('referente','concierge_pm','equipo');
  if v_id is null then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  perform 1 from public.club_codigos_canje k
    where k.miembro_id = v_id and k.usado_en is null and k.invalidado_en is null for update;
  select * into v_m from public.club_miembros m where m.id = v_id and m.estado = 'activo' for update;
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if found then perform public.club_local(v_m.location_id, true); end if;   -- LC-ML
  select * into v_cfg from public.club_config c where c.location_id = v_m.location_id;
  if public.club_saldo_personas(v_m.id) < v_cfg.canje_min * v_cfg.personas_por_credito then
    raise exception 'Todavía no te alcanza para canjear' using errcode = 'P0001';
  end if;
  if (select count(*) from public.club_codigos_canje k
       where k.miembro_id = v_m.id and k.creado_en > now() - interval '1 hour') >= 5 then
    raise exception 'Demasiados códigos de canje' using errcode = 'P0001';
  end if;

  update public.club_codigos_canje k set invalidado_en = now()
   where k.miembro_id = v_m.id and k.usado_en is null and k.invalidado_en is null;
  for i in 1 .. 5 loop
    v_cod := public.club_gen_codigo(6);
    begin
      insert into public.club_codigos_canje (location_id, miembro_id, codigo_hash, vence_en)
      values (v_m.location_id, v_m.id, public.club_codigo_hash(v_cod), v_vence);
      codigo := v_cod; vence_en := v_vence; url := 'https://club.satoricostarica.com/k/' || v_cod;
      return next; return;
    exception when unique_violation then
      null;   -- choque de hash (muy raro): otro intento
    end;
  end loop;
  raise exception 'No se pudo generar el código' using errcode = 'P0001';
end;
$$;

-- Núcleo del canje (interno: no se le da EXECUTE a nadie). p_codigo = código de canje (caja) o null con
-- p_nota (respaldo aprobado por owner o manager). Las guardas de rol están en las dos puertas.
-- Un código equivocado NO lanza error: devuelve `error` (así queda guardado el intento fallido).
drop function if exists public.club_canje(uuid, numeric, text, uuid);
drop function if exists public.club_canje(uuid, numeric, text, uuid, jsonb);
drop function if exists public.club_canje(uuid, text, numeric, text, uuid, jsonb);
drop function if exists public.club_canje_aprobado(uuid, numeric, text, uuid, jsonb, text);
drop function if exists public.club_canje_aplicar(uuid, text, numeric, text, uuid, jsonb, text);
create or replace function public.club_canje_aplicar(p_miembro uuid, p_codigo text, p_creditos numeric, p_factura text,
                                                     p_op uuid, p_pos jsonb, p_nota text)
returns table (personas int, creditos numeric, movimiento uuid, error text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_fac      text := public.club_norm_factura(p_factura);
  v_hash     text;
  v_pos      jsonb;
  v_sin_pos  boolean := p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null';
  v_visita   text;
  v_m        public.club_miembros%rowtype;
  v_k        public.club_codigos_canje%rowtype;
  v_cfg      public.club_config%rowtype;
  v_prev     public.club_movimientos%rowtype;
  v_mov      uuid;
  v_saldo    int;
  v_necesita numeric;
  v_ya_fac   numeric;
  v_ya_dia   numeric;
  v_hoy      timestamptz;
  v_motivo   text;
begin
  if p_op is null then
    raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
  end if;

  -- 1. op
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));   -- CLUB-AUD-08
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'canje' or v_prev.miembro_id is distinct from p_miembro then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); movimiento := v_prev.id;
    return next; return;
  end if;

  -- 2. código (R-01): vigente, del mismo miembro, sin usar. Se bloquea la fila hasta el commit.
  if p_nota is null then
    -- CLUB-AUD-38: contar y anotar el intento bajo un lock por actor y por miembro; sin él, N cajas a la vez
    -- cuentan «4» y anotan todas, y el tope de 5 se pasa. Orden: op → intentos (actor, miembro) → código → miembro.
    perform pg_advisory_xact_lock(hashtextextended('club_intentos_actor:' || coalesce(auth.uid()::text, '-'), 0));
    perform pg_advisory_xact_lock(hashtextextended('club_intentos_miembro:' || p_miembro::text, 0));
    if public.club_canje_bloqueado(auth.uid(), p_miembro) then
      raise exception 'Demasiados códigos equivocados: esperá 15 minutos o pedile al manager un canje sin celular'
        using errcode = 'P0001';
    end if;
    v_hash := public.club_codigo_hash(p_codigo);
    if upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g')) !~ '^[A-HJ-NP-Z2-9]{6}$' then
      v_motivo := 'Falta el código de canje: pedile al referente que lo genere en su portal';
    else
      select * into v_k from public.club_codigos_canje k where k.codigo_hash = v_hash for update;
      v_motivo := case
        when not found or v_k.miembro_id <> p_miembro then 'Código de canje no válido: pedile al referente el código de su portal'
        when v_k.usado_en is not null then 'Este código de canje ya se usó: pedile uno nuevo'
        when v_k.invalidado_en is not null then 'Este código de canje fue reemplazado por uno más nuevo: escaneá el último que generó'
        when v_k.vence_en <= now() then 'El código de canje venció: pedile uno nuevo'
      end;
    end if;
    if v_motivo is not null then
      insert into public.club_canje_intentos (actor, miembro_id, motivo) values (auth.uid(), p_miembro, v_motivo);
      error := v_motivo;
      return next; return;
    end if;
  end if;

  -- 3. miembro: serializa canjes simultáneos del mismo miembro.
  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found then
    raise exception 'No se encontró la cuenta del referente: escaneá de nuevo o buscalo por nombre' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'El referente está dado de baja: seguí con la cuenta sin canje' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  if p_creditos is null
     or p_creditos < v_cfg.canje_min
     or p_creditos > v_cfg.max_creditos_por_visita
     or mod(p_creditos, v_cfg.canje_paso) <> 0 then
    raise exception 'Créditos no válidos: de % a %, de a %. Elegí uno de los botones',
      public.club_num(v_cfg.canje_min), public.club_num(v_cfg.max_creditos_por_visita), public.club_num(v_cfg.canje_paso) using errcode = 'P0001';
  end if;
  if v_sin_pos and (v_fac = '' or length(v_fac) > 40) then
    raise exception 'Falta el pedido o la factura: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  perform public.club_local(v_m.location_id, true);   -- LC-ML: Club activo en el local del miembro
  v_pos := public.club_pos_ref(p_pos, v_m.location_id);   -- CLUB-AUD-18: local del miembro
  v_visita := coalesce(v_pos->>'visita', public.club_visita_canonica(v_m.location_id, null, v_fac));

  v_necesita := p_creditos * v_cfg.personas_por_credito;
  if v_necesita <> trunc(v_necesita) then
    raise exception 'Créditos no válidos para esta configuración: elegí uno de los botones' using errcode = 'P0001';
  end if;

  -- Máximo por visita: suma de canjes del miembro con la misma visita.
  select coalesce(sum(mv.creditos), 0) into v_ya_fac from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and coalesce(mv.visita_clave, mv.factura_pos) = v_visita;
  if v_ya_fac + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por visita: elegí menos créditos (el resto, en otra visita)', public.club_num(v_cfg.max_creditos_por_visita)
      using errcode = 'P0001';
  end if;

  -- Tope por día (hora CR): suma de créditos canjeados hoy por el miembro, con cualquier factura.
  v_hoy := date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  select coalesce(sum(mv.creditos), 0) into v_ya_dia from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and mv.fecha_visita >= v_hoy;
  if v_ya_dia + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por día: el resto lo puede canjear mañana', public.club_num(v_cfg.max_creditos_por_visita)
      using errcode = 'P0001';
  end if;

  v_saldo := public.club_saldo_personas(p_miembro);
  if v_saldo < v_necesita then
    raise exception 'Saldo insuficiente: elegí menos créditos o cobrá la cuenta sin canje' using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id, pos_ref, visita_clave, nota)
  values
    (v_m.location_id, p_miembro, 'canje', -v_necesita::int, p_creditos, v_cfg.personas_por_credito,
     v_cfg.valor_credito_crc, nullif(v_fac, ''), now(), auth.uid(), 'app', p_op, v_pos, v_visita,
     case when p_nota is not null then 'Canje aprobado sin código: ' || p_nota end)
  returning id into v_mov;
  -- LC-A4 regla fija: si hay visita de socio en este pedido, queda marcada (pagada con créditos = sin descuento; A5 la cruza).
  update public.club_visitas_socio set con_canje = true where visita_clave = v_visita and not con_canje;

  if p_nota is null then
    update public.club_codigos_canje set usado_en = now(), usado_por = auth.uid(), movimiento_id = v_mov
     where id = v_k.id;
  end if;
  insert into public.club_alertas (location_id, tipo, miembro_id, movimiento_id) values (v_m.location_id, 'canje', p_miembro, v_mov);

  v_saldo := v_saldo - v_necesita::int;
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito); movimiento := v_mov;
  return next;
end;
$$;

-- Caja (owner, manager, cajero): con el código de canje del referente.
create or replace function public.club_canje(p_miembro uuid, p_codigo_canje text, p_creditos numeric, p_factura text,
                                             p_op uuid, p_pos jsonb default null)
returns table (personas int, creditos numeric, movimiento uuid, error text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return query select * from public.club_canje_aplicar(p_miembro, coalesce(p_codigo_canje, ''), p_creditos, p_factura, p_op, p_pos, null);
end;
$$;

-- Respaldo sin celular (solo owner o manager): nota obligatoria; registrado_por = quien lo aprueba.
create or replace function public.club_canje_aprobado(p_miembro uuid, p_creditos numeric, p_factura text, p_op uuid,
                                                      p_pos jsonb, p_nota text)
returns table (personas int, creditos numeric, movimiento uuid, error text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_nota text := btrim(coalesce(p_nota, ''));
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nota) not between 5 and 300 then
    raise exception 'La nota es obligatoria (de 5 a 300 caracteres): escribí por qué se canjea sin código' using errcode = 'P0001';
  end if;
  return query select * from public.club_canje_aplicar(p_miembro, null, p_creditos, p_factura, p_op, p_pos, v_nota);
end;
$$;

-- Link de WhatsApp para avisarle al referente del canje que se acaba de hacer (mientras no exista el pase).
-- Solo quien registró el canje, en los 15 minutos siguientes, o owner y manager. Sin teléfono → null.
-- Devuelve {tel, texto}; el teléfono lo ve la caja solo para ese canje recién hecho.
drop function if exists public.club_canje_aviso(uuid);
create or replace function public.club_canje_aviso(p_movimiento uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_mv  public.club_movimientos%rowtype;
  v_tel text;
  v_nom text;
  v_cfg public.club_config%rowtype;
  v_txt text;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_mv from public.club_movimientos where id = p_movimiento and tipo = 'canje';
  if not found or (v_rol = 'cajero' and (v_mv.registrado_por is distinct from auth.uid() or v_mv.registrado_en < now() - interval '15 minutes')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select c.telefono into v_tel from public.club_miembros_contacto c where c.miembro_id = v_mv.miembro_id;
  if v_tel is null then return null; end if;
  select public.club_nombre_pila(m.nombre) into v_nom from public.club_miembros m where m.id = v_mv.miembro_id;
  select * into v_cfg from public.club_config where location_id = v_mv.location_id;
  v_txt := format('Hola %s: en Satori se canjearon %s %s de tu cuenta el %s. Te quedan %s. Si no fuiste vos, avisanos por acá.',
                  coalesce(v_nom, ''), public.club_num(v_mv.creditos), case when v_mv.creditos = 1 then 'crédito' else 'créditos' end,
                  to_char(v_mv.fecha_visita at time zone 'America/Costa_Rica', 'DD/MM HH24:MI'),
                  public.club_num(public.club_creditos(public.club_saldo_personas(v_mv.miembro_id), v_cfg.personas_por_credito)));
  update public.club_alertas set canal = 'wa.me (link mostrado en caja)' where movimiento_id = p_movimiento and canal is null;
  return jsonb_build_object('tel', ltrim(v_tel, '+'), 'texto', v_txt);   -- la app arma https://wa.me/<tel>?text=…
end;
$$;

-- 4.4 Ajuste manual (solo owner): ajuste, restitución o vencimiento. Nota obligatoria.
-- CLUB-AUD-09: idempotente con p_op (mismo patrón que canje y tarjeta). La firma vieja se borra.
drop function if exists public.club_ajuste(uuid, int, text, text);
create or replace function public.club_ajuste(p_miembro uuid, p_personas int, p_tipo text, p_nota text, p_op uuid)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_nota  text := btrim(coalesce(p_nota, ''));
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_movimientos%rowtype;
  v_saldo int;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de operación' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo is distinct from p_tipo or v_prev.miembro_id is distinct from p_miembro or v_prev.personas is distinct from p_personas then
      raise exception 'El id de operación ya se usó para otra cosa' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;
  if p_tipo is null or p_tipo not in ('ajuste','restitucion','vencimiento') then
    raise exception 'Tipo no válido (ajuste, restitucion o vencimiento)' using errcode = 'P0001';
  end if;
  if v_nota = '' then
    raise exception 'La nota es obligatoria' using errcode = 'P0001';
  end if;
  if p_personas is null or p_personas = 0
     or (p_tipo = 'restitucion' and p_personas < 0)
     or (p_tipo = 'vencimiento' and p_personas > 0) then
    raise exception 'Personas no válidas para el tipo %', p_tipo using errcode = 'P0001';
  end if;

  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  v_saldo := public.club_saldo_personas(p_miembro);
  if v_saldo + p_personas < 0 then
    raise exception 'El saldo no puede quedar negativo' using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     fecha_visita, registrado_por, origen, nota, client_op_id)
  values
    (v_m.location_id, p_miembro, p_tipo, p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     now(), auth.uid(), 'app', v_nota, p_op);

  v_saldo := v_saldo + p_personas;
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

-- 4.5 Portal del referente por token (PÚBLICA: anon y authenticated). Solo lectura.
create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok   text := lower(btrim(coalesce(p_token, '')));
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_saldo int;
  v_movs  jsonb;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  v_saldo := public.club_saldo_personas(v_m.id);

  select coalesce(jsonb_agg(x order by x.fecha desc), '[]'::jsonb) into v_movs
  from (
    select mv.tipo, mv.personas, mv.creditos, mv.fecha_visita as fecha
    from public.club_movimientos mv
    where mv.miembro_id = v_m.id
    order by mv.fecha_visita desc
    limit 10
  ) x;

  return jsonb_build_object(
    'nombre',                   v_m.nombre,
    'codigo',                   v_m.codigo,
    'personas',                 v_saldo,
    'creditos',                 public.club_creditos(v_saldo, v_cfg.personas_por_credito),
    'personas_proximo_credito', public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
    'movimientos',              v_movs,
    -- LC-A2: el portal sirve también al socio (estado y link de baja del aviso de privacidad)
    'anfitrion',                exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol <> 'socio' and r.estado = 'activo'),
    -- A4.5: la pestaña «Mi Club» del portal (los mismos datos del pase, sin contactos)
    'socio',                    (select jsonb_build_object('estado', r.estado, 'desde', r.desde, 'codigo_socio', v_m.codigo_socio,
                                          'beneficio', ps->'socio'->'beneficio', 'visitas_mes', ps->'socio'->'visitas_mes',
                                          'cortesias', ps->'socio'->'cortesias', 'promociones', ps->'promociones')
                                   from public.club_miembro_roles r
                                   cross join lateral (select public.club_pase_datos(v_m.id) as ps) x
                                  where r.miembro_id = v_m.id and r.rol = 'socio' and r.estado <> 'baja')
  );
end;
$$;

-- 4.6 Vencimiento por inactividad (solo owner; el cron se programa más adelante).
-- ⚠️ REGLA para las sesiones de Claude Code: nunca correr club_vencer fuera de una transacción con ROLLBACK
--    (vence TODAS las cuentas candidatas del local, no una).
-- Vencimiento por inactividad (decisión de Ismael 07-nov: nunca a ciegas). Tres piezas:
--   · club_vencer_candidatos (interna): la lista, con la misma regla de siempre (saldo > 0 y sin
--     tarjeta, canje ni restitución desde hace vencimiento_meses al corte).
--   · club_vencer_simular (owner): esa lista con nombre, personas, créditos y última actividad. No escribe.
--   · club_vencer(p_corte, p_confirmo_total) (owner): solo vence si p_confirmo_total es igual a la
--     cantidad de cuentas que da la simulación en ese momento. Si no coincide, error: hay que volver a simular.
drop function if exists public.club_vencer(date);
create or replace function public.club_vencer_candidatos(p_corte date)
returns table (miembro_id uuid, location_id text, personas int, creditos numeric, ultima_actividad timestamptz,
               personas_por_credito int, valor_credito_crc int, vencimiento_meses int, limite timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.miembro_id, s.location_id, s.personas, s.creditos, s.ultima_actividad,
         c.personas_por_credito, c.valor_credito_crc, c.vencimiento_meses,
         ((p_corte - make_interval(months => c.vencimiento_meses))::timestamp at time zone 'America/Costa_Rica')
    from public.club_saldos s
    join public.club_config c on c.location_id = s.location_id
    join public.club_miembros m on m.id = s.miembro_id
   where s.personas > 0
     and coalesce(s.ultima_actividad, m.created_at)
         < ((p_corte - make_interval(months => c.vencimiento_meses))::timestamp at time zone 'America/Costa_Rica')
   order by s.miembro_id;
$$;

create or replace function public.club_vencer_simular(p_corte date)
returns table (miembro_id uuid, nombre text, tipo text, personas int, creditos numeric, ultima_actividad timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_corte is null or p_corte > (now() at time zone 'America/Costa_Rica')::date then
    raise exception 'Fecha de corte no válida' using errcode = 'P0001';
  end if;
  return query
    select k.miembro_id, public.club_nombre_limpio(m.nombre), m.tipo, k.personas, k.creditos, k.ultima_actividad
      from public.club_vencer_candidatos(p_corte) k join public.club_miembros m on m.id = k.miembro_id
     order by k.creditos desc, k.personas desc, k.ultima_actividad;
end;
$$;

create or replace function public.club_vencer(p_corte date, p_confirmo_total int)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_n      int := 0;
  v_total  int;
  r        record;
  v_p      int;
  v_ult    timestamptz;
  v_creado timestamptz;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_corte is null or p_corte > (now() at time zone 'America/Costa_Rica')::date then
    raise exception 'Fecha de corte no válida' using errcode = 'P0001';
  end if;
  -- Una sola corrida a la vez (dos owners confirmando a la par).
  perform pg_advisory_xact_lock(hashtextextended('club_vencer', 0));
  select count(*) into v_total from public.club_vencer_candidatos(p_corte);
  if p_confirmo_total is null or p_confirmo_total <> v_total then
    raise exception 'La simulación da % cuentas y confirmaste %: volvé a simular', v_total, coalesce(p_confirmo_total::text, 'ninguna')
      using errcode = 'P0001';
  end if;

  -- CLUB-AUD-03: por cada candidato se bloquea al miembro y recién ahí se recalculan el saldo y la
  -- última actividad (snapshot nuevo). Así un canje o una tarjeta simultáneos no dejan el saldo
  -- negativo ni se vence lo que acaba de tener actividad.
  for r in select * from public.club_vencer_candidatos(p_corte) loop
    select m.created_at into v_creado from public.club_miembros m where m.id = r.miembro_id for update;
    select coalesce(sum(mv.personas), 0),
           max(mv.fecha_visita) filter (where mv.tipo in ('tarjeta','canje','restitucion'))   -- AUD-10
      into v_p, v_ult
      from public.club_movimientos mv where mv.miembro_id = r.miembro_id;
    continue when v_p <= 0 or coalesce(v_ult, v_creado) >= r.limite;
    insert into public.club_movimientos
      (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
       fecha_visita, registrado_por, origen, nota)
    values
      (r.location_id, r.miembro_id, 'vencimiento', -v_p, r.personas_por_credito, r.valor_credito_crc,
       now(), auth.uid(), 'app',
       format('Vencimiento automático: %s meses sin actividad al %s', r.vencimiento_meses, p_corte));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── 4b. F1c: funciones de staff, resolución de QR e historial de config ─────

-- Formato de los QR (lo usa también el front: src/modules/club/qrFormato.ts):
--   referente: https://club.satoricostarica.com/r/{codigo8}
--   cupón:     https://club.satoricostarica.com/c/{codigo10}

-- Teléfono a E.164 (+506 por defecto si vienen 8 dígitos). NULL si viene vacío; error si no es válido.
create or replace function public.club_norm_telefono(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare v text := nullif(regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g'), '');
begin
  if v is null then return null; end if;
  if v ~ '^[0-9]{8}$' then v := '+506' || v;
  elsif v ~ '^[1-9][0-9]{7,14}$' then v := '+' || v;
  end if;
  if v !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Teléfono no válido' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Texto normalizado para buscar sin mayúsculas ni tildes.
create or replace function public.club_norm_texto(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(translate(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'),
                         'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'));
$$;

-- Negocios: alta y edición (owner, manager).
drop function if exists public.club_negocio_guardar(uuid, text, text, boolean);   -- LC-ML: suma p_location
create or replace function public.club_negocio_guardar(p_id uuid, p_nombre text, p_tipo text, p_activo boolean,
                                                      p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = 'P0001';
  end if;
  if p_tipo is null or p_tipo not in ('hotel','tienda','host','delivery','concierge','otro') then
    raise exception 'Tipo de negocio no válido' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into public.club_negocios (location_id, nombre, tipo, activo)
      values (public.club_local(p_location, false), v_nombre, p_tipo, coalesce(p_activo, true))
      returning id into v_id;
    else
      update public.club_negocios
         set nombre = v_nombre, tipo = p_tipo, activo = coalesce(p_activo, activo), updated_at = now()
       where id = p_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Negocio no encontrado' using errcode = 'P0001';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Ya existe un negocio con ese nombre' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

-- Miembros: alta y edición (owner, manager). El contacto va a club_miembros_contacto.
-- p_contacto NULL = no tocar el contacto; un objeto = reemplazarlo
-- ({telefono, email, optin_whatsapp, optin_email}; claves ausentes o vacías = sin dato).
drop function if exists public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb);   -- LC-ML: suma p_location
create or replace function public.club_miembro_guardar(
  p_id uuid, p_tipo text, p_nombre text, p_negocio_id uuid, p_estado text, p_contacto jsonb, p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
  v_tel    text;
  v_email  text;
  v_antes  text;
  v_saldo  int;
  v_cfg    public.club_config%rowtype;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = 'P0001';
  end if;
  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo') then
    raise exception 'Tipo no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
  end if;
  if p_estado is not null and p_estado not in ('activo','baja') then
    raise exception 'Estado no válido' using errcode = 'P0001';
  end if;
  if p_negocio_id is not null and not exists (select 1 from public.club_negocios n where n.id = p_negocio_id) then
    raise exception 'Negocio no encontrado' using errcode = 'P0001';
  end if;

  if p_contacto is not null then
    if jsonb_typeof(p_contacto) <> 'object' then
      raise exception 'Contacto no válido' using errcode = 'P0001';
    end if;
    v_tel := public.club_norm_telefono(p_contacto->>'telefono');
    v_email := nullif(lower(btrim(coalesce(p_contacto->>'email', ''))), '');
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Email no válido' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    -- LC-ML: el local se elige (o sale del negocio); sin dato, el único local con el Club activo
    insert into public.club_miembros (location_id, tipo, nombre, negocio_id, estado, origen)
    values (public.club_local(coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)), false),
            p_tipo, v_nombre, p_negocio_id, coalesce(p_estado, 'activo'), 'app')
    returning id into v_id;
  else
    select m.estado into v_antes from public.club_miembros m where m.id = p_id for update;
    update public.club_miembros
       set tipo = p_tipo, nombre = v_nombre, negocio_id = p_negocio_id,
           estado = coalesce(p_estado, estado), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Miembro no encontrado' using errcode = 'P0001';
    end if;
    -- Baja: el saldo vence en la misma transacción. Volver a activo NO restituye
    -- (eso es club_ajuste tipo restitucion, solo owner).
    if v_antes = 'activo' and p_estado = 'baja' then
      v_saldo := public.club_saldo_personas(v_id);
      if v_saldo > 0 then
        select * into v_cfg from public.club_config c
         where c.location_id = (select m.location_id from public.club_miembros m where m.id = v_id);
        insert into public.club_movimientos
          (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
           fecha_visita, registrado_por, origen, nota)
        values
          (v_cfg.location_id, v_id, 'vencimiento', -v_saldo, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
           now(), auth.uid(), 'app', 'baja: saldo vencido');
      end if;
    end if;
  end if;

  if p_contacto is not null then
    insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email)
    values (v_id, (select location_id from public.club_miembros where id = v_id), v_tel, v_email,
            coalesce((p_contacto->>'optin_whatsapp')::boolean, false) and v_tel is not null,
            coalesce((p_contacto->>'optin_email')::boolean, false) and v_email is not null)
    on conflict (miembro_id) do update
      set telefono = excluded.telefono, email = excluded.email,
          optin_whatsapp = excluded.optin_whatsapp, optin_email = excluded.optin_email, updated_at = now();
  end if;
  return v_id;
end;
$$;

-- Regenerar código y token (owner, manager): los anteriores dejan de valer.
create or replace function public.club_miembro_regenerar_codigo(p_id uuid)
returns table (codigo text, token_portal text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_m   public.club_miembros%rowtype;
  i int;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  for i in 1 .. 5 loop
    begin
      update public.club_miembros m
         set codigo = public.club_gen_codigo(8),
             token_portal = encode(extensions.gen_random_bytes(32), 'hex'),
             updated_at = now()
       where m.id = p_id
      returning * into v_m;
      exit;
    exception when unique_violation then
      if i = 5 then raise exception 'No se pudo regenerar el código' using errcode = 'P0001'; end if;
    end;
  end loop;
  if v_m.id is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  codigo := v_m.codigo; token_portal := v_m.token_portal;
  return next;
end;
$$;

-- Token del portal para copiar el link (owner, manager). La caja no lo ve.
create or replace function public.club_miembro_token(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role(); v text;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select m.token_portal into v from public.club_miembros m where m.id = p_id;
  if v is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  perform public.club_auditar('ver_link_portal', 'club_miembros', p_id, null, null);   -- CLUB-AUD-25
  return v;
end;
$$;

-- Búsqueda (plan B de caja): nombre, negocio o últimos 4 dígitos del teléfono.
-- NUNCA devuelve teléfono ni email. Máximo 20.
-- LC-PRIV (Grok 39 y 41, 08-nov): cada búsqueda queda en club_auditoria (quién, cuándo, si fue por dígitos o por
-- texto y cuántas filas; NUNCA el texto buscado) y hay un tope por usuario y por minuto (club_config.
-- buscar_tope_minuto; con varios locales encendidos, el menor), para que no se pueda barrer el mapa de teléfonos.
create or replace function public.club_buscar(p_q text)
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

-- Tarjeta física ya repartida (owner, manager, cajero): movimiento `tarjeta` con nota «manual».
drop function if exists public.club_tarjeta_manual(uuid, int, text, uuid);
create or replace function public.club_tarjeta_manual(p_miembro uuid, p_personas int, p_factura text, p_op uuid, p_pos jsonb default null)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_fac   text := public.club_norm_factura(p_factura);
  v_pos   jsonb;
  v_loc   text;
  v_sin_pos boolean := p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null';
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_movimientos%rowtype;
  v_saldo int;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));   -- CLUB-AUD-08
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'tarjeta' or v_prev.miembro_id is distinct from p_miembro or v_prev.cupon_id is not null then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;

  if p_personas is null or p_personas < 1 or p_personas > 30 then
    raise exception 'Personas fuera de rango (1 a 30): corregí el número' using errcode = 'P0001';
  end if;
  if v_sin_pos and (v_fac = '' or length(v_fac) > 40) then
    raise exception 'Falta el pedido o la factura: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  -- CLUB-AUD-26: apagada (prod) → nadie; prendida (staging, piloto en paralelo) → tope diario por miembro.
  select c.* into v_cfg from public.club_config c
   where c.location_id = (select m.location_id from public.club_miembros m where m.id = p_miembro);
  if not coalesce(v_cfg.tarjeta_manual_activa, false) then
    raise exception 'La tarjeta física está desactivada en este local: registrá la visita con el cupón del turista' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-18: el local es el del miembro. CLUB-AUD-02: control de la visita ANTES del lock del
  -- miembro (orden visita → miembro).
  v_loc := (select m.location_id from public.club_miembros m where m.id = p_miembro);
  if v_loc is null then raise exception 'No se encontró al miembro: escaneá su QR o buscalo de nuevo' using errcode = 'P0001'; end if;
  perform public.club_local(v_loc, true);   -- LC-ML: Club activo en el local del miembro
  v_pos := public.club_pos_ref(p_pos, v_loc);
  perform public.club_visita_control(v_loc, coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, null, v_fac)),
                                     v_pos, v_fac, p_miembro, p_personas);
  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found or v_m.tipo not in ('referente','concierge_pm','equipo') then
    raise exception 'No se encontró la cuenta del referente: escaneá de nuevo o buscalo por nombre' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'REFERENTE_INACTIVO' using errcode = 'P0001',
      hint = 'Referente dado de baja: seguí con la cuenta sin crédito';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  if (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
       where mv.miembro_id = p_miembro and mv.tipo = 'tarjeta' and mv.cupon_id is null and mv.origen = 'app'
         and mv.fecha_visita >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')
     + p_personas > v_cfg.tarjeta_manual_tope_dia then
    raise exception 'Supera el tope diario de tarjeta física (% personas por miembro): cargá el resto mañana o avisale al manager', v_cfg.tarjeta_manual_tope_dia
      using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id, nota, pos_ref, visita_clave)
  values
    (v_m.location_id, p_miembro, 'tarjeta', p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     nullif(v_fac, ''), now(), auth.uid(), 'app', p_op, 'manual', v_pos,
     coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, null, v_fac)));

  v_saldo := public.club_saldo_personas(p_miembro);
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

-- Resolver lo leído en un QR (URL completa o solo el código). owner, manager, cajero.
-- {tipo: 'cupon'|'referente'|'desconocido', datos: {...}}
-- Datos del referente para la caja (interno). p_k = el código de canje leído (R-01), o null (/r/ o «buscar»).
create or replace function public.club_referente_json(p_miembro uuid, p_k public.club_codigos_canje, p_codigo text, p_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_saldo int;
  v_dia   numeric;
  v_neg   text;
begin
  select * into v_m from public.club_miembros m where m.id = p_miembro;
  if not found then return null; end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  select n.nombre into v_neg from public.club_negocios n where n.id = v_m.negocio_id;
  v_saldo := public.club_saldo_personas(v_m.id);
  select coalesce(sum(mv.creditos), 0) into v_dia from public.club_movimientos mv
   where mv.miembro_id = v_m.id and mv.tipo = 'canje'
     and mv.fecha_visita >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  return jsonb_build_object('tipo', p_tipo, 'datos', jsonb_build_object(
    'codigo_canje',             case when p_k.id is not null then p_codigo end,
    'codigo_estado',            case when p_k.id is null then null
                                     when p_k.usado_en is not null then 'usado'
                                     when p_k.invalidado_en is not null then 'reemplazado'
                                     when p_k.vence_en <= now() then 'vencido' else 'vigente' end,
    'codigo_vence_en',          p_k.vence_en,
    'id',                       v_m.id,
    'nombre',                   v_m.nombre,
    'tipo_miembro',             v_m.tipo,
    'negocio',                  v_neg,
    'estado',                   v_m.estado,
    'personas',                 v_saldo,
    'creditos',                 public.club_creditos(v_saldo, v_cfg.personas_por_credito),
    'personas_proximo',         public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
    'personas_por_credito',     v_cfg.personas_por_credito,
    'canjeado_hoy',             v_dia,
    'canje_min',                v_cfg.canje_min,
    'canje_paso',               v_cfg.canje_paso,
    'max_creditos_por_visita',  v_cfg.max_creditos_por_visita,
    'tarjeta_manual_activa',    v_cfg.tarjeta_manual_activa));
end;
$$;

-- Resolver lo que lee la caja: cupón (/c/), QR público del referente (/r/, saldo SIN canje) o código de canje
-- (/k/ o 6 caracteres, R-01). Volátil: un código de canje que no existe cuenta como intento fallido.
create or replace function public.club_resolver(p_texto text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_t     text := btrim(coalesce(p_texto, ''));
  v_kind  text;
  v_cod   text;
  v_c     public.club_cupones%rowtype;
  v_m     public.club_miembros%rowtype;
  v_k     public.club_codigos_canje%rowtype;
  mm      text[];
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  mm := regexp_match(v_t, '^https?://club\.satoricostarica\.com/([rcksRCKS])/([A-Za-z0-9]+)/?$', 'i');
  if mm is not null then
    v_kind := lower(mm[1]); v_cod := upper(mm[2]);
  else
    v_cod := upper(regexp_replace(v_t, '\s', '', 'g'));
    v_kind := case length(v_cod) when 8 then 'r' when 10 then 'c' when 6 then 'k' when 9 then 's' else null end;
  end if;

  -- LC-A1: QR fijo del socio (/s/, 9 caracteres). Solo identifica (10 % y cortesía); nunca da créditos.
  if v_kind = 's' and v_cod ~ '^[A-HJ-NP-Z2-9]{9}$' then
    select * into v_m from public.club_miembros m where m.codigo_socio = v_cod;
    if found then
      return jsonb_build_object('tipo', 'socio', 'datos', (
        select jsonb_build_object('id', v_m.id, 'nombre', v_m.nombre, 'persona_estado', v_m.estado,
                                  'estado', r.estado, 'desde', r.desde, 'alta_por', r.alta_por,
                                  'provisional_hasta', r.provisional_hasta,
                                  'es_anfitrion', public.club_tiene_rol(v_m.id, array['referente','concierge_pm','equipo']))
          from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol = 'socio'));
    end if;
  end if;

  if v_kind = 'c' and v_cod ~ '^[A-HJ-NP-Z2-9]{10}$' then
    select * into v_c from public.club_cupones c where c.codigo = v_cod;
    if found then
      select * into v_m from public.club_miembros m where m.id = v_c.referente_id;
      return jsonb_build_object('tipo', 'cupon', 'datos', jsonb_build_object(
        'codigo',           v_c.codigo,
        'estado',           case when v_c.estado = 'vigente' and v_c.vence_en <= now() then 'vencido' else v_c.estado end,
        'vence_en',         v_c.vence_en,
        'usado_en',         v_c.usado_en,
        'referente_id',     v_m.id,
        'referente',        v_m.nombre,
        'referente_estado', v_m.estado));
    end if;
  elsif v_kind = 'r' and v_cod ~ '^[A-HJ-NP-Z2-9]{8}$' then
    select * into v_m from public.club_miembros m
     where m.codigo = v_cod and m.tipo in ('referente','concierge_pm','equipo');
    if found then
      return public.club_referente_json(v_m.id, null, null, 'referente');
    end if;
  elsif v_kind = 'k' and v_cod ~ '^[A-HJ-NP-Z2-9]{6}$' then
    perform pg_advisory_xact_lock(hashtextextended('club_intentos_actor:' || coalesce(auth.uid()::text, '-'), 0));   -- CLUB-AUD-38
    if public.club_canje_bloqueado(auth.uid(), null) then
      raise exception 'Demasiados códigos equivocados: esperá 15 minutos o pedile al manager un canje sin celular'
        using errcode = 'P0001';
    end if;
    select * into v_k from public.club_codigos_canje k where k.codigo_hash = public.club_codigo_hash(v_cod);
    if found then
      return public.club_referente_json(v_k.miembro_id, v_k, v_cod, 'canje');
    end if;
    insert into public.club_canje_intentos (actor, miembro_id, motivo) values (auth.uid(), null, 'Código de canje no reconocido');
  end if;
  return jsonb_build_object('tipo', 'desconocido', 'datos', '{}'::jsonb);
end;
$$;

-- «Buscar» (plan B) → la misma ficha que el /r/: saldo, sin canje (R-01). La caja no lee el `codigo` (30).
create or replace function public.club_resolver_miembro(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.club_miembros m where m.id = p_id and m.tipo in ('referente','concierge_pm','equipo')) then
    return jsonb_build_object('tipo', 'desconocido', 'datos', '{}'::jsonb);
  end if;
  return public.club_referente_json(p_id, null, null, 'referente');
end;
$$;

-- CLUB-AUD-30: el código del QR público solo lo ven owner y manager, por función (para la ficha y el QR).
create or replace function public.club_miembro_codigo(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role(); v text;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select m.codigo into v from public.club_miembros m where m.id = p_id;
  if v is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  perform public.club_auditar('ver_codigo', 'club_miembros', p_id, null, null);   -- LC-PRIV (Grok 41): sin el código
  return v;
end;
$$;

-- Pedidos abiertos del local según el puente (pos_ndf_open, refresco ~75 s). owner, manager, cajero.
-- Lo que la caja ve después del QR: «Pedido 14 · Mesa 20 · ₡48.500 · salonero». Un toque elige.
drop function if exists public.club_mesas_abiertas(text);
drop function if exists public.club_pedidos_abiertos(text);
create or replace function public.club_pedidos_abiertos(p_location text default null)
returns table (pedido text, clave text, area text, mesa text, salonero text, total_crc numeric, pax int, actualizado timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not public.club_puente_fresco(p_location) then   -- CLUB-AUD-27: la caja pasa al plan B
    raise exception 'Puente sin datos: elegí la factura' using errcode = 'P0001';
  end if;
  return query
    select o.id_pedido, o.clave, nullif(upper(btrim(coalesce(o.area, ''))), ''), nullif(upper(btrim(coalesce(o.mesa, ''))), ''),
           coalesce((select e.full_name from public.employees e where e.pos_login = o.salonero_login and e.is_active limit 1), o.salonero_login),
           o.monto_estimado_crc, o.pax, o.updated_at
      from public.pos_ndf_open o
     where o.local = p_location and o.id_pedido is not null
     order by case when o.id_pedido ~ '^[0-9]+$' then lpad(o.id_pedido, 10, '0') else o.id_pedido end;
end;
$$;

-- Plan B: facturas cerradas de las últimas 2 h (hora, total, mesa si tiene, consecutivo para comparar
-- con el tiquete). owner, manager, cajero.
drop function if exists public.club_facturas_recientes(text);
create or replace function public.club_facturas_recientes(p_location text default null)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, pedido text, consecutivo_fe text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return query
    select t.numero_factura, t.fecha_registra, t.total_crc,
           nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
           (select case when btrim(coalesce(x, '')) in ('', '0') then null else upper(btrim(x)) end
              from (select coalesce(t.mesa_factura, t.mesa) as x) m),
           t.numero_pedido, t.consecutivo_fe
      from public.pos_ndf_tickets t
     where t.local = p_location and t.estado = 'C' and t.fecha_registra >= now() - interval '2 hours'
       and t.fecha_registra <= now() + interval '5 minutes'   -- margen por el reloj de la PC del PoS
     order by t.fecha_registra desc, t.numero_factura desc
     limit 100;
end;
$$;

-- Historial de club_config: quién, cuándo, campo, valor anterior y nuevo. Solo owner lo lee.
create table if not exists public.club_config_historial (
  id              bigint generated always as identity primary key,
  location_id     text not null,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  cambiado_por    uuid,
  cambiado_en     timestamptz not null default now()
);
alter table public.club_config_historial enable row level security;
revoke all on public.club_config_historial from anon, public, authenticated;
grant select on public.club_config_historial to authenticated;
drop policy if exists club_config_hist_owner on public.club_config_historial;
create policy club_config_hist_owner on public.club_config_historial for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() = 'owner');

create or replace function public.club_config_auditar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  k text;
begin
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('updated_at','created_at') and (v_old->k) is distinct from (v_new->k) then
      insert into public.club_config_historial (location_id, campo, valor_anterior, valor_nuevo, cambiado_por)
      values (new.location_id, k, v_old->>k, v_new->>k, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists club_config_auditar_trg on public.club_config;
create trigger club_config_auditar_trg after update on public.club_config
  for each row execute function public.club_config_auditar();

-- club_miembros: el staff lee todo MENOS el token del portal y el código del QR público (privilegio por
-- columna; CLUB-AUD-30). La caja resuelve por función (club_resolver, club_resolver_miembro); owner y manager
-- ven el código con club_miembro_codigo.
revoke select on public.club_miembros from authenticated;
grant select (id, location_id, tipo, nombre, negocio_id, estado, origen, legacy_id, created_at, updated_at)
  on public.club_miembros to authenticated;
-- club_cupones (CLUB-AUD-30): solo owner y manager, y sin el código (la caja y el contador no lo necesitan).
revoke select on public.club_cupones from authenticated;
grant select (id, location_id, referente_id, estado, creado_en, vence_en, usado_en, usado_por, factura_pos, personas, created_at)
  on public.club_cupones to authenticated;
drop policy if exists club_staff_select on public.club_cupones;
drop policy if exists club_cupones_gerencia on public.club_cupones;
create policy club_cupones_gerencia on public.club_cupones for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- ── 4c. F1d: páginas públicas (cupón del turista y portal) ─────────────────

-- Nombre de pila para mostrar en público: sin el prefijo «NN/», sin el sufijo «PM», primera palabra.
create or replace function public.club_nombre_pila(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(split_part(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*\d+\s*/\s*', ''), '\s+PM\s*$', '', 'i')), ' ', 1), '');
$$;

-- Ver un cupón (PÚBLICA: anon y authenticated). Solo estado, vence_en y el nombre de pila del referente.
-- Si el referente está dado de baja o el cupón fue anulado, se informa como «vencido» (no se puede usar).
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
                                       'mapa', c.mapa_url) from public.club_config c where c.location_id = v_c.location_id));
end;
$$;

-- Opt-in del turista DESPUÉS de obtener el cupón (PÚBLICA). Solo sobre un cupón vigente y sin
-- contacto previo (una sola vez). Mismas validaciones que club_cupon_crear. No revela nada.
create or replace function public.club_cupon_contacto(p_codigo text, p_contacto jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod    text := upper(btrim(coalesce(p_codigo, '')));
  v_c      public.club_cupones%rowtype;
  v_nombre text;
  v_wa     text;
  v_email  text;
  v_aviso  text;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' or p_contacto is null or jsonb_typeof(p_contacto) <> 'object' then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p_contacto->'optin'), '') <> 'boolean' or not (p_contacto->>'optin')::boolean then
    raise exception 'Falta el consentimiento' using errcode = 'P0001';
  end if;
  select * into v_c from public.club_cupones c where c.codigo = v_cod for update;
  if not found or v_c.estado <> 'vigente' or v_c.vence_en <= now() then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  -- LC-PRIV (Grok 63): el aviso de privacidad vigente del local del cupón, versión exacta (club-web la manda)
  select c.aviso_privacidad_version into v_aviso from public.club_config c where c.location_id = v_c.location_id;
  if v_aviso is null or coalesce(p_contacto->>'acepto', '') <> v_aviso then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.club_cupones_contactos k where k.cupon_id = v_c.id) then
    return true;   -- ya cargado: no se pisa ni se informa nada más
  end if;
  v_nombre := nullif(btrim(regexp_replace(coalesce(p_contacto->>'nombre', ''), '[[:cntrl:]]', '', 'g')), '');
  if v_nombre is not null and length(v_nombre) > 80 then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  begin
    v_wa := public.club_norm_telefono(p_contacto->>'whatsapp');
  exception when others then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end;
  v_email := nullif(lower(btrim(coalesce(p_contacto->>'email', ''))), '');
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  if v_wa is null and v_email is null then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  insert into public.club_cupones_contactos (cupon_id, nombre, whatsapp, email, optin, aviso_version, aviso_aceptado_en)
  values (v_c.id, v_nombre, v_wa, v_email, true, v_aviso, now())
  on conflict (cupon_id) do nothing;
  return true;
end;
$$;

-- ── 4d. F1f: bandeja de excepciones del puente y reporte mensual ───────────
-- Las tablas pos_ndf_* son SOLO LECTURA acá: se consultan, nunca se escriben.

-- Config: artículo marcador de la promo en el PoS (opción 2, apagado mientras sea NULL)
-- y margen de latencia del puente antes de marcar REGISTRO_SIN_FACTURA.
alter table public.club_config add column if not exists promo_articulo_codigo text;
alter table public.club_config add column if not exists puente_latencia_min int not null default 30
  check (puente_latencia_min between 1 and 1440);

-- Clave de comparación de facturas: solo dígitos, sin ceros a la izquierda.
create or replace function public.club_factura_clave(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(ltrim(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '0'), '');
$$;

-- Nombre para reportes (ESTANDAR-reportes §7): sin «NN/», «(Grupo)» ni «PM» final.
create or replace function public.club_nombre_limpio(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*\d+\s*/\s*', ''),
                                         '\(\s*grupo\s*\)', '', 'gi'),
                          '\s+PM\s*$', '', 'i'),
           '\s+', ' ', 'g'));
$$;

-- Cruce automático de un registro del Club con sus facturas del puente (ítem 11, firma de Ismael
-- 07-nov). Interna (sin EXECUTE para nadie). Devuelve las facturas de la visita, la principal primero;
-- vacío si no cruza.
--   · sin pos_ref (factura tipeada): por número, solo dígitos y sin ceros a la izquierda.
--   · modo 'factura' (plan B): por número.
--   · modo 'pedido':
--       1. PRINCIPAL = la factura del pedido (FAC_Pedidos.NumeroFactura → numero_pedido). Si la
--          factura trae la apertura del pedido (mig 081), la clave es exacta: número + apertura. Si
--          no (histórico sin backfill), la primera factura con ese número cerrada desde la apertura
--          (o el escaneo) y hasta 18 h después del escaneo. Nunca el día de la factura ni fecha_cierra.
--       2. CUENTA DIVIDIDA = las facturas SIN pedido de la misma mesa (mesa de la factura, mig 081)
--          registradas entre la apertura del pedido y 30 min después de la principal.
--     Sin principal no hay ventana para las divididas: va a Excepciones (SIN_CRUCE).
--     Margen de 2 min por la diferencia de reloj entre la PC del PoS y el servidor.
drop function if exists public.club_cruce_auto(text, jsonb, text);
-- Detalle del cruce: cada factura con su rol. 'principal' (la del pedido), 'dividida' (sin pedido, misma
-- mesa, solo en la ventana de ESTE pedido) o 'ambigua' (sin pedido, misma mesa, pero también cae en la
-- ventana de OTRO pedido de esa mesa: no se asigna a ninguno y va a Excepciones como AMBIGUA; decisión
-- de Ismael 07-nov). Ventana de un pedido = de su apertura a 30 min después de su factura; si la
-- factura no trae la apertura (antes del backfill), la ventana del otro pedido arranca en su factura.
create or replace function public.club_cruce_detalle(p_location text, p_pos jsonb, p_factura text)
returns table (ticket_id uuid, rol text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_clave  text;
  v_hora   timestamptz;
  v_abre   timestamptz;
  v_mesa   text;
  v_area   text;
  v_id     uuid;
  v_fr     timestamptz;
begin
  if p_pos is null then
    v_clave := public.club_factura_clave(p_factura);   -- una vez, no por fila
    if v_clave is null then return; end if;
    -- CLUB-AUD-68: el camino legacy (número tipeado) cruza solo con facturas CERRADAS (estado 'C'), como los demás.
    return query select t.id, 'principal'::text from public.pos_ndf_tickets t
     where t.local = p_location and ltrim(t.numero_factura, '0') = v_clave and t.estado = 'C' limit 1;
    return;
  elsif p_pos->>'modo' = 'factura' then
    return query select t.id, 'principal'::text from public.pos_ndf_tickets t
     where t.local = p_location and t.numero_factura = p_pos->>'numero_factura' and t.estado = 'C';
    return;
  elsif p_pos->>'modo' <> 'pedido' or p_pos->>'modo' is null then
    return;
  end if;

  v_hora := (p_pos->>'hora')::timestamptz;
  v_abre := coalesce((p_pos->>'abierto_en')::timestamptz, (p_pos->>'visto')::timestamptz, v_hora);
  v_mesa := nullif(ltrim(upper(btrim(coalesce(p_pos->>'mesa', ''))), '0'), '');

  -- 1. principal: exacta por número + apertura; si la factura no trae la apertura, la primera.
  select t.id, t.fecha_registra, nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), '')
    into v_id, v_fr, v_area from public.pos_ndf_tickets t
   where t.local = p_location and t.estado = 'C' and t.numero_pedido = p_pos->>'pedido'
     -- CLUB-AUD-13 (EXPLAIN 07-nov): el número de pedido se repite cada día; el rango de fecha usa el índice
     -- (local, numero_pedido, fecha_registra) y no cambia el resultado (la factura es posterior a la apertura).
     and t.fecha_registra >= least(v_abre, v_hora) - interval '2 minutes' and t.fecha_registra < v_hora + interval '18 hours'
     and (case when t.pedido_abierto_en is not null
               then abs(extract(epoch from t.pedido_abierto_en - v_abre)) < 2
               else t.fecha_registra >= least(v_abre, v_hora) - interval '2 minutes'
                    and t.fecha_registra < v_hora + interval '18 hours' end)
   order by (t.pedido_abierto_en is null), t.fecha_registra, t.numero_factura
   limit 1;
  if v_id is null then
    return;
  end if;
  ticket_id := v_id; rol := 'principal'; return next;
  if v_mesa is null then
    return;
  end if;
  -- La mesa es (área, mesa) (decisión de Ismael, 07-nov): la del escaneo o, si no vino, la de la factura del pedido.
  v_area := coalesce(nullif(upper(btrim(coalesce(p_pos->>'area', ''))), ''), v_area, '');

  -- 2. sin pedido, misma mesa de la factura, de la apertura a principal + 30 min; ambigua si también
  --    cae en la ventana de otro pedido de esa mesa.
  return query
    select t.id,
           case when exists (
             select 1 from public.pos_ndf_tickets o
              where o.local = p_location and o.estado = 'C' and o.numero_pedido is not null and o.id <> v_id
                -- CLUB-AUD-13: acotado por fecha (índice (local, fecha_registra)); un pedido dura menos de 18 h
                and o.fecha_registra >= t.fecha_registra - interval '30 minutes'
                and o.fecha_registra <= t.fecha_registra + interval '18 hours'
                and nullif(ltrim(upper(btrim(coalesce(o.mesa_factura, o.mesa, ''))), '0'), '') = v_mesa
                and upper(btrim(coalesce(o.area_factura, o.area, ''))) = v_area
                and t.fecha_registra >= coalesce(o.pedido_abierto_en, o.fecha_registra) - interval '2 minutes'
                and t.fecha_registra <= o.fecha_registra + interval '30 minutes')
           then 'ambigua' else 'dividida' end
      from public.pos_ndf_tickets t
     where t.local = p_location and t.estado = 'C' and t.numero_pedido is null
       and nullif(ltrim(upper(btrim(coalesce(t.mesa_factura, ''))), '0'), '') = v_mesa
       and upper(btrim(coalesce(t.area_factura, t.area, ''))) = v_area
       and t.fecha_registra >= v_abre - interval '2 minutes'
       and t.fecha_registra <= v_fr + interval '30 minutes'
     order by t.fecha_registra, t.numero_factura;
end;
$$;

-- Las facturas de la visita (principal primero + divididas no ambiguas). Interna.
create or replace function public.club_cruce_facturas(p_location text, p_pos jsonb, p_factura text)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(d.ticket_id order by (d.rol <> 'principal'), t.fecha_registra, t.numero_factura), '{}')
    from public.club_cruce_detalle(p_location, p_pos, p_factura) d
    join public.pos_ndf_tickets t on t.id = d.ticket_id
   where d.rol in ('principal', 'dividida');
$$;

-- Factura elegida a mano por el manager para un registro que no cruzó solo (cuenta dividida o
-- refactura: el PoS cobra en facturas sin pedido). Queda anotado quién y cuándo. No toca el libro.
create table if not exists public.club_cruces_manuales (
  movimiento_id   uuid primary key references public.club_movimientos(id),
  location_id     text not null,
  numero_factura  text not null check (numero_factura ~ '^[0-9]{1,30}$'),
  elegido_por     uuid,
  elegido_en      timestamptz not null default now(),
  nota            text check (nota is null or length(nota) <= 500)
);
-- CLUB-AUD-25: cada elección queda en el historial (club_cruces_manuales guarda la vigente).
create table if not exists public.club_cruces_manuales_historial (
  id              bigint generated always as identity primary key,
  movimiento_id   uuid not null references public.club_movimientos(id),
  location_id     text not null,
  numero_factura  text not null,
  elegido_por     uuid,
  elegido_en      timestamptz not null default now(),
  nota            text
);
alter table public.club_cruces_manuales_historial enable row level security;
revoke all on public.club_cruces_manuales_historial from anon, public, authenticated;
grant select on public.club_cruces_manuales_historial to authenticated;
drop policy if exists club_cruces_hist_gerencia on public.club_cruces_manuales_historial;
create policy club_cruces_hist_gerencia on public.club_cruces_manuales_historial for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));
alter table public.club_cruces_manuales enable row level security;
revoke all on public.club_cruces_manuales from anon, public, authenticated;
grant select on public.club_cruces_manuales to authenticated;
drop policy if exists club_cruces_gerencia on public.club_cruces_manuales;
create policy club_cruces_gerencia on public.club_cruces_manuales for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

create table if not exists public.club_excepciones_resueltas (
  id            bigint generated always as identity primary key,
  location_id   text not null,
  tipo          text not null,
  ref           text not null check (length(ref) between 1 and 100),
  nota          text not null check (length(btrim(nota)) between 1 and 500),
  resuelto_por  uuid,
  resuelto_en   timestamptz not null default now(),
  unique (location_id, tipo, ref)
);
-- El check de tipos va aparte para poder sumar tipos sin recrear la tabla (re-ejecutable).
alter table public.club_excepciones_resueltas drop constraint if exists club_excepciones_resueltas_tipo_check;
alter table public.club_excepciones_resueltas add constraint club_excepciones_resueltas_tipo_check
  check (tipo in ('PROMO_SIN_CUPON','CREDITOS_SIN_CANJE','CANJE_MONTO_DISTINTO','REGISTRO_SIN_FACTURA','SIN_CRUCE',
                  'VISITA_REPETIDA','PERSONAS_SOBRE_PAX','AMBIGUA','CUPON_SIN_PROMO','TARJETA_MANUAL','CANJE_SIN_CODIGO',
                  -- LC-A5
                  'LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','CANJE_CON_DESCUENTO','DESCUENTO_SIN_RESPALDO','SOCIO_USO_ANOMALO','CUPON_AUTOREFERIDO','CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA','ANFITRION_SOBRE_TOPE','SOCIO_ALTA_SIN_CONFIRMAR'));
-- CLUB-AUD-25: historial de resoluciones (cada una es una fila nueva; vale la última). Ya no se pisa.
alter table public.club_excepciones_resueltas drop constraint if exists club_excepciones_resueltas_location_id_tipo_ref_key;
create index if not exists club_exc_res_ref_idx on public.club_excepciones_resueltas (location_id, tipo, ref, resuelto_en desc);
alter table public.club_excepciones_resueltas enable row level security;
revoke all on public.club_excepciones_resueltas from anon, public, authenticated;
grant select on public.club_excepciones_resueltas to authenticated;
drop policy if exists club_exc_gerencia on public.club_excepciones_resueltas;
create policy club_exc_gerencia on public.club_excepciones_resueltas for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- LC-A5: configuración de las excepciones del Local Club.
alter table public.club_config add column if not exists socio_visitas_semana_max int not null default 5 check (socio_visitas_semana_max between 1 and 50);
-- Artículos que van a ₡0 y NO son cortesía (p. ej. el 857 «INVITADO», cuando Ismael confirme qué marca). Vacío por defecto.
alter table public.club_config add column if not exists articulos_cero_permitidos text[] not null default '{}';
-- Desde qué día corren las excepciones del Local Club que miran facturas del PoS (antes del lanzamiento el LC se cobra
-- sin la app y todo saldría como excepción). Se carga el día del lanzamiento (RUNBOOK). Null = sin filtro.
alter table public.club_config add column if not exists lc_excepciones_desde date;

-- Excepciones del puente en un rango de fechas (hora CR). owner, manager.
--   REGISTRO_SIN_FACTURA (exacta)  · cupón/tarjeta/canje de la app con factura que no está en el puente
--   VISITA_REPETIDA      (exacta)  · el mismo referente con más de una tarjeta en la misma visita (misma
--                                    factura principal), aunque se haya registrado por caminos distintos
--   PERSONAS_SOBRE_PAX   (probable)· Σ personas de las tarjetas de una visita > pax de sus facturas
--   AMBIGUA              (probable)· factura sin pedido de la mesa de un registro que cae también en la
--                                    ventana de otro pedido de esa mesa: no se asigna a ninguno
--   SIN_CRUCE            (probable)· registro con pedido que no encontró su factura (primera con ese pedido
--                                    después del escaneo, tope 18 h): posible cuenta dividida o refactura
--                                    (el PoS las cobra en facturas sin pedido). El manager elige la factura.
--   CREDITOS_SIN_CANJE   (probable)· factura con cxc múltiplo de medio crédito y sin canje
--   CANJE_MONTO_DISTINTO (probable)· canjes de una factura cuyo valor ≠ cxc de la factura (±₡1)
--   PROMO_SIN_CUPON      (exacta)  · solo si club_config.promo_articulo_codigo está cargado
--   CUPON_SIN_PROMO      (exacta)  · cupón usado sin el artículo de la promo en las facturas de la visita
--                                    (R-02). Solo si promo_articulo_codigo está cargado, igual que la anterior.
-- LC-A5 (Local Club; artículo LC = club_config.lc_articulo_codigo, «856»):
--   (857 «INVITADO» = lc_invitado_codigo cuenta igual que el 856 en todas: «el 856» acá quiere decir «el 856 o el 857»)
--   LC_SIN_REGISTRO       (exacta)  · factura C con el 856 que no cruza con ninguna visita de socio
--   REGISTRO_LC_SIN_856   (exacta)  · visita de socio (con beneficio) cuya factura cruzada no tiene el 856
--   CANJE_CON_DESCUENTO   (exacta)  · factura pagada con créditos (cxc > 0 o canje del Club) con el 856, PROMO CLUB, un
--                                     MARCADOR DE DESCUENTO activo o una línea en cortesía (regla fija: créditos = sin descuento)
--   DESCUENTO_SIN_RESPALDO (probable)· línea por debajo de su precio de referencia (moda de los 30 días anteriores, sin
--                                     facturas con marcador) en una factura sin cupón ni MARCADOR DE DESCUENTO (LC-MD: la
--                                     lista configurable por local; un marcador con % esperado respalda solo ese %, ±1,5
--                                     puntos); una por factura; si ese día
--                                     ≥ 60 % de las ventas del artículo van a ese precio, es el precio nuevo (no salta)
--   SOCIO_USO_ANOMALO     (probable)· el mismo socio en dos mesas el mismo día, o más de socio_visitas_semana_max (5)
--                                     visitas en la semana
--   CUPON_AUTOREFERIDO    (exacta)  · cupón de un anfitrión que usó en una visita donde él mismo es socio
--   CORTESIA_DISTINTA     (exacta)  · en la factura de la visita, un artículo de «CORTESÍA CLUB» distinto del sorteado,
--                                     o más de los sorteados
--   CORTESIA_SIN_SOCIO    (exacta)  · un artículo de «CORTESÍA CLUB» en una factura sin visita de socio (solo desde
--                                     lc_excepciones_desde: antes del lanzamiento la sección se usa fuera del Club)
--   CORTESIA_NO_CONFIGURADA (probable)· una línea a ₡0 fuera de la sección (ni PAX, ni el 856, ni PROMO, ni
--                                     articulos_cero_permitidos)
--   ANFITRION_SOBRE_TOPE  (exacta)  · anfitrión que pasó anfitrion_tope_mes_crc (₡25.000) de ganado en el mes (siempre;
--                                     la retención es solo del nuevo, A4.4)
--   SOCIO_ALTA_SIN_CONFIRMAR (exacta)· alta provisional (caja o validación) que nadie distinto confirmó todavía
--   Las tres de cortesía salen «pendiente de configuración» mientras no estén ni cortesia_familia ni las cortesías.
drop function if exists public.club_excepciones(date, date, text);   -- LC-A5: se suma p_tipo
create or replace function public.club_excepciones(p_desde date, p_hasta date, p_location text default null, p_tipo text default null)
returns table (tipo text, ref text, fecha timestamptz, factura text, certeza text, detalle jsonb,
               resuelta boolean, nota text, resuelta_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_cfg public.club_config%rowtype;
  v_ini timestamptz;
  v_fin timestamptz;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML
  if not public.club_local_activo(p_location) then return; end if;   -- Club apagado en el local: sin excepciones LC
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';

  return query
  with tk as (
    select t.id, t.numero_factura, ltrim(t.numero_factura, '0') as clave,
           coalesce(t.fecha_registra, t.fecha_cierra) as f, coalesce(t.cxc_crc, 0) as cxc, t.total_crc, t.estado,
           coalesce(t.mesa_factura, t.mesa) as mesa,
           -- LC-A5 (Ismael, 08-nov): quién cobró la factura en el PoS, para la segregación de las que salen solo del PoS
           array_remove(array[nullif(btrim(t.cajero_login), ''), nullif(btrim(t.salonero_login), '')], null) as pos_logins,
           -- (08-nov) turno de la factura (corte del local) y los logins fijos de caja que aparecen en ella
           case when (coalesce(t.fecha_registra, t.fecha_cierra) at time zone 'America/Costa_Rica')::time < v_cfg.turno_corte
                then 'mañana' else 'tarde' end as turno,
           array(select x from unnest(array[nullif(btrim(t.cajero_login), ''), nullif(btrim(t.salonero_login), '')]) x
                  where x = any(v_cfg.pos_logins_caja)) as logins_fijos
      from public.pos_ndf_tickets t
     where t.local = p_location and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
       and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin),
  mv0 as (
    select m.*, public.club_factura_clave(m.factura_pos) as clave
      from public.club_movimientos m
     where m.location_id = p_location and m.origen = 'app' and m.tipo in ('tarjeta','canje')
       and (m.factura_pos is not null or m.pos_ref is not null)
       -- CLUB-AUD-13: solo el rango pedido (más un día de margen para los canjes de facturas del borde),
       -- no todo el historial: cada registro dispara su cruce con pos_ndf_tickets.
       and m.fecha_visita >= v_ini - interval '1 day' and m.fecha_visita < v_fin + interval '1 day'),
  -- Facturas del puente de cada registro: la elegida a mano por el manager (si hay) o el cruce
  -- automático (club_cruce_facturas: la del pedido + las divididas de la misma mesa). La primera es
  -- la principal.
  mv as (
    select m.*, a.auto_ids,
           case when cm_t.id is not null then array[cm_t.id] else a.auto_ids end as ticket_ids,
           case when cm.movimiento_id is not null then 'manual' else 'exacta' end as cert,
           coalesce(m.factura_pos,
                    case m.pos_ref->>'modo'
                      when 'pedido'  then concat('pedido ', m.pos_ref->>'pedido', coalesce(' · área ' || (m.pos_ref->>'area'), ''),
                                                 coalesce(' · mesa ' || (m.pos_ref->>'mesa'), ''))
                      when 'factura' then m.pos_ref->>'numero_factura' end) as ref_factura
      from mv0 m
      cross join lateral (select public.club_cruce_facturas(p_location, m.pos_ref, m.factura_pos) as auto_ids) a
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = p_location and cm_t.numero_factura = cm.numero_factura
     -- LC-A5: con p_tipo, el cruce de cada registro (lo caro) solo para los tipos que lo usan
     where p_tipo is null or p_tipo not in ('LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','SOCIO_USO_ANOMALO','CORTESIA_DISTINTA',
                                            'CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA','ANFITRION_SOBRE_TOPE',
                                            'SOCIO_ALTA_SIN_CONFIRMAR','TARJETA_MANUAL','CANJE_SIN_CODIGO')),
  -- LC-A5: visitas de socio con sus facturas (la del pedido + divididas)
  vs as (
    select v.*, public.club_cruce_facturas(v.location_id, v.pos_ref, null) as ticket_ids
      from public.club_visitas_socio v
     where v.location_id = p_location and v.registrada_en >= v_ini - interval '1 day' and v.registrada_en < v_fin + interval '1 day'
       and (p_tipo is null or p_tipo in ('LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','SOCIO_USO_ANOMALO','CUPON_AUTOREFERIDO',
                                         'CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO'))),
  -- Club compartido: las visitas de esos socios en TODOS los locales (para SOCIO_USO_ANOMALO entre locales)
  vsa as (
    select v.* from public.club_visitas_socio v
     where v.registrada_en >= v_ini - interval '7 days' and v.registrada_en < v_fin + interval '1 day'
       and (p_tipo is null or p_tipo = 'SOCIO_USO_ANOMALO')
       and v.miembro_id in (select x.miembro_id from public.club_visitas_socio x
                             where x.location_id = p_location and x.registrada_en >= v_ini - interval '7 days'
                               and x.registrada_en < v_fin + interval '1 day')),
  -- líneas de las facturas C del rango, marcadas
  ln as (
    select l.*, t.clave, t.f, t.numero_factura, t.cxc,
           (l.codigo_producto in (v_cfg.lc_articulo_codigo, v_cfg.lc_invitado_codigo)) as es_lc,   -- 856 y 857
           (l.codigo_producto = v_cfg.lc_invitado_codigo) as es_invitado,
           (v_cfg.promo_articulo_codigo is not null and l.codigo_producto = v_cfg.promo_articulo_codigo) as es_promo,
           -- LC-MD: marcador de descuento configurado (activo) del local
           (select mk.nombre from public.club_marcadores_descuento mk
             where mk.location_id = p_location and mk.activo and mk.codigo_producto = l.codigo_producto) as marcador,
           ((v_cfg.cortesia_familia is not null and l.familia = v_cfg.cortesia_familia)
             or exists (select 1 from public.club_cortesias c where c.location_id = p_location and c.codigo_producto = l.codigo_producto)) as es_seccion
      from public.pos_ndf_ticket_lines l join tk t on t.id = l.ticket_id
     where t.estado = 'C'
       and (p_tipo is null or p_tipo in ('LC_SIN_REGISTRO','CANJE_CON_DESCUENTO','CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA'))),
  seccion_ok as (
    select (v_cfg.cortesia_familia is not null or exists (select 1 from public.club_cortesias c where c.location_id = p_location)) as ok),
  -- LC-MD: facturas con un MARCADOR DE DESCUENTO activo del local (club_marcadores_descuento, configurable). Un marcador
  -- sin % esperado respalda cualquier descuento de la factura; con % esperado, solo un descuento de ese % (±1,5 puntos).
  dmk as materialized (
    select t.id as tid, bool_or(mk.pct_esperado is null) as total,
           array_agg(mk.pct_esperado) filter (where mk.pct_esperado is not null) as pcts
      from public.pos_ndf_ticket_lines z join public.pos_ndf_tickets t on t.id = z.ticket_id
      join public.club_marcadores_descuento mk on mk.location_id = p_location and mk.activo and mk.codigo_producto = z.codigo_producto
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '30 days' and t.fecha_registra < v_fin
       and (p_tipo is null or p_tipo = 'DESCUENTO_SIN_RESPALDO')
     group by t.id),
  -- DESCUENTO_SIN_RESPALDO: precios unitarios de las facturas C, desde 30 días antes del rango (una pasada)
  dpr as materialized (
    select l.ticket_id as tid, l.codigo_producto as cod, l.nombre, round(l.monto / l.cantidad, 2) as u, l.cantidad as q,
           (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
           (k.tid is not null) as mk, coalesce(k.total, false) as mk_total, k.pcts as mk_pcts
      from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
      left join dmk k on k.tid = t.id
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '30 days' and t.fecha_registra < v_fin
       and l.cantidad > 0 and l.monto > 0 and not l.es_cortesia and not l.es_pax and l.codigo_producto is not null
       and (p_tipo is null or p_tipo = 'DESCUENTO_SIN_RESPALDO')),
  -- candidatas: del rango, en facturas sin cupón ni marcador sin %, por debajo del precio más alto del artículo
  -- (el precio de referencia sale solo de las facturas SIN marcador)
  dcand as materialized (
    select p.* from dpr p
      join (select cod, max(u) as umax from dpr where not mk group by cod) mx on mx.cod = p.cod
     where p.dia >= p_desde and p.dia <= p_hasta and p.u < mx.umax * 0.99 and not p.mk_total
       and (v_cfg.lc_excepciones_desde is null or p.dia >= v_cfg.lc_excepciones_desde)
       and not exists (select 1 from mv m where m.cupon_id is not null and p.tid = any(m.ticket_ids))),
  -- referencia: la moda de los 30 días anteriores, solo para los (artículo, día) candidatos. Con conteos por
  -- (artículo, día, precio) y un join (no una subconsulta por candidato); empate → el precio más alto.
  dday as materialized (select cod, dia, u, count(*) as n from dpr where not mk group by cod, dia, u),
  -- para la regla del cambio de lista: todas las ventas del día salvo las respaldadas del todo (marcador sin %)
  ddia as materialized (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u),
  dref as (
    select distinct on (z.cod, z.dia) z.cod, z.dia, z.u as ref
      from (select d.cod, d.dia, x.u, sum(x.n) as n
              from (select distinct cod, dia from dcand) d
              join dday x on x.cod = d.cod and x.dia >= d.dia - 30 and x.dia < d.dia
             group by d.cod, d.dia, x.u) z
     order by z.cod, z.dia, z.n desc, z.u desc),
  ex0 as (
    -- REGISTRO_SIN_FACTURA
    select 'REGISTRO_SIN_FACTURA'::text as tipo, m.id::text as ref, m.fecha_visita as fecha, m.ref_factura as factura,
           m.cert as certeza,
           jsonb_build_object('movimiento', case when m.cupon_id is not null then 'cupon' when m.tipo = 'canje' then 'canje' else 'tarjeta_manual' end,
                              'personas', m.personas, 'creditos', m.creditos,
                              'miembro', public.club_nombre_limpio(mi.nombre),
                              'registradores', jsonb_build_array(m.registrado_por)) as detalle
      from mv m join public.club_miembros mi on mi.id = m.miembro_id
     where m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and cardinality(m.ticket_ids) = 0
       and coalesce(m.pos_ref->>'modo', '') <> 'pedido'
    union all
    -- SIN_CRUCE: pedido sin su factura. Se marca cuando ya pasó la latencia del puente y el pedido no
    -- sigue abierto (o pasaron las 18 h). Sigue listada (resuelta) aunque el manager elija la factura.
    select 'SIN_CRUCE', m.id::text, m.fecha_visita, m.ref_factura, 'probable',
           jsonb_build_object('motivo', 'posible cuenta dividida',
                              'movimiento', case when m.cupon_id is not null then 'cupon' when m.tipo = 'canje' then 'canje' else 'tarjeta_manual' end,
                              'personas', m.personas, 'creditos', m.creditos,
                              'miembro', public.club_nombre_limpio(mi.nombre),
                              'pedido', m.pos_ref->>'pedido', 'area', m.pos_ref->>'area', 'mesa', m.pos_ref->>'mesa',
                              'total_crc', (m.pos_ref->>'total')::numeric, 'hora_escaneo', m.pos_ref->>'hora',
                              'registradores', jsonb_build_array(m.registrado_por),
                              'factura_elegida', cm.numero_factura, 'elegida_en', cm.elegido_en,
                              'elegida_por', (select p.full_name from public.profiles p where p.id = cm.elegido_por))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
     where m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and m.pos_ref->>'modo' = 'pedido'
       and cardinality(m.auto_ids) = 0
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and (now() >= (m.pos_ref->>'hora')::timestamptz + interval '18 hours'
            or not exists (select 1 from public.pos_ndf_open o where o.local = p_location and o.id_pedido = m.pos_ref->>'pedido'))
    union all
    -- AMBIGUA: una por factura (aunque la vean varios registros), con los pedidos del Club que la tocan
    select 'AMBIGUA', 'ambigua:' || ltrim(t.numero_factura, '0'), min(m.fecha_visita), t.numero_factura, 'probable',
           jsonb_build_object('mesa', t.mesa_factura, 'total_crc', t.total_crc, 'hora', t.fecha_registra,
                              'pedidos', jsonb_agg(distinct m.pos_ref->>'pedido'),
                              'registradores', jsonb_agg(distinct m.registrado_por),
                              'miembro', string_agg(distinct public.club_nombre_limpio(mi.nombre), ', '))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      cross join lateral public.club_cruce_detalle(p_location, m.pos_ref, m.factura_pos) d
      join public.pos_ndf_tickets t on t.id = d.ticket_id
     where m.pos_ref->>'modo' = 'pedido' and d.rol = 'ambigua' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
     group by t.id, t.numero_factura, t.mesa_factura, t.total_crc, t.fecha_registra
    union all
    -- VISITA_REPETIDA (CLUB-AUD-02): mismo miembro, misma factura principal, más de una tarjeta
    select 'VISITA_REPETIDA', 'visita:' || v.miembro_id || ':' || ltrim(t.numero_factura, '0'), v.f, t.numero_factura, 'exacta',
           jsonb_build_object('tarjetas', v.n, 'personas', v.personas, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'registradores', v.registradores,
                              'mesa', coalesce(t.mesa_factura, t.mesa), 'pax', t.pax)
      from (select m.miembro_id, m.ticket_ids[1] as principal, count(*) as n, sum(m.personas) as personas, min(m.fecha_visita) as f,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m
             where m.tipo = 'tarjeta' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by 1, 2 having count(*) > 1) v
      join public.pos_ndf_tickets t on t.id = v.principal
      join public.club_miembros mi on mi.id = v.miembro_id
    union all
    -- PERSONAS_SOBRE_PAX (CLUB-AUD-02): Σ personas de todas las tarjetas de la visita (todos los referentes)
    -- contra el pax DEL PEDIDO, nunca el de cada factura: en una cuenta dividida las facturas sin pedido llegan
    -- con pax 0 o con parte de los artículos de pax (677/678). Pax del pedido = el mayor entre las Personas
    -- del pedido (pax_nativo de la factura principal) y la suma del pax de todas las facturas de la visita
    -- (principal + divididas). Pax 0 = desconocido: no se compara.
    select 'PERSONAS_SOBRE_PAX', 'pax:' || ltrim(t.numero_factura, '0'), v.f, t.numero_factura, 'probable',
           jsonb_build_object('personas', v.personas, 'pax', x.pax, 'pax_personas_pedido', t.pax_nativo, 'pax_facturas', x.pax_facturas,
                              'tarjetas', v.n, 'referentes', v.miembros, 'mesa', coalesce(t.mesa_factura, t.mesa),
                              'registradores', v.registradores)
      from (select m.ticket_ids[1] as principal,
                   count(*) as n, sum(m.personas) as personas, min(m.fecha_visita) as f,
                   string_agg(distinct public.club_nombre_limpio(mi.nombre), ', ') as miembros,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m join public.club_miembros mi on mi.id = m.miembro_id
             where m.tipo = 'tarjeta' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by 1) v
      join public.pos_ndf_tickets t on t.id = v.principal
      cross join lateral (select greatest(coalesce(t.pax_nativo, 0), coalesce(sum(z.pax), 0)) as pax, coalesce(sum(z.pax), 0) as pax_facturas
                            from public.pos_ndf_tickets z
                           where z.id in (select unnest(m2.ticket_ids) from mv m2
                                           where m2.tipo = 'tarjeta' and m2.ticket_ids[1] = v.principal)) x
     where x.pax > 0 and v.personas > x.pax
    union all
    -- CREDITOS_SIN_CANJE (heurística: cxc múltiplo de medio crédito)
    select 'CREDITOS_SIN_CANJE', 'factura:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('cxc_crc', t.cxc, 'creditos_estimados', round(t.cxc / v_cfg.valor_credito_crc, 1), 'total_crc', t.total_crc)
      from tk t
     where t.cxc > 0 and t.cxc % (v_cfg.valor_credito_crc / 2.0) = 0
       and not exists (select 1 from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids))
    union all
    -- CANJE_MONTO_DISTINTO (por visita: Σ créditos × valor vs Σ cxc de sus facturas, principal + divididas)
    select 'CANJE_MONTO_DISTINTO', 'factura:' || ltrim(t.numero_factura, '0'), c.f, t.numero_factura, 'probable',
           jsonb_build_object('canje_crc', c.valor, 'cxc_crc', x.cxc, 'diferencia_crc', c.valor - x.cxc,
                              'creditos', c.creditos, 'miembro', c.miembro, 'mesa', coalesce(t.mesa_factura, t.mesa), 'total_crc', x.total,
                              'facturas', x.n, 'registradores', c.registradores)
      from (select m.ticket_ids, min(m.fecha_visita) as f,
                   sum(m.creditos * m.valor_credito_crc) as valor, sum(m.creditos) as creditos,
                   string_agg(distinct public.club_nombre_limpio(mi.nombre), ', ') as miembro,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m join public.club_miembros mi on mi.id = m.miembro_id
             where m.tipo = 'canje' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by m.ticket_ids) c
      join public.pos_ndf_tickets t on t.id = c.ticket_ids[1]
      cross join lateral (select coalesce(sum(coalesce(z.cxc_crc, 0)), 0) as cxc, sum(z.total_crc) as total, count(*) as n
                            from public.pos_ndf_tickets z where z.id = any(c.ticket_ids)) x
     where abs(c.valor - x.cxc) > 1
    union all
    -- PROMO_SIN_CUPON (apagada mientras no haya artículo marcador)
    select 'PROMO_SIN_CUPON', 'factura:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulo', v_cfg.promo_articulo_codigo, 'total_crc', t.total_crc)
      from tk t
     where v_cfg.promo_articulo_codigo is not null
       and exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = t.id and l.codigo_producto = v_cfg.promo_articulo_codigo)
       and not exists (select 1 from mv m where m.tipo = 'tarjeta' and t.id = any(m.ticket_ids))
    union all
    -- CUPON_SIN_PROMO (R-02, apagada mientras no haya artículo marcador): cupón usado cuyas facturas de la
    -- visita (principal + divididas) no tienen el artículo de la promo: dio personas sin descuento aplicado.
    select 'CUPON_SIN_PROMO', 'cupon:' || m.cupon_id, m.fecha_visita, t.numero_factura, 'exacta',
           jsonb_build_object('articulo', v_cfg.promo_articulo_codigo, 'cupon', c.codigo, 'personas', m.personas,
                              'miembro', public.club_nombre_limpio(mi.nombre), 'facturas', cardinality(m.ticket_ids),
                              'mesa', coalesce(t.mesa_factura, t.mesa), 'total_crc', t.total_crc,
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      join public.club_cupones c on c.id = m.cupon_id
      join public.pos_ndf_tickets t on t.id = m.ticket_ids[1]
     where v_cfg.promo_articulo_codigo is not null
       and m.cupon_id is not null and cardinality(m.ticket_ids) > 0
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and not exists (select 1 from public.pos_ndf_ticket_lines l
                        where l.ticket_id = any(m.ticket_ids) and l.codigo_producto = v_cfg.promo_articulo_codigo)
    union all
    -- R02 (ronda 5): sin el código del artículo de la promo, las dos verificaciones NO pueden correr. En vez de
    -- desaparecer (que se lee como «ok»), sale una fila por verificación en «pendiente de configuración». No se
    -- resuelve con nota: se resuelve cargando club_config.promo_articulo_codigo.
    select x.tipo, 'config:promo_articulo_codigo', now(), null::text, 'pendiente_configuracion',
           jsonb_build_object('estado', 'pendiente_configuracion', 'falta', 'promo_articulo_codigo',
                              'texto', 'Falta el código del artículo «PROMO CLUB 10%» del PoS: esta verificación no corre hasta cargarlo')
      from (values ('PROMO_SIN_CUPON'), ('CUPON_SIN_PROMO')) x(tipo)
     where v_cfg.promo_articulo_codigo is null
    union all
    -- TARJETA_MANUAL (CLUB-AUD-26): toda tarjeta física cargada a mano. Siempre visible; no la resuelve quien la cargó.
    select 'TARJETA_MANUAL', m.id::text, m.fecha_visita, rf.ref_factura, 'exacta',
           jsonb_build_object('movimiento', 'tarjeta_manual', 'personas', m.personas, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'cargada_por', (select p.full_name from public.profiles p where p.id = m.registrado_por),
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv0 m join public.club_miembros mi on mi.id = m.miembro_id
      left join lateral (select coalesce(m.factura_pos,
                    case m.pos_ref->>'modo'
                      when 'pedido'  then concat('pedido ', m.pos_ref->>'pedido', coalesce(' · área ' || (m.pos_ref->>'area'), ''),
                                                 coalesce(' · mesa ' || (m.pos_ref->>'mesa'), ''))
                      when 'factura' then m.pos_ref->>'numero_factura' end) as ref_factura) rf on true
     where m.tipo = 'tarjeta' and m.cupon_id is null and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
    union all
    -- CANJE_SIN_CODIGO (R-01): canje sin celular aprobado por owner o manager. Siempre visible; no lo resuelve quien lo aprobó.
    select 'CANJE_SIN_CODIGO', m.id::text, m.fecha_visita, coalesce(m.factura_pos, m.pos_ref->>'numero_factura', 'pedido ' || (m.pos_ref->>'pedido')), 'exacta',
           jsonb_build_object('movimiento', 'canje', 'creditos', m.creditos, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'motivo', substr(m.nota, length('Canje aprobado sin código: ') + 1),
                              'aprobado_por', (select p.full_name from public.profiles p where p.id = m.registrado_por),
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv0 m join public.club_miembros mi on mi.id = m.miembro_id
     where m.tipo = 'canje' and m.nota like 'Canje aprobado sin código:%' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
    union all
    -- ═══ LC-A5 ═══
    -- LC_SIN_REGISTRO: factura C con el 856 sin visita de socio que la cruce
    select 'LC_SIN_REGISTRO', 'lc:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulos', (select jsonb_agg(distinct ln.codigo_producto) from ln where ln.ticket_id = t.id and ln.es_lc),
                              'mesa', t.mesa, 'total_crc', t.total_crc, 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where t.estado = 'C' and t.f < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.es_lc)
       and not exists (select 1 from vs where t.id = any(vs.ticket_ids))
    union all
    -- REGISTRO_LC_SIN_856: visita con beneficio cuya factura (ya cruzada) no tiene el 856
    select 'REGISTRO_LC_SIN_856', 'visita:' || v.id, v.registrada_en, t.numero_factura, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'beneficio', v.aplicar->>'texto',
                              'registradores', jsonb_build_array(v.registrado_por))
      from vs v join public.club_miembros mi on mi.id = v.miembro_id
      join public.pos_ndf_tickets t on t.id = v.ticket_ids[1]
     where v.registrada_en >= v_ini and v.registrada_en < v_fin and cardinality(v.ticket_ids) > 0
       and v.estado_beneficio = 'aplica' and t.estado = 'C'
       and not exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = any(v.ticket_ids)
                         and l.codigo_producto in (v_cfg.lc_articulo_codigo, v_cfg.lc_invitado_codigo))
    union all
    -- CANJE_CON_DESCUENTO: pagada con créditos y con 856, PROMO CLUB o una cortesía
    select 'CANJE_CON_DESCUENTO', 'canje-desc:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('cxc_crc', t.cxc, 'turno', t.turno, 'pos_logins', to_jsonb(t.pos_logins), 'logins_fijos', to_jsonb(t.logins_fijos), 'con', (select jsonb_agg(distinct case when ln.es_lc then 'LC' when ln.es_promo then 'PROMO'
                                                                                   when ln.marcador is not null then ln.marcador else 'cortesia' end)
                                                      from ln where ln.ticket_id = t.id and (ln.es_lc or ln.es_promo or ln.marcador is not null or ln.es_cortesia or ln.es_seccion)),
                              'registradores', (select coalesce(jsonb_agg(distinct m.registrado_por), '[]'::jsonb) from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids)))
      from tk t
     where t.estado = 'C'
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and (t.cxc > 0 or exists (select 1 from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids)))
       and exists (select 1 from ln where ln.ticket_id = t.id and (ln.es_lc or ln.es_promo or ln.marcador is not null or ln.es_cortesia or ln.es_seccion))
    union all
    -- DESCUENTO_SIN_RESPALDO (ver el encabezado): una por factura, la línea con más descuento
    (select distinct on (c.tid) 'DESCUENTO_SIN_RESPALDO', 'desc:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('articulo', c.cod, 'nombre', c.nombre, 'precio', c.u, 'referencia', c.ref,
                              'descuento_pct', round(100 * (1 - c.u / c.ref), 1), 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos),
                              'marcador_pct', to_jsonb(c.mk_pcts),
                              -- (08-nov) monto estimado de la línea y su CLASIFICACIÓN: el tipo por porcentaje más cercano del local
                              -- (±1,5 puntos). Sin tipo = «sin clasificar», la alarma real.
                              'descuento_crc', round((c.ref - c.u) * c.q),
                              'clasificacion', (select dt.nombre from public.club_descuentos_tipo dt
                                                 where dt.location_id = p_location and dt.activo
                                                   and abs(100 * (1 - c.u / c.ref) - dt.pct) <= 1.5
                                                 order by abs(100 * (1 - c.u / c.ref) - dt.pct), dt.pct limit 1))
      from (select k.*, r.ref
              from dcand k
              join dref r on r.cod = k.cod and r.dia = k.dia
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(q.n) filter (where q.u <= k.u * 1.001)::numeric / nullif(sum(q.n), 0)
                      from ddia q where q.cod = k.cod and q.dia = k.dia) < 0.6
               -- LC-MD: con un marcador de % esperado, el descuento que coincide (±1,5 puntos) está respaldado
               and (k.mk_pcts is null or not exists (select 1 from unnest(k.mk_pcts) x(p)
                                                       where abs(100 * (1 - k.u / r.ref) - x.p) <= 1.5))) c
      join tk t on t.id = c.tid
     order by c.tid, c.u / c.ref)
    union all
    -- SOCIO_USO_ANOMALO: dos mesas el mismo día. CLUB COMPARTIDO (08-nov): cuenta las visitas del socio en TODOS los
    -- locales (vsa) y sale en cada local donde tuvo una de esas visitas; dice en qué locales.
    select 'SOCIO_USO_ANOMALO', 'socio-dia:' || v.miembro_id || ':' || v.fecha, min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'dos mesas el mismo día',
                              'mesas', jsonb_agg(distinct v.pos_ref->>'mesa'), 'locales', jsonb_agg(distinct v.location_id),
                              'registradores', jsonb_agg(distinct v.registrado_por))
      from vsa v join public.club_miembros mi on mi.id = v.miembro_id
     where v.registrada_en >= v_ini and v.registrada_en < v_fin
     group by v.miembro_id, v.fecha
    having count(distinct v.location_id || ':' || coalesce(v.pos_ref->>'mesa', v.visita_clave)) > 1
       and bool_or(v.location_id = p_location)
    union all
    -- SOCIO_USO_ANOMALO: más de N visitas en la semana (en todos los locales)
    select 'SOCIO_USO_ANOMALO', 'socio-semana:' || v.miembro_id || ':' || to_char(v.fecha, 'IYYY-IW'), min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'muchas visitas en la semana',
                              'visitas', count(*), 'maximo', v_cfg.socio_visitas_semana_max, 'locales', jsonb_agg(distinct v.location_id),
                              'registradores', jsonb_agg(distinct v.registrado_por))
      from vsa v join public.club_miembros mi on mi.id = v.miembro_id
     where v.registrada_en >= v_ini and v.registrada_en < v_fin
     group by v.miembro_id, to_char(v.fecha, 'IYYY-IW')
    having count(*) > v_cfg.socio_visitas_semana_max and bool_or(v.location_id = p_location)
    union all
    -- CUPON_AUTOREFERIDO: cupón usado en una visita (misma clave o misma factura) donde su anfitrión es socio
    select 'CUPON_AUTOREFERIDO', 'autoref:' || m.id, m.fecha_visita, m.ref_factura, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'personas', m.personas,
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv m join public.club_miembros mi on mi.id = m.miembro_id
     where m.tipo = 'tarjeta' and m.cupon_id is not null and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and exists (select 1 from vs where vs.miembro_id = m.miembro_id
                    and (vs.visita_clave = m.visita_clave or vs.ticket_ids && m.ticket_ids))
    union all
    -- CORTESIA_DISTINTA: en las facturas de la visita, un artículo de la sección distinto del sorteado, o más
    select 'CORTESIA_DISTINTA', 'cort-dist:' || v.id, v.registrada_en, null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre),
                              'sorteadas', (select coalesce(jsonb_agg(x->>'codigo'), '[]'::jsonb) from jsonb_array_elements(v.cortesias) x),
                              'cobradas', (select jsonb_agg(ln.codigo_producto) from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion),
                              'registradores', jsonb_build_array(v.registrado_por))
      from vs v join public.club_miembros mi on mi.id = v.miembro_id
     where (select ok from seccion_ok) and v.registrada_en >= v_ini and v.registrada_en < v_fin and cardinality(v.ticket_ids) > 0
       and ((select count(*) from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion) > jsonb_array_length(v.cortesias)
            or exists (select 1 from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion
                        and ln.codigo_producto not in (select x->>'codigo' from jsonb_array_elements(v.cortesias) x)))
    union all
    -- CORTESIA_SIN_SOCIO: artículo de la sección en una factura sin visita de socio
    select 'CORTESIA_SIN_SOCIO', 'cort-sin-socio:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulos', (select jsonb_agg(ln.codigo_producto) from ln where ln.ticket_id = t.id and ln.es_seccion), 'mesa', t.mesa,
                              'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where (select ok from seccion_ok) and t.estado = 'C' and t.f < now() - make_interval(mins => v_cfg.puente_latencia_min)
       -- (08-nov) la sección se usa también fuera del Club hasta el lanzamiento: cuenta SOLO desde lc_excepciones_desde
       and v_cfg.lc_excepciones_desde is not null and t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica'
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.es_seccion)
       and not exists (select 1 from vs where t.id = any(vs.ticket_ids))
    union all
    -- CORTESIA_NO_CONFIGURADA: línea a ₡0 fuera de la sección (ni PAX, ni LC, ni PROMO, ni las permitidas)
    select 'CORTESIA_NO_CONFIGURADA', 'cort-nc:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('articulos', (select jsonb_agg(jsonb_build_object('codigo', ln.codigo_producto, 'nombre', ln.nombre))
                                              from ln where ln.ticket_id = t.id and ln.monto = 0 and ln.cantidad > 0 and not ln.es_pax
                                               and not ln.es_seccion and not ln.es_lc and not ln.es_promo
                                               and not (coalesce(ln.codigo_producto, '') = any(v_cfg.articulos_cero_permitidos))),
                              'mesa', t.mesa, 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where (select ok from seccion_ok) and t.estado = 'C'
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.monto = 0 and ln.cantidad > 0 and not ln.es_pax
                    and not ln.es_seccion and not ln.es_lc and not ln.es_promo
                    and not (coalesce(ln.codigo_producto, '') = any(v_cfg.articulos_cero_permitidos)))
    union all
    -- Sin la sección configurada, las tres de cortesía no pueden correr: «pendiente de configuración» (nunca «ok»)
    select x.tipo, 'config:cortesia_club', now(), null::text, 'pendiente_configuracion',
           jsonb_build_object('estado', 'pendiente_configuracion', 'falta', 'cortesia_familia',
                              'texto', 'Falta la sección «CORTESÍA CLUB» del PoS (familia o artículos): esta verificación no corre hasta cargarla')
      from (values ('CORTESIA_DISTINTA'), ('CORTESIA_SIN_SOCIO'), ('CORTESIA_NO_CONFIGURADA')) x(tipo)
     where not (select ok from seccion_ok)
    union all
    -- ANFITRION_SOBRE_TOPE: ganado en el mes (tarjetas + pendientes) por encima del tope
    select 'ANFITRION_SOBRE_TOPE', 'tope:' || g.miembro_id || ':' || to_char(g.mes, 'YYYY-MM'), g.ultimo, null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'mes', to_char(g.mes, 'YYYY-MM'),
                              'ganado_crc', round(g.personas * v_cfg.valor_credito_crc / v_cfg.personas_por_credito),
                              'tope_crc', v_cfg.anfitrion_tope_mes_crc, 'pendientes', g.pend,
                              'registradores', coalesce(to_jsonb(g.regs), '[]'::jsonb))
      from (select x.miembro_id, x.mes, sum(x.personas) as personas, sum(x.pend) as pend, max(x.f) as ultimo,
                   array_remove(array_agg(distinct x.reg), null) as regs
              from (select m.miembro_id, date_trunc('month', m.fecha_visita at time zone 'America/Costa_Rica') as mes, m.personas, 0 as pend, m.fecha_visita as f,
                           m.registrado_por as reg
                      from public.club_movimientos m
                     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
                    union all
                    select pp.miembro_id, date_trunc('month', pp.fecha_visita at time zone 'America/Costa_Rica'), pp.personas, pp.personas, pp.fecha_visita,
                           pp.registrado_por
                      from public.club_personas_pendientes pp
                     where pp.location_id = p_location and pp.estado = 'pendiente' and pp.fecha_visita >= v_ini and pp.fecha_visita < v_fin) x
             group by x.miembro_id, x.mes) g
      join public.club_miembros mi on mi.id = g.miembro_id
     where v_cfg.anfitrion_tope_mes_crc > 0
       and g.personas * v_cfg.valor_credito_crc / v_cfg.personas_por_credito > v_cfg.anfitrion_tope_mes_crc
    union all
    -- SOCIO_ALTA_SIN_CONFIRMAR: alta provisional que nadie distinto confirmó (vigente o ya vencida)
    select 'SOCIO_ALTA_SIN_CONFIRMAR', 'alta:' || r.miembro_id, coalesce(r.validado_en, r.desde), null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'alta_por', r.alta_por, 'estado', r.estado,
                              'provisional_hasta', r.provisional_hasta,
                              'cargada_por', (select p.full_name from public.profiles p where p.id = r.registrado_por),
                              'registradores', jsonb_build_array(r.registrado_por))
      from public.club_miembro_roles r join public.club_miembros mi on mi.id = r.miembro_id
     where mi.location_id = p_location and r.rol = 'socio' and r.registrado_por is not null and r.confirmado_en is null
       and r.estado in ('activo','pendiente') and coalesce(r.validado_en, r.desde) >= v_ini and coalesce(r.validado_en, r.desde) < v_fin
  ),
  -- LC-A5: con p_tipo, solo esa verificación (el planificador descarta las otras ramas; lo usa la segregación)
  ex as (select * from ex0 where p_tipo is null or ex0.tipo = p_tipo)
  select ex.tipo, ex.ref, ex.fecha, ex.factura, ex.certeza,
         ex.detalle || case when r.id is null then '{}'::jsonb
                            else jsonb_build_object('resuelta_por', (select p.full_name from public.profiles p where p.id = r.resuelto_por)) end,
         r.id is not null, r.nota, r.resuelto_en
    from ex
    left join lateral (select x.* from public.club_excepciones_resueltas x
                        where x.location_id = p_location and x.tipo = ex.tipo and x.ref = ex.ref
                        order by x.resuelto_en desc, x.id desc limit 1) r on true
   order by ex.fecha desc;
end;
$$;

-- Cantidad de excepciones abiertas de los últimos N días (contador de la tarjeta Club). owner, manager.
create or replace function public.club_excepciones_abiertas(p_dias int default 30, p_location text default null)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.club_excepciones(((now() at time zone 'America/Costa_Rica')::date - least(greatest(coalesce(p_dias, 30), 1), 400)),
                                 (now() at time zone 'America/Costa_Rica')::date, p_location) e
   where not e.resuelta
     -- (08-nov) un descuento de un tipo conocido no es alarma: solo cuentan los «sin clasificar»
     and not (e.tipo = 'DESCUENTO_SIN_RESPALDO' and e.detalle->>'clasificacion' is not null);
$$;

-- Segregación (CLUB-AUD-25): quien registró el movimiento no resuelve su excepción; la resuelve el owner.
-- TARJETA_MANUAL y CANJE_SIN_CODIGO: no las resuelve quien las cargó o aprobó, ni siquiera si es el owner.
create or replace function public.club_excepcion_segregacion(p_tipo text, p_ref text, p_location text, p_rol public.user_role)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_reg jsonb; v_hay boolean; v_logins jsonb; v_mapeados uuid[]; v_sin_mapa boolean; v_fijos jsonb; v_turno text;
begin
  -- CLUB-AUD-36: la excepción tiene que figurar HOY en club_excepciones (ventana de 120 días hasta hoy). Así nadie
  -- «pre-resuelve» un (tipo, ref) que todavía no existe ni resuelve algo inventado.
  select true, e.detalle->'registradores', e.detalle->'pos_logins', e.detalle->'logins_fijos', e.detalle->>'turno'
    into v_hay, v_reg, v_logins, v_fijos, v_turno
    from public.club_excepciones((now() at time zone 'America/Costa_Rica')::date - 120,
                                 (now() at time zone 'America/Costa_Rica')::date, p_location, p_tipo) e
   where e.tipo = p_tipo and e.ref = p_ref
   limit 1;
  if v_hay is null then
    raise exception 'Esa excepción no figura hoy en la lista: actualizá la pantalla' using errcode = 'P0001';
  end if;
  -- LC-A5 (Ismael, 08-nov): las que salen solo del PoS se segregan por quien COBRÓ la factura en el PoS (cajero o salonero),
  -- con su login mapeado al empleado (employees.pos_login → profile_id). El manager la resuelve si NO es esa persona; si
  -- algún login de la factura no está mapeado (o no hay login), la resuelve el owner.
  if p_tipo in ('LC_SIN_REGISTRO','DESCUENTO_SIN_RESPALDO','CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA') and p_rol <> 'owner' then
    -- (08-nov) con un login FIJO de caja no hay una persona detrás: la resuelve el owner (que identifica por fecha y turno)
    if jsonb_array_length(coalesce(v_fijos, '[]'::jsonb)) > 0 then
      raise exception 'Esta factura se cobró con un login fijo de caja (%, turno %): la resuelve el owner',
        (select string_agg(x, ', ') from jsonb_array_elements_text(v_fijos) x), coalesce(v_turno, '—') using errcode = 'P0001';
    end if;
    select array_agg(e.profile_id) filter (where e.profile_id is not null),
           coalesce(bool_or(e.profile_id is null), true) or jsonb_array_length(coalesce(v_logins, '[]'::jsonb)) = 0
      into v_mapeados, v_sin_mapa
      from jsonb_array_elements_text(coalesce(v_logins, '[]'::jsonb)) l(login)
      left join public.employees e on e.pos_login = l.login;
    if v_sin_mapa then
      raise exception 'Esta excepción sale del PoS y quien cobró la factura no tiene su login del PoS cargado en Empleados: la resuelve el owner'
        using errcode = 'P0001';
    end if;
    if auth.uid() = any(v_mapeados) then
      raise exception 'Esta factura la cobraste vos en el PoS: la resuelve otro manager o el owner' using errcode = 'P0001';
    end if;
  end if;
  -- La segregación es por el REGISTRANTE del movimiento (registradores = registrado_por de los movimientos).
  if v_reg is null or jsonb_typeof(v_reg) <> 'array' or auth.uid() is null or not (v_reg ? auth.uid()::text) then
    return;
  end if;
  if p_tipo in ('TARJETA_MANUAL', 'CANJE_SIN_CODIGO') then
    raise exception 'No podés resolver una excepción de un registro tuyo: la resuelve otra persona' using errcode = 'P0001';
  end if;
  if p_rol <> 'owner' then
    raise exception 'Esta excepción es de un registro tuyo: la resuelve el owner' using errcode = 'P0001';
  end if;
end;
$$;

-- Resolver una excepción con nota (owner, manager). No modifica el libro.
create or replace function public.club_excepcion_resolver(p_tipo text, p_ref text, p_nota text, p_location text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_nota text := btrim(coalesce(p_nota, ''));
  v_ref  text := btrim(coalesce(p_ref, ''));
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('PROMO_SIN_CUPON','CREDITOS_SIN_CANJE','CANJE_MONTO_DISTINTO','REGISTRO_SIN_FACTURA','SIN_CRUCE',
                                      'VISITA_REPETIDA','PERSONAS_SOBRE_PAX','AMBIGUA','CUPON_SIN_PROMO','TARJETA_MANUAL','CANJE_SIN_CODIGO',
                                      'LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','CANJE_CON_DESCUENTO','DESCUENTO_SIN_RESPALDO','SOCIO_USO_ANOMALO','CUPON_AUTOREFERIDO','CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA','ANFITRION_SOBRE_TOPE','SOCIO_ALTA_SIN_CONFIRMAR') then
    raise exception 'Tipo de excepción no válido' using errcode = 'P0001';
  end if;
  if length(v_ref) not between 1 and 100 then
    raise exception 'Referencia no válida' using errcode = 'P0001';
  end if;
  if length(v_nota) not between 1 and 500 then
    raise exception 'La nota es obligatoria (hasta 500 caracteres)' using errcode = 'P0001';
  end if;
  if v_ref like 'config:%' then
    raise exception 'Pendiente de configuración: se resuelve cargando el código del artículo de la promo, no con una nota' using errcode = 'P0001';
  end if;
  perform public.club_excepcion_segregacion(p_tipo, v_ref, p_location, v_rol);
  -- CLUB-AUD-25: cada resolución es una fila nueva (historial); la vigente es la última.
  insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota, resuelto_por)
  values (p_location, p_tipo, v_ref, v_nota, auth.uid());
  return true;
end;
$$;

-- SIN_CRUCE: facturas candidatas para un registro con pedido que no cruzó solo. owner, manager.
--   · sin búsqueda: las facturas SIN PEDIDO del día del escaneo (desde las 00:00 CR de ese día hasta
--     18 h después del escaneo, así entra una cuenta cobrada después de medianoche), primero las de
--     la misma mesa.
--   · con `p_buscar` (los últimos dígitos del consecutivo del tiquete, de 3 a 20): cualquier factura
--     cerrada cuyo consecutivo termine así, desde el día anterior al escaneo hasta 18 h después.
-- `asignada_a_otro`: ya la eligieron para otro registro (puede pasar: cupón y canje de la misma mesa).
drop function if exists public.club_sin_cruce_candidatas(uuid);
drop function if exists public.club_sin_cruce_candidatas(uuid, text);   -- cambió el tipo de retorno (área)
create or replace function public.club_sin_cruce_candidatas(p_movimiento uuid, p_buscar text default null)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, consecutivo_fe text,
               misma_mesa boolean, asignada_a_otro boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  m      public.club_movimientos%rowtype;
  v_hora timestamptz;
  v_dia  timestamptz;
  v_mesa text;
  v_area text;
  v_bus  text := nullif(regexp_replace(coalesce(p_buscar, ''), '\D', '', 'g'), '');
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into m from public.club_movimientos x where x.id = p_movimiento;
  if not found or coalesce(m.pos_ref->>'modo', '') <> 'pedido' then
    raise exception 'Registro no encontrado o sin pedido' using errcode = 'P0001';
  end if;
  if v_bus is not null and length(v_bus) not between 3 and 20 then
    raise exception 'Escribí entre 3 y 20 dígitos del consecutivo' using errcode = 'P0001';
  end if;
  v_hora := (m.pos_ref->>'hora')::timestamptz;
  v_dia  := date_trunc('day', v_hora at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  v_mesa := nullif(ltrim(upper(btrim(coalesce(m.pos_ref->>'mesa', ''))), '0'), '');
  v_area := upper(btrim(coalesce(m.pos_ref->>'area', '')));
  return query
    select t.numero_factura, t.fecha_registra, t.total_crc,
           nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
           nullif(nullif(upper(btrim(coalesce(t.mesa_factura, t.mesa, ''))), ''), '0'),
           t.consecutivo_fe,
           v_mesa is not null and nullif(ltrim(upper(btrim(coalesce(t.mesa_factura, t.mesa, ''))), '0'), '') = v_mesa
             and (v_area = '' or upper(btrim(coalesce(t.area_factura, t.area, ''))) = v_area),
           exists (select 1 from public.club_cruces_manuales c
                    where c.numero_factura = t.numero_factura and c.location_id = m.location_id and c.movimiento_id <> m.id)
      from public.pos_ndf_tickets t
     where t.local = m.location_id and t.estado = 'C'
       and t.fecha_registra < v_hora + interval '18 hours'
       and case when v_bus is null
                then t.numero_pedido is null and t.fecha_registra >= v_dia
                else t.consecutivo_fe like '%' || v_bus and t.fecha_registra >= v_dia - interval '1 day' end
     order by 7 desc, t.fecha_registra, t.numero_factura
     limit 200;
end;
$$;

-- SIN_CRUCE: el manager elige la factura. Queda anotado quién y cuándo (club_cruces_manuales) y la
-- excepción queda resuelta con la nota «Factura N elegida». Se puede corregir eligiendo otra.
-- No toca el libro ni el saldo.
create or replace function public.club_sin_cruce_elegir(p_movimiento uuid, p_numero_factura text, p_nota text default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  m      public.club_movimientos%rowtype;
  v_nf   text := btrim(coalesce(p_numero_factura, ''));
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if v_nota is not null and length(v_nota) > 400 then
    raise exception 'La nota es de hasta 400 caracteres' using errcode = 'P0001';
  end if;
  select * into m from public.club_movimientos x where x.id = p_movimiento;
  if not found or coalesce(m.pos_ref->>'modo', '') <> 'pedido' then
    raise exception 'Registro no encontrado o sin pedido' using errcode = 'P0001';
  end if;
  if cardinality(public.club_cruce_facturas(m.location_id, m.pos_ref, m.factura_pos)) > 0 then
    raise exception 'Este registro ya cruzó con su factura' using errcode = 'P0001';
  end if;
  -- Tiene que ser una factura cerrada de la ventana de las candidatas (del día anterior al escaneo
  -- hasta 18 h después): sin pedido de ese día, o encontrada por el consecutivo.
  if not exists (select 1 from public.pos_ndf_tickets t
                  where t.local = m.location_id and t.estado = 'C' and t.numero_factura = v_nf
                    and t.fecha_registra >= (date_trunc('day', (m.pos_ref->>'hora')::timestamptz at time zone 'America/Costa_Rica')
                                             at time zone 'America/Costa_Rica') - interval '1 day'
                    and t.fecha_registra < (m.pos_ref->>'hora')::timestamptz + interval '18 hours') then
    raise exception 'Esa factura no está en la lista (fuera de la fecha del registro o no está cerrada)' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-25: quien registró el movimiento no elige su factura (lo hace el owner).
  if m.registrado_por = auth.uid() and v_rol <> 'owner' then
    raise exception 'Esta excepción es de un registro tuyo: la resuelve el owner' using errcode = 'P0001';
  end if;

  insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura, elegido_por, elegido_en, nota)
  values (m.id, m.location_id, v_nf, auth.uid(), now(), v_nota)
  on conflict (movimiento_id) do update
    set numero_factura = excluded.numero_factura, elegido_por = excluded.elegido_por,
        elegido_en = excluded.elegido_en, nota = excluded.nota;
  insert into public.club_cruces_manuales_historial (movimiento_id, location_id, numero_factura, elegido_por, nota)
  values (m.id, m.location_id, v_nf, auth.uid(), v_nota);

  insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota, resuelto_por)
  values (m.location_id, 'SIN_CRUCE', m.id::text, concat('Factura ', v_nf, ' elegida', ' · ' || v_nota), auth.uid());
  return v_nf;
end;
$$;

-- CLUB-AUD-04 (opción A, decisión de Ismael): el reporte de un mes CERRADO se congela. Tabla de solo
-- inserción con el JSON y su sha256; un recierre es una versión nueva con motivo. club_reporte_mes
-- devuelve la última versión si existe. Nadie la edita ni la borra desde la app.
create table if not exists public.club_reportes_cerrados (
  id           bigint generated always as identity primary key,
  location_id  text not null,
  mes          date not null check (mes = date_trunc('month', mes)::date),
  version      int not null check (version >= 1),
  datos        jsonb not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  motivo       text check (motivo is null or length(motivo) <= 500),
  cerrado_por  uuid,
  cerrado_en   timestamptz not null default now(),
  unique (location_id, mes, version)
);
-- CLUB-AUD-16: encadenado (el hash de cada cierre incluye el del anterior del local) e inmutable: ni
-- UPDATE, ni DELETE, ni TRUNCATE, tampoco para el dueño de la tabla. Para corregir hay que borrar el
-- trigger, y eso queda en el log de DDL.
alter table public.club_reportes_cerrados add column if not exists sha256_prev text
  check (sha256_prev is null or sha256_prev ~ '^[0-9a-f]{64}$');
create or replace function public.club_reportes_cerrados_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Los cierres de mes son inmutables: para corregir se recierra (versión nueva con motivo)'
    using errcode = 'P0001';
end;
$$;
drop trigger if exists club_reportes_cerrados_inmutable_trg on public.club_reportes_cerrados;
create trigger club_reportes_cerrados_inmutable_trg before update or delete on public.club_reportes_cerrados
  for each row execute function public.club_reportes_cerrados_inmutable();
drop trigger if exists club_reportes_cerrados_truncate_trg on public.club_reportes_cerrados;
create trigger club_reportes_cerrados_truncate_trg before truncate on public.club_reportes_cerrados
  for each statement execute function public.club_reportes_cerrados_inmutable();
alter table public.club_reportes_cerrados enable row level security;
revoke all on public.club_reportes_cerrados from public, anon, authenticated;
grant select on public.club_reportes_cerrados to authenticated;
drop policy if exists club_rep_cerr_sel on public.club_reportes_cerrados;
create policy club_rep_cerr_sel on public.club_reportes_cerrados for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- Reporte mensual (owner, manager). JSON sin teléfonos ni emails. `p_vivo` = recalcular aunque el mes
-- esté cerrado (lo usa club_reporte_cerrar; la pantalla muestra el congelado).
drop function if exists public.club_reporte_mes(date, text);
create or replace function public.club_reporte_mes(p_mes date, p_location text default null, p_vivo boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_cfg  public.club_config%rowtype;
  v_mes  date;
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_pini timestamptz;   -- mes anterior
  v_3ini timestamptz;   -- 3 meses previos
  r      jsonb;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  v_mes  := date_trunc('month', coalesce(p_mes, now()::date))::date;
  -- Mes cerrado → la última versión congelada (CLUB-AUD-04).
  select rc.datos || jsonb_build_object('cerrado', true, 'version', rc.version, 'sha256', rc.sha256,
                                        'sha256_prev', rc.sha256_prev, 'cerrado_en', rc.cerrado_en, 'motivo', rc.motivo,
                                        'generado_en', rc.cerrado_en)   -- fuera del hash (CLUB-AUD-16)
    into r
    from public.club_reportes_cerrados rc
   where rc.location_id = p_location and rc.mes = v_mes and not coalesce(p_vivo, false)
   order by rc.version desc limit 1;
  if r is not null then
    return r;
  end if;
  v_ini  := v_mes::timestamp at time zone 'America/Costa_Rica';
  v_fin  := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';
  v_pini := (v_mes - interval '1 month')::timestamp at time zone 'America/Costa_Rica';
  v_3ini := (v_mes - interval '3 months')::timestamp at time zone 'America/Costa_Rica';

  with mi as (
    select m.id, m.tipo, m.estado, public.club_nombre_limpio(m.nombre) as nombre, n.nombre as negocio
      from public.club_miembros m left join public.club_negocios n on n.id = m.negocio_id
     where m.location_id = p_location and m.tipo in ('referente','concierge_pm','equipo')),
  mv as (select v.* from public.club_movimientos v join mi on mi.id = v.miembro_id where v.fecha_visita < v_fin),
  por_m as (
    select mi.id, mi.tipo, mi.estado, mi.nombre, mi.negocio,
           coalesce(sum(v.personas), 0)::int as saldo_p,
           coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_ini), 0)::int as pers_mes,
           count(*) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_ini)::int as t_mes,
           coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_3ini and v.fecha_visita < v_ini), 0) / 3.0 as prom3,
           max(v.fecha_visita) filter (where v.tipo in ('tarjeta','canje','restitucion')) as ult,
           min(v.fecha_visita) filter (where v.tipo = 'tarjeta') as primera
      from mi left join mv v on v.miembro_id = mi.id
     group by 1,2,3,4,5),
  pm as (select p.*, public.club_creditos(greatest(p.saldo_p, 0), v_cfg.personas_por_credito) as cr from por_m p),
  k as (
    select
      count(*) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_ini)                              as tarjetas,
      coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_ini), 0)          as personas,
      count(*) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini)                                as canjes,
      coalesce(sum(v.creditos) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini), 0)            as creditos_canjeados,
      coalesce(sum(v.creditos * v.valor_credito_crc) filter (where v.tipo = 'canje' and v.fecha_visita >= v_ini), 0) as valor_canjeado_crc,
      coalesce(-sum(v.personas) filter (where v.tipo = 'vencimiento' and v.fecha_visita >= v_ini), 0)     as personas_vencidas,
      count(*) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini)  as tarjetas_ant,
      coalesce(sum(v.personas) filter (where v.tipo = 'tarjeta' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini), 0) as personas_ant,
      count(*) filter (where v.tipo = 'canje' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini)    as canjes_ant,
      coalesce(sum(v.creditos) filter (where v.tipo = 'canje' and v.fecha_visita >= v_pini and v.fecha_visita < v_ini), 0) as creditos_canjeados_ant
    from mv v),
  fila as (select p.*, jsonb_build_object('nombre', p.nombre, 'negocio', p.negocio, 'tipo', p.tipo) as base from pm p)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location,
    'local_nombre', (select coalesce(c.nombre, c.location_id) from public.club_config c where c.location_id = p_location),   -- LC-ML
    'generado_en', now(),
    'config', jsonb_build_object('valor_credito_crc', v_cfg.valor_credito_crc, 'personas_por_credito', v_cfg.personas_por_credito,
                                 'vencimiento_meses', v_cfg.vencimiento_meses, 'pm_pausado', v_cfg.pm_pausado),
    -- Club compartido (08-nov): visitas de socios en ESTE local (donde ocurrieron), de cuántos socios, y cuántas de socios
    -- que se anotaron en otro local; altas hechas en este local.
    'socios', (select jsonb_build_object(
        'visitas', count(*), 'socios', count(distinct vs.miembro_id),
        'con_beneficio', count(*) filter (where vs.estado_beneficio in ('aplica','pendiente_configuracion')),
        'de_otro_local', count(*) filter (where m.location_id <> p_location),
        'socios_de_otro_local', count(distinct vs.miembro_id) filter (where m.location_id <> p_location),
        'altas', (select count(*) from public.club_miembro_roles rr join public.club_miembros mm on mm.id = rr.miembro_id
                   where rr.rol = 'socio' and mm.location_id = p_location and rr.desde >= v_ini and rr.desde < v_fin))
      from public.club_visitas_socio vs join public.club_miembros m on m.id = vs.miembro_id
     where vs.location_id = p_location and vs.registrada_en >= v_ini and vs.registrada_en < v_fin),
    'kpis', (select jsonb_build_object(
        'tarjetas', k.tarjetas, 'personas', k.personas,
        'creditos_generados', round(k.personas::numeric / v_cfg.personas_por_credito, 1),
        'canjes', k.canjes, 'creditos_canjeados', k.creditos_canjeados, 'valor_canjeado_crc', k.valor_canjeado_crc,
        'personas_vencidas', k.personas_vencidas,
        'referentes_con_visitas', (select count(*) from pm where pm.tipo <> 'equipo' and pm.t_mes > 0),
        'cupones_generados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.creado_en >= v_ini and c.creado_en < v_fin),
        'cupones_usados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.usado_en >= v_ini and c.usado_en < v_fin),
        'saldo_creditos_al_cierre', (select coalesce(sum(cr), 0) from pm),
        'cuentas_con_saldo', (select count(*) from pm where pm.cr > 0),
        'anterior', jsonb_build_object('tarjetas', k.tarjetas_ant, 'personas', k.personas_ant, 'canjes', k.canjes_ant,
                                       'creditos_canjeados', k.creditos_canjeados_ant)) from k),
    'ranking', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'tarjetas', f.t_mes, 'prom_3m', round(f.prom3, 1))
                                          order by f.pers_mes desc, f.nombre), '[]') from (select * from fila where tipo <> 'equipo' and pers_mes > 0 order by pers_mes desc, nombre limit 10) f),
    'subiendo', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'prom_3m', round(f.prom3, 1), 'nuevo_ritmo', f.prom3 = 0)
                                           order by f.pers_mes - f.prom3 desc), '[]')
                   from (select * from fila where tipo <> 'equipo' and pers_mes > 0 and (prom3 = 0 or pers_mes > prom3 * 1.3)
                          order by pers_mes - prom3 desc limit 5) f),
    'bajando', (select coalesce(jsonb_agg(f.base || jsonb_build_object('personas', f.pers_mes, 'prom_3m', round(f.prom3, 1)) order by f.pers_mes - f.prom3), '[]')
                  from (select * from fila where tipo <> 'equipo' and prom3 > 0 and pers_mes < prom3 * 0.7 order by pers_mes - prom3 limit 5) f),
    'dormidos', (select jsonb_build_object('cuentas', count(*), 'creditos', coalesce(sum(cr), 0),
                   'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('creditos', x.cr, 'ultima_actividad', x.ult) order by x.cr desc)
                                        from (select * from fila where tipo <> 'equipo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')
                                               order by cr desc) x), '[]'))   -- lista completa: el PDF muestra 10, el CSV todas
                   from pm where tipo <> 'equipo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')),
    'a_contactar', (select coalesce(jsonb_agg(x.base || jsonb_build_object('creditos', x.cr, 'vence_en', x.vence) order by x.vence), '[]')
                      from (select f.*, f.ult + make_interval(months => v_cfg.vencimiento_meses) as vence from fila f
                             where f.tipo <> 'equipo' and f.cr > 0 and f.ult is not null
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) >= v_fin
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) < v_fin + interval '30 days'
                             order by vence limit 10) x),
    'nuevos', (select jsonb_build_object('cuentas', count(*),
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes) order by x.pers_mes desc)
                                      from (select * from fila where tipo <> 'equipo' and primera >= v_ini order by pers_mes desc limit 10) x), '[]'))
                 from pm where tipo <> 'equipo' and primera >= v_ini),
    'equipo', (select jsonb_build_object('personas_mes', coalesce(sum(pers_mes), 0), 'creditos', coalesce(sum(cr), 0),
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes, 'creditos', x.cr) order by x.cr desc, x.pers_mes desc)
                                      from (select * from fila where tipo = 'equipo' and (cr > 0 or pers_mes > 0)
                                             order by cr desc, pers_mes desc limit 10) x), '[]'))
                 from pm where tipo = 'equipo'),
    'antiguedad', (select coalesce(jsonb_agg(jsonb_build_object('tramo', b.tramo, 'cuentas', b.cuentas, 'creditos', b.creditos,
                                                               'valor_crc', b.creditos * v_cfg.valor_credito_crc) order by b.orden), '[]')
                     from (select case when ult >= v_fin - interval '3 months' then 1 when ult >= v_fin - interval '6 months' then 2
                                       when ult >= v_fin - interval '12 months' then 3 else 4 end as orden,
                                  case when ult >= v_fin - interval '3 months' then 'menos de 3 meses'
                                       when ult >= v_fin - interval '6 months' then '3 a 6 meses'
                                       when ult >= v_fin - interval '12 months' then '6 a 12 meses' else 'más de 12 meses' end as tramo,
                                  count(*) as cuentas, sum(cr) as creditos
                             from pm where cr > 0 group by 1, 2) b),
    'pm', jsonb_build_object(
        'pausado', v_cfg.pm_pausado,
        'nota', case when v_cfg.pm_pausado then 'Programa PM en pausa por temas contables: los montos son informativos.' else null end,
        -- CLUB-AUD-04: pendiente AL CIERRE por eventos, no por el estado de hoy: todo cargo creado antes
        -- del cierre cuenta, salvo el anulado antes del cierre; se restan los pagos hechos antes del cierre.
        -- Un cargo pagado después ya no le baja el pendiente a un mes cerrado.
        'pendiente_crc', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c join mi on mi.id = c.miembro_id
                           where c.created_at < v_fin
                             and not (c.estado = 'anulado' and coalesce(c.anulado_en, '-infinity') < v_fin))
                       - (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p join mi on mi.id = p.miembro_id
                           where p.pagado_en < v_fin),
        'cargos_mes_crc', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c join mi on mi.id = c.miembro_id
                            where c.created_at >= v_ini and c.created_at < v_fin),
        'pagos_mes_crc', (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p join mi on mi.id = p.miembro_id
                           where p.pagado_en >= v_ini and p.pagado_en < v_fin)),
    'calidad', (select jsonb_build_object('abiertas', coalesce(sum(e.n_ab), 0), 'resueltas', coalesce(sum(e.n_res), 0),
                                          'por_tipo', coalesce(jsonb_object_agg(e.tipo, e.n_ab) filter (where e.n_ab > 0), '{}'),
                                          'promo_activa', v_cfg.promo_articulo_codigo is not null)
                  from (select x.tipo, count(*) filter (where not x.resuelta) as n_ab, count(*) filter (where x.resuelta) as n_res
                          from public.club_excepciones(v_mes, (v_mes + interval '1 month' - interval '1 day')::date, p_location) x
                         group by x.tipo) e)
  ) into r;
  return r || jsonb_build_object('cerrado', false);
end;
$$;

-- Cerrar un mes (solo owner): congela el reporte con su sha256. Solo meses ya terminados (hora CR).
-- Recerrar = versión nueva, con motivo obligatorio. Devuelve lo congelado.
create or replace function public.club_reporte_cerrar(p_mes date, p_motivo text default null, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_mes    date := date_trunc('month', p_mes)::date;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ver    int;
  v_datos  jsonb;
  v_hash   text;
  v_prev   text;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if v_mes is null or v_mes >= date_trunc('month', (now() at time zone 'America/Costa_Rica'))::date then
    raise exception 'Solo se cierran meses terminados' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_cierre:' || p_location || ':' || v_mes, 0));
  select coalesce(max(rc.version), 0) + 1 into v_ver from public.club_reportes_cerrados rc
   where rc.location_id = p_location and rc.mes = v_mes;
  if v_ver > 1 and v_motivo is null then
    raise exception 'El mes ya está cerrado: para recerrarlo hace falta el motivo' using errcode = 'P0001';
  end if;
  if v_motivo is not null and length(v_motivo) > 500 then
    raise exception 'El motivo es de hasta 500 caracteres' using errcode = 'P0001';
  end if;
  -- CLUB-AUD-16: sin `generado_en` (así el hash se puede recomputar desde la fila) y encadenado con el
  -- último cierre del local (cualquier mes): sha256 = sha256(sha256_prev || datos).
  v_datos := public.club_reporte_mes(v_mes, p_location, true) - 'cerrado' - 'generado_en';
  perform pg_advisory_xact_lock(hashtextextended('club_cierre_cadena:' || p_location, 0));
  select rc.sha256 into v_prev from public.club_reportes_cerrados rc where rc.location_id = p_location order by rc.id desc limit 1;
  v_hash  := encode(extensions.digest(coalesce(v_prev, '') || v_datos::text, 'sha256'), 'hex');
  insert into public.club_reportes_cerrados (location_id, mes, version, datos, sha256, sha256_prev, motivo, cerrado_por)
  values (p_location, v_mes, v_ver, v_datos, v_hash, v_prev, v_motivo, auth.uid());
  return v_datos || jsonb_build_object('cerrado', true, 'version', v_ver, 'sha256', v_hash, 'sha256_prev', v_prev, 'motivo', v_motivo,
                                       'cerrado_en', now());   -- la pantalla muestra la fecha (sin generado_en: CLUB-AUD-16)
end;
$$;

-- CLUB-AUD-05 (opción a, decisión de Ismael): no se cambia personas_por_credito mientras haya saldos
-- vivos en el local. Los créditos se derivan de las personas con la tasa de hoy: cambiarla reescribiría
-- los créditos históricos. Para cambiarla hace falta una conversión explícita (fuera de alcance).
create or replace function public.club_config_tasa_guardia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.personas_por_credito is distinct from old.personas_por_credito
     and exists (select 1 from public.club_movimientos mv join public.club_miembros m on m.id = mv.miembro_id
                  where m.location_id = new.location_id
                  group by mv.miembro_id having sum(mv.personas) > 0) then
    raise exception 'No se puede cambiar la tasa (personas por crédito) con saldos vivos: requiere una conversión'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists club_config_tasa_guardia_trg on public.club_config;
create trigger club_config_tasa_guardia_trg before update on public.club_config
  for each row execute function public.club_config_tasa_guardia();


-- Piloto interno en paralelo (decisión de Ismael 07-nov): «Comparación con la página vieja». Por referente y
-- por semana (lunes, hora CR): personas cargadas en staging (tarjetas de la app: cupones y tarjeta física) al
-- lado de las de la página vieja, que carga Ismael (o un export). Sin datos de contacto. owner y manager.
create table if not exists public.club_comparacion_vieja (
  id           bigint generated always as identity primary key,
  location_id  text not null,
  semana       date not null check (extract(isodow from semana) = 1),
  miembro_id   uuid not null references public.club_miembros(id),
  personas     int not null check (personas between 0 and 10000),
  cargado_por  uuid,
  cargado_en   timestamptz not null default now(),
  unique (location_id, semana, miembro_id)
);
alter table public.club_comparacion_vieja enable row level security;
revoke all on public.club_comparacion_vieja from public, anon, authenticated;
grant select on public.club_comparacion_vieja to authenticated;
drop policy if exists club_comparacion_gerencia on public.club_comparacion_vieja;
create policy club_comparacion_gerencia on public.club_comparacion_vieja for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- Cargar las personas de la página vieja: [{referente | miembro_id, semana (AAAA-MM-DD, cualquier día), personas}].
-- El referente se busca por nombre exacto (sin tildes ni mayúsculas); si no hay uno solo, vuelve en `no_encontrados`.
create or replace function public.club_comparacion_cargar(p_filas jsonb, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  f      jsonb;
  v_id   uuid;
  v_sem  date;
  v_n    int := 0;
  v_no   jsonb := '[]'::jsonb;
  v_cand int;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 2000 then
    raise exception 'Filas no válidas (hasta 2000)' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    begin
      v_sem := (f->>'semana')::date;
      v_sem := v_sem - (extract(isodow from v_sem)::int - 1);
    exception when others then
      v_no := v_no || jsonb_build_object('referente', f->>'referente', 'motivo', 'semana no válida'); continue;
    end;
    if (f->>'personas') !~ '^[0-9]{1,5}$' then
      v_no := v_no || jsonb_build_object('referente', f->>'referente', 'motivo', 'personas no válidas'); continue;
    end if;
    if f ? 'miembro_id' then
      select m.id into v_id from public.club_miembros m where m.id = (f->>'miembro_id')::uuid and m.location_id = p_location;
      v_cand := case when v_id is null then 0 else 1 end;
    else
      select count(*), min(m.id::text)::uuid into v_cand, v_id from public.club_miembros m
       where m.location_id = p_location and m.tipo in ('referente','concierge_pm','equipo')
         and public.club_norm_texto(m.nombre) = public.club_norm_texto(f->>'referente');
    end if;
    if v_cand <> 1 then
      v_no := v_no || jsonb_build_object('referente', f->>'referente', 'motivo', case when v_cand = 0 then 'no existe' else 'nombre repetido' end);
      continue;
    end if;
    insert into public.club_comparacion_vieja (location_id, semana, miembro_id, personas, cargado_por)
    values (p_location, v_sem, v_id, (f->>'personas')::int, auth.uid())
    on conflict (location_id, semana, miembro_id) do update
      set personas = excluded.personas, cargado_por = excluded.cargado_por, cargado_en = now();
    v_n := v_n + 1;
  end loop;
  perform public.club_auditar('comparacion_cargar', 'club_comparacion_vieja', null, null,
                              jsonb_build_object('cargadas', v_n, 'no_encontradas', jsonb_array_length(v_no)));
  return jsonb_build_object('cargadas', v_n, 'no_encontrados', v_no);
end;
$$;

create or replace function public.club_comparacion(p_desde date, p_hasta date, p_location text default null)
returns table (semana date, miembro_id uuid, referente text, negocio text, personas_staging int, personas_vieja int, diferencia int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 120 then
    raise exception 'Rango no válido (hasta 120 días)' using errcode = 'P0001';
  end if;
  return query
  with st as (
    select (date_trunc('week', mv.fecha_visita at time zone 'America/Costa_Rica'))::date as sem, mv.miembro_id as mid, sum(mv.personas)::int as p
      from public.club_movimientos mv
     where mv.location_id = p_location and mv.origen = 'app' and mv.tipo = 'tarjeta'
       and mv.fecha_visita >= (p_desde - (extract(isodow from p_desde)::int - 1))::timestamp at time zone 'America/Costa_Rica'
       and mv.fecha_visita < (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica'
     group by 1, 2),
  vi as (
    select c.semana as sem, c.miembro_id as mid, c.personas as p from public.club_comparacion_vieja c
     where c.location_id = p_location and c.semana >= p_desde - (extract(isodow from p_desde)::int - 1) and c.semana <= p_hasta)
  select coalesce(st.sem, vi.sem), coalesce(st.mid, vi.mid), m.nombre, n.nombre,
         coalesce(st.p, 0), vi.p, coalesce(st.p, 0) - coalesce(vi.p, 0)
    from st full join vi on vi.sem = st.sem and vi.mid = st.mid
    join public.club_miembros m on m.id = coalesce(st.mid, vi.mid)
    left join public.club_negocios n on n.id = m.negocio_id
   order by 1 desc, abs(coalesce(st.p, 0) - coalesce(vi.p, 0)) desc, 3;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOCAL CLUB · A1 (07-nov, plan PLAN-LC-lanzamiento.md): una persona, un pase, roles «anfitrión» y/o «socio».
--   · club_miembro_roles es la fuente de verdad de los roles. «Anfitrión» = referente, concierge PM o equipo
--     (comparte cupones y gana créditos); «socio» = cliente del Local Club (pendiente, activo o baja).
--   · club_miembros.tipo queda como ESPEJO del rol de anfitrión ('socio' si no tiene ninguno): todo lo que ya
--     andaba (cupones, canje, reportes, migrador) sigue preguntando por tipo sin cambios.
--   · QR fijo del socio: /s/{codigo_socio} (9 caracteres). Solo identifica en caja (10 % y cortesía); NUNCA da
--     créditos (los créditos siguen con el código de un solo uso de R-01).
--   · Contrato del pase (CONTRATO-pase.md): funciones solo para service_role (el Edge del pase), eventos de cambio.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.club_miembros add column if not exists codigo_socio text unique
  check (codigo_socio is null or codigo_socio ~ '^[A-HJ-NP-Z2-9]{9}$');

create table if not exists public.club_miembro_roles (
  miembro_id           uuid not null references public.club_miembros(id),
  rol                  text not null check (rol in ('referente','concierge_pm','equipo','socio')),
  estado               text not null default 'activo' check (estado in ('pendiente','activo','baja')),
  desde                timestamptz not null default now(),
  alta_por             text not null default 'app' check (alta_por in ('caja','autoalta','gerencia','migracion','app')),
  validado_por         uuid,
  validado_en          timestamptz,
  referido_por         uuid references public.club_miembros(id),
  verifico_residencia  boolean,             -- el cajero marca «verifiqué residencia»; NUNCA se guarda el documento
  actualizado_en       timestamptz not null default now(),
  primary key (miembro_id, rol),
  check (rol = 'socio' or estado <> 'pendiente')   -- solo el socio puede estar pendiente
);
-- Un solo rol de anfitrión por persona.
create unique index if not exists club_roles_un_anfitrion on public.club_miembro_roles (miembro_id) where rol <> 'socio';
create index if not exists club_roles_rol_estado_idx on public.club_miembro_roles (rol, estado);
alter table public.club_miembro_roles enable row level security;
revoke all on public.club_miembro_roles from public, anon, authenticated;
grant select on public.club_miembro_roles to authenticated;
drop policy if exists club_roles_staff on public.club_miembro_roles;
create policy club_roles_staff on public.club_miembro_roles for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager','cajero','contador'));

-- Roles de los miembros que ya existen (idempotente).
insert into public.club_miembro_roles (miembro_id, rol, estado, desde, alta_por)
select m.id, m.tipo, case when m.estado = 'baja' then 'baja' else 'activo' end, m.created_at,
       case when m.origen = 'migracion' then 'migracion' else 'app' end
  from public.club_miembros m
 where m.tipo in ('referente','concierge_pm','equipo','socio')
on conflict (miembro_id, rol) do nothing;

-- Código del QR fijo del socio (9 caracteres; el del QR de cupones tiene 8 y el de canje 6).
create or replace function public.club_codigo_socio_nuevo()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v text; i int;
begin
  for i in 1 .. 10 loop
    v := public.club_gen_codigo(9);
    if not exists (select 1 from public.club_miembros where codigo_socio = v) then return v; end if;
  end loop;
  raise exception 'No se pudo generar el código del socio' using errcode = 'P0001';
end;
$$;

-- club_miembros → roles: el alta crea el rol; cambiar el tipo o el estado de la persona lo acompaña.
create or replace function public.club_roles_desde_miembro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anf_viejo text := case when tg_op = 'UPDATE' and old.tipo in ('referente','concierge_pm','equipo') then old.tipo end;
  v_anf_nuevo text := case when new.tipo in ('referente','concierge_pm','equipo') then new.tipo end;
begin
  if tg_op = 'INSERT' then
    if new.tipo in ('referente','concierge_pm','equipo','socio') then
      insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por)
      values (new.id, new.tipo, case when new.estado = 'baja' then 'baja' else 'activo' end,
              case when new.origen = 'migracion' then 'migracion' else 'app' end)
      on conflict (miembro_id, rol) do nothing;
    end if;
    return null;
  end if;
  -- cambio de tipo de anfitrión (referente → equipo, etc.)
  if v_anf_viejo is distinct from v_anf_nuevo then
    if v_anf_viejo is not null then
      delete from public.club_miembro_roles where miembro_id = new.id and rol = v_anf_viejo;
    end if;
    if v_anf_nuevo is not null then
      insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por)
      values (new.id, v_anf_nuevo, case when new.estado = 'baja' then 'baja' else 'activo' end, 'app')
      on conflict (miembro_id, rol) do nothing;
    end if;
  end if;
  -- baja o reactivación de la persona: alcanza a todos sus roles (un socio sin validar vuelve a pendiente)
  if old.estado is distinct from new.estado then
    update public.club_miembro_roles r
       set estado = case when new.estado = 'baja' then 'baja'
                         when r.rol = 'socio' and r.validado_en is null and r.alta_por = 'autoalta' then 'pendiente'
                         else 'activo' end,
           actualizado_en = now()
     where r.miembro_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists club_roles_desde_miembro_trg on public.club_miembros;
create trigger club_roles_desde_miembro_trg after insert or update of tipo, estado on public.club_miembros
  for each row execute function public.club_roles_desde_miembro();

-- Rol de socio → el miembro recibe su QR fijo (/s/).
create or replace function public.club_roles_codigo_socio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.rol = 'socio' then
    update public.club_miembros set codigo_socio = public.club_codigo_socio_nuevo()
     where id = new.miembro_id and codigo_socio is null;
  end if;
  return null;
end;
$$;
drop trigger if exists club_roles_codigo_socio_trg on public.club_miembro_roles;
create trigger club_roles_codigo_socio_trg after insert on public.club_miembro_roles
  for each row execute function public.club_roles_codigo_socio();
update public.club_miembros m set codigo_socio = public.club_codigo_socio_nuevo()
 where m.codigo_socio is null and exists (select 1 from public.club_miembro_roles r where r.miembro_id = m.id and r.rol = 'socio');

-- ¿Tiene este rol activo? (interno)
create or replace function public.club_tiene_rol(p_miembro uuid, p_roles text[], p_estados text[] default array['activo'])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.club_miembro_roles r
                  where r.miembro_id = p_miembro and r.rol = any(p_roles) and r.estado = any(p_estados))
$$;

-- Activar a un socio como anfitrión (solo owner o manager, con nota y auditoría). Fase 2: «Quiero ser anfitrión».
create or replace function public.club_rol_activar_anfitrion(p_miembro uuid, p_rol text, p_nota text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_nota text := btrim(coalesce(p_nota, ''));
  v_m    public.club_miembros%rowtype;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_rol is null or p_rol not in ('referente','concierge_pm','equipo') then
    raise exception 'Rol de anfitrión no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
  end if;
  if length(v_nota) not between 5 and 300 then
    raise exception 'La nota es obligatoria (de 5 a 300 caracteres): escribí por qué se activa como anfitrión' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros where id = p_miembro for update;
  if not found or v_m.estado <> 'activo' then
    raise exception 'No se encontró la cuenta activa: buscala de nuevo' using errcode = 'P0001';
  end if;
  if public.club_tiene_rol(p_miembro, array['referente','concierge_pm','equipo'], array['activo','baja']) then
    raise exception 'Ya es anfitrión: si estaba de baja, reactivalo desde su ficha' using errcode = 'P0001';
  end if;
  insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por, validado_por, validado_en)
  values (p_miembro, p_rol, 'activo', 'gerencia', auth.uid(), now());
  update public.club_miembros set tipo = p_rol, updated_at = now() where id = p_miembro;
  perform public.club_auditar('activar_anfitrion', 'club_miembro_roles', p_miembro, null,
                              jsonb_build_object('rol', p_rol, 'nota', v_nota));
  return true;
end;
$$;

-- ── Contrato del pase (CONTRATO-pase.md): eventos de cambio, cursor, pases emitidos ──────────────────────
alter table public.club_config add column if not exists wallet_apple_activo boolean not null default false;

create table if not exists public.club_pase_eventos (
  id          bigint generated always as identity primary key,
  miembro_id  uuid,                    -- null = afecta a todos los pases (promociones)
  motivo      text not null check (motivo in ('movimiento','rol','datos','cortesia','promociones')),
  creado_en   timestamptz not null default now()
);
create index if not exists club_pase_eventos_miembro_idx on public.club_pase_eventos (miembro_id, id);
alter table public.club_pase_eventos enable row level security;
revoke all on public.club_pase_eventos from public, anon, authenticated;

create table if not exists public.club_pase_cursor (
  nombre    text primary key check (nombre in ('google','apple')),
  ultimo_id bigint not null default 0,
  guardado_en timestamptz not null default now()
);
alter table public.club_pase_cursor enable row level security;
revoke all on public.club_pase_cursor from public, anon, authenticated;

create table if not exists public.club_pases (
  miembro_id     uuid not null references public.club_miembros(id),
  plataforma     text not null check (plataforma in ('google','apple')),
  object_id      text not null,
  emitido_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (miembro_id, plataforma)
);
alter table public.club_pases enable row level security;
revoke all on public.club_pases from public, anon, authenticated;
grant select on public.club_pases to authenticated;
drop policy if exists club_pases_gerencia on public.club_pases;
create policy club_pases_gerencia on public.club_pases for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

create or replace function public.club_pase_evento_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'club_movimientos' then
    insert into public.club_pase_eventos (miembro_id, motivo) values (new.miembro_id, 'movimiento');
  elsif tg_table_name = 'club_miembro_roles' then
    insert into public.club_pase_eventos (miembro_id, motivo) values (coalesce(new.miembro_id, old.miembro_id), 'rol');
  elsif tg_table_name = 'club_miembros' then
    if tg_op = 'UPDATE' and (old.nombre, old.estado, old.codigo, old.token_portal, old.codigo_socio, old.token_pase)
                            is distinct from (new.nombre, new.estado, new.codigo, new.token_portal, new.codigo_socio, new.token_pase) then
      insert into public.club_pase_eventos (miembro_id, motivo) values (new.id, 'datos');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists club_pase_evento_mov_trg on public.club_movimientos;
create trigger club_pase_evento_mov_trg after insert on public.club_movimientos
  for each row execute function public.club_pase_evento_trg();
drop trigger if exists club_pase_evento_rol_trg on public.club_miembro_roles;
create trigger club_pase_evento_rol_trg after insert or update or delete on public.club_miembro_roles
  for each row execute function public.club_pase_evento_trg();
drop trigger if exists club_pase_evento_mi_trg on public.club_miembros;
create trigger club_pase_evento_mi_trg after update on public.club_miembros
  for each row execute function public.club_pase_evento_trg();

-- Datos del pase (contrato v1). Solo service_role.
create or replace function public.club_pase_datos(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_anf   public.club_miembro_roles%rowtype;
  v_soc   public.club_miembro_roles%rowtype;
  v_saldo int;
  v_ver   bigint;
  v_mes   timestamptz := date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  v_base  text := 'https://club.satoricostarica.com';
  j_anf   jsonb;
  j_soc   jsonb;
  j_prom  jsonb := '[]'::jsonb;
  v_roles text[] := '{}';
  v_pben  text;          -- beneficio de la promo vigente del socio (A3)
  v_pcor  int;
  v_pest  text[] := '{}';
begin
  select * into v_m from public.club_miembros where id = p_miembro;
  if not found then return null; end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  select * into v_anf from public.club_miembro_roles where miembro_id = p_miembro and rol <> 'socio';
  select * into v_soc from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio';
  select coalesce(max(e.id), 0) into v_ver from public.club_pase_eventos e where e.miembro_id = p_miembro or e.miembro_id is null;

  -- A3: roles para las promociones (el socio pendiente no tiene beneficio todavía).
  if v_soc.miembro_id is not null and v_soc.estado = 'activo' then v_roles := v_roles || 'socio'::text; end if;
  if v_anf.miembro_id is not null and v_anf.estado = 'activo' then v_roles := v_roles || 'referente'::text; end if;
  if cardinality(v_roles) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'nombre', p.nombre, 'nombre_en', p.nombre_en, 'beneficio', public.club_promo_beneficio(p),
             'para', to_jsonb(p.para), 'vigente_hasta', p.hasta, 'dias', to_jsonb(p.dias),
             'horario', case when p.hora_desde is not null then jsonb_build_object('desde', to_char(p.hora_desde, 'HH24:MI'), 'hasta', to_char(p.hora_hasta, 'HH24:MI')) end)
             order by p.porcentaje desc, p.cortesias desc, p.nombre), '[]'::jsonb)
      into j_prom from public.club_promociones_vigentes(v_m.location_id, now(), v_roles) p;
  end if;
  if v_soc.miembro_id is not null and v_soc.estado in ('pendiente','activo') then
    v_pest := v_pest || 'mi_club'::text;
    select public.club_promo_beneficio(p), p.cortesias into v_pben, v_pcor
      from public.club_promociones_vigentes(v_m.location_id, now(), array['socio']) p limit 1;
    j_soc := jsonb_build_object(
      'estado', v_soc.estado, 'desde', (v_soc.desde at time zone 'America/Costa_Rica')::date,
      'qr_url', v_base || '/s/' || v_m.codigo_socio,
      -- Club compartido (08-nov): el beneficio del socio vale en todos los locales encendidos: texto GENÉRICO, no la promo de un local
      'beneficio', case when v_soc.estado = 'activo' then 'Vale en todos los Satori' end,
      'visitas_mes', (select count(*) from public.club_visitas_socio vs where vs.miembro_id = v_m.id
                        and vs.fecha >= date_trunc('month', now() at time zone 'America/Costa_Rica')::date),
      -- Cortesía SORPRESA (se sortea en caja): solo si es activo, la promo la da y hay cortesías activas; más los premios
      -- por referir disponibles (A4.3), cada uno con su vencimiento.
      'cortesias', case when v_soc.estado = 'activo' then
                     (case when coalesce(v_pcor, 0) > 0
                            and exists (select 1 from public.club_cortesias c where c.location_id = v_m.location_id and c.activa)
                           then jsonb_build_array(jsonb_build_object('sorpresa', true, 'cantidad', v_pcor, 'motivo', 'promo', 'vence_en', null))
                           else '[]'::jsonb end)
                     || coalesce((select jsonb_agg(jsonb_build_object('sorpresa', true, 'cantidad', 1, 'motivo', 'premio_referido',
                                                                     'vence_en', (p.vence_en at time zone 'America/Costa_Rica')::date) order by p.vence_en)
                                    from public.club_premios p where p.beneficiario = v_m.id and p.estado = 'disponible' and p.vence_en > now()), '[]'::jsonb)
                   else '[]'::jsonb end);
  end if;
  if v_anf.miembro_id is not null and v_anf.estado = 'activo' then
    v_pest := v_pest || 'anfitrion'::text;
    v_saldo := public.club_saldo_personas(v_m.id);
    j_anf := jsonb_build_object(
      'activo', true, 'tipo', v_anf.rol, 'codigo_publico', v_m.codigo,
      'qr_url', v_base || '/r/' || v_m.codigo,
      'personas', v_saldo,
      'creditos', public.club_creditos(v_saldo, v_cfg.personas_por_credito),
      'personas_proximo_medio', public.club_personas_proximo(v_saldo, v_cfg.personas_por_credito),
      'valor_credito_crc', v_cfg.valor_credito_crc,
      'referidos_mes', (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                         where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta' and mv.fecha_visita >= v_mes),
      'creditos_ganados_mes', public.club_creditos((select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
                         where mv.miembro_id = v_m.id and mv.tipo = 'tarjeta' and mv.fecha_visita >= v_mes), v_cfg.personas_por_credito));
  end if;

  return jsonb_build_object(
    'contrato', 1,
    'miembro_id', v_m.id,
    'version', v_ver,
    'actualizado_en', now(),
    'nombre_pila', public.club_nombre_pila(v_m.nombre),
    'estado', v_m.estado,
    'local', jsonb_build_object('id', v_m.location_id, 'nombre', coalesce(v_cfg.nombre, v_m.location_id)),   -- LC-ML: dato, no texto fijo
    'pestanas', to_jsonb(v_pest),
    'codigo_barras', case when j_soc is not null then jsonb_build_object('tipo', 'socio', 'valor', j_soc->>'qr_url')
                          when j_anf is not null then jsonb_build_object('tipo', 'cupones', 'valor', j_anf->>'qr_url') end,
    'socio', j_soc,
    'anfitrion', j_anf,
    'promociones', j_prom,   -- A3: vigentes hoy para sus roles activos
    -- CLUB-AUD-69: el pase lleva el token de PASE (propio, revocable), nunca el del portal
    'canjear_url', case when j_anf is not null and v_m.token_pase is not null then v_base || '/w/' || v_m.token_pase end);
end;
$$;

create or replace function public.club_pase_por_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo'
     and exists (select 1 from public.club_miembro_roles r where r.miembro_id = m.id and r.estado in ('pendiente','activo'))
$$;

create or replace function public.club_pase_emitido(p_miembro uuid, p_plataforma text, p_object_id text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.club_pases (miembro_id, plataforma, object_id) values (p_miembro, p_plataforma, p_object_id)
  on conflict (miembro_id, plataforma) do update set object_id = excluded.object_id, actualizado_en = now();
$$;

-- B3 (08-nov): los pases emitidos de una plataforma, para los eventos globales (`miembro_id` null = promociones): B
-- recorre esta lista y actualiza cada objeto. Paginada por miembro_id (keyset). Solo service_role.
create or replace function public.club_pases_emitidos(p_plataforma text, p_despues uuid default null, p_limite int default 500)
returns table (miembro_id uuid, object_id text, emitido_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.miembro_id, p.object_id, p.emitido_en from public.club_pases p
   where p.plataforma = p_plataforma and (p_despues is null or p.miembro_id > p_despues)
   order by p.miembro_id
   limit least(greatest(coalesce(p_limite, 500), 1), 2000)
$$;

create or replace function public.club_pase_eventos_leer(p_despues bigint, p_limite int default 500)
returns table (id bigint, miembro_id uuid, motivo text, creado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.miembro_id, e.motivo, e.creado_en from public.club_pase_eventos e
   where e.id > coalesce(p_despues, 0) order by e.id limit least(greatest(coalesce(p_limite, 500), 1), 2000)
$$;

create or replace function public.club_pase_cursor_leer(p_nombre text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce((select c.ultimo_id from public.club_pase_cursor c where c.nombre = p_nombre), 0) $$;

create or replace function public.club_pase_cursor_guardar(p_nombre text, p_id bigint)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.club_pase_cursor (nombre, ultimo_id) values (p_nombre, p_id)
  on conflict (nombre) do update set ultimo_id = greatest(public.club_pase_cursor.ultimo_id, excluded.ultimo_id), guardado_en = now();
$$;

create or replace function public.club_alertas_pendientes(p_limite int default 100)
returns table (id bigint, miembro_id uuid, tipo text, creditos numeric, saldo_creditos numeric, fecha timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.miembro_id, a.tipo, mv.creditos,
         public.club_creditos(public.club_saldo_personas(a.miembro_id), c.personas_por_credito), mv.fecha_visita
    from public.club_alertas a
    join public.club_movimientos mv on mv.id = a.movimiento_id
    join public.club_config c on c.location_id = a.location_id
   where a.enviado_en is null and a.tipo = 'canje'   -- las de cupo de autoalta no van al pase
   order by a.id limit least(greatest(coalesce(p_limite, 100), 1), 1000)
$$;

create or replace function public.club_alerta_enviada(p_id bigint, p_canal text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$ update public.club_alertas set enviado_en = now(), canal = p_canal where id = p_id and enviado_en is null $$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOCAL CLUB · A2 (08-nov): socios — alta en caja (activo provisional), confirmación por otra persona,
-- autoalta (pendiente), validación en caja, token de pase propio (CLUB-AUD-69), cursor con rebobinado (70).
--   · LC-DES-01: el alta en caja (o la validación de una autoalta) deja al socio ACTIVO PROVISIONAL: usa el 10 %
--     ese día. Un manager u owner DISTINTO de quien lo cargó lo confirma dentro de 7 días; si no, vuelve a
--     pendiente (club_socios_mantenimiento, todos los días).
--   · LC-DES-07: autoalta pública (club-web, x-club-web + Turnstile + tope por IP en club-web; tope global por día
--     acá), datos mínimos (nombre y WhatsApp), aviso de privacidad versionado y baja desde el portal. Las autoaltas
--     sin validar se purgan a los 30 días. NUNCA se guarda un número de cédula, DIMEX ni pasaporte.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.club_config add column if not exists socio_provisional_dias int not null default 7
  check (socio_provisional_dias between 1 and 60);
alter table public.club_config add column if not exists socio_autoalta_max_dia int not null default 60
  check (socio_autoalta_max_dia between 1 and 10000);
alter table public.club_config add column if not exists socio_autoalta_purga_dias int not null default 30
  check (socio_autoalta_purga_dias between 7 and 365);
alter table public.club_config add column if not exists aviso_privacidad_version text not null default 'v1'
  check (aviso_privacidad_version ~ '^v[0-9A-Za-z.-]{1,30}$');
-- v1 (Ismael, 08-nov): el texto final del aviso de club-web/src/i18n.ts. Las versiones de prueba anteriores
-- (v0-provisorio, v1-borrador) pasan a v1; una versión cargada a mano distinta no se pisa. Cada alta guarda la versión
-- que aceptó (club_miembro_roles.aviso_version).
alter table public.club_config alter column aviso_privacidad_version set default 'v1';
update public.club_config set aviso_privacidad_version = 'v1' where aviso_privacidad_version in ('v0-provisorio', 'v1-borrador');

alter table public.club_miembro_roles add column if not exists registrado_por uuid;          -- quién lo cargó en caja
alter table public.club_miembro_roles add column if not exists provisional_hasta timestamptz; -- activo provisional
alter table public.club_miembro_roles add column if not exists confirmado_por uuid;
alter table public.club_miembro_roles add column if not exists confirmado_en timestamptz;
alter table public.club_miembro_roles add column if not exists aviso_version text;
alter table public.club_miembro_roles add column if not exists aviso_aceptado_en timestamptz;

-- CLUB-AUD-69: token de pase propio (no el del portal). Revocable (null) y regenerable.
alter table public.club_miembros add column if not exists token_pase text unique
  check (token_pase is null or token_pase ~ '^[0-9a-f]{64}$');
update public.club_miembros set token_pase = encode(extensions.gen_random_bytes(32), 'hex') where token_pase is null;
alter table public.club_miembros alter column token_pase set default encode(extensions.gen_random_bytes(32), 'hex');

-- CLUB-AUD-72: autoalta con un teléfono que ya existe → solicitud (no cambia nada). La caja la atiende en persona
-- («Validar socio» si está pendiente, «Nuevo socio» si estaba de baja); al validarse queda atendida.
create table if not exists public.club_socio_solicitudes (
  id            bigint generated always as identity primary key,
  location_id   text not null,
  miembro_id    uuid not null references public.club_miembros(id),
  creada_en     timestamptz not null default now(),
  aviso_version text,
  referido_por  uuid references public.club_miembros(id),
  atendida_en   timestamptz,
  atendida_por  uuid
);
create unique index if not exists club_socio_solicitudes_abierta on public.club_socio_solicitudes (miembro_id) where atendida_en is null;
alter table public.club_socio_solicitudes enable row level security;
revoke all on public.club_socio_solicitudes from public, anon, authenticated;

-- Interno: busca a la persona por teléfono normalizado (una persona, un pase).
create or replace function public.club_miembro_por_telefono(p_tel text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.miembro_id from public.club_miembros_contacto c join public.club_miembros m on m.id = c.miembro_id
   where c.telefono = p_tel order by (m.estado = 'activo') desc, m.created_at limit 1
$$;

-- Interno: crea (o reusa) la persona y le pone el rol de socio con el estado y el origen pedidos.
create or replace function public.club_socio_crear(p_nombre text, p_tel text, p_email text, p_estado text, p_alta_por text,
                                                   p_referido uuid, p_aviso text, p_location text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_r public.club_miembro_roles%rowtype;
begin
  v_id := public.club_miembro_por_telefono(p_tel);
  if v_id is not null then
    select * into v_r from public.club_miembro_roles where miembro_id = v_id and rol = 'socio';
    if found and v_r.estado <> 'baja' then
      raise exception 'YA_ES_SOCIO' using errcode = 'P0001';
    end if;
    if found then
      update public.club_miembro_roles set estado = p_estado, alta_por = p_alta_por, desde = now(), actualizado_en = now(),
             validado_por = null, validado_en = null, confirmado_por = null, confirmado_en = null, provisional_hasta = null,
             referido_por = coalesce(p_referido, referido_por), aviso_version = p_aviso, aviso_aceptado_en = case when p_aviso is not null then now() end
       where miembro_id = v_id and rol = 'socio';
    else
      insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por, referido_por, aviso_version, aviso_aceptado_en)
      values (v_id, 'socio', p_estado, p_alta_por, p_referido, p_aviso, case when p_aviso is not null then now() end);
    end if;
    update public.club_miembros set estado = 'activo', updated_at = now() where id = v_id and estado = 'baja'
      and not exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_id and r.rol <> 'socio');
    return v_id;
  end if;
  insert into public.club_miembros (location_id, tipo, nombre) values (p_location, 'socio', btrim(p_nombre)) returning id into v_id;
  -- el alta del miembro creó el rol 'socio' activo: se le pone el estado y el origen reales
  update public.club_miembro_roles set estado = p_estado, alta_por = p_alta_por, referido_por = p_referido,
         aviso_version = p_aviso, aviso_aceptado_en = case when p_aviso is not null then now() end, actualizado_en = now()
   where miembro_id = v_id and rol = 'socio';
  insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp)
  values (v_id, p_location, p_tel, p_email, p_aviso is not null);
  return v_id;
end;
$$;

-- Activo provisional (alta o validación en caja): «verifiqué residencia», quién lo cargó y hasta cuándo.
create or replace function public.club_socio_provisional(p_miembro uuid, p_dias int)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.club_socio_solicitudes set atendida_en = now(), atendida_por = auth.uid()
   where miembro_id = p_miembro and atendida_en is null;
  update public.club_miembro_roles
     set estado = 'activo', verifico_residencia = true, registrado_por = auth.uid(), validado_por = auth.uid(), validado_en = now(),
         provisional_hasta = now() + make_interval(days => p_dias), confirmado_por = null, confirmado_en = null, actualizado_en = now()
   where miembro_id = p_miembro and rol = 'socio';
$$;

-- Alta en caja (owner, manager, cajero). Obligatorios: nombre, WhatsApp y «verifiqué residencia».
create or replace function public.club_socio_alta_caja(p_nombre text, p_whatsapp text, p_email text, p_verifico_residencia boolean,
                                                       p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_cfg public.club_config%rowtype;
  v_tel text;
  v_em  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id  uuid;
begin
  p_location := public.club_local(p_location, true);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config where location_id = p_location;
  if not found then raise exception 'Local no válido: elegí el local de la lista' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_nombre, ''))) not between 2 and 120 then
    raise exception 'Falta el nombre: escribí nombre y apellido' using errcode = 'P0001';
  end if;
  if coalesce(p_verifico_residencia, false) is not true then
    raise exception 'Falta «verifiqué residencia»: confirmá que es local antes del alta' using errcode = 'P0001';
  end if;
  begin
    v_tel := public.club_norm_telefono(p_whatsapp);
  exception when others then
    raise exception 'WhatsApp no válido: revisá el número (8 dígitos o con código de país)' using errcode = 'P0001';
  end;
  if v_tel is null then raise exception 'Falta el WhatsApp: es obligatorio para el alta' using errcode = 'P0001'; end if;
  if v_em is not null and (v_em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_em) > 254) then
    raise exception 'Email no válido: corregilo o dejalo vacío' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_socio_tel:' || v_tel, 0));
  begin
    v_id := public.club_socio_crear(p_nombre, v_tel, v_em, 'activo', 'caja', null, null, p_location);
  exception when others then
    if sqlerrm = 'YA_ES_SOCIO' then
      raise exception 'Ya es socio (o tiene el alta pendiente): escaneá su QR o validalo desde ahí' using errcode = 'P0001';
    end if;
    raise;
  end;
  perform public.club_socio_provisional(v_id, v_cfg.socio_provisional_dias);
  -- CLUB-AUD-73: el alta en caja también registra la versión del aviso que la caja le muestra al socio.
  update public.club_miembro_roles set aviso_version = v_cfg.aviso_privacidad_version, aviso_aceptado_en = now()
   where miembro_id = v_id and rol = 'socio';
  perform public.club_auditar('socio_alta_caja', 'club_miembro_roles', v_id, null,
                              jsonb_build_object('verifico_residencia', true, 'provisional_dias', v_cfg.socio_provisional_dias));
  return jsonb_build_object('miembro_id', v_id, 'estado', 'activo', 'provisional_hasta', now() + make_interval(days => v_cfg.socio_provisional_dias));
end;
$$;

-- Validar en caja una autoalta pendiente (owner, manager, cajero): pasa a activo provisional, igual que el alta.
-- Club compartido (08-nov): se valida desde CUALQUIER local encendido (el de la caja, p_location); el alta sigue con el
-- local donde se hizo.
drop function if exists public.club_socio_validar(uuid, boolean);
create or replace function public.club_socio_validar(p_miembro uuid, p_verifico_residencia boolean, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_r   public.club_miembro_roles%rowtype;
  v_cfg public.club_config%rowtype;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if coalesce(p_verifico_residencia, false) is not true then
    raise exception 'Falta «verifiqué residencia»: confirmá que es local antes de validar' using errcode = 'P0001';
  end if;
  select * into v_r from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio' for update;
  if not found then raise exception 'No es socio: hacé el alta desde «Nuevo socio»' using errcode = 'P0001'; end if;
  if v_r.estado <> 'pendiente' then
    raise exception 'El socio no está pendiente: no hace falta validarlo' using errcode = 'P0001';
  end if;
  -- CLUB-AUD-71: si ya tuvo un alta provisional que nadie confirmó (venció y volvió a pendiente), la caja no la
  -- renueva otros 7 días: la valida un manager u owner DISTINTO de quien la cargó, y esa validación ya la confirma.
  if v_r.registrado_por is not null and v_r.confirmado_en is null then
    if v_rol not in ('owner','manager') or v_r.registrado_por = auth.uid() then
      raise exception 'Este socio ya tuvo un alta provisional que nadie confirmó: la valida un manager u owner distinto de quien la cargó'
        using errcode = 'P0001';
    end if;
    update public.club_miembro_roles
       set estado = 'activo', verifico_residencia = true, validado_por = auth.uid(), validado_en = now(), provisional_hasta = null,
           confirmado_por = auth.uid(), confirmado_en = now(), actualizado_en = now()
     where miembro_id = p_miembro and rol = 'socio';
    update public.club_socio_solicitudes set atendida_en = now(), atendida_por = auth.uid()
     where miembro_id = p_miembro and atendida_en is null;
    perform public.club_auditar('socio_validar', 'club_miembro_roles', p_miembro, jsonb_build_object('estado', 'pendiente'),
                                jsonb_build_object('estado', 'activo', 'confirmado', true, 'registrado_por', v_r.registrado_por));
    return jsonb_build_object('miembro_id', p_miembro, 'estado', 'activo', 'provisional_hasta', null);
  end if;
  select c.* into v_cfg from public.club_config c where c.location_id = public.club_local(p_location, true);   -- el local de la caja
  perform public.club_socio_provisional(p_miembro, v_cfg.socio_provisional_dias);
  perform public.club_auditar('socio_validar', 'club_miembro_roles', p_miembro, jsonb_build_object('estado', 'pendiente'),
                              jsonb_build_object('estado', 'activo', 'provisional', true));
  return jsonb_build_object('miembro_id', p_miembro, 'estado', 'activo', 'provisional_hasta', now() + make_interval(days => v_cfg.socio_provisional_dias));
end;
$$;

-- Confirmar el alta (owner o manager DISTINTO de quien la cargó).
create or replace function public.club_socio_confirmar(p_miembro uuid, p_nota text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_r    public.club_miembro_roles%rowtype;
  v_nota text := btrim(coalesce(p_nota, ''));
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_r from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio' for update;
  if not found or v_r.estado <> 'activo' or v_r.provisional_hasta is null then
    raise exception 'No hay un alta provisional para confirmar' using errcode = 'P0001';
  end if;
  if v_r.registrado_por = auth.uid() then
    raise exception 'La cargaste vos: la confirma otro manager u owner' using errcode = 'P0001';
  end if;
  update public.club_miembro_roles set provisional_hasta = null, confirmado_por = auth.uid(), confirmado_en = now(), actualizado_en = now()
   where miembro_id = p_miembro and rol = 'socio';
  perform public.club_auditar('socio_confirmar', 'club_miembro_roles', p_miembro, null,
                              jsonb_build_object('registrado_por', v_r.registrado_por, 'nota', nullif(v_nota, '')));
  return true;
end;
$$;

-- Autoalta (PÚBLICA, solo por club-web: x-club-web; Turnstile y tope por IP los controla club-web).
-- Datos mínimos: nombre, WhatsApp, consentimiento del aviso vigente. `ref` = código público del socio que refiere.
-- Respuesta pareja (no dice si el teléfono ya existía). Devuelve el link del portal de esa persona.
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
  -- CLUB-AUD-74: al llegar al 80 % del cupo diario, una alerta (una por día) para gerencia.
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
  -- CLUB-AUD-72: si el teléfono ya existe, la autoalta NO toca nada (ni roles, ni estado, ni baja, ni aviso):
  -- deja una solicitud que la caja valida en persona y responde lo mismo que siempre.
  v_id := public.club_miembro_por_telefono(v_tel);
  if v_id is not null then
    insert into public.club_socio_solicitudes (location_id, miembro_id, aviso_version, referido_por)
    values (v_loc, v_id, v_cfg.aviso_privacidad_version, nullif(v_ref, v_id))
    on conflict (miembro_id) where atendida_en is null do nothing;
    return jsonb_build_object('ok', true);
  end if;
  v_id := public.club_socio_crear(v_nom, v_tel, null, 'pendiente', 'autoalta', v_ref, v_cfg.aviso_privacidad_version, v_loc);
  select token_portal into v_tok from public.club_miembros where id = v_id;
  return jsonb_build_object('ok', true, 'portal', 'https://club.satoricostarica.com/p/' || v_tok);
end;
$$;

-- Baja del Local Club desde el portal (PÚBLICA, solo por club-web): el link de baja del aviso de privacidad.
create or replace function public.club_socio_baja_portal(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.club_web_ok() then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  select m.id into v_id from public.club_miembros m where m.token_portal = lower(btrim(coalesce(p_token, '')));
  if v_id is null or not exists (select 1 from public.club_miembro_roles where miembro_id = v_id and rol = 'socio' and estado <> 'baja') then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  update public.club_miembro_roles set estado = 'baja', actualizado_en = now() where miembro_id = v_id and rol = 'socio';
  update public.club_miembros_contacto set optin_whatsapp = false, optin_email = false, updated_at = now() where miembro_id = v_id;
  perform public.club_auditar('socio_baja_portal', 'club_miembro_roles', v_id, null, null);
  return true;
end;
$$;

-- Mantenimiento diario: altas provisionales vencidas → pendiente; autoaltas sin validar → purga (30 días).
create or replace function public.club_socios_mantenimiento()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_venc int; v_purg int := 0; r record;
begin
  with v as (
    update public.club_miembro_roles set estado = 'pendiente', actualizado_en = now()
     where rol = 'socio' and estado = 'activo' and provisional_hasta is not null and provisional_hasta < now()
    returning miembro_id)
  select count(*) into v_venc from v;
  -- CLUB-AUD-73: purga de autoaltas sin validar.
  --   · sin otro rol ACTIVO (anfitrión): se borran el contacto, el pase, la solicitud y el rol de socio, y el nombre;
  --     la fila del miembro queda en baja (la referencian la auditoría y los eventos; los movimientos, si los hubiera).
  --   · con otro rol activo: solo los datos del Local Club (rol de socio y solicitudes); el contacto sigue, porque es
  --     del anfitrión.
  for r in select x.miembro_id,
                  exists (select 1 from public.club_miembro_roles y where y.miembro_id = x.miembro_id and y.rol <> 'socio' and y.estado = 'activo') otro_rol
             from public.club_miembro_roles x
             join public.club_miembros m on m.id = x.miembro_id
             join public.club_config c on c.location_id = m.location_id
            where x.rol = 'socio' and x.estado = 'pendiente' and x.alta_por = 'autoalta' and x.validado_en is null
              and x.desde < now() - make_interval(days => c.socio_autoalta_purga_dias) loop
    delete from public.club_socio_solicitudes where miembro_id = r.miembro_id;
    delete from public.club_miembro_roles where miembro_id = r.miembro_id and rol = 'socio';
    if not r.otro_rol then
      delete from public.club_miembros_contacto where miembro_id = r.miembro_id;
      delete from public.club_pases where miembro_id = r.miembro_id;
      update public.club_miembros set estado = 'baja', nombre = 'Purgado (autoalta sin validar)', updated_at = now() where id = r.miembro_id;
    end if;
    v_purg := v_purg + 1;
  end loop;
  return jsonb_build_object('provisionales_vencidas', v_venc, 'autoaltas_purgadas', v_purg,
                            'premios', case when exists (select 1 from public.club_config c where c.club_activo) then public.club_premios_generar(null) else 0 end);
end;
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('club_socios_mantenimiento', '15 9 * * *', 'select public.club_socios_mantenimiento()');   -- 03:15 CR
  end if;
end $$;

-- Altas provisionales para confirmar (owner, manager). `puedo_confirmar` = false si la cargó quien pregunta.
create or replace function public.club_socios_por_confirmar()
returns table (miembro_id uuid, nombre text, alta_por text, registrado_por text, provisional_hasta timestamptz, puedo_confirmar boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select r.miembro_id, m.nombre, r.alta_por, coalesce(p.full_name, 'Sin perfil'), r.provisional_hasta,
           r.registrado_por is distinct from auth.uid()
      from public.club_miembro_roles r join public.club_miembros m on m.id = r.miembro_id
      left join public.profiles p on p.id = r.registrado_por
     where r.rol = 'socio' and r.estado = 'activo' and r.provisional_hasta is not null
     order by r.provisional_hasta;
end;
$$;

-- CLUB-AUD-72: solicitudes abiertas (autoalta con un teléfono que ya existía). owner, manager. Sin contacto.
create or replace function public.club_socio_solicitudes_abiertas()
returns table (miembro_id uuid, nombre text, estado_socio text, creada_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select q.miembro_id, m.nombre, coalesce(r.estado, 'sin rol de socio'), q.creada_en
      from public.club_socio_solicitudes q join public.club_miembros m on m.id = q.miembro_id
      left join public.club_miembro_roles r on r.miembro_id = q.miembro_id and r.rol = 'socio'
     where q.atendida_en is null
     order by q.creada_en;
end;
$$;

-- LC-A5: altas de socios por cajero en un rango (owner, manager). Sale de la auditoría (solo inserción): altas en caja,
-- validaciones de autoaltas y confirmaciones hechas por cada usuario; y, de las altas que cargó, cuántas siguen sin
-- confirmar y cuántas volvieron a pendiente.
create or replace function public.club_reporte_altas(p_desde date, p_hasta date, p_location text default null)
returns table (usuario text, altas_caja int, validaciones int, confirmo int, sin_confirmar int, vencidas int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_ini timestamptz;
  v_fin timestamptz;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';
  return query
    with a as (
      select x.actor, x.accion, x.objeto_id from public.club_auditoria x
        join public.club_miembros m on m.id = x.objeto_id and m.location_id = p_location
       where x.accion in ('socio_alta_caja','socio_validar','socio_confirmar') and x.en >= v_ini and x.en < v_fin),
    r as (
      select rr.registrado_por as actor,
             count(*) filter (where rr.estado = 'activo' and rr.provisional_hasta is not null) as sin_conf,
             count(*) filter (where rr.estado = 'pendiente' and rr.confirmado_en is null) as venc
        from public.club_miembro_roles rr join public.club_miembros m on m.id = rr.miembro_id and m.location_id = p_location
       where rr.rol = 'socio' and rr.registrado_por is not null and coalesce(rr.validado_en, rr.desde) >= v_ini and coalesce(rr.validado_en, rr.desde) < v_fin
       group by rr.registrado_por),
    u as (select actor from a union select actor from r)
    select coalesce(p.full_name, 'Sin perfil'),
           (select count(*)::int from a where a.actor = u.actor and a.accion = 'socio_alta_caja'),
           (select count(*)::int from a where a.actor = u.actor and a.accion = 'socio_validar'),
           (select count(*)::int from a where a.actor = u.actor and a.accion = 'socio_confirmar'),
           coalesce((select r.sin_conf::int from r where r.actor = u.actor), 0),
           coalesce((select r.venc::int from r where r.actor = u.actor), 0)
      from u left join public.profiles p on p.id = u.actor
     where u.actor is not null
     order by 2 desc, 3 desc, 1;
end;
$$;

-- LC-A6: visitas de socio por usuario (cierra el hueco de la autorrevisión de A4/A5: un cajero que registra visitas
-- falsas para justificar el 856). Por quien registró la visita en la app, en el rango y el local: cuántas, de cuántos
-- socios distintos, con beneficio, como invitado, pagadas con créditos, cuántas no cruzaron con ninguna factura (pasada la
-- latencia del puente) y el máximo de visitas de un mismo socio. Owner y manager.
create or replace function public.club_reporte_visitas(p_desde date, p_hasta date, p_location text default null)
returns table (usuario text, visitas int, socios int, con_beneficio int, como_invitado int, con_creditos int,
               sin_factura int, max_mismo_socio int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_ini timestamptz;
  v_fin timestamptz;
  v_lat int;
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';
  select c.puente_latencia_min into v_lat from public.club_config c where c.location_id = p_location;
  return query
    with v as (
      select x.registrado_por as actor, x.miembro_id, x.estado_beneficio,
             (x.registrada_en < now() - make_interval(mins => coalesce(v_lat, 30))
              and cardinality(public.club_cruce_facturas(x.location_id, x.pos_ref, null)) = 0) as sin_fac
        from public.club_visitas_socio x
       where x.location_id = p_location and x.registrada_en >= v_ini and x.registrada_en < v_fin),
    m as (select actor, max(n)::int as mx from (select actor, miembro_id, count(*) as n from v group by 1, 2) z group by actor)
    select coalesce(p.full_name, 'Sin perfil'), count(*)::int, count(distinct v.miembro_id)::int,
           count(*) filter (where v.estado_beneficio in ('aplica','pendiente_configuracion'))::int,
           count(*) filter (where v.estado_beneficio = 'como_invitado')::int,
           count(*) filter (where v.estado_beneficio = 'paga_con_creditos')::int,
           count(*) filter (where v.sin_fac)::int,
           max(m.mx)
      from v left join public.profiles p on p.id = v.actor left join m on m.actor is not distinct from v.actor
     group by v.actor, p.full_name
     order by 2 desc, 1;
end;
$$;

-- CLUB-AUD-69: código de canje desde el PASE (token de pase propio). Solo abre «Canjear».
create or replace function public.club_canje_codigo_generar_pase(p_token_pase text)
returns table (codigo text, vence_en timestamptz, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_tok text;
begin
  if not public.club_web_ok() then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  select m.token_portal into v_tok from public.club_miembros m
   where m.token_pase is not null and m.token_pase = lower(btrim(coalesce(p_token_pase, '')));
  if v_tok is null then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;
  return query select * from public.club_canje_codigo_generar(v_tok);
end;
$$;

-- Regenerar o revocar el token de pase (owner o manager). Regenerar = el pase se actualiza (evento «datos»).
create or replace function public.club_pase_token(p_miembro uuid, p_accion text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_accion not in ('regenerar','revocar') then raise exception 'Acción no válida (regenerar o revocar)' using errcode = 'P0001'; end if;
  update public.club_miembros set token_pase = case when p_accion = 'regenerar' then encode(extensions.gen_random_bytes(32), 'hex') end,
         updated_at = now() where id = p_miembro;
  if not found then raise exception 'Miembro no encontrado: buscalo de nuevo' using errcode = 'P0001'; end if;
  perform public.club_auditar('pase_token_' || p_accion, 'club_miembros', p_miembro, null, null);
  return true;
end;
$$;

-- CLUB-AUD-70: rebobinar el cursor del pase (explícito, con motivo y auditoría). Solo service_role.
create or replace function public.club_pase_cursor_rebobinar(p_nombre text, p_id bigint, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'El motivo es obligatorio' using errcode = 'P0001'; end if;
  insert into public.club_pase_cursor (nombre, ultimo_id) values (p_nombre, greatest(coalesce(p_id, 0), 0))
  on conflict (nombre) do update set ultimo_id = greatest(coalesce(p_id, 0), 0), guardado_en = now();
  perform public.club_auditar('pase_cursor_rebobinar', 'club_pase_cursor', null, null,
                              jsonb_build_object('nombre', p_nombre, 'id', p_id, 'motivo', p_motivo));
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOCAL CLUB · A3 (08-nov): promociones mínimas, productos (desde las líneas del puente) y cortesías del sorteo.
--   · Promoción: nombre, para quién, vigencia (fechas, días ISO 1=lun…7=dom, horario), porcentaje y cantidad de
--     cortesías (se sortean en caja entre las activas: A4). Estado borrador → vigente → terminada. Solo owner edita.
--   · Cortesías (decisión «1b»): hasta 10, activables, cada una un artículo de la sección «CORTESÍA CLUB» del PoS
--     (₡0; códigos de Ismael). La sección es la familia `club_config.cortesia_familia` (null hasta que Ismael la cree).
--   · Productos: lo que ya llega en pos_ndf_ticket_lines (120 días). Sin tocar el agente.
--   · Cada cambio de promociones deja un evento `promociones` (miembro null) para el pase.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.club_config add column if not exists cortesia_familia int check (cortesia_familia is null or cortesia_familia > 0);
-- (08-nov) La sección «CORTESÍAS» del PoS es un par (clasificación, subclasificación): cortesia_familia es la CLASIFICACIÓN
-- (la «familia» de las líneas) y cortesia_subclasificacion la subclasificación. Las líneas del puente todavía no traen la
-- subclasificación: hoy se compara la clasificación; la subclasificación queda guardada para cuando el puente la mande.
alter table public.club_config add column if not exists cortesia_subclasificacion int check (cortesia_subclasificacion is null or cortesia_subclasificacion > 0);
-- (08-nov) Turno de la factura del PoS para excepciones y reportes: «mañana» antes del corte, «tarde» desde el corte (hora
-- de Costa Rica, por local). Logins FIJOS de caja: el sistema del PoS se abre con ellos (no son una persona): en las
-- excepciones se muestran con su turno y no cuentan como «sin empleado»; esas excepciones las resuelve solo el owner.
alter table public.club_config add column if not exists turno_corte time not null default '16:00';
alter table public.club_config add column if not exists pos_logins_caja text[] not null default '{}'
  check (array_position(pos_logins_caja, null) is null);
alter table public.club_config add column if not exists cortesias_por_visita int not null default 1 check (cortesias_por_visita between 0 and 3);
alter table public.club_config add column if not exists socio_visitas_por_dia int not null default 1 check (socio_visitas_por_dia between 1 and 5);

create table if not exists public.club_promociones (
  id             uuid primary key default gen_random_uuid(),
  location_id    text not null,
  nombre         text not null check (length(btrim(nombre)) between 2 and 80),
  nombre_en      text check (nombre_en is null or length(btrim(nombre_en)) between 2 and 80),
  para           text[] not null check (para <@ array['socio','referente','turista_cupon','todos'] and cardinality(para) between 1 and 4),
  estado         text not null default 'borrador' check (estado in ('borrador','vigente','terminada')),
  desde          date,
  hasta          date,
  dias           int[] not null default '{1,2,3,4,5,6,7}' check (dias <@ '{1,2,3,4,5,6,7}'::int[] and cardinality(dias) between 1 and 7),
  hora_desde     time,
  hora_hasta     time,
  porcentaje     numeric(5,2) not null default 0 check (porcentaje between 0 and 100),
  cortesias      int not null default 0 check (cortesias between 0 and 3),
  creada_por     uuid,
  creada_en      timestamptz not null default now(),
  actualizada_por uuid,
  actualizada_en timestamptz not null default now(),
  check (hasta is null or desde is null or hasta >= desde),
  check ((hora_desde is null) = (hora_hasta is null)),
  check (porcentaje > 0 or cortesias > 0)
);
create unique index if not exists club_promociones_nombre_uq on public.club_promociones (location_id, lower(btrim(nombre)));
alter table public.club_promociones enable row level security;
revoke all on public.club_promociones from public, anon, authenticated;

create table if not exists public.club_cortesias (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  codigo_producto text not null check (codigo_producto ~ '^[0-9A-Za-z._-]{1,30}$'),
  nombre          text not null check (length(btrim(nombre)) between 2 and 80),
  familia         int,
  activa          boolean not null default true,
  creada_por      uuid,
  creada_en       timestamptz not null default now(),
  actualizada_por uuid,
  actualizada_en  timestamptz not null default now(),
  unique (location_id, codigo_producto)
);
alter table public.club_cortesias enable row level security;
revoke all on public.club_cortesias from public, anon, authenticated;

-- Tope duro de 10 cortesías por local (aunque alguien inserte por fuera de la función).
create or replace function public.club_cortesias_tope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('club_cortesias:' || new.location_id, 0));
  if (select count(*) from public.club_cortesias c where c.location_id = new.location_id) >= 10 then
    raise exception 'Ya hay 10 cortesías cargadas (el máximo): desactivá o reusá una' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists club_cortesias_tope_trg on public.club_cortesias;
create trigger club_cortesias_tope_trg before insert on public.club_cortesias for each row execute function public.club_cortesias_tope();

-- Evento para el pase: cualquier cambio de promociones afecta a todos los pases.
create or replace function public.club_promociones_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.club_pase_eventos (miembro_id, motivo) values (null, 'promociones');
  return null;
end;
$$;
drop trigger if exists club_promociones_evento_trg on public.club_promociones;
create trigger club_promociones_evento_trg after insert or update or delete on public.club_promociones
  for each row execute function public.club_promociones_evento();   -- por fila: un INSERT que no inserta nada no avisa

-- ¿La promoción está vigente en ese momento (hora de Costa Rica)? El horario puede cruzar la medianoche.
create or replace function public.club_promo_vigente_en(p public.club_promociones, p_ts timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p.estado = 'vigente'
     and (p.desde is null or (p_ts at time zone 'America/Costa_Rica')::date >= p.desde)
     and (p.hasta is null or (p_ts at time zone 'America/Costa_Rica')::date <= p.hasta)
     and extract(isodow from p_ts at time zone 'America/Costa_Rica')::int = any(p.dias)
     and (p.hora_desde is null
          or (p.hora_desde <= p.hora_hasta and (p_ts at time zone 'America/Costa_Rica')::time >= p.hora_desde
                                            and (p_ts at time zone 'America/Costa_Rica')::time <  p.hora_hasta)
          or (p.hora_desde >  p.hora_hasta and ((p_ts at time zone 'America/Costa_Rica')::time >= p.hora_desde
                                             or (p_ts at time zone 'America/Costa_Rica')::time <  p.hora_hasta)))
$$;

-- Texto del beneficio (en español; B arma el inglés con los números).
create or replace function public.club_promo_beneficio(p public.club_promociones)
returns text
language sql
immutable
as $$
  select concat_ws(' + ',
           case when p.porcentaje > 0 then trim(to_char(p.porcentaje, 'FM990.##'), '.') || ' %' end,
           case when p.cortesias = 1 then '1 cortesía' when p.cortesias > 1 then p.cortesias || ' cortesías' end)
$$;

-- Vigentes ahora para una lista de roles ('socio', 'referente', 'turista_cupon'). Interna (A4 y el pase).
create or replace function public.club_promociones_vigentes(p_location text, p_ts timestamptz, p_roles text[])
returns setof public.club_promociones
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from public.club_promociones p
   where p.location_id = p_location and public.club_promo_vigente_en(p, p_ts)
     and (p.para && p_roles or 'todos' = any(p.para))
   order by p.porcentaje desc, p.cortesias desc, p.nombre
$$;

-- Lista (owner y manager leen; solo el owner edita).
create or replace function public.club_promociones_listar(p_location text default null)
returns table (id uuid, nombre text, nombre_en text, para text[], estado text, desde date, hasta date, dias int[],
               hora_desde time, hora_hasta time, porcentaje numeric, cortesias int, beneficio text, vigente_ahora boolean,
               actualizada_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select p.id, p.nombre, p.nombre_en, p.para, p.estado, p.desde, p.hasta, p.dias, p.hora_desde, p.hora_hasta,
           p.porcentaje, p.cortesias, public.club_promo_beneficio(p), public.club_promo_vigente_en(p, now()), p.actualizada_en
      from public.club_promociones p where p.location_id = p_location
     order by case p.estado when 'vigente' then 0 when 'borrador' then 1 else 2 end, p.nombre;
end;
$$;

-- Crear o editar (solo owner). Una terminada no se edita (se crea otra). Queda en la auditoría.
create or replace function public.club_promocion_guardar(p_id uuid, p_datos jsonb, p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_ant  public.club_promociones%rowtype;
  v_id   uuid;
  v_para text[];
  v_dias int[];
  v_nom  text := btrim(coalesce(p_datos->>'nombre', ''));
  v_est  text := coalesce(p_datos->>'estado', 'borrador');
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'Faltan los datos de la promoción' using errcode = 'P0001'; end if;
  if length(v_nom) not between 2 and 80 then raise exception 'Falta el nombre (de 2 a 80 caracteres)' using errcode = 'P0001'; end if;
  if v_est not in ('borrador','vigente','terminada') then raise exception 'Estado no válido: borrador, vigente o terminada' using errcode = 'P0001'; end if;
  begin
    v_para := array(select jsonb_array_elements_text(coalesce(p_datos->'para', '[]')));
    v_dias := array(select (jsonb_array_elements_text(coalesce(p_datos->'dias', '[1,2,3,4,5,6,7]')))::int);
  exception when others then
    raise exception 'Para quién o los días no son válidos' using errcode = 'P0001';
  end;
  if cardinality(v_para) = 0 or not v_para <@ array['socio','referente','turista_cupon','todos'] then
    raise exception 'Elegí para quién: socios, referentes, turistas con cupón o todos' using errcode = 'P0001';
  end if;
  if cardinality(v_dias) = 0 or not v_dias <@ '{1,2,3,4,5,6,7}'::int[] then
    raise exception 'Elegí al menos un día de la semana' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_ant from public.club_promociones where id = p_id and location_id = p_location for update;
    if not found then raise exception 'No se encontró la promoción: recargá la lista' using errcode = 'P0001'; end if;
    if v_ant.estado = 'terminada' then raise exception 'Está terminada: no se edita. Creá una nueva' using errcode = 'P0001'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.club_promociones (location_id, nombre, nombre_en, para, estado, desde, hasta, dias, hora_desde, hora_hasta,
                                           porcentaje, cortesias, creada_por, actualizada_por)
      values (p_location, v_nom, nullif(btrim(coalesce(p_datos->>'nombre_en', '')), ''), v_para, v_est,
              nullif(p_datos->>'desde', '')::date, nullif(p_datos->>'hasta', '')::date, v_dias,
              nullif(p_datos->>'hora_desde', '')::time, nullif(p_datos->>'hora_hasta', '')::time,
              coalesce(nullif(p_datos->>'porcentaje', '')::numeric, 0), coalesce(nullif(p_datos->>'cortesias', '')::int, 0),
              auth.uid(), auth.uid())
      returning id into v_id;
    else
      update public.club_promociones set
        nombre = v_nom, nombre_en = nullif(btrim(coalesce(p_datos->>'nombre_en', '')), ''), para = v_para, estado = v_est,
        desde = nullif(p_datos->>'desde', '')::date, hasta = nullif(p_datos->>'hasta', '')::date, dias = v_dias,
        hora_desde = nullif(p_datos->>'hora_desde', '')::time, hora_hasta = nullif(p_datos->>'hora_hasta', '')::time,
        porcentaje = coalesce(nullif(p_datos->>'porcentaje', '')::numeric, 0), cortesias = coalesce(nullif(p_datos->>'cortesias', '')::int, 0),
        actualizada_por = auth.uid(), actualizada_en = now()
      where id = p_id
      returning id into v_id;
    end if;
  exception
    when unique_violation then raise exception 'Ya hay una promoción con ese nombre' using errcode = 'P0001';
    when check_violation then raise exception 'Revisá los datos: porcentaje de 0 a 100, cortesías de 0 a 3 (al menos uno de los dos), «hasta» después de «desde» y el horario completo' using errcode = 'P0001';
    when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'Fecha, horario o número no válido' using errcode = 'P0001';
  end;
  perform public.club_auditar(case when p_id is null then 'promocion_alta' else 'promocion_edicion' end, 'club_promociones', v_id,
                              case when p_id is null then null else to_jsonb(v_ant) end,
                              (select to_jsonb(p) from public.club_promociones p where p.id = v_id));
  return v_id;
end;
$$;

-- Productos que llegan en las facturas (120 días). owner y manager. Para elegir las cortesías.
drop function if exists public.club_productos(text, text);   -- (08-nov) suma en_seccion
create or replace function public.club_productos(p_buscar text default null, p_location text default null)
returns table (codigo text, nombre text, familia int, veces bigint, ultima timestamptz, es_cortesia boolean, en_seccion boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_q   text := nullif(btrim(coalesce(p_buscar, '')), '');
  v_fam int;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_q is not null and length(v_q) > 40 then v_q := left(v_q, 40); end if;
  select c.cortesia_familia into v_fam from public.club_config c where c.location_id = p_location;
  return query
    select x.codigo, x.nombre, x.familia, x.veces, x.ultima, x.es_cortesia,
           case when v_fam is null or x.familia is null then null else x.familia = v_fam end from (
      select l.codigo_producto as codigo,
             (array_agg(l.nombre order by t.fecha_registra desc))[1] as nombre,
             (array_agg(l.familia order by t.fecha_registra desc))[1] as familia,
             count(*) as veces, max(t.fecha_registra) as ultima, bool_or(l.es_cortesia) as es_cortesia
        from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
       where t.local = p_location and t.fecha_registra >= now() - interval '120 days' and l.codigo_producto is not null
       group by l.codigo_producto) x
     where v_q is null or x.codigo = v_q or x.nombre ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
     order by x.veces desc, x.codigo
     limit 50;
end;
$$;

-- Cortesías del sorteo (owner y manager leen).
create or replace function public.club_cortesias_listar(p_location text default null)
returns table (id uuid, codigo_producto text, nombre text, familia int, activa boolean, en_seccion boolean,
               visto_en_facturas boolean, actualizada_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role(); v_fam int;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select cortesia_familia into v_fam from public.club_config where location_id = p_location;
  return query
    select c.id, c.codigo_producto, c.nombre, c.familia, c.activa,
           case when v_fam is null or c.familia is null then null else c.familia = v_fam end,
           exists (select 1 from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
                    where t.local = p_location and l.codigo_producto = c.codigo_producto and t.fecha_registra >= now() - interval '120 days'),
           c.actualizada_en
      from public.club_cortesias c where c.location_id = p_location
     order by c.activa desc, c.nombre;
end;
$$;

-- Alta o edición de una cortesía (solo owner). Alta: el código del artículo «CORTESÍA CLUB»; si ya se vendió, el
-- nombre y la familia salen de las facturas; si es nuevo (Ismael recién lo creó), el nombre es obligatorio.
-- Con `cortesia_familia` cargada, un artículo de otra familia se rechaza. Edición: nombre y activa (el código no cambia).
create or replace function public.club_cortesia_guardar(p_id uuid, p_codigo text, p_nombre text, p_activa boolean,
                                                        p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_cod  text := btrim(coalesce(p_codigo, ''));
  v_nom  text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_fam  int;
  v_cfam int;
  v_lnom text;
  v_ant  public.club_cortesias%rowtype;
  v_id   uuid;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_id is not null then
    select * into v_ant from public.club_cortesias where id = p_id and location_id = p_location for update;
    if not found then raise exception 'No se encontró la cortesía: recargá la lista' using errcode = 'P0001'; end if;
    if v_nom is not null and length(v_nom) not between 2 and 80 then raise exception 'El nombre va de 2 a 80 caracteres' using errcode = 'P0001'; end if;
    update public.club_cortesias set nombre = coalesce(v_nom, nombre), activa = coalesce(p_activa, activa),
           actualizada_por = auth.uid(), actualizada_en = now()
     where id = p_id returning id into v_id;
    perform public.club_auditar('cortesia_edicion', 'club_cortesias', v_id, to_jsonb(v_ant),
                                (select to_jsonb(c) from public.club_cortesias c where c.id = v_id));
    return v_id;
  end if;
  if v_cod !~ '^[0-9A-Za-z._-]{1,30}$' then raise exception 'Falta el código del artículo del PoS (sección «CORTESÍA CLUB»)' using errcode = 'P0001'; end if;
  select cortesia_familia into v_cfam from public.club_config where location_id = p_location;
  select (array_agg(l.nombre order by t.fecha_registra desc))[1], (array_agg(l.familia order by t.fecha_registra desc))[1]
    into v_lnom, v_fam
    from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
   where t.local = p_location and l.codigo_producto = v_cod and t.fecha_registra >= now() - interval '120 days';
  if v_cfam is not null and v_fam is not null and v_fam <> v_cfam then
    raise exception 'Ese artículo no es de la sección «CORTESÍA CLUB» del PoS (familia %, la sección es %)', v_fam, v_cfam using errcode = 'P0001';
  end if;
  v_nom := coalesce(v_nom, v_lnom);
  if v_nom is null or length(v_nom) not between 2 and 80 then
    raise exception 'Ese código todavía no aparece en ninguna factura: escribí el nombre de la cortesía' using errcode = 'P0001';
  end if;
  begin
    insert into public.club_cortesias (location_id, codigo_producto, nombre, familia, activa, creada_por, actualizada_por)
    values (p_location, v_cod, v_nom, coalesce(v_fam, v_cfam), coalesce(p_activa, true), auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esa cortesía ya está cargada: activala desde la lista' using errcode = 'P0001';
  end;
  perform public.club_auditar('cortesia_alta', 'club_cortesias', v_id, null, (select to_jsonb(c) from public.club_cortesias c where c.id = v_id));
  return v_id;
end;
$$;

-- Promoción inicial (decisión de Ismael): «Local Club: 10 % + 1 cortesía», para socios, todos los días, en BORRADOR.
-- LC-ML: se siembra por local al darlo de alta (trigger club_config_alta, sección LC-ML), sin nombres de local.


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOCAL CLUB · A4.1 (08-nov): visita del socio y «qué aplicar».
--   · La caja escanea el QR fijo del socio (/s/), elige el pedido (como el cupón) y registra la visita. La base
--     responde QUÉ APLICAR: el % de la promo vigente para socios y la cortesía SORTEADA entre las activas.
--   · Sorteo fijo: la visita del día se registra una vez; reescanear devuelve la MISMA (no se re-sortea).
--   · Tope: `club_config.socio_visitas_por_dia` (1) visitas por día por socio.
--   · Regla fija: una factura pagada con créditos no lleva descuento ni cortesía (si ya hay un canje en ese pedido,
--     la visita sale «NO aplicar»; si el canje viene después, la visita queda marcada `con_canje`).
--   · Antiautocanje: un cupón no suma en un pedido donde su anfitrión registró visita de socio.
--   · Sin promoción vigente o sin cortesías activas: «pendiente de configuración», nunca un beneficio inventado.
--   · El cruce con la factura es por el artículo LC (`club_config.lc_articulo_codigo`, '856'); las excepciones, en A5.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.club_config add column if not exists lc_articulo_codigo text not null default '856'
  check (lc_articulo_codigo ~ '^[0-9A-Za-z._-]{1,30}$');
-- 857 «INVITADO» (Ismael, 08-nov): el beneficio Local Club del acompañante de un socio. Cuenta igual que el 856 en todas
-- las reglas (créditos = sin descuento, DESCUENTO_SIN_RESPALDO, CANJE_CON_DESCUENTO, LC_SIN_REGISTRO, visita del socio).
-- SIN límite de invitados por visita (Ismael, 08-nov: «mientras más gente traiga, mejor»).
alter table public.club_config add column if not exists lc_invitado_codigo text not null default '857'
  check (lc_invitado_codigo ~ '^[0-9A-Za-z._-]{1,30}$');
alter table public.club_config drop column if exists lc_invitados_max;   -- existió unas horas en staging; ya no va
-- Grok 91: socios con beneficio por factura (el % se aplica una vez por factura; el resto va como invitado, 857).
alter table public.club_config add column if not exists socios_por_factura int not null default 1 check (socios_por_factura between 1 and 10);

create table if not exists public.club_visitas_socio (
  id               uuid primary key default gen_random_uuid(),
  location_id      text not null,
  miembro_id       uuid not null references public.club_miembros(id),
  fecha            date not null,                      -- día de Costa Rica
  registrada_en    timestamptz not null default now(),
  registrado_por   uuid,
  client_op_id     uuid not null unique,
  pos_ref          jsonb,
  visita_clave     text,
  promo_id         uuid references public.club_promociones(id),
  porcentaje       numeric(5,2) not null default 0,
  cortesias        jsonb not null default '[]'::jsonb, -- [{id, codigo, nombre, motivo}] sorteadas
  estado_beneficio text not null,
  con_canje        boolean not null default false,
  aplicar          jsonb not null                       -- lo que se le mostró a la caja (para el replay)
);
-- Grok 91: «como_invitado» = un segundo socio en una factura que ya tiene uno con beneficio (va con el 857).
alter table public.club_visitas_socio drop constraint if exists club_visitas_socio_estado_beneficio_check;
alter table public.club_visitas_socio add constraint club_visitas_socio_estado_beneficio_check
  check (estado_beneficio in ('aplica','paga_con_creditos','sin_promocion','pendiente_configuracion','como_invitado'));
create index if not exists club_visitas_socio_miembro_idx on public.club_visitas_socio (miembro_id, fecha);
create index if not exists club_visitas_socio_clave_idx on public.club_visitas_socio (visita_clave);
alter table public.club_visitas_socio enable row level security;
revoke all on public.club_visitas_socio from public, anon, authenticated;

-- A4.3: tabla de premios (antes de club_socio_visita, que la usa).
alter table public.club_config add column if not exists premios_referente_mes int not null default 3 check (premios_referente_mes between 0 and 50);
alter table public.club_config add column if not exists premios_validador_mes int not null default 10 check (premios_validador_mes between 0 and 500);
alter table public.club_config add column if not exists premio_vence_dias int not null default 60 check (premio_vence_dias between 7 and 365);

create table if not exists public.club_premios (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  beneficiario    uuid not null references public.club_miembros(id),
  referido        uuid not null unique references public.club_miembros(id),   -- un referido da a lo sumo un premio
  ticket_id       uuid,                                                        -- la primera factura C con el 856
  estado          text not null check (estado in ('disponible','usado','vencido','sin_premio')),
  motivo          text check (motivo is null or motivo in ('autorreferido','ciclo','tope_referente','tope_validador')),
  creado_en       timestamptz not null default now(),
  vence_en        timestamptz,
  usado_en        timestamptz,
  visita_id       uuid references public.club_visitas_socio(id),
  check ((estado = 'sin_premio') = (motivo is not null))
);
create index if not exists club_premios_benef_idx on public.club_premios (beneficiario, estado);
alter table public.club_premios enable row level security;
revoke all on public.club_premios from public, anon, authenticated;

-- Registrar la visita del socio y decir qué aplicar. owner, manager, cajero.
-- CLUB COMPARTIDO (Ismael, 08-nov): el socio vale en TODOS los locales encendidos. La visita es del local de la CAJA
-- (p_location, encendido): su pedido, su promo, sus cortesías y sus códigos; queda guardada con ese local. El tope de
-- visitas con beneficio por día es GLOBAL (todas las visitas del socio, en cualquier local).
drop function if exists public.club_socio_visita(uuid, jsonb, uuid);
create or replace function public.club_socio_visita(p_miembro uuid, p_pos jsonb, p_op uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_m     public.club_miembros%rowtype;
  v_r     public.club_miembro_roles%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_visitas_socio%rowtype;
  v_pos   jsonb;
  v_clave text;
  v_hoy   date := (now() at time zone 'America/Costa_Rica')::date;
  v_promo public.club_promociones%rowtype;
  v_cort  jsonb := '[]'::jsonb;
  v_est   text;
  v_pct   numeric := 0;
  v_avis  jsonb := '[]'::jsonb;
  v_texto text;
  v_n     int;
  v_id    uuid;
  v_prem  public.club_premios%rowtype;
  v_extra jsonb;
  v_loc   text;
  r       jsonb;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_op is null then raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));
  select * into v_prev from public.club_visitas_socio where client_op_id = p_op;
  if found then
    if v_prev.miembro_id <> p_miembro then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    return v_prev.aplicar || jsonb_build_object('repetida', true);
  end if;

  select * into v_m from public.club_miembros where id = p_miembro;
  if not found then raise exception 'No se encontró al socio: escaneá su QR de nuevo' using errcode = 'P0001'; end if;
  v_loc := public.club_local(p_location, true);   -- Club compartido: el local de la CAJA, encendido (el del socio puede estar apagado)
  perform pg_advisory_xact_lock(hashtextextended('club_socio_visita:' || p_miembro::text, 0));
  select * into v_r from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio';
  if not found or v_m.estado <> 'activo' or v_r.estado = 'baja' then
    raise exception 'No es socio activo: seguí con la cuenta normal, sin beneficio' using errcode = 'P0001';
  end if;
  if v_r.estado = 'pendiente' then
    raise exception 'Socio pendiente: validalo primero (botón «Validar socio») y después registrá la visita' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_loc;

  if p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null' then
    raise exception 'Falta el pedido: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  v_pos := public.club_pos_ref(p_pos, v_loc);
  v_clave := coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, v_pos, null));

  -- Tope por día. En el MISMO pedido: la caja ve la visita que ya está (misma cortesía, sin re-sorteo).
  -- Grok 90: en OTRO pedido → «ya_uso_hoy», NO aplicar beneficio (no se registra nada).
  select count(*) into v_n from public.club_visitas_socio where miembro_id = p_miembro and fecha = v_hoy;
  if v_n >= v_cfg.socio_visitas_por_dia then
    select * into v_prev from public.club_visitas_socio
     where miembro_id = p_miembro and fecha = v_hoy and location_id = v_loc and visita_clave is not distinct from v_clave
     order by registrada_en desc limit 1;
    if v_prev.id is not null then
      return v_prev.aplicar || jsonb_build_object('repetida', true,
        'avisos', coalesce(v_prev.aplicar->'avisos', '[]'::jsonb) || to_jsonb('Ya registró su visita de hoy en este pedido: es la misma de antes (la cortesía no se vuelve a sortear).'::text));
    end if;
    return jsonb_build_object('visita_id', null, 'socio', public.club_nombre_limpio(v_m.nombre), 'estado', 'ya_uso_hoy',
      'porcentaje', 0, 'cortesias', '[]'::jsonb, 'texto', 'Ya usó su beneficio hoy en otro pedido: NO aplicar beneficio',
      'avisos', jsonb_build_array('El tope es de ' || v_cfg.socio_visitas_por_dia || ' visita(s) con beneficio por día. Si viene con otro socio, puede ir como su invitado (857).'),
      'articulo_lc', v_cfg.lc_articulo_codigo, 'repetida', false, 'promo', null);
  end if;

  -- Regla fija: pagada con créditos → sin descuento ni cortesía.
  if v_clave is not null and exists (select 1 from public.club_movimientos mv where mv.tipo = 'canje' and mv.location_id = v_loc and mv.visita_clave = v_clave) then
    v_est := 'paga_con_creditos';
  -- Grok 91: ya hay `socios_por_factura` socio(s) con beneficio en esta factura → este va como invitado (857).
  elsif v_clave is not null and (select count(*) from public.club_visitas_socio x
                                   where x.location_id = v_loc and x.visita_clave = v_clave and x.miembro_id <> p_miembro
                                     and x.estado_beneficio in ('aplica','pendiente_configuracion')) >= v_cfg.socios_por_factura then
    v_est := 'como_invitado';
  else
    select p.* into v_promo from public.club_promociones_vigentes(v_loc, now(), array['socio']) p limit 1;
    if v_promo.id is null then
      v_est := 'sin_promocion';
    else
      v_est := 'aplica';
      v_pct := v_promo.porcentaje;
      if v_promo.cortesias > 0 and v_cfg.cortesias_por_visita > 0 then
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'promo')), '[]'::jsonb)
          into v_cort
          from (select * from public.club_cortesias c where c.location_id = v_loc and c.activa
                 order by random() limit least(v_promo.cortesias, v_cfg.cortesias_por_visita)) c;
        if jsonb_array_length(v_cort) = 0 then
          v_est := 'pendiente_configuracion';
          v_avis := v_avis || to_jsonb('Cortesía: pendiente de configuración (no hay artículos de «CORTESÍA CLUB» activos). Aplicá solo el descuento.'::text);
        end if;
      end if;
    end if;
  end if;

  -- A4.3: premio por referir disponible → una cortesía extra sorteada (no en una visita pagada con créditos ni sin promo).
  if v_est in ('aplica','pendiente_configuracion') then
    select * into v_prem from public.club_premios p
     where p.beneficiario = p_miembro and p.estado = 'disponible' and p.vence_en > now()
     order by p.vence_en limit 1 for update;
    if v_prem.id is not null then
      select jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'premio_referido') into v_extra
        from public.club_cortesias c
       where c.location_id = v_loc and c.activa
         and not exists (select 1 from jsonb_array_elements(v_cort) y where y->>'id' = c.id::text)
       order by random() limit 1;
      if v_extra is null then   -- todas ya salieron en el sorteo de la promo: puede repetirse el producto
        select jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'premio_referido') into v_extra
          from public.club_cortesias c where c.location_id = v_loc and c.activa order by random() limit 1;
      end if;
      if v_extra is null then
        v_avis := v_avis || to_jsonb('Tiene un premio por referir guardado: pendiente de configuración (no hay cortesías activas). Queda para la próxima.'::text);
        v_prem.id := null;
      else
        v_cort := v_cort || v_extra;
        if v_est = 'pendiente_configuracion' then v_est := 'aplica'; end if;
      end if;
    end if;
  end if;

  -- Antiautocanje (al revés): si este socio ya usó un cupón propio en este pedido, se avisa (A5: CUPON_AUTOREFERIDO).
  if v_clave is not null and exists (select 1 from public.club_movimientos mv where mv.tipo = 'tarjeta' and mv.miembro_id = p_miembro and mv.location_id = v_loc and mv.visita_clave = v_clave) then
    v_avis := v_avis || to_jsonb('Este socio ya registró un cupón propio en este pedido: queda para revisión.'::text);
  end if;

  v_texto := case v_est
    when 'paga_con_creditos' then 'Paga con créditos: NO aplicar descuento ni cortesía'
    when 'como_invitado' then 'Ya hay un socio con beneficio en esta factura: este socio va como invitado (marcá el ' || v_cfg.lc_invitado_codigo || '). El % se aplica una sola vez.'
    when 'sin_promocion' then case when exists (select 1 from public.club_promociones p where p.location_id = v_loc and p.estado = 'borrador' and 'socio' = any(p.para))
                                   then 'Promoción del Local Club en borrador (pendiente de configuración): NO aplicar beneficio'
                                   else 'Sin promoción vigente para socios ahora: NO aplicar beneficio' end
    else concat_ws(' + ',
           case when v_pct > 0 then trim(to_char(v_pct, 'FM990.##'), '.') || ' % LC' end,
           (select string_agg(case when x->>'motivo' = 'premio_referido' then '1 cortesía de premio: ' else '1 cortesía: ' end || (x->>'nombre'), ' + ')
              from jsonb_array_elements(v_cort) x))
    end;
  if v_est in ('aplica','pendiente_configuracion') then
    v_avis := v_avis || to_jsonb(format('Acompañantes: el artículo %s (INVITADO) por cada uno.', v_cfg.lc_invitado_codigo));
    v_avis := v_avis || to_jsonb(format('Marcá el artículo %s (LOCAL CLUB) en la factura%s.', v_cfg.lc_articulo_codigo,
      case when jsonb_array_length(v_cort) > 0 then ' y la cortesía con su artículo de «CORTESÍA CLUB»' else '' end));
  end if;

  v_id := gen_random_uuid();
  r := jsonb_build_object('visita_id', v_id, 'socio', public.club_nombre_limpio(v_m.nombre), 'estado', v_est,
                          'porcentaje', v_pct, 'cortesias', v_cort, 'texto', coalesce(nullif(v_texto, ''), 'Sin beneficio'),
                          'avisos', v_avis, 'articulo_lc', v_cfg.lc_articulo_codigo, 'repetida', false,
                          'promo', case when v_promo.id is not null then v_promo.nombre end);
  insert into public.club_visitas_socio (id, location_id, miembro_id, fecha, registrado_por, client_op_id, pos_ref, visita_clave,
                                         promo_id, porcentaje, cortesias, estado_beneficio, aplicar)
  values (v_id, v_loc, p_miembro, v_hoy, auth.uid(), p_op, v_pos, v_clave, v_promo.id, v_pct, v_cort, v_est, r);
  insert into public.club_pase_eventos (miembro_id, motivo) values (p_miembro, 'cortesia');
  if v_prem.id is not null then
    update public.club_premios set estado = 'usado', usado_en = now(), visita_id = v_id where id = v_prem.id;
  end if;
  return r;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOCAL CLUB · A4.3 (08-nov): premio por referir socios (LC-DES-02).
--   · Nace SOLO con la primera factura C del referido que tenga el artículo LC (856) y cruce con una visita suya.
--   · Sin autorreferido (mismo teléfono) ni ciclos (A refiere a B y B a A). Topes por mes: por referente
--     (`premios_referente_mes`, 3) y por quien validó al referido (`premios_validador_mes`, 10). Vence a los
--     `premio_vence_dias` (60). Lo que no da premio queda anotado con el motivo (no se reevalúa).
--   · Se consume en la próxima visita del que refirió: una cortesía extra sorteada (motivo `premio_referido`). Sin
--     cortesías activas, el premio sigue disponible («pendiente de configuración»).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Genera los premios que correspondan (interna; la llama el mantenimiento diario). Devuelve cuántos dio.
create or replace function public.club_premios_generar(p_location text default null)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- CLUB COMPARTIDO (08-nov): el premio nace con la primera factura C con el 856/857 del referido en CUALQUIER local
-- encendido (con los códigos de ESE local) y queda con ese local; se cobra en cualquier local. Los topes por mes son
-- por persona (globales); sus valores salen del local del premio. p_location null = todos los locales encendidos (lo
-- que usa la tarea diaria); con un local, solo las visitas de ese local (y 0 si está apagado).
declare
  v_cfg  public.club_config%rowtype;
  r      record;
  v_mes  timestamptz := date_trunc('month', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  v_n    int := 0;
  v_mot  text;
begin
  if p_location is not null then
    p_location := public.club_local(p_location, false);
    if not public.club_local_activo(p_location) then return 0; end if;   -- Club apagado: no genera premios
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_premios', 0));    -- una pasada a la vez (los topes son por persona)
  for r in
    select rr.miembro_id as referido, rr.referido_por as benef, rr.validado_por as validador, f.ticket_id, f.loc
      from public.club_miembro_roles rr
      join public.club_miembros m on m.id = rr.miembro_id and m.estado = 'activo'
      cross join lateral (
        select t.id as ticket_id, t.fecha_registra, v.location_id as loc
          from public.club_visitas_socio v
          join public.club_config c on c.location_id = v.location_id and c.club_activo
          cross join lateral unnest(public.club_cruce_facturas(v.location_id, v.pos_ref, null)) x(tid)
          join public.pos_ndf_tickets t on t.id = x.tid and t.estado = 'C'
         where v.miembro_id = rr.miembro_id and (p_location is null or v.location_id = p_location)
           and exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = t.id
                         and l.codigo_producto in (c.lc_articulo_codigo, c.lc_invitado_codigo))
         order by t.fecha_registra limit 1) f
     where rr.rol = 'socio' and rr.estado = 'activo' and rr.referido_por is not null and rr.referido_por <> rr.miembro_id
       and not exists (select 1 from public.club_premios p where p.referido = rr.miembro_id)
       and exists (select 1 from public.club_miembro_roles b where b.miembro_id = rr.referido_por and b.rol = 'socio' and b.estado = 'activo')
     order by f.fecha_registra
  loop
    select * into v_cfg from public.club_config where location_id = r.loc;
    v_mot := null;
    if exists (select 1 from public.club_miembros_contacto a join public.club_miembros_contacto b on b.telefono = a.telefono
                where a.miembro_id = r.referido and b.miembro_id = r.benef and a.telefono is not null) then
      v_mot := 'autorreferido';
    elsif exists (select 1 from public.club_miembro_roles c where c.miembro_id = r.benef and c.rol = 'socio' and c.referido_por = r.referido) then
      v_mot := 'ciclo';
    elsif (select count(*) from public.club_premios p where p.beneficiario = r.benef and p.estado <> 'sin_premio' and p.creado_en >= v_mes)
          >= v_cfg.premios_referente_mes then
      v_mot := 'tope_referente';
    elsif r.validador is not null and (select count(*) from public.club_premios p join public.club_miembro_roles q on q.miembro_id = p.referido and q.rol = 'socio'
                                         where q.validado_por = r.validador and p.estado <> 'sin_premio' and p.creado_en >= v_mes)
          >= v_cfg.premios_validador_mes then
      v_mot := 'tope_validador';
    end if;
    insert into public.club_premios (location_id, beneficiario, referido, ticket_id, estado, motivo, vence_en)
    values (r.loc, r.benef, r.referido, r.ticket_id, case when v_mot is null then 'disponible' else 'sin_premio' end, v_mot,
            case when v_mot is null then now() + make_interval(days => v_cfg.premio_vence_dias) end);
    if v_mot is null then
      v_n := v_n + 1;
      insert into public.club_pase_eventos (miembro_id, motivo) values (r.benef, 'cortesia');
    end if;
  end loop;
  -- vencidos
  update public.club_premios set estado = 'vencido'
   where estado = 'disponible' and vence_en < now() and (p_location is null or location_id = p_location);
  return v_n;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LC-MD · MARCADORES DE DESCUENTO por local (Ismael, 08-nov). La lista fija (856, 857, PROMO CLUB) pasa a ser una
-- lista CONFIGURABLE por local: artículos del PoS que «respaldan» un descuento en la factura (tarjetas de hoteles o
-- tiendas, descuento de personal, el Local Club, la promo…). DESCUENTO_SIN_RESPALDO y CANJE_CON_DESCUENTO la usan:
-- cargar un marcador nuevo hace que esas facturas dejen de salir como excepción, sin código.
--   · pct_esperado null = respalda cualquier descuento; con valor = solo un descuento de ese % (±1,5 puntos).
--   · No se borran: se desactivan (queda la historia). Los edita el owner; owner, manager y contador los ven.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.club_marcadores_descuento (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  codigo_producto text not null check (codigo_producto ~ '^[0-9A-Za-z._-]{1,30}$'),
  nombre          text not null check (length(btrim(nombre)) between 2 and 80),
  pct_esperado    numeric(5,2) check (pct_esperado is null or (pct_esperado > 0 and pct_esperado <= 100)),
  activo          boolean not null default true,
  creado_por      uuid,
  creado_en       timestamptz not null default now(),
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now(),
  unique (location_id, codigo_producto)
);
alter table public.club_marcadores_descuento enable row level security;
revoke all on public.club_marcadores_descuento from public, anon, authenticated;

-- Siembra (genérica, sin nombres de local): los códigos que ya respaldaban descuentos en cada local configurado.
-- Idempotente: no se borran filas, así que un marcador desactivado no vuelve.
insert into public.club_marcadores_descuento (location_id, codigo_producto, nombre)
select c.location_id, x.cod, x.nom
  from public.club_config c
 cross join lateral (values (c.lc_articulo_codigo, 'LOCAL CLUB (socio)'), (c.lc_invitado_codigo, 'INVITADO (Local Club)'),
                            (c.promo_articulo_codigo, 'PROMO CLUB')) x(cod, nom)
 where x.cod is not null
on conflict (location_id, codigo_producto) do nothing;

create or replace function public.club_marcadores_listar(p_location text default null)
returns table (id uuid, codigo_producto text, nombre text, pct_esperado numeric, activo boolean,
               visto_en_facturas boolean, actualizado_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager','contador') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  return query
    select m.id, m.codigo_producto, m.nombre, m.pct_esperado, m.activo,
           exists (select 1 from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
                    where t.local = p_location and l.codigo_producto = m.codigo_producto and t.fecha_registra >= now() - interval '120 days'),
           m.actualizado_en
      from public.club_marcadores_descuento m where m.location_id = p_location
     order by m.activo desc, m.nombre;
end;
$$;

-- Alta (p_id null: código del PoS + nombre) o edición (nombre, % esperado y activo; el código no cambia). Solo owner.
create or replace function public.club_marcador_guardar(p_id uuid, p_codigo text, p_nombre text, p_pct numeric,
                                                        p_activo boolean, p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_cod text := btrim(coalesce(p_codigo, ''));
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_ant public.club_marcadores_descuento%rowtype;
  v_id  uuid;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  if p_pct is not null and (p_pct <= 0 or p_pct > 100) then
    raise exception 'El %% esperado va de 0,01 a 100 (o vacío: cualquier descuento)' using errcode = 'P0001';
  end if;
  if v_nom is not null and length(v_nom) not between 2 and 80 then
    raise exception 'El nombre va de 2 a 80 caracteres' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_ant from public.club_marcadores_descuento where id = p_id and location_id = p_location for update;
    if not found then raise exception 'No se encontró el marcador: recargá la lista' using errcode = 'P0001'; end if;
    update public.club_marcadores_descuento
       set nombre = coalesce(v_nom, nombre), pct_esperado = p_pct, activo = coalesce(p_activo, activo),
           actualizado_por = auth.uid(), actualizado_en = now()
     where id = p_id returning id into v_id;
    perform public.club_auditar('marcador_edicion', 'club_marcadores_descuento', v_id, to_jsonb(v_ant),
                                (select to_jsonb(m) from public.club_marcadores_descuento m where m.id = v_id));
    return v_id;
  end if;
  if v_cod !~ '^[0-9A-Za-z._-]{1,30}$' then raise exception 'Falta el código del artículo marcador del PoS' using errcode = 'P0001'; end if;
  v_nom := coalesce(v_nom, (select (array_agg(l.nombre order by t.fecha_registra desc))[1]
                              from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
                             where t.local = p_location and l.codigo_producto = v_cod and t.fecha_registra >= now() - interval '120 days'));
  if v_nom is null or length(v_nom) not between 2 and 80 then
    raise exception 'Ese código todavía no aparece en ninguna factura: escribí el nombre del marcador' using errcode = 'P0001';
  end if;
  begin
    insert into public.club_marcadores_descuento (location_id, codigo_producto, nombre, pct_esperado, activo, creado_por, actualizado_por)
    values (p_location, v_cod, v_nom, p_pct, coalesce(p_activo, true), auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ese código ya es un marcador de este local: editalo en la lista' using errcode = 'P0001';
  end;
  perform public.club_auditar('marcador_alta', 'club_marcadores_descuento', v_id, null,
                              (select to_jsonb(m) from public.club_marcadores_descuento m where m.id = v_id));
  return v_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LC-DT · DESCUENTOS TIPIFICADOS POR PORCENTAJE, por local (Ismael, 08-nov). Hay descuentos que el PoS aplica SIN artículo
-- (p. ej. 10 %, 15 %, 30 %). Cargados acá (nombre, %, activo), DESCUENTO_SIN_RESPALDO los muestra CLASIFICADOS (±1,5 puntos)
-- y separados de los que no encajan en ningún tipo ni marcador («sin clasificar»: la alarma real). Los edita el owner.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.club_descuentos_tipo (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  nombre          text not null check (length(btrim(nombre)) between 2 and 60),
  pct             numeric(5,2) not null check (pct > 0 and pct <= 100),
  activo          boolean not null default true,
  creado_por      uuid,
  creado_en       timestamptz not null default now(),
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now(),
  unique (location_id, nombre)
);
alter table public.club_descuentos_tipo enable row level security;
revoke all on public.club_descuentos_tipo from public, anon, authenticated;

create or replace function public.club_descuentos_tipo_listar(p_location text default null)
returns table (id uuid, nombre text, pct numeric, activo boolean, actualizado_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager','contador') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  return query select d.id, d.nombre, d.pct, d.activo, d.actualizado_en from public.club_descuentos_tipo d
                where d.location_id = p_location order by d.activo desc, d.pct;
end;
$$;

create or replace function public.club_descuento_tipo_guardar(p_id uuid, p_nombre text, p_pct numeric, p_activo boolean,
                                                              p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_ant public.club_descuentos_tipo%rowtype;
  v_id  uuid;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  if v_nom is not null and length(v_nom) not between 2 and 60 then raise exception 'El nombre va de 2 a 60 caracteres' using errcode = 'P0001'; end if;
  if p_pct is not null and (p_pct <= 0 or p_pct > 100) then raise exception 'El porcentaje va de 0,01 a 100' using errcode = 'P0001'; end if;
  begin
    if p_id is null then
      if v_nom is null or p_pct is null then raise exception 'Falta el nombre o el porcentaje del tipo de descuento' using errcode = 'P0001'; end if;
      insert into public.club_descuentos_tipo (location_id, nombre, pct, activo, creado_por, actualizado_por)
      values (p_location, v_nom, p_pct, coalesce(p_activo, true), auth.uid(), auth.uid()) returning id into v_id;
      perform public.club_auditar('descuento_tipo_alta', 'club_descuentos_tipo', v_id, null,
                                  (select to_jsonb(d) from public.club_descuentos_tipo d where d.id = v_id));
    else
      select * into v_ant from public.club_descuentos_tipo where id = p_id and location_id = p_location for update;
      if not found then raise exception 'No se encontró el tipo de descuento: recargá la lista' using errcode = 'P0001'; end if;
      update public.club_descuentos_tipo set nombre = coalesce(v_nom, nombre), pct = coalesce(p_pct, pct), activo = coalesce(p_activo, activo),
             actualizado_por = auth.uid(), actualizado_en = now()
       where id = p_id returning id into v_id;
      perform public.club_auditar('descuento_tipo_edicion', 'club_descuentos_tipo', v_id, to_jsonb(v_ant),
                                  (select to_jsonb(d) from public.club_descuentos_tipo d where d.id = v_id));
    end if;
  exception when unique_violation then
    raise exception 'Ya hay un tipo de descuento con ese nombre en este local' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

-- Reporte de descuentos sin artículo: por mes, tipo (o «sin clasificar») y turno. Facturas y monto estimado. Owner y manager.
create or replace function public.club_reporte_descuentos(p_desde date, p_hasta date, p_location text default null)
returns table (mes text, tipo text, turno text, facturas int, descuento_crc numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  return query
    select to_char(e.fecha at time zone 'America/Costa_Rica', 'YYYY-MM'),
           coalesce(e.detalle->>'clasificacion', 'sin clasificar'), coalesce(e.detalle->>'turno', '—'),
           count(*)::int, coalesce(sum((e.detalle->>'descuento_crc')::numeric), 0)
      from public.club_excepciones(p_desde, p_hasta, p_location, 'DESCUENTO_SIN_RESPALDO') e
     group by 1, 2, 3
     order by 1, (coalesce(e.detalle->>'clasificacion', 'sin clasificar') = 'sin clasificar') desc, 2, 3;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LC-ML · MULTILOCAL (Ismael, 08-nov). El Club corre POR LOCAL y los locales salen de datos (`club_config`): ninguna
-- función ni pantalla nombra un local. Encender o apagar el Club en un local es UN dato, sin código ni migración:
--   update public.club_config set club_activo = true where location_id = '<local>';   (o el interruptor del owner)
-- Apagado = en ese local no hay altas (caja ni autoalta), visitas de socio, cupones, canjes, tarjeta manual, premios ni
-- excepciones LC. Sí se puede preparar su configuración (promociones, cortesías, códigos del PoS, anfitriones, negocios)
-- y leer sus reportes. Checklist «Encender un local» en el RUNBOOK. Alta de un local: un INSERT en club_config (o
-- club_local_crear desde la app); el trigger club_config_alta siembra sus marcadores y su promoción en borrador.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
                  and column_name = 'club_activo') then
    alter table public.club_config add column club_activo boolean not null default false;
    -- Una sola vez, al crear la columna: el Club ya corría en los locales que tenían config. Si después se apaga, no se pisa.
    update public.club_config set club_activo = true;
  end if;
end $$;
alter table public.club_config add column if not exists nombre    text check (nombre is null or length(btrim(nombre)) between 1 and 60);
alter table public.club_config add column if not exists direccion text check (direccion is null or length(direccion) <= 160);
alter table public.club_config add column if not exists mapa_url  text check (mapa_url is null or mapa_url ~ '^https://');
alter table public.club_config drop constraint if exists club_config_location_id_formato;
alter table public.club_config add constraint club_config_location_id_formato check (location_id ~ '^[a-z0-9-]{2,40}$');
-- Los datos de cada local (nombre, dirección, mapa, encendido) son filas: RUNBOOK paso 4b, sin nombres en esta migración.

-- ¿El Club está encendido en el local?
create or replace function public.club_local_activo(p_location text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select c.club_activo from public.club_config c where c.location_id = p_location), false);
$$;

-- El local de una operación. Con dato: tiene que existir en club_config (y, si p_exigir_activo, con el Club encendido).
-- Sin dato: el único local con el Club encendido; con dos o más, hay que elegir (nunca se supone uno por nombre).
create or replace function public.club_local(p_location text, p_exigir_activo boolean default true)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.club_config%rowtype;
  v_n int;
begin
  if p_location is null then
    select count(*) into v_n from public.club_config c where c.club_activo;
    if v_n = 0 then
      raise exception 'El Club no está activo en ningún local' using errcode = 'P0001';
    elsif v_n > 1 then
      raise exception 'Hay más de un local con el Club activo: elegí el local' using errcode = 'P0001';
    end if;
    select c.* into v_c from public.club_config c where c.club_activo;
    return v_c.location_id;
  end if;
  select c.* into v_c from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  if p_exigir_activo and not v_c.club_activo then
    raise exception 'El Club no está activo en %', coalesce(v_c.nombre, v_c.location_id) using errcode = 'P0001';
  end if;
  return v_c.location_id;
end;
$$;

-- Locales con el Club encendido (PÚBLICA, solo por club-web): la autoalta ofrece elegir cuando hay más de uno.
create or replace function public.club_locales_activos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.club_web_ok() then
    raise exception 'No disponible' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.location_id, 'nombre', coalesce(c.nombre, c.location_id),
                                                       'direccion', c.direccion, 'mapa', c.mapa_url) order by c.location_id)
                     from public.club_config c where c.club_activo), '[]'::jsonb);
end;
$$;


-- `location_id` en las tablas del Club: NOT NULL y SIN default (Ismael, 08-nov). Nunca se asume un local en silencio:
-- las funciones, el migrador (`--local`) y las pruebas lo pasan explícito; una inserción sin local falla.
do $$
declare r record;
begin
  for r in select c.table_name from information_schema.columns c
            where c.table_schema = 'public' and c.table_name like 'club\_%' and c.column_name = 'location_id'
              and c.table_name <> 'club_config'
              and exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = c.table_name
                            and t.table_type = 'BASE TABLE') loop
    execute format('alter table public.%I alter column location_id drop default', r.table_name);
    execute format('alter table public.%I alter column location_id set not null', r.table_name);
  end loop;
end $$;
alter table public.club_config alter column location_id drop default;

-- Alta de un local (INSERT en club_config o club_local_crear): siembra sus marcadores de descuento (los códigos del
-- PoS de su fila) y la promoción «Local Club» en BORRADOR. Nada más: cortesías, anfitriones y demás se cargan por app.
create or replace function public.club_config_alta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.club_marcadores_descuento (location_id, codigo_producto, nombre, pct_esperado)
  select new.location_id, x.cod, x.nom, x.pct
    from (values (new.lc_articulo_codigo, 'LOCAL CLUB (socio)', null::numeric), (new.lc_invitado_codigo, 'INVITADO (Local Club)', null),
                 (new.promo_articulo_codigo, 'PROMO CLUB 10 %', 10)) x(cod, nom, pct)
   where x.cod is not null
  on conflict (location_id, codigo_producto) do nothing;
  if tg_op = 'UPDATE' then return new; end if;   -- al cambiar un código: solo su marcador
  insert into public.club_promociones (location_id, nombre, para, estado, porcentaje, cortesias)
  select new.location_id, 'Local Club', array['socio'], 'borrador', 10, 1
   where not exists (select 1 from public.club_promociones p where p.location_id = new.location_id and lower(p.nombre) = 'local club');
  return new;
end;
$$;
drop trigger if exists club_config_alta_trg on public.club_config;
create trigger club_config_alta_trg after insert on public.club_config for each row execute function public.club_config_alta();
-- al cargar o cambiar un código del PoS (p. ej. PROMO CLUB), su marcador de descuento se siembra solo
drop trigger if exists club_config_codigos_trg on public.club_config;
create trigger club_config_codigos_trg after update of lc_articulo_codigo, lc_invitado_codigo, promo_articulo_codigo on public.club_config
  for each row execute function public.club_config_alta();

-- Locales que ya existían: la misma siembra (idempotente, genérica).
insert into public.club_promociones (location_id, nombre, para, estado, porcentaje, cortesias)
select c.location_id, 'Local Club', array['socio'], 'borrador', 10, 1
  from public.club_config c
 where not exists (select 1 from public.club_promociones p where p.location_id = c.location_id and lower(p.nombre) = 'local club');

-- Alta de un local desde la app (solo owner). Queda APAGADO. Con p_copiar_de, arranca con la configuración de ese
-- local (códigos del PoS, topes, valores del crédito) para revisar; sin él, con los valores por defecto.
create or replace function public.club_local_crear(p_id text, p_nombre text, p_direccion text default null,
                                                   p_mapa text default null, p_copiar_de text default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_id  text := lower(btrim(coalesce(p_id, '')));
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_dir text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_map text := nullif(btrim(coalesce(p_mapa, '')), '');
  v_base public.club_config%rowtype;
  v_nuevo public.club_config%rowtype;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'El id del local va en minúsculas, números y guiones (2 a 40), por ejemplo «playa-nueva»' using errcode = 'P0001';
  end if;
  if v_nom is null or length(v_nom) > 60 then raise exception 'Falta el nombre del local (hasta 60 caracteres)' using errcode = 'P0001'; end if;
  if v_map is not null and v_map !~ '^https://' then raise exception 'El enlace del mapa tiene que empezar con https://' using errcode = 'P0001'; end if;
  if exists (select 1 from public.club_config where location_id = v_id) then
    raise exception 'Ya existe un local con ese id' using errcode = 'P0001';
  end if;
  if p_copiar_de is not null then
    select * into v_base from public.club_config where location_id = p_copiar_de;
    if not found then raise exception 'No existe el local a copiar' using errcode = 'P0001'; end if;
    v_nuevo := jsonb_populate_record(v_base, jsonb_build_object('location_id', v_id, 'nombre', v_nom, 'direccion', v_dir,
                 'mapa_url', v_map, 'club_activo', false, 'lc_excepciones_desde', null, 'created_at', now(), 'updated_at', now()));
    insert into public.club_config select v_nuevo.*;
  else
    insert into public.club_config (location_id, nombre, direccion, mapa_url, club_activo)
    values (v_id, v_nom, v_dir, v_map, false);
  end if;
  perform public.club_auditar('local_alta', 'club_config', null, null,
                              (select to_jsonb(c) from public.club_config c where c.location_id = v_id));
  return v_id;
end;
$$;

-- ── 5. EXECUTE: nada por defecto, grant explícito ───────────────────────────

revoke all on function public.club_gen_codigo(int)                       from public, anon, authenticated;
revoke all on function public.club_creditos(bigint, int)                 from public, anon;
revoke all on function public.club_personas_proximo(bigint, int)         from public, anon;
revoke all on function public.club_norm_factura(text)                     from public, anon, authenticated;
revoke all on function public.club_num(numeric)                           from public, anon, authenticated;
revoke all on function public.club_saldo_personas(uuid)                  from public, anon, authenticated;
revoke all on function public.club_cupon_crear(text, jsonb)              from public, anon, authenticated;
revoke all on function public.club_cupon_usar(text, int, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.club_canje(uuid, text, numeric, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.club_canje_aplicar(uuid, text, numeric, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_canje_aprobado(uuid, numeric, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_canje_codigo_generar(text)       from public, anon, authenticated;
revoke all on function public.club_canje_aviso(uuid)                from public, anon, authenticated;
revoke all on function public.club_codigo_hash(text)                from public, anon, authenticated;
revoke all on function public.club_canje_bloqueado(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.club_referente_json(uuid, public.club_codigos_canje, text, text) from public, anon, authenticated;
revoke all on function public.club_resolver_miembro(uuid)           from public, anon, authenticated;
revoke all on function public.club_miembro_codigo(uuid)             from public, anon, authenticated;
revoke all on function public.club_puente_fresco(text)              from public, anon, authenticated;
revoke all on function public.club_mov_solo_insercion()             from public, anon, authenticated;
revoke all on function public.club_mov_sin_truncate()               from public, anon, authenticated;
revoke all on function public.club_auditoria_inmutable()            from public, anon, authenticated;
revoke all on function public.club_auditar(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.club_auditar_trg()                    from public, anon, authenticated;
revoke all on function public.club_excepcion_segregacion(text, text, text, public.user_role) from public, anon, authenticated;
revoke all on function public.club_comparacion_cargar(jsonb, text)  from public, anon, authenticated;
revoke all on function public.club_comparacion(date, date, text)    from public, anon, authenticated;
grant execute on function public.club_canje_aviso(uuid)             to authenticated;
grant execute on function public.club_resolver_miembro(uuid)        to authenticated;
grant execute on function public.club_miembro_codigo(uuid)          to authenticated;
grant execute on function public.club_comparacion_cargar(jsonb, text) to authenticated;
grant execute on function public.club_comparacion(date, date, text) to authenticated;
-- LC-A1
revoke all on function public.club_codigo_socio_nuevo()                          from public, anon, authenticated;
revoke all on function public.club_roles_desde_miembro()                         from public, anon, authenticated;
revoke all on function public.club_roles_codigo_socio()                          from public, anon, authenticated;
revoke all on function public.club_tiene_rol(uuid, text[], text[])               from public, anon, authenticated;
revoke all on function public.club_rol_activar_anfitrion(uuid, text, text)       from public, anon, authenticated;
grant execute on function public.club_rol_activar_anfitrion(uuid, text, text)    to authenticated;
-- LC-A2
revoke all on function public.club_miembro_por_telefono(text)                    from public, anon, authenticated;
revoke all on function public.club_socio_crear(text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.club_socio_provisional(uuid, int)                  from public, anon, authenticated;
revoke all on function public.club_socio_alta_caja(text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.club_socio_validar(uuid, boolean, text)            from public, anon, authenticated;
revoke all on function public.club_socio_confirmar(uuid, text)                   from public, anon, authenticated;
revoke all on function public.club_socio_autoalta(jsonb)                         from public, anon, authenticated;
revoke all on function public.club_socio_baja_portal(text)                       from public, anon, authenticated;
revoke all on function public.club_socios_mantenimiento()                        from public, anon, authenticated;
revoke all on function public.club_canje_codigo_generar_pase(text)               from public, anon, authenticated;
revoke all on function public.club_pase_token(uuid, text)                        from public, anon, authenticated;
revoke all on function public.club_pase_cursor_rebobinar(text, bigint, text)     from public, anon, authenticated;
grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated;
grant execute on function public.club_socio_validar(uuid, boolean, text)         to authenticated;
grant execute on function public.club_socio_confirmar(uuid, text)                to authenticated;
grant execute on function public.club_pase_token(uuid, text)                     to authenticated;
-- LC-A3
revoke all on function public.club_modo_pruebas()                              from public, anon, authenticated;
revoke all on function public.club_cortesias_tope()                              from public, anon, authenticated;
revoke all on function public.club_promociones_evento()                          from public, anon, authenticated;
revoke all on function public.club_promo_vigente_en(public.club_promociones, timestamptz) from public, anon, authenticated;
revoke all on function public.club_promo_beneficio(public.club_promociones)      from public, anon, authenticated;
revoke all on function public.club_promociones_vigentes(text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.club_promociones_listar(text)                      from public, anon, authenticated;
revoke all on function public.club_promocion_guardar(uuid, jsonb, text)          from public, anon, authenticated;
revoke all on function public.club_productos(text, text)                         from public, anon, authenticated;
revoke all on function public.club_cortesias_listar(text)                        from public, anon, authenticated;
revoke all on function public.club_cortesia_guardar(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.club_promociones_listar(text)                   to authenticated;
grant execute on function public.club_promocion_guardar(uuid, jsonb, text)       to authenticated;
grant execute on function public.club_productos(text, text)                      to authenticated;
grant execute on function public.club_cortesias_listar(text)                     to authenticated;
grant execute on function public.club_cortesia_guardar(uuid, text, text, boolean, text) to authenticated;
-- LC-A4
revoke all on function public.club_socio_visita(uuid, jsonb, uuid, text)              from public, anon, authenticated;
grant execute on function public.club_socio_visita(uuid, jsonb, uuid, text)           to authenticated;
revoke all on function public.club_pendientes_listar(text)                       from public, anon, authenticated;
revoke all on function public.club_pendiente_resolver(uuid, boolean, text)       from public, anon, authenticated;
grant execute on function public.club_pendientes_listar(text)                    to authenticated;
grant execute on function public.club_pendiente_resolver(uuid, boolean, text)    to authenticated;
revoke all on function public.club_reporte_altas(date, date, text)              from public, anon, authenticated;
revoke all on function public.club_reporte_visitas(date, date, text)            from public, anon, authenticated;
grant execute on function public.club_reporte_altas(date, date, text)           to authenticated;
grant execute on function public.club_reporte_visitas(date, date, text)         to authenticated;
revoke all on function public.club_premios_generar(text)                       from public, anon, authenticated;
revoke all on function public.club_socios_por_confirmar()                        from public, anon, authenticated;
revoke all on function public.club_socio_solicitudes_abiertas()                  from public, anon, authenticated;
grant execute on function public.club_socio_solicitudes_abiertas()               to authenticated;
grant execute on function public.club_socios_por_confirmar()                     to authenticated;
-- públicas (club-web: x-club-web)
grant execute on function public.club_socio_autoalta(jsonb)                      to anon, authenticated;
grant execute on function public.club_socio_baja_portal(text)                    to anon, authenticated;
grant execute on function public.club_canje_codigo_generar_pase(text)            to anon, authenticated;
grant execute on function public.club_pase_cursor_rebobinar(text, bigint, text)  to service_role;
revoke all on function public.club_pase_evento_trg()                             from public, anon, authenticated;
-- Contrato del pase: SOLO service_role (el Edge del pase).
do $$
declare f text;
begin
  foreach f in array array['public.club_pase_datos(uuid)', 'public.club_pase_por_token(text)',
                           'public.club_pase_emitido(uuid, text, text)', 'public.club_pase_eventos_leer(bigint, int)',
                           'public.club_pase_cursor_leer(text)', 'public.club_pase_cursor_guardar(text, bigint)',
                           'public.club_alertas_pendientes(int)', 'public.club_alerta_enviada(bigint, text)',
                           'public.club_pases_emitidos(text, uuid, int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.club_ajuste(uuid, int, text, text, uuid)   from public, anon, authenticated;
revoke all on function public.club_portal(text)                          from public, anon, authenticated;
revoke all on function public.club_vencer(date, int)                     from public, anon, authenticated;
revoke all on function public.club_vencer_simular(date)                  from public, anon, authenticated;
revoke all on function public.club_vencer_candidatos(date)               from public, anon, authenticated;

revoke all on function public.club_norm_telefono(text)                    from public, anon, authenticated;
revoke all on function public.club_norm_texto(text)                       from public, anon, authenticated;
revoke all on function public.club_negocio_guardar(uuid, text, text, boolean, text)      from public, anon, authenticated;
revoke all on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_miembro_regenerar_codigo(uuid)         from public, anon, authenticated;
revoke all on function public.club_miembro_token(uuid)                    from public, anon, authenticated;
revoke all on function public.club_buscar(text)                           from public, anon, authenticated;
revoke all on function public.club_tarjeta_manual(uuid, int, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.club_pos_ref(jsonb, text) from public, anon, authenticated;
revoke all on function public.club_visita_canonica(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_visita_control(text, text, jsonb, text, uuid, int) from public, anon, authenticated;
revoke all on function public.club_web_ok() from public, anon, authenticated;
revoke all on function public.club_web_clave_cargar(text) from public, anon, authenticated;
revoke all on function public.club_pedidos_abiertos(text) from public, anon, authenticated;
grant execute on function public.club_pedidos_abiertos(text) to authenticated;
revoke all on function public.club_facturas_recientes(text) from public, anon, authenticated;
grant execute on function public.club_facturas_recientes(text) to authenticated;
revoke all on function public.club_cruce_facturas(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_cruce_detalle(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.club_resolver(text)                         from public, anon, authenticated;
revoke all on function public.club_config_auditar()                       from public, anon, authenticated;

grant execute on function public.club_negocio_guardar(uuid, text, text, boolean, text)     to authenticated;
grant execute on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text) to authenticated;
grant execute on function public.club_miembro_regenerar_codigo(uuid)        to authenticated;
grant execute on function public.club_miembro_token(uuid)                   to authenticated;
grant execute on function public.club_buscar(text)                          to authenticated;
grant execute on function public.club_tarjeta_manual(uuid, int, text, uuid, jsonb) to authenticated;
grant execute on function public.club_resolver(text)                        to authenticated;

-- La vista los usa con los permisos de quien consulta (staff).
grant execute on function public.club_creditos(bigint, int)          to authenticated;
grant execute on function public.club_personas_proximo(bigint, int)  to authenticated;
-- Públicas
grant execute on function public.club_cupon_crear(text, jsonb)       to anon, authenticated;
grant execute on function public.club_portal(text)                   to anon, authenticated;
grant execute on function public.club_canje_codigo_generar(text)     to anon, authenticated;   -- R-01
revoke all on function public.club_nombre_pila(text)                  from public, anon, authenticated;
revoke all on function public.club_cupon_ver(text)                    from public, anon, authenticated;
revoke all on function public.club_cupon_contacto(text, jsonb)        from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text)                 to anon, authenticated;
grant execute on function public.club_cupon_contacto(text, jsonb)     to anon, authenticated;
revoke all on function public.club_factura_clave(text)                from public, anon, authenticated;
revoke all on function public.club_nombre_limpio(text)                from public, anon, authenticated;
revoke all on function public.club_excepciones(date, date, text, text) from public, anon, authenticated;
revoke all on function public.club_excepciones_abiertas(int, text)    from public, anon, authenticated;
revoke all on function public.club_excepcion_resolver(text, text, text, text) from public, anon, authenticated;
revoke all on function public.club_reporte_mes(date, text, boolean)   from public, anon, authenticated;
revoke all on function public.club_reporte_cerrar(date, text, text)   from public, anon, authenticated;
revoke all on function public.club_config_tasa_guardia()               from public, anon, authenticated;
revoke all on function public.club_reportes_cerrados_inmutable()        from public, anon, authenticated;
grant execute on function public.club_excepciones(date, date, text, text) to authenticated;
grant execute on function public.club_excepciones_abiertas(int, text) to authenticated;
grant execute on function public.club_excepcion_resolver(text, text, text, text) to authenticated;
grant execute on function public.club_reporte_mes(date, text, boolean) to authenticated;
grant execute on function public.club_reporte_cerrar(date, text, text) to authenticated;
revoke all on function public.club_sin_cruce_candidatas(uuid, text)    from public, anon, authenticated;
revoke all on function public.club_sin_cruce_elegir(uuid, text, text)  from public, anon, authenticated;
grant execute on function public.club_sin_cruce_candidatas(uuid, text) to authenticated;
grant execute on function public.club_sin_cruce_elegir(uuid, text, text) to authenticated;
-- Staff (la guarda de rol está adentro)
grant execute on function public.club_cupon_usar(text, int, text, uuid, jsonb) to authenticated;
grant execute on function public.club_canje(uuid, text, numeric, text, uuid, jsonb) to authenticated;
grant execute on function public.club_canje_aprobado(uuid, numeric, text, uuid, jsonb, text) to authenticated;
grant execute on function public.club_ajuste(uuid, int, text, text, uuid) to authenticated;
grant execute on function public.club_vencer(date, int)                  to authenticated;
grant execute on function public.club_vencer_simular(date)               to authenticated;
-- LC-DT: descuentos tipificados por porcentaje
revoke all on function public.club_descuentos_tipo_listar(text)                  from public, anon, authenticated;
revoke all on function public.club_descuento_tipo_guardar(uuid, text, numeric, boolean, text) from public, anon, authenticated;
revoke all on function public.club_reporte_descuentos(date, date, text)          from public, anon, authenticated;
grant execute on function public.club_descuentos_tipo_listar(text)               to authenticated;
grant execute on function public.club_descuento_tipo_guardar(uuid, text, numeric, boolean, text) to authenticated;
grant execute on function public.club_reporte_descuentos(date, date, text)       to authenticated;
-- LC-MD: marcadores de descuento
revoke all on function public.club_marcadores_listar(text)                       from public, anon, authenticated;
revoke all on function public.club_marcador_guardar(uuid, text, text, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.club_marcadores_listar(text)                    to authenticated;
grant execute on function public.club_marcador_guardar(uuid, text, text, numeric, boolean, text) to authenticated;
-- LC-ML: puerta pública (club-web) y helpers internos sin grant
revoke all on function public.club_local_crear(text, text, text, text, text)  from public, anon, authenticated;
grant execute on function public.club_local_crear(text, text, text, text, text) to authenticated;
revoke all on function public.club_config_alta()                          from public, anon, authenticated;
grant execute on function public.club_locales_activos()                  to anon, authenticated;
revoke all on function public.club_local(text, boolean)                  from public, anon, authenticated;
revoke all on function public.club_local_activo(text)                    from public, anon, authenticated;


-- ── LC-PRIV (08-nov tarde): aviso del turista, lecturas de datos personales con rastro, tope de búsqueda ──
-- Grok 39: tope de búsquedas por usuario y por minuto, por local (club_buscar usa el menor de los encendidos).
alter table public.club_config add column if not exists buscar_tope_minuto int not null default 30
  check (buscar_tope_minuto between 5 and 300);
-- El tope cuenta las búsquedas del último minuto en club_auditoria: índice por actor y acción.
create index if not exists club_auditoria_actor_accion_idx on public.club_auditoria (actor, accion, en);

-- Grok 41: el detalle de contacto de un miembro se lee SOLO por esta función, que deja rastro (quién y cuándo, sin
-- el dato). Las tablas de contacto ya no se leen directo (se revoca el SELECT de authenticated más abajo).
create or replace function public.club_miembro_contacto_ver(p_miembro uuid)
returns table (miembro_id uuid, telefono text, email text, optin_whatsapp boolean, optin_email boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.club_miembros m where m.id = p_miembro) then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  return query
    select c.miembro_id, c.telefono, c.email, c.optin_whatsapp, c.optin_email
      from public.club_miembros_contacto c where c.miembro_id = p_miembro;
  perform public.club_auditar('ver_contacto', 'club_miembros_contacto', p_miembro, null, null);
end;
$$;

-- Grok 41: los exportes del reporte del mes (CSV y HTML/PDF) se arman en el navegador con datos ya leídos; la app
-- registra el exporte acá ANTES de armarlo (si falla, no exporta). Sin el contenido: formato, mes y local.
create or replace function public.club_registrar_exporte(p_formato text, p_mes date, p_location text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_formato is null or p_formato not in ('csv','html') or p_mes is null then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  perform public.club_auditar('exporte_' || p_formato, 'club_reporte_mes', null, null,
    jsonb_build_object('mes', to_char(date_trunc('month', p_mes), 'YYYY-MM'),
                       'local', case when p_location ~ '^[a-z0-9-]{2,40}$' then p_location end));
end;
$$;

-- Grok 63: baja del turista (link del aviso corto del cupón). Con el código del cupón (secreto, 10 caracteres) se
-- borra su contacto. Siempre responde true (no revela si el cupón existe o tenía contacto). Queda rastro sin datos.
create or replace function public.club_cupon_contacto_baja(p_codigo text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
  v_id  uuid;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  delete from public.club_cupones_contactos k using public.club_cupones c
   where c.codigo = v_cod and k.cupon_id = c.id
  returning k.cupon_id into v_id;
  if v_id is not null then
    perform public.club_auditar('baja_contacto_turista', 'club_cupones_contactos', v_id, null, null);
  end if;
  return true;
end;
$$;

-- Grok 41: las tablas de contacto ya no se leen directo desde la app (la RLS queda como segunda barrera).
revoke select on public.club_miembros_contacto from authenticated;
revoke select on public.club_cupones_contactos from authenticated;

revoke all on function public.club_miembro_contacto_ver(uuid)               from public, anon, authenticated;
revoke all on function public.club_registrar_exporte(text, date, text)       from public, anon, authenticated;
revoke all on function public.club_cupon_contacto_baja(text)                 from public, anon, authenticated;
grant execute on function public.club_miembro_contacto_ver(uuid)            to authenticated;
grant execute on function public.club_registrar_exporte(text, date, text)    to authenticated;
grant execute on function public.club_cupon_contacto_baja(text)              to anon, authenticated;


-- CLUB-AUD-11: red de seguridad al final, después de todos los grants de arriba.
--   · Secuencias club_% (identity): nadie de la app las usa directo.
--   · Funciones club_%: ninguna para PUBLIC; para anon solo las 10 puertas públicas (R-01: código de canje; LC-A2:
--     autoalta, baja del socio y código de canje desde el pase; LC-ML: locales activos; LC-PRIV: baja del turista).
do $$
declare r record;
begin
  for r in select c.oid::regclass as obj from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'club\_%' loop
    execute format('revoke all on sequence %s from public, anon, authenticated', r.obj);
  end loop;
  for r in select p.oid::regprocedure as fn, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'club\_%' loop
    execute format('revoke all on function %s from public', r.fn);
    if r.proname not in ('club_cupon_crear', 'club_portal', 'club_cupon_ver', 'club_cupon_contacto', 'club_canje_codigo_generar',
                         'club_socio_autoalta', 'club_socio_baja_portal', 'club_canje_codigo_generar_pase',
                         'club_locales_activos', 'club_cupon_contacto_baja') then
      execute format('revoke all on function %s from anon', r.fn);
    end if;
  end loop;
end $$;
commit;
