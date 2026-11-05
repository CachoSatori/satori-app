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
  v_fac     text := public.club_norm_factura(p_factura);
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
    raise exception 'REFERENTE_INACTIVO' using errcode = 'P0001',
      hint = 'Referente dado de baja: seguí con la cuenta sin crédito';
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
  v_fac      text := public.club_norm_factura(p_factura);
  v_m        public.club_miembros%rowtype;
  v_cfg      public.club_config%rowtype;
  v_prev     public.club_movimientos%rowtype;
  v_saldo    int;
  v_necesita numeric;
  v_ya_fac   numeric;
  v_ya_dia   numeric;
  v_hoy      timestamptz;
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

  -- Tope por día (hora CR): suma de créditos canjeados hoy por el miembro, con cualquier factura.
  v_hoy := date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
  select coalesce(sum(mv.creditos), 0) into v_ya_dia from public.club_movimientos mv
   where mv.miembro_id = p_miembro and mv.tipo = 'canje' and mv.fecha_visita >= v_hoy;
  if v_ya_dia + p_creditos > v_cfg.max_creditos_por_visita then
    raise exception 'Supera el máximo de % créditos por día', v_cfg.max_creditos_por_visita
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
create or replace function public.club_negocio_guardar(p_id uuid, p_nombre text, p_tipo text, p_activo boolean)
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
      insert into public.club_negocios (nombre, tipo, activo)
      values (v_nombre, p_tipo, coalesce(p_activo, true))
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
create or replace function public.club_miembro_guardar(
  p_id uuid, p_tipo text, p_nombre text, p_negocio_id uuid, p_estado text, p_contacto jsonb)
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
    insert into public.club_miembros (tipo, nombre, negocio_id, estado, origen)
    values (p_tipo, v_nombre, p_negocio_id, coalesce(p_estado, 'activo'), 'app')
    returning id into v_id;
  else
    update public.club_miembros
       set tipo = p_tipo, nombre = v_nombre, negocio_id = p_negocio_id,
           estado = coalesce(p_estado, estado), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Miembro no encontrado' using errcode = 'P0001';
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
stable
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
  return v;
end;
$$;

-- Búsqueda (plan B de caja): nombre, negocio o últimos 4 dígitos del teléfono.
-- NUNCA devuelve teléfono ni email. Máximo 20.
create or replace function public.club_buscar(p_q text)
returns table (id uuid, nombre text, negocio text, tipo text, estado text, personas int, creditos numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_q   text := public.club_norm_texto(p_q);
  v_dig boolean;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_dig := v_q ~ '^[0-9]{4}$';
  if not v_dig and length(v_q) < 3 then
    raise exception 'Escribí al menos 3 letras o los últimos 4 dígitos del teléfono' using errcode = 'P0001';
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
end;
$$;

-- Tarjeta física ya repartida (owner, manager, cajero): movimiento `tarjeta` con nota «manual».
create or replace function public.club_tarjeta_manual(p_miembro uuid, p_personas int, p_factura text, p_op uuid)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_fac   text := public.club_norm_factura(p_factura);
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_movimientos%rowtype;
  v_saldo int;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de operación' using errcode = 'P0001';
  end if;

  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    if v_prev.tipo <> 'tarjeta' or v_prev.miembro_id is distinct from p_miembro or v_prev.cupon_id is not null then
      raise exception 'El id de operación ya se usó para otra cosa' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;

  if p_personas is null or p_personas < 1 or p_personas > 30 then
    raise exception 'Personas fuera de rango (1 a 30)' using errcode = 'P0001';
  end if;
  if v_fac = '' or length(v_fac) > 40 then
    raise exception 'Falta el número de factura' using errcode = 'P0001';
  end if;

  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found or v_m.tipo not in ('referente','concierge_pm','equipo') then
    raise exception 'Miembro no encontrado' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'REFERENTE_INACTIVO' using errcode = 'P0001',
      hint = 'Referente dado de baja: seguí con la cuenta sin crédito';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id, nota)
  values
    (v_m.location_id, p_miembro, 'tarjeta', p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     v_fac, now(), auth.uid(), 'app', p_op, 'manual');

  v_saldo := public.club_saldo_personas(p_miembro);
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;

