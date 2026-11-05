-- ============================================================================
-- 075_club_satori_esquema.sql — Club Satori F1a: esquema, RLS y funciones
-- ----------------------------------------------------------------------------
-- Spec: docs/club-satori/SPEC.md (§3 modelo, §5.1 vencimiento, §6 seguridad).
-- ⚠️ SOLO STAGING hasta el piloto. El PR no se mergea a `main` antes del piloto:
--    Branching aplicaría esta migración en prod.
--
-- Principios:
--  · Multi-local: `location_id text not null default 'santa-teresa'` SIN FK
--    (prod no tiene `public.locations`; mismo patrón que `pos_ndf_*`).
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

-- Personas que faltan para el próximo crédito entero.
create or replace function public.club_personas_proximo(p_personas bigint, p_ppc int)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_ppc is null or p_ppc <= 0 then null
    else (p_ppc - mod(greatest(coalesce(p_personas, 0), 0), p_ppc))::int
  end;
$$;

-- ── 1. Tablas ───────────────────────────────────────────────────────────────

create table if not exists public.club_config (
  location_id                text primary key default 'santa-teresa',
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

insert into public.club_config (location_id) values ('santa-teresa')
on conflict (location_id) do nothing;

create table if not exists public.club_negocios (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null default 'santa-teresa',
  nombre      text not null check (length(btrim(nombre)) between 1 and 120),
  tipo        text not null default 'otro'
              check (tipo in ('hotel','tienda','host','delivery','concierge','otro')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Único por local, sin distinguir mayúsculas, tildes ni espacios sobrantes.
create unique index if not exists club_negocios_nombre_norm_uq
  on public.club_negocios (
    location_id,
    lower(translate(regexp_replace(btrim(nombre), '\s+', ' ', 'g'),
                    'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))
  );

create table if not exists public.club_miembros (
  id           uuid primary key default gen_random_uuid(),
  location_id  text not null default 'santa-teresa',
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
  location_id     text not null default 'santa-teresa',
  telefono        text check (telefono ~ '^\+[1-9][0-9]{6,14}$'),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  optin_whatsapp  boolean not null default false,
  optin_email     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.club_cupones (
  id                 uuid primary key default gen_random_uuid(),
  location_id        text not null default 'santa-teresa',
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
  contacto_nombre    text check (length(contacto_nombre) <= 80),
  contacto_whatsapp  text check (contacto_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  contacto_email     text check (length(contacto_email) <= 254),
  contacto_optin     boolean not null default false,
  created_at         timestamptz not null default now(),
  check ((estado = 'usado') = (usado_en is not null))
);
create index if not exists club_cupones_ref_dia_idx on public.club_cupones (referente_id, creado_en);

create table if not exists public.club_movimientos (
  id                    uuid primary key default gen_random_uuid(),
  location_id           text not null default 'santa-teresa',
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

create table if not exists public.club_pm_pagos (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null default 'santa-teresa',
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
  location_id       text not null default 'santa-teresa',
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

-- F3: se crea vacía.
create table if not exists public.club_visitas (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null default 'santa-teresa',
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
         max(mv.fecha_visita) filter (where mv.tipo in ('tarjeta','canje')) as ultima_actividad
  from public.club_movimientos mv
  where mv.miembro_id = m.id
) s on true;

-- ── 3. RLS y privilegios de tabla ───────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['club_config','club_negocios','club_miembros','club_miembros_contacto',
                           'club_cupones','club_movimientos','club_pm_pagos','club_pm_cargos','club_visitas']
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
  -- Código del referente: formato y existencia con el MISMO error (no se distingue).
  if v_cod !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;
  select * into v_ref from public.club_miembros m
   where m.codigo = v_cod and m.estado = 'activo' and m.tipo in ('referente','concierge_pm','equipo');
  if not found then
    raise exception 'Código no válido' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.club_config where location_id = v_ref.location_id;
  if not found then
    raise exception 'Código no válido' using errcode = 'P0001';
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
  end if;

  -- Inserción con reintento si choca el código (muy improbable).
  for i in 1 .. 5 loop
    begin
      insert into public.club_cupones
        (location_id, referente_id, vence_en, contacto_nombre, contacto_whatsapp, contacto_email, contacto_optin)
      values
        (v_ref.location_id, v_ref.id, now() + make_interval(days => v_cfg.cupon_dias),
         v_nombre, v_wa, v_email, v_optin and (v_wa is not null or v_email is not null))
      returning * into v_cupon;
      exit;
    exception when unique_violation then
      if i = 5 then raise exception 'No se pudo generar el cupón' using errcode = 'P0001'; end if;
    end;
  end loop;

  codigo := v_cupon.codigo;
  vence_en := v_cupon.vence_en;
  return next;
end;
$$;

-- 4.2 Usar el cupón en caja → movimiento `tarjeta` del referente.
create or replace function public.club_cupon_usar(p_codigo text, p_personas int, p_factura text, p_op uuid)
returns table (miembro_id uuid, personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol     public.user_role := public.get_my_role();
  v_cod     text := upper(btrim(coalesce(p_codigo, '')));
  v_fac     text := btrim(coalesce(p_factura, ''));
  v_cupon   public.club_cupones%rowtype;
  v_ref     public.club_miembros%rowtype;
  v_cfg     public.club_config%rowtype;
  v_prev    public.club_movimientos%rowtype;
  v_saldo   int;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de operación' using errcode = 'P0001';
  end if;

  -- Idempotencia: la misma operación devuelve el mismo resultado.
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'tarjeta' or v_prev.cupon_id is distinct from
       (select c.id from public.club_cupones c where c.codigo = v_cod) then
      raise exception 'El id de operación ya se usó para otra cosa' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(v_prev.miembro_id);
    miembro_id := v_prev.miembro_id; personas := v_saldo;
    creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;

  if p_personas is null or p_personas < 1 or p_personas > 30 then
    raise exception 'Personas fuera de rango (1 a 30)' using errcode = 'P0001';
  end if;
  if v_fac = '' or length(v_fac) > 40 then
    raise exception 'Falta el número de factura' using errcode = 'P0001';
  end if;

  select * into v_cupon from public.club_cupones c where c.codigo = v_cod for update;
  if not found then
    raise exception 'Cupón no encontrado' using errcode = 'P0001';
  end if;
  if v_cupon.estado <> 'vigente' or v_cupon.usado_en is not null then
    raise exception 'El cupón ya se usó o fue anulado' using errcode = 'P0001';
  end if;
  if v_cupon.vence_en <= now() then
    raise exception 'El cupón está vencido' using errcode = 'P0001';
  end if;

  select * into v_ref from public.club_miembros m where m.id = v_cupon.referente_id;
  if v_ref.estado <> 'activo' then
    raise exception 'El referente está dado de baja' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_cupon.location_id;

  update public.club_cupones
     set estado = 'usado', usado_en = now(), usado_por = auth.uid(), factura_pos = v_fac, personas = p_personas
   where id = v_cupon.id;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     factura_pos, cupon_id, fecha_visita, registrado_por, origen, client_op_id)
  values
    (v_cupon.location_id, v_ref.id, 'tarjeta', p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     v_fac, v_cupon.id, now(), auth.uid(), 'app', p_op);

  v_saldo := public.club_saldo_personas(v_ref.id);
  miembro_id := v_ref.id; personas := v_saldo;
  creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

-- 4.3 Canje de créditos (1 / 1,5 / 2 por visita, de a 0,5).
create or replace function public.club_canje(p_miembro uuid, p_creditos numeric, p_factura text, p_op uuid)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol      public.user_role := public.get_my_role();
  v_fac      text := btrim(coalesce(p_factura, ''));
  v_m        public.club_miembros%rowtype;
  v_cfg      public.club_config%rowtype;
  v_prev     public.club_movimientos%rowtype;
  v_saldo    int;
  v_necesita numeric;
  v_ya_fac   numeric;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de operación' using errcode = 'P0001';
  end if;

  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'canje' or v_prev.miembro_id is distinct from p_miembro then
      raise exception 'El id de operación ya se usó para otra cosa' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;

  -- Bloquea al miembro: serializa canjes simultáneos.
  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'El miembro está dado de baja' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  if p_creditos is null
     or p_creditos < v_cfg.canje_min
     or p_creditos > v_cfg.max_creditos_por_visita
     or mod(p_creditos, v_cfg.canje_paso) <> 0 then
    raise exception 'Créditos no válidos: de % a %, de a %',
      v_cfg.canje_min, v_cfg.max_creditos_por_visita, v_cfg.canje_paso using errcode = 'P0001';
  end if;
  if v_fac = '' or length(v_fac) > 40 then
    raise exception 'Falta el número de factura' using errcode = 'P0001';
  end if;

  v_necesita := p_creditos * v_cfg.personas_por_credito;
  if v_necesita <> trunc(v_necesita) then
    raise exception 'Créditos no válidos para esta configuración' using errcode = 'P0001';
  end if;

  -- Máximo por visita: suma de canjes del miembro con la misma factura.
  select coalesce(sum(mv.creditos), 0) into v_ya_fac from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and mv.factura_pos = v_fac;
  if v_ya_fac + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por visita', v_cfg.max_creditos_por_visita
      using errcode = 'P0001';
  end if;

  v_saldo := public.club_saldo_personas(p_miembro);
  if v_saldo < v_necesita then
    raise exception 'Saldo insuficiente' using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id)
  values
    (v_m.location_id, p_miembro, 'canje', -v_necesita::int, p_creditos, v_cfg.personas_por_credito,
     v_cfg.valor_credito_crc, v_fac, now(), auth.uid(), 'app', p_op);

  v_saldo := v_saldo - v_necesita::int;
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

-- 4.4 Ajuste manual (solo owner): ajuste, restitución o vencimiento. Nota obligatoria.
create or replace function public.club_ajuste(p_miembro uuid, p_personas int, p_tipo text, p_nota text)
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
  v_saldo int;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
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
     fecha_visita, registrado_por, origen, nota)
  values
    (v_m.location_id, p_miembro, p_tipo, p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     now(), auth.uid(), 'app', v_nota);

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
    'movimientos',              v_movs
  );
end;
$$;

-- 4.6 Vencimiento por inactividad (solo owner; el cron se programa más adelante).
create or replace function public.club_vencer(p_corte date)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_n    int := 0;
  r      record;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_corte is null or p_corte > (now() at time zone 'America/Costa_Rica')::date then
    raise exception 'Fecha de corte no válida' using errcode = 'P0001';
  end if;

  for r in
    select s.miembro_id, s.location_id, s.personas, c.personas_por_credito, c.valor_credito_crc, c.vencimiento_meses
    from public.club_saldos s
    join public.club_config c on c.location_id = s.location_id
    join public.club_miembros m on m.id = s.miembro_id
    where s.personas > 0
      and coalesce(s.ultima_actividad, m.created_at)
          < ((p_corte - make_interval(months => c.vencimiento_meses))::timestamp at time zone 'America/Costa_Rica')
    for update of m
  loop
    insert into public.club_movimientos
      (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
       fecha_visita, registrado_por, origen, nota)
    values
      (r.location_id, r.miembro_id, 'vencimiento', -r.personas, r.personas_por_credito, r.valor_credito_crc,
       now(), auth.uid(), 'app',
       format('Vencimiento automático: %s meses sin actividad al %s', r.vencimiento_meses, p_corte));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── 5. EXECUTE: nada por defecto, grant explícito ───────────────────────────

revoke all on function public.club_gen_codigo(int)                       from public, anon, authenticated;
revoke all on function public.club_creditos(bigint, int)                 from public, anon;
revoke all on function public.club_personas_proximo(bigint, int)         from public, anon;
revoke all on function public.club_saldo_personas(uuid)                  from public, anon, authenticated;
revoke all on function public.club_cupon_crear(text, jsonb)              from public, anon, authenticated;
revoke all on function public.club_cupon_usar(text, int, text, uuid)     from public, anon, authenticated;
revoke all on function public.club_canje(uuid, numeric, text, uuid)      from public, anon, authenticated;
revoke all on function public.club_ajuste(uuid, int, text, text)         from public, anon, authenticated;
revoke all on function public.club_portal(text)                          from public, anon, authenticated;
revoke all on function public.club_vencer(date)                          from public, anon, authenticated;

-- La vista los usa con los permisos de quien consulta (staff).
grant execute on function public.club_creditos(bigint, int)          to authenticated;
grant execute on function public.club_personas_proximo(bigint, int)  to authenticated;
-- Públicas
grant execute on function public.club_cupon_crear(text, jsonb)       to anon, authenticated;
grant execute on function public.club_portal(text)                   to anon, authenticated;
-- Staff (la guarda de rol está adentro)
grant execute on function public.club_cupon_usar(text, int, text, uuid)  to authenticated;
grant execute on function public.club_canje(uuid, numeric, text, uuid)   to authenticated;
grant execute on function public.club_ajuste(uuid, int, text, text)      to authenticated;
grant execute on function public.club_vencer(date)                       to authenticated;

commit;
