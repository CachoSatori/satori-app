-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 166 (origen 112) — Club: campañas con grupo de control (SPEC Club v2 ítem 12, B8, Fase 2D).       ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Esquema (dos tablas nuevas) y funciones que leen plata y contactos: no se mergea sin el OK del dueño. Creada como 112
-- (bloque CLUB); prod va por la 155, así que va al bloque de PASE con origen 112 (regla 3). 156–165 son de otros PRs.
-- No depende de 156–165: rama independiente desde main. Copia el criterio de «venta respaldada» del tablero (160): neta
-- (sin familias 6, 17 y 20) − regalía, una factura una vez. NO estima descuento (no hace falta para comparar los grupos).
--
-- ── QUÉ ES ─────────────────────────────────────────────────────────────────────────────────────
-- El owner arma una campaña (hoy: la lista «A contactar», créditos que vencen en los próximos 30 días) y puede reservar
-- un % (por defecto 15, editable de 0 a 50) SIN la oferta. El reporte compara los dos grupos: así se sabe si la oferta
-- movió algo o si esa gente iba a volver igual.
--
-- REGLA (decisión del dueño, SPEC v2 ítem 12): al grupo reservado NUNCA se le quita el beneficio base (el 10 %/15 % del
-- Local Club, la cortesía, sus créditos, sus canjes, el pase, el portal). Solo no recibe el EXTRA de esa campaña (el
-- mensaje, y más adelante el reto o el avance de 90 días). Esta migración no toca ningún beneficio: solo anota quién
-- está en qué grupo y lo mide.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · public.club_campanas: la campaña (local, nombre, fuente, % reservado, SEMILLA del sorteo, día de inicio CR, quién).
--     fuente: 'a_contactar' (hoy) y, reservadas para lo que viene, 'reto' (ítem 16) y 'primeros_90' (ítem 15): el modelo
--     ya las acepta; club_campana_crear todavía no (dice «todavía no está disponible»).
--   · public.club_campana_asignaciones: (campaña, miembro) → grupo 'control' u 'oferta', con el valor del sorteo y cuándo.
--     Una fila por miembro y campaña (clave primaria): quien se asigna una vez queda fijo en esa campaña.
--   · SORTEO FIJO Y AUDITADO: valor = md5(semilla:campaña:miembro) → número en [0, 1); control si valor < %/100. Es
--     determinístico y reproducible: con la semilla (que queda en la campaña y en club_auditoria) cualquiera lo recalcula.
--     El grupo lo pone un trigger BEFORE INSERT (club_campana_asignar_trg), nunca quien inserta: aunque alguien inserte a
--     mano con otro grupo, queda el del sorteo. UPDATE y DELETE de las dos tablas se rechazan siempre (trigger): nadie
--     reasigna ni cambia la semilla o el % después. Sin acceso directo: RLS sin políticas y sin grants (solo funciones).
--   · Funciones (SECURITY DEFINER, search_path fijo, SOLO owner ACTIVO —get_my_role() es null con la cuenta inactiva—,
--     local en mis_locales()):
--       club_campana_crear(nombre, local, % reservado, fuente) → arma la campaña y sortea la lista de HOY.
--       club_campana_sumar_nuevos(campaña) → suma a los que entraron a la lista después; los ya asignados no cambian.
--       club_campanas_listar(local) → campañas del local con el tamaño de cada grupo (sin personas).
--       club_campana_lista(campaña, exporte, apertura) → SOLO el grupo con oferta (el reservado sale como un número). Con
--         p_exporte, además WhatsApp y correo de quien los autorizó (optin): es el CSV de la campaña.
--       club_campana_reporte(campaña, apertura) → los dos grupos lado a lado (ver «Reporte»), con el aviso honesto de
--         que con pocos miembros la diferencia no es concluyente.
--     Rastro en club_auditoria: crear y sumar (con la semilla, el % y los tamaños), cada exporte (cuántas filas, sin
--     datos) y las lecturas de lista y reporte UNA vez por apertura de la pantalla (mismo usuario, acción e id en 12 h:
--     como la 161, con su propia función interna para no depender de ella).
--
-- ── MANAGER ────────────────────────────────────────────────────────────────────────────────────
-- Patrón de «A contactar» hoy: el manager la ve en Reportes (nombre y créditos, sin contactos) y el CSV de contactos es
-- solo del owner. Campañas siguen el lado del owner: el manager NO arma campañas, NO ve los grupos ni el reporte (42501).
-- La lista «A contactar» del reporte mensual no cambia (sigue mostrando a todos; ver «Decisión abierta» en el PR).
--
-- ── DEFINICIONES ───────────────────────────────────────────────────────────────────────────────
--   · «A contactar» (como el reporte del mes, pero desde HOY y sin el tope de 10): referentes y concierge PM ACTIVOS del
--     local con créditos (club_creditos del saldo > 0) que vencen en los próximos 30 días: última tarjeta, canje o
--     restitución + vencimiento_meses ∈ [ahora, ahora + 30 días). El equipo no entra (D7).
--   · Ventana de cada miembro: 30 días CR desde el día (CR) en que se lo asignó: [día 00:00, día + 30 00:00) CR. El
--     reporte está «cerrado» cuando la ventana del último asignado terminó.
--   · Actividad (visita): un día CR con visita de socio (club_visitas_socio), tarjeta o canje de la app
--     (club_movimientos origen 'app') del miembro EN EL LOCAL de la campaña. Un día con varias cuenta una vez.
--   · Venta respaldada: facturas CERRADAS (C) que cruzan con esos registros (club_cruce_facturas, o la elegida a mano en
--     club_cruces_manuales), como el tablero (160). Por factura: neta (Σ líneas sin familias 6, 17 y 20) − regalía,
--     mínimo 0. UNA factura cuenta UNA vez por grupo aunque tenga dos miembros o dos registros. Una anulada no cuenta.
--   · Aviso «no concluyente»: si algún grupo tiene menos de 30 miembros (o el reservado es 0). Sin estadística: el aviso
--     dice el tamaño de cada grupo y que la diferencia puede ser casualidad.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ningún beneficio, saldo, movimiento, cupón ni promoción. Ninguna función existente. Ni sagrados, ni caja, ni Edge.
--
-- Pruebas: scripts/sql/166_pruebas.sql (+ 166_pruebas.py; transacción con rollback; Postgres 16 local y staging).
-- Rollback: scripts/sql/166_rollback.sql.