-- Resolver lo leído en un QR (URL completa o solo el código). owner, manager, cajero.
-- {tipo: 'cupon'|'referente'|'desconocido', datos: {...}}
create or replace function public.club_resolver(p_texto text)
returns jsonb
language plpgsql
stable
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
  v_cfg   public.club_config%rowtype;
  v_saldo int;
  v_hoy   timestamptz;
  v_dia   numeric;
  v_neg   text;
  mm      text[];
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  mm := regexp_match(v_t, '^https?://club\.satoricostarica\.com/([rcRC])/([A-Za-z0-9]+)/?$', 'i');
  if mm is not null then
    v_kind := lower(mm[1]); v_cod := upper(mm[2]);
  else
    v_cod := upper(regexp_replace(v_t, '\s', '', 'g'));
    v_kind := case length(v_cod) when 8 then 'r' when 10 then 'c' else null end;
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
      select * into v_cfg from public.club_config where location_id = v_m.location_id;
      select n.nombre into v_neg from public.club_negocios n where n.id = v_m.negocio_id;
      v_saldo := public.club_saldo_personas(v_m.id);
      v_hoy := date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica';
      select coalesce(sum(mv.creditos), 0) into v_dia from public.club_movimientos mv
       where mv.miembro_id = v_m.id and mv.tipo = 'canje' and mv.fecha_visita >= v_hoy;
      return jsonb_build_object('tipo', 'referente', 'datos', jsonb_build_object(
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
        'max_creditos_por_visita',  v_cfg.max_creditos_por_visita));
    end if;
  end if;
  return jsonb_build_object('tipo', 'desconocido', 'datos', '{}'::jsonb);
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

-- club_miembros: la caja lee todo MENOS el token del portal (privilegio por columna).
revoke select on public.club_miembros from authenticated;
grant select (id, location_id, tipo, nombre, negocio_id, codigo, estado, origen, legacy_id, created_at, updated_at)
  on public.club_miembros to authenticated;

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
    'referente', public.club_nombre_pila(v_m.nombre));
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
begin
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
  if v_c.contacto_whatsapp is not null or v_c.contacto_email is not null then
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
  update public.club_cupones
     set contacto_nombre = v_nombre, contacto_whatsapp = v_wa, contacto_email = v_email, contacto_optin = true
   where id = v_c.id;
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