begin;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tablas
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.club_campanas (
  id           uuid primary key default gen_random_uuid(),
  location_id  text not null references public.club_config(location_id),
  nombre       text not null check (length(btrim(nombre)) between 2 and 80),
  fuente       text not null check (fuente in ('a_contactar', 'reto', 'primeros_90')),
  control_pct  numeric(5,2) not null default 15 check (control_pct >= 0 and control_pct <= 50),
  semilla      text not null default encode(extensions.gen_random_bytes(16), 'hex') check (semilla ~ '^[0-9a-f]{32}$'),
  inicio       date not null,                 -- día CR en que se armó
  creada_por   uuid,
  creada_en    timestamptz not null default now()
);
create index if not exists club_campanas_loc_idx on public.club_campanas (location_id, creada_en desc);
comment on table public.club_campanas is
  'Club (166): campañas del owner con grupo de control. La semilla fija el sorteo; nada se edita ni se borra (trigger).';

create table if not exists public.club_campana_asignaciones (
  campana_id   uuid not null references public.club_campanas(id),
  miembro_id   uuid not null references public.club_miembros(id),
  grupo        text not null check (grupo in ('control', 'oferta')),
  sorteo       numeric(10,9) not null check (sorteo >= 0 and sorteo < 1),
  asignado_en  timestamptz not null default now(),
  asignado_por uuid,
  primary key (campana_id, miembro_id)
);
create index if not exists club_campana_asig_miembro_idx on public.club_campana_asignaciones (miembro_id);
comment on table public.club_campana_asignaciones is
  'Club (166): grupo de cada miembro en cada campaña. El grupo lo pone el sorteo (trigger), no quien inserta; no se reasigna.';

alter table public.club_campanas enable row level security;
alter table public.club_campana_asignaciones enable row level security;
revoke all on public.club_campanas from public, anon, authenticated;
revoke all on public.club_campana_asignaciones from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Sorteo: determinístico y reproducible. md5(semilla:campaña:miembro), 8 primeros hex → [0, 1).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_campana_sorteo(p_semilla text, p_campana uuid, p_miembro uuid)
returns numeric
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select round(('x' || substr(md5(p_semilla || ':' || p_campana::text || ':' || p_miembro::text), 1, 8))::bit(32)::bigint
               / 4294967296.0, 9)
$$;

-- El grupo SIEMPRE sale del sorteo: lo que traiga el INSERT se pisa.
create or replace function public.club_campana_asignar_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_c public.club_campanas%rowtype;
begin
  select * into v_c from public.club_campanas c where c.id = new.campana_id;
  if not found then
    raise exception 'Campaña no encontrada' using errcode = 'P0001';
  end if;
  new.sorteo := public.club_campana_sorteo(v_c.semilla, v_c.id, new.miembro_id);
  -- round(…, 9) puede dar 1.000000000 con el hash máximo: se queda en el último valor posible
  if new.sorteo >= 1 then new.sorteo := 0.999999999; end if;
  new.grupo := case when new.sorteo < v_c.control_pct / 100 then 'control' else 'oferta' end;
  new.asignado_en := now();
  new.asignado_por := auth.uid();
  return new;
end;
$$;
drop trigger if exists club_campana_asignar_trg on public.club_campana_asignaciones;
create trigger club_campana_asignar_trg before insert on public.club_campana_asignaciones
  for each row execute function public.club_campana_asignar_trg();

-- Nada se reasigna ni se edita: ni el grupo, ni la semilla, ni el %. Tampoco se borra (es el rastro del sorteo).
create or replace function public.club_campana_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% es de solo inserción: el sorteo no se reasigna', tg_table_name using errcode = 'P0001';
end;
$$;
drop trigger if exists club_campanas_inmutable_trg on public.club_campanas;
create trigger club_campanas_inmutable_trg before update or delete on public.club_campanas
  for each row execute function public.club_campana_inmutable();
drop trigger if exists club_campana_asig_inmutable_trg on public.club_campana_asignaciones;
create trigger club_campana_asig_inmutable_trg before update or delete on public.club_campana_asignaciones
  for each row execute function public.club_campana_inmutable();