create table if not exists public.club_excepciones_resueltas (
  id            bigint generated always as identity primary key,
  location_id   text not null default 'santa-teresa',
  tipo          text not null check (tipo in ('PROMO_SIN_CUPON','CREDITOS_SIN_CANJE','CANJE_MONTO_DISTINTO','REGISTRO_SIN_FACTURA')),
  ref           text not null check (length(ref) between 1 and 100),
  nota          text not null check (length(btrim(nota)) between 1 and 500),
  resuelto_por  uuid,
  resuelto_en   timestamptz not null default now(),
  unique (location_id, tipo, ref)
);
alter table public.club_excepciones_resueltas enable row level security;
revoke all on public.club_excepciones_resueltas from anon, public, authenticated;
grant select on public.club_excepciones_resueltas to authenticated;
drop policy if exists club_exc_gerencia on public.club_excepciones_resueltas;
create policy club_exc_gerencia on public.club_excepciones_resueltas for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- Excepciones del puente en un rango de fechas (hora CR). owner, manager.
--   REGISTRO_SIN_FACTURA (exacta)  · cupón/tarjeta/canje de la app con factura que no está en el puente
--   CREDITOS_SIN_CANJE   (probable)· factura con cxc múltiplo de medio crédito y sin canje
--   CANJE_MONTO_DISTINTO (probable)· canjes de una factura cuyo valor ≠ cxc de la factura (±₡1)
--   PROMO_SIN_CUPON      (exacta)  · solo si club_config.promo_articulo_codigo está cargado
create or replace function public.club_excepciones(p_desde date, p_hasta date, p_location text default 'santa-teresa')
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
           coalesce(t.fecha_registra, t.fecha_cierra) as f, coalesce(t.cxc_crc, 0) as cxc, t.total_crc
      from public.pos_ndf_tickets t
     where t.local = p_location and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
       and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin),
  mv as (
    select m.*, public.club_factura_clave(m.factura_pos) as clave
      from public.club_movimientos m
     where m.location_id = p_location and m.origen = 'app' and m.tipo in ('tarjeta','canje') and m.factura_pos is not null),
  ex as (
    -- REGISTRO_SIN_FACTURA
    select 'REGISTRO_SIN_FACTURA'::text as tipo, m.id::text as ref, m.fecha_visita as fecha, m.factura_pos as factura,
           'exacta'::text as certeza,
           jsonb_build_object('movimiento', case when m.cupon_id is not null then 'cupon' when m.tipo = 'canje' then 'canje' else 'tarjeta_manual' end,
                              'personas', m.personas, 'creditos', m.creditos,
                              'miembro', public.club_nombre_limpio(mi.nombre)) as detalle
      from mv m join public.club_miembros mi on mi.id = m.miembro_id
     where m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and not exists (select 1 from public.pos_ndf_tickets t
                        where t.local = p_location and ltrim(t.numero_factura, '0') = m.clave)
    union all
    -- CREDITOS_SIN_CANJE (heurística: cxc múltiplo de medio crédito)
    select 'CREDITOS_SIN_CANJE', 'factura:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('cxc_crc', t.cxc, 'creditos_estimados', round(t.cxc / v_cfg.valor_credito_crc, 1), 'total_crc', t.total_crc)
      from tk t
     where t.cxc > 0 and t.cxc % (v_cfg.valor_credito_crc / 2.0) = 0
       and not exists (select 1 from mv m where m.tipo = 'canje' and m.clave = t.clave)
    union all
    -- CANJE_MONTO_DISTINTO (por factura: Σ créditos × valor vs cxc)
    select 'CANJE_MONTO_DISTINTO', 'factura:' || c.clave, c.f, c.factura, 'probable',
           jsonb_build_object('canje_crc', c.valor, 'cxc_crc', c.cxc, 'diferencia_crc', c.valor - c.cxc, 'creditos', c.creditos,
                              'miembro', c.miembro)
      from (select m.clave, min(m.factura_pos) as factura, min(m.fecha_visita) as f,
                   sum(m.creditos * m.valor_credito_crc) as valor, sum(m.creditos) as creditos,
                   string_agg(distinct public.club_nombre_limpio(mi.nombre), ', ') as miembro,
                   (select coalesce(max(t.cxc_crc), 0) from public.pos_ndf_tickets t
                     where t.local = p_location and ltrim(t.numero_factura, '0') = m.clave) as cxc,
                   exists (select 1 from public.pos_ndf_tickets t
                            where t.local = p_location and ltrim(t.numero_factura, '0') = m.clave) as en_puente
              from mv m join public.club_miembros mi on mi.id = m.miembro_id
             where m.tipo = 'canje' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by m.clave) c
     where c.en_puente and abs(c.valor - c.cxc) > 1
    union all
    -- PROMO_SIN_CUPON (apagada mientras no haya artículo marcador)
    select 'PROMO_SIN_CUPON', 'factura:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulo', v_cfg.promo_articulo_codigo, 'total_crc', t.total_crc)
      from tk t
     where v_cfg.promo_articulo_codigo is not null
       and exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = t.id and l.codigo_producto = v_cfg.promo_articulo_codigo)
       and not exists (select 1 from mv m where m.tipo = 'tarjeta' and m.clave = t.clave)
  )
  select ex.tipo, ex.ref, ex.fecha, ex.factura, ex.certeza, ex.detalle,
         r.id is not null, r.nota, r.resuelto_en
    from ex
    left join public.club_excepciones_resueltas r
      on r.location_id = p_location and r.tipo = ex.tipo and r.ref = ex.ref
   order by ex.fecha desc;
end;
$$;

-- Cantidad de excepciones abiertas de los últimos N días (contador de la tarjeta Club). owner, manager.
create or replace function public.club_excepciones_abiertas(p_dias int default 30, p_location text default 'santa-teresa')
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.club_excepciones(((now() at time zone 'America/Costa_Rica')::date - least(greatest(coalesce(p_dias, 30), 1), 400)),
                                 (now() at time zone 'America/Costa_Rica')::date, p_location) e
   where not e.resuelta;
$$;

-- Resolver una excepción con nota (owner, manager). No modifica el libro.
create or replace function public.club_excepcion_resolver(p_tipo text, p_ref text, p_nota text, p_location text default 'santa-teresa')
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
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('PROMO_SIN_CUPON','CREDITOS_SIN_CANJE','CANJE_MONTO_DISTINTO','REGISTRO_SIN_FACTURA') then
    raise exception 'Tipo de excepción no válido' using errcode = 'P0001';
  end if;
  if length(v_ref) not between 1 and 100 then
    raise exception 'Referencia no válida' using errcode = 'P0001';
  end if;
  if length(v_nota) not between 1 and 500 then
    raise exception 'La nota es obligatoria (hasta 500 caracteres)' using errcode = 'P0001';
  end if;
  insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota, resuelto_por)
  values (p_location, p_tipo, v_ref, v_nota, auth.uid())
  on conflict (location_id, tipo, ref) do update
    set nota = excluded.nota, resuelto_por = excluded.resuelto_por, resuelto_en = now();
  return true;