drop trigger if exists club_campana_asig_truncate_trg on public.club_campana_asignaciones;
create trigger club_campana_asig_truncate_trg before truncate on public.club_campana_asignaciones
  for each statement execute function public.club_campana_inmutable();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Internas
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- La campaña, si el usuario es owner ACTIVO y ve su local. Si no, 42501 (antes de decir si existe).
create or replace function public.club_campana_de_owner(p_campana uuid)
returns public.club_campanas
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_c   public.club_campanas%rowtype;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_c from public.club_campanas c where c.id = p_campana;
  if not found then
    raise exception 'Campaña no encontrada' using errcode = 'P0001';
  end if;
  if not public.puede_ver_local(v_c.location_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return v_c;
end;
$$;

-- Rastro de una LECTURA: una fila por apertura de la pantalla (mismo usuario, acción e id en 12 h). Sin id, siempre.
create or replace function public.club_campana_auditar_lectura(p_accion text, p_apertura uuid, p_despues jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_apertura is not null and exists (
       select 1 from public.club_auditoria a
        where a.actor = auth.uid() and a.accion = p_accion and a.objeto_id = p_apertura
          and a.en > now() - interval '12 hours') then
    return;
  end if;
  perform public.club_auditar(p_accion, 'club_campanas', p_apertura, null, p_despues);
end;
$$;

-- Saldo y vencimiento de los referentes / concierge PM ACTIVOS del local, ahora (la base de «A contactar»).
create or replace function public.club_campana_saldos(p_location text)
returns table (miembro_id uuid, creditos numeric, vence_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cfg as (select c.personas_por_credito, c.vencimiento_meses from public.club_config c where c.location_id = p_location),
  s as (
    select m.id, coalesce(sum(v.personas), 0) as p,
           max(v.fecha_visita) filter (where v.tipo in ('tarjeta', 'canje', 'restitucion')) as ult
      from public.club_miembros m
      left join public.club_movimientos v on v.miembro_id = m.id
     where m.location_id = p_location and m.tipo in ('referente', 'concierge_pm') and m.estado = 'activo'
     group by m.id)
  select s.id, public.club_creditos(greatest(s.p, 0)::bigint, cfg.personas_por_credito)::numeric,
         s.ult + make_interval(months => cfg.vencimiento_meses)
    from s, cfg
$$;

-- Suma a la campaña a los que HOY están en su fuente. Los ya asignados no cambian (on conflict do nothing).
create or replace function public.club_campana_sumar(p_campana uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_c public.club_campanas%rowtype; v_n int;
begin
  select * into v_c from public.club_campanas c where c.id = p_campana;
  if v_c.fuente <> 'a_contactar' then
    raise exception 'Esa fuente todavía no está disponible' using errcode = 'P0001';
  end if;
  insert into public.club_campana_asignaciones (campana_id, miembro_id, grupo, sorteo)
  select v_c.id, s.miembro_id, 'oferta', 0     -- grupo y sorteo los pone el trigger
    from public.club_campana_saldos(v_c.location_id) s
   where s.creditos > 0 and s.vence_en >= now() and s.vence_en < now() + interval '30 days'
  on conflict (campana_id, miembro_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Tamaño de cada grupo de una campaña.
create or replace function public.club_campana_tamanos(p_campana uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('oferta', count(*) filter (where a.grupo = 'oferta'),
                            'control', count(*) filter (where a.grupo = 'control'))
    from public.club_campana_asignaciones a where a.campana_id = p_campana
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Armar una campaña (solo owner)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_campana_crear(p_nombre text, p_location text default null,
                                                     p_control_pct numeric default 15, p_fuente text default 'a_contactar')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_c   public.club_campanas%rowtype;
  v_t   jsonb;
begin
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 2 and 80 then
    raise exception 'Poné un nombre de 2 a 80 letras' using errcode = 'P0001';
  end if;
  if p_control_pct is null or p_control_pct < 0 or p_control_pct > 50 then
    raise exception 'El grupo reservado va de 0 %% a 50 %%' using errcode = 'P0001';
  end if;
  if p_fuente is null or p_fuente not in ('a_contactar', 'reto', 'primeros_90') then
    raise exception 'Fuente no válida' using errcode = 'P0001';
  end if;
  if p_fuente <> 'a_contactar' then
    raise exception 'Esa fuente todavía no está disponible' using errcode = 'P0001';
  end if;
  p_location := public.club_local(p_location, false);
  if not public.puede_ver_local(p_location) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  insert into public.club_campanas (location_id, nombre, fuente, control_pct, inicio, creada_por)
  values (p_location, btrim(p_nombre), p_fuente, round(p_control_pct, 2),
          (now() at time zone 'America/Costa_Rica')::date, auth.uid())
  returning * into v_c;
  perform public.club_campana_sumar(v_c.id);
  v_t := public.club_campana_tamanos(v_c.id);
  -- La semilla va al rastro: con ella (y los id) el sorteo se recalcula igual.
  perform public.club_auditar('campana_crear', 'club_campanas', v_c.id, null,
    jsonb_build_object('local', v_c.location_id, 'fuente', v_c.fuente, 'control_pct', v_c.control_pct,
                       'semilla', v_c.semilla, 'inicio', v_c.inicio) || v_t);
  return jsonb_build_object('id', v_c.id, 'nombre', v_c.nombre, 'local', v_c.location_id, 'fuente', v_c.fuente,
                            'control_pct', v_c.control_pct, 'inicio', v_c.inicio, 'creada_en', v_c.creada_en) || v_t;
end;
$$;

-- Sumar a los que entraron a la lista después (los ya asignados quedan donde estaban).
create or replace function public.club_campana_sumar_nuevos(p_campana uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_c public.club_campanas%rowtype; v_n int; v_t jsonb;
begin
  v_c := public.club_campana_de_owner(p_campana);
  v_n := public.club_campana_sumar(v_c.id);
  v_t := public.club_campana_tamanos(v_c.id);
  perform public.club_auditar('campana_sumar', 'club_campanas', v_c.id, null, jsonb_build_object('nuevos', v_n) || v_t);
  return jsonb_build_object('id', v_c.id, 'nuevos', v_n) || v_t;
end;
$$;

-- Campañas del local (solo owner): sin personas, solo tamaños.
create or replace function public.club_campanas_listar(p_location text default null)
returns jsonb
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
  p_location := public.club_local(p_location, false);
  if not public.puede_ver_local(p_location) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'local', c.location_id, 'fuente', c.fuente,
                                        'control_pct', c.control_pct, 'inicio', c.inicio, 'creada_en', c.creada_en)
                     || public.club_campana_tamanos(c.id) order by c.creada_en desc)
      from public.club_campanas c where c.location_id = p_location), '[]'::jsonb);
end;
$$;

-- La lista de la campaña: SOLO el grupo con oferta. El reservado sale como un número. Con p_exporte, el CSV: además
-- WhatsApp y correo de quien los autorizó; deja fila siempre (cuántas, sin datos).
create or replace function public.club_campana_lista(p_campana uuid, p_exporte boolean default false, p_apertura uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_c public.club_campanas%rowtype; v_filas jsonb; v_n int;
begin
  v_c := public.club_campana_de_owner(p_campana);
  select coalesce(jsonb_agg(
           jsonb_build_object('miembro_id', m.id, 'nombre', m.nombre, 'negocio', n.nombre, 'tipo', m.tipo, 'estado', m.estado,
                              'creditos', coalesce(s.creditos, 0), 'vence_en', s.vence_en)
           || case when coalesce(p_exporte, false) then jsonb_build_object(
                'whatsapp', case when k.optin_whatsapp then k.telefono end,
                'email', case when k.optin_email then k.email end) else '{}'::jsonb end
           order by s.vence_en nulls last, m.nombre), '[]'::jsonb), count(*)
    into v_filas, v_n
    from public.club_campana_asignaciones a
    join public.club_miembros m on m.id = a.miembro_id
    left join public.club_negocios n on n.id = m.negocio_id
    left join public.club_campana_saldos(v_c.location_id) s on s.miembro_id = m.id
    left join public.club_miembros_contacto k on k.miembro_id = m.id
   where a.campana_id = v_c.id and a.grupo = 'oferta';     -- el grupo reservado NUNCA sale en la lista ni en el CSV
  if coalesce(p_exporte, false) then
    perform public.club_auditar('exporte_campana_csv', 'club_campanas', v_c.id, null,
      jsonb_build_object('campana', v_c.id, 'local', v_c.location_id, 'filas', v_n));
  else
    perform public.club_campana_auditar_lectura('ver_campana_lista', p_apertura,
      jsonb_build_object('campana', v_c.id, 'local', v_c.location_id));
  end if;
  return jsonb_build_object('id', v_c.id, 'nombre', v_c.nombre, 'local', v_c.location_id, 'control_pct', v_c.control_pct,
                            'filas', v_filas) || public.club_campana_tamanos(v_c.id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Reporte de la campaña: los dos grupos lado a lado (solo owner)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_campana_reporte(p_campana uuid, p_apertura uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_c      public.club_campanas%rowtype;
  v_hoy    date := (now() at time zone 'America/Costa_Rica')::date;
  c_minimo constant int := 30;   -- con menos miembros en un grupo, la diferencia no es concluyente
  r        jsonb;
begin
  v_c := public.club_campana_de_owner(p_campana);
  perform public.club_campana_auditar_lectura('ver_campana_reporte', p_apertura,
    jsonb_build_object('campana', v_c.id, 'local', v_c.location_id));

  with
  -- Cada miembro con su ventana de 30 días CR desde el día (CR) en que se lo asignó
  a as (
    select x.miembro_id, x.grupo, (x.asignado_en at time zone 'America/Costa_Rica')::date as dia,
           ((x.asignado_en at time zone 'America/Costa_Rica')::date)::timestamp at time zone 'America/Costa_Rica' as ini,
           (((x.asignado_en at time zone 'America/Costa_Rica')::date + 30))::timestamp at time zone 'America/Costa_Rica' as fin
      from public.club_campana_asignaciones x where x.campana_id = v_c.id),
  -- Actividad en el local de la campaña: un día CR por miembro
  act as (
    select v.miembro_id, (v.registrada_en at time zone 'America/Costa_Rica')::date as d
      from public.club_visitas_socio v join a on a.miembro_id = v.miembro_id
     where v.location_id = v_c.location_id and v.registrada_en >= a.ini and v.registrada_en < a.fin
    union
    select m.miembro_id, (m.fecha_visita at time zone 'America/Costa_Rica')::date
      from public.club_movimientos m join a on a.miembro_id = m.miembro_id
     where m.location_id = v_c.location_id and m.origen = 'app' and m.tipo in ('tarjeta', 'canje')
       and m.fecha_visita >= a.ini and m.fecha_visita < a.fin),
  -- Facturas de esos registros (el cruce del tablero 160)
  reg as (
    select v.miembro_id, x.tid
      from public.club_visitas_socio v join a on a.miembro_id = v.miembro_id
      cross join lateral unnest(public.club_cruce_facturas(v.location_id, v.pos_ref, null)) as x(tid)
     where v.location_id = v_c.location_id and v.registrada_en >= a.ini and v.registrada_en < a.fin
    union
    select m.miembro_id, x.tid
      from public.club_movimientos m join a on a.miembro_id = m.miembro_id
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = v_c.location_id and cm_t.numero_factura = cm.numero_factura
      cross join lateral unnest(case when cm_t.id is not null then array[cm_t.id]
                                     else public.club_cruce_facturas(v_c.location_id, m.pos_ref, m.factura_pos) end) as x(tid)
     where m.location_id = v_c.location_id and m.origen = 'app' and m.tipo in ('tarjeta', 'canje')
       and (m.factura_pos is not null or m.pos_ref is not null)
       and m.fecha_visita >= a.ini and m.fecha_visita < a.fin),
  -- Una factura cuenta UNA vez por grupo (dos miembros del mismo grupo en la mesa, o dos registros, son una)
  fg as (select distinct a.grupo, reg.tid from reg join a on a.miembro_id = reg.miembro_id where reg.tid is not null),
  fv as (
    select fg.grupo, fg.tid,
           greatest(coalesce((select sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20))
                                from public.pos_ndf_ticket_lines l where l.ticket_id = fg.tid), 0)
                    - coalesce(t.regalia_crc, 0), 0) as cobrada
      from fg join public.pos_ndf_tickets t on t.id = fg.tid and t.estado = 'C'),
  g as (
    select gr.grupo,
           (select count(*) from a where a.grupo = gr.grupo) as miembros,
           (select count(distinct act.miembro_id) from act join a on a.miembro_id = act.miembro_id where a.grupo = gr.grupo) as con_visita,
           (select count(*) from act join a on a.miembro_id = act.miembro_id where a.grupo = gr.grupo) as visitas,
           (select count(*) from fv where fv.grupo = gr.grupo) as facturas,
           (select coalesce(sum(fv.cobrada), 0) from fv where fv.grupo = gr.grupo) as venta
      from (values ('oferta'), ('control')) gr(grupo)),
  gj as (
    select g.grupo, jsonb_build_object(
             'miembros', g.miembros, 'con_visita', g.con_visita,
             'con_visita_pct', case when g.miembros > 0 then round(100.0 * g.con_visita / g.miembros, 1) end,
             'visitas', g.visitas,
             'visitas_por_miembro', case when g.miembros > 0 then round(g.visitas::numeric / g.miembros, 2) end,
             'facturas', g.facturas, 'venta_respaldada_crc', round(g.venta),
             'venta_por_miembro_crc', case when g.miembros > 0 then round(g.venta / g.miembros) end) as j
      from g)
  select jsonb_build_object(
    'id', v_c.id, 'nombre', v_c.nombre, 'local', v_c.location_id, 'fuente', v_c.fuente,
    'control_pct', v_c.control_pct, 'inicio', v_c.inicio, 'generado_en', now(),
    'ventana_dias', 30,
    'ventana_hasta', (select max(a.dia) + 29 from a),
    'cerrado', coalesce((select max(a.dia) + 30 <= v_hoy from a), false),
    'umbral_minimo', c_minimo,
    'no_concluyente', (select bool_or(g.miembros < c_minimo) from g),
    'pos_sin_datos', not exists (select 1 from public.pos_ndf_tickets t where t.local = v_c.location_id and t.estado = 'C'
                                    and coalesce(t.fecha_registra, t.fecha_cierra) >= v_c.inicio::timestamp at time zone 'America/Costa_Rica'),
    'oferta', (select j from gj where grupo = 'oferta'),
    'control', (select j from gj where grupo = 'control'))
  into r;
  return r;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Permisos: las de pantalla, solo authenticated (el rol se chequea adentro). Las internas, nadie.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke all on function public.club_campana_sorteo(text, uuid, uuid)                    from public, anon, authenticated;
revoke all on function public.club_campana_asignar_trg()                               from public, anon, authenticated;
revoke all on function public.club_campana_inmutable()                                 from public, anon, authenticated;
revoke all on function public.club_campana_de_owner(uuid)                              from public, anon, authenticated;
revoke all on function public.club_campana_auditar_lectura(text, uuid, jsonb)          from public, anon, authenticated;
revoke all on function public.club_campana_saldos(text)                                from public, anon, authenticated;
revoke all on function public.club_campana_sumar(uuid)                                 from public, anon, authenticated;
revoke all on function public.club_campana_tamanos(uuid)                               from public, anon, authenticated;
revoke all on function public.club_campana_crear(text, text, numeric, text)            from public, anon, authenticated;
revoke all on function public.club_campana_sumar_nuevos(uuid)                          from public, anon, authenticated;
revoke all on function public.club_campanas_listar(text)                               from public, anon, authenticated;
revoke all on function public.club_campana_lista(uuid, boolean, uuid)                  from public, anon, authenticated;
revoke all on function public.club_campana_reporte(uuid, uuid)                         from public, anon, authenticated;
grant execute on function public.club_campana_crear(text, text, numeric, text)         to authenticated;
grant execute on function public.club_campana_sumar_nuevos(uuid)                       to authenticated;
grant execute on function public.club_campanas_listar(text)                            to authenticated;
grant execute on function public.club_campana_lista(uuid, boolean, uuid)               to authenticated;
grant execute on function public.club_campana_reporte(uuid, uuid)                      to authenticated;

comment on function public.club_campana_reporte(uuid, uuid) is
  'Club (166): reporte de una campaña, grupo con oferta contra grupo reservado (actividad y venta respaldada a 30 días). Solo owner activo; rastro por apertura.';

-- Verificación: tablas con RLS y sin grants, triggers puestos, funciones SECURITY DEFINER con search_path fijo y anon
-- sin EXECUTE. Si algo no está, aborta.
do $$
declare v_p record;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.club_campanas'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.club_campana_asignaciones'::regclass) then
    raise exception '166: falta RLS en las tablas de campañas';
  end if;
  if has_table_privilege('authenticated', 'public.club_campana_asignaciones', 'INSERT,UPDATE,DELETE,SELECT')
     or has_table_privilege('authenticated', 'public.club_campanas', 'INSERT,UPDATE,DELETE,SELECT') then
    raise exception '166: authenticated tiene acceso directo a las tablas de campañas';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgrelid in
        ('public.club_campanas'::regclass, 'public.club_campana_asignaciones'::regclass)) <> 4 then
    raise exception '166: faltan triggers de las campañas';
  end if;
  for v_p in select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname in
                ('club_campana_crear', 'club_campana_sumar_nuevos', 'club_campanas_listar', 'club_campana_lista', 'club_campana_reporte')
  loop
    if not v_p.prosecdef then raise exception '166: % no es SECURITY DEFINER', v_p.proname; end if;
    if not exists (select 1 from unnest(v_p.proconfig) c where c like 'search_path=%') then
      raise exception '166: % sin search_path fijo', v_p.proname;
    end if;
    if has_function_privilege('anon', v_p.oid, 'execute') then
      raise exception '166: anon puede ejecutar %', v_p.proname;
    end if;
  end loop;
end $$;

commit;