end;
$$;

-- Reporte mensual (owner, manager). JSON sin teléfonos ni emails.
create or replace function public.club_reporte_mes(p_mes date, p_location text default 'santa-teresa')
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
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  v_mes  := date_trunc('month', coalesce(p_mes, now()::date))::date;
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
           max(v.fecha_visita) filter (where v.tipo in ('tarjeta','canje')) as ult,
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
    'mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location, 'generado_en', now(),
    'config', jsonb_build_object('valor_credito_crc', v_cfg.valor_credito_crc, 'personas_por_credito', v_cfg.personas_por_credito,
                                 'vencimiento_meses', v_cfg.vencimiento_meses, 'pm_pausado', v_cfg.pm_pausado),
    'kpis', (select jsonb_build_object(
        'tarjetas', k.tarjetas, 'personas', k.personas,
        'creditos_generados', round(k.personas::numeric / v_cfg.personas_por_credito, 1),
        'canjes', k.canjes, 'creditos_canjeados', k.creditos_canjeados, 'valor_canjeado_crc', k.valor_canjeado_crc,
        'personas_vencidas', k.personas_vencidas,
        'referentes_con_visitas', (select count(*) from pm where pm.tipo <> 'equipo' and pm.t_mes > 0),
        'cupones_generados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.creado_en >= v_ini and c.creado_en < v_fin),
        'cupones_usados', (select count(*) from public.club_cupones c where c.location_id = p_location and c.usado_en >= v_ini and c.usado_en < v_fin),
        'saldo_creditos_al_cierre', (select coalesce(sum(cr), 0) from pm where pm.estado = 'activo'),
        'cuentas_con_saldo', (select count(*) from pm where pm.estado = 'activo' and pm.cr > 0),
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
                                        from (select * from fila where estado = 'activo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')
                                               order by cr desc limit 10) x), '[]'))
                   from pm where estado = 'activo' and cr > 0 and (ult is null or ult < v_fin - interval '60 days')),
    'a_contactar', (select coalesce(jsonb_agg(x.base || jsonb_build_object('creditos', x.cr, 'vence_en', x.vence) order by x.vence), '[]')
                      from (select f.*, f.ult + make_interval(months => v_cfg.vencimiento_meses) as vence from fila f
                             where f.estado = 'activo' and f.cr > 0 and f.ult is not null
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) >= v_fin
                               and f.ult + make_interval(months => v_cfg.vencimiento_meses) < v_fin + interval '30 days'
                             order by vence limit 10) x),
    'nuevos', (select jsonb_build_object('cuentas', count(*),
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes) order by x.pers_mes desc)
                                      from (select * from fila where tipo <> 'equipo' and primera >= v_ini order by pers_mes desc limit 10) x), '[]'))
                 from pm where tipo <> 'equipo' and primera >= v_ini),
    'equipo', (select jsonb_build_object('personas_mes', coalesce(sum(pers_mes), 0), 'creditos', coalesce(sum(cr) filter (where estado = 'activo'), 0),
                 'lista', coalesce((select jsonb_agg(x.base || jsonb_build_object('personas', x.pers_mes, 'creditos', x.cr) order by x.cr desc, x.pers_mes desc)
                                      from (select * from fila where tipo = 'equipo' and estado = 'activo' and (cr > 0 or pers_mes > 0)
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
                             from pm where estado = 'activo' and cr > 0 group by 1, 2) b),
    'pm', jsonb_build_object(
        'pausado', v_cfg.pm_pausado,
        'nota', case when v_cfg.pm_pausado then 'Programa PM en pausa por temas contables: los montos son informativos.' else null end,
        'pendiente_crc', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c join mi on mi.id = c.miembro_id
                           where mi.estado = 'activo' and c.estado in ('pendiente','aprobado') and c.created_at < v_fin)
                       - (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p join mi on mi.id = p.miembro_id
                           where mi.estado = 'activo' and p.pagado_en < v_fin),
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
  return r;
end;
$$;

-- ── 5. EXECUTE: nada por defecto, grant explícito ───────────────────────────

revoke all on function public.club_gen_codigo(int)                       from public, anon, authenticated;
revoke all on function public.club_creditos(bigint, int)                 from public, anon;
revoke all on function public.club_personas_proximo(bigint, int)         from public, anon;
revoke all on function public.club_norm_factura(text)                     from public, anon, authenticated;
revoke all on function public.club_saldo_personas(uuid)                  from public, anon, authenticated;
revoke all on function public.club_cupon_crear(text, jsonb)              from public, anon, authenticated;
revoke all on function public.club_cupon_usar(text, int, text, uuid)     from public, anon, authenticated;
revoke all on function public.club_canje(uuid, numeric, text, uuid)      from public, anon, authenticated;
revoke all on function public.club_ajuste(uuid, int, text, text)         from public, anon, authenticated;
revoke all on function public.club_portal(text)                          from public, anon, authenticated;
revoke all on function public.club_vencer(date)                          from public, anon, authenticated;

revoke all on function public.club_norm_telefono(text)                    from public, anon, authenticated;
revoke all on function public.club_norm_texto(text)                       from public, anon, authenticated;
revoke all on function public.club_negocio_guardar(uuid, text, text, boolean)            from public, anon, authenticated;
revoke all on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb)  from public, anon, authenticated;
revoke all on function public.club_miembro_regenerar_codigo(uuid)         from public, anon, authenticated;
revoke all on function public.club_miembro_token(uuid)                    from public, anon, authenticated;
revoke all on function public.club_buscar(text)                           from public, anon, authenticated;
revoke all on function public.club_tarjeta_manual(uuid, int, text, uuid)  from public, anon, authenticated;
revoke all on function public.club_resolver(text)                         from public, anon, authenticated;
revoke all on function public.club_config_auditar()                       from public, anon, authenticated;

grant execute on function public.club_negocio_guardar(uuid, text, text, boolean)           to authenticated;
grant execute on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.club_miembro_regenerar_codigo(uuid)        to authenticated;
grant execute on function public.club_miembro_token(uuid)                   to authenticated;
grant execute on function public.club_buscar(text)                          to authenticated;
grant execute on function public.club_tarjeta_manual(uuid, int, text, uuid) to authenticated;
grant execute on function public.club_resolver(text)                        to authenticated;

-- La vista los usa con los permisos de quien consulta (staff).
grant execute on function public.club_creditos(bigint, int)          to authenticated;
grant execute on function public.club_personas_proximo(bigint, int)  to authenticated;
-- Públicas
grant execute on function public.club_cupon_crear(text, jsonb)       to anon, authenticated;
grant execute on function public.club_portal(text)                   to anon, authenticated;
revoke all on function public.club_nombre_pila(text)                  from public, anon, authenticated;
revoke all on function public.club_cupon_ver(text)                    from public, anon, authenticated;
revoke all on function public.club_cupon_contacto(text, jsonb)        from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text)                 to anon, authenticated;
grant execute on function public.club_cupon_contacto(text, jsonb)     to anon, authenticated;
revoke all on function public.club_factura_clave(text)                from public, anon, authenticated;
revoke all on function public.club_nombre_limpio(text)                from public, anon, authenticated;
revoke all on function public.club_excepciones(date, date, text)      from public, anon, authenticated;
revoke all on function public.club_excepciones_abiertas(int, text)    from public, anon, authenticated;
revoke all on function public.club_excepcion_resolver(text, text, text, text) from public, anon, authenticated;
revoke all on function public.club_reporte_mes(date, text)            from public, anon, authenticated;
grant execute on function public.club_excepciones(date, date, text)   to authenticated;
grant execute on function public.club_excepciones_abiertas(int, text) to authenticated;
grant execute on function public.club_excepcion_resolver(text, text, text, text) to authenticated;
grant execute on function public.club_reporte_mes(date, text)         to authenticated;
-- Staff (la guarda de rol está adentro)
grant execute on function public.club_cupon_usar(text, int, text, uuid)  to authenticated;
grant execute on function public.club_canje(uuid, numeric, text, uuid)   to authenticated;
grant execute on function public.club_ajuste(uuid, int, text, text)      to authenticated;
grant execute on function public.club_vencer(date)                       to authenticated;

commit;
