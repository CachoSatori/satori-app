-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 164 (origen 110) — Club: alertas con umbral para el Inicio («Para revisar hoy»). SPEC-club-v2 ítem 10 (B6). ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Esquema del Club en prod (5 columnas nuevas en club_config + 1 función de lectura): no se mergea sin el OK del dueño.
-- Creada en el bloque CLUB como 110; prod va por la 155 y el bloque PASE tiene reservadas hasta la 163 → 164 (regla 3),
-- con origen 110. Vía a prod: merge → Branching (nada a mano).
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · club_config: 5 umbrales POR LOCAL (los cambia solo el owner: la política club_config_update ya lo exige; quedan en
--     club_config_historial por el trigger club_config_auditar, que audita cualquier columna). Valores iniciales:
--       alerta_anfitrion_24h_max       5  → aviso si un anfitrión suma MÁS de 5 acumulaciones en 24 h
--       alerta_mismo_usuario_max       2  → aviso si el mismo usuario registra al mismo socio (o al mismo del equipo)
--       alerta_mismo_usuario_dias      3     MÁS de 2 veces en 3 días (o sea, 3 o más)
--       alerta_visitas_sin_factura_max 0  → aviso desde la 1.ª visita de socio sin factura (ayer y hoy)
--       alerta_canjes_sin_codigo_max   0  → aviso desde el 1.er canje sin código sin resolver (30 días)
--     Por qué esos números: con el tope del mes de fábrica (anfitrion_tope_mes_crc), 6 mesas del mismo anfitrión en
--     24 h ya pasan lo que gana en un mes normal. Un socio con beneficio usa una visita por día: que el MISMO usuario
--     lo registre 3 veces en 3 días es raro (en el piloto, 2 socios). Visitas sin factura y canjes sin código: 0 es la
--     meta de la guía 6.13 → cualquiera se avisa.
--   · public.club_alertas_inicio(p_location text default null): lo que el Inicio muestra en «Club · Para revisar hoy».
--     Sin local (lo que usa el Inicio): todos los locales con el Club encendido que el usuario ve (puede_ver_local), cada
--     aviso con su local en el detalle (local, local_nombre, multilocal). Con local: solo ese.
--     Ventana de revisión: AYER y HOY (hora de Costa Rica), salvo (d), que usa los mismos 30 días que el aviso de
--     excepciones. Devuelve solo lo que pasa el umbral (cero filas = nada para revisar):
--       (a) ANFITRION_24H     · anfitrión (cualquier tipo, también el equipo) con más de N acumulaciones en una ventana de
--                               24 h que termina dentro de la ventana de revisión. Acumulación = tarjeta (cupón, manual o
--                               papel; NO la carga inicial, origen 'migracion', como la 155) o persona pendiente del tope
--                               que todavía no es movimiento (pendiente o rechazada: el intento cuenta). Por fecha de visita.
--       (b) MISMO_USUARIO     · el mismo usuario de la app registró al mismo socio (visita de socio) o al mismo del equipo
--                               (tarjeta) más de M veces en D días. El equipo entra porque su ranking premia desempeño
--                               (con o sin la 157: sigue registrando tarjetas). Por hora de registro.
--       (c) VISITAS_SIN_FACTURA · REUTILIZA club_reporte_visitas (misma regla: latencia del puente, R = cobrada, pedido
--                               abierto hasta 18 h): suma «sin factura» de ayer y hoy.
--       (d) CANJE_SIN_CODIGO  · REUTILIZA club_excepciones(…, 'CANJE_SIN_CODIGO'): cuántas siguen sin resolver en 30 días.
--                               No se duplica la alerta: se revisa y se resuelve en Excepciones.
--   · Permisos: SECURITY DEFINER, search_path fijo, rol activo owner o manager (get_my_role() es null si el perfil está
--     inactivo), y el manager solo en sus locales (puede_ver_local, 091). Cajero, salonero, contador y anon: 42501 / sin
--     EXECUTE. Club apagado en el local: cero filas (como club_excepciones).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni plata, ni saldos, ni movimientos. No escribe nada (STABLE). No cambia club_excepciones ni club_reporte_visitas.
--   · No hay reversa por factura anulada (decisión del dueño, 14-nov): no es parte de estas alertas.
--
-- Pruebas: scripts/sql/164_pruebas.sql (+ 164_pruebas.py; transacción descartada, Postgres local o staging).
-- Rollback: scripts/sql/164_rollback.sql.

begin;

-- ── 1. Umbrales por local ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.club_config add column if not exists alerta_anfitrion_24h_max int not null default 5
  check (alerta_anfitrion_24h_max between 1 and 100);
alter table public.club_config add column if not exists alerta_mismo_usuario_max int not null default 2
  check (alerta_mismo_usuario_max between 1 and 50);
alter table public.club_config add column if not exists alerta_mismo_usuario_dias int not null default 3
  check (alerta_mismo_usuario_dias between 1 and 30);
alter table public.club_config add column if not exists alerta_visitas_sin_factura_max int not null default 0
  check (alerta_visitas_sin_factura_max between 0 and 100);
alter table public.club_config add column if not exists alerta_canjes_sin_codigo_max int not null default 0
  check (alerta_canjes_sin_codigo_max between 0 and 100);

comment on column public.club_config.alerta_anfitrion_24h_max is
  'Inicio «Para revisar hoy» (a): aviso si un anfitrión suma MÁS de N acumulaciones en 24 h. Solo owner (164).';
comment on column public.club_config.alerta_mismo_usuario_max is
  'Inicio (b): aviso si el mismo usuario registra al mismo socio o al mismo del equipo MÁS de N veces en alerta_mismo_usuario_dias. Solo owner (164).';
comment on column public.club_config.alerta_mismo_usuario_dias is
  'Inicio (b): ventana en días de alerta_mismo_usuario_max. Solo owner (164).';
comment on column public.club_config.alerta_visitas_sin_factura_max is
  'Inicio (c): aviso si las visitas de socio sin factura de ayer y hoy son MÁS de N (0 = desde la primera). Solo owner (164).';
comment on column public.club_config.alerta_canjes_sin_codigo_max is
  'Inicio (d): aviso si los canjes sin código sin resolver (30 días) son MÁS de N (0 = desde el primero). Solo owner (164).';

-- ── 2. Las alertas del Inicio ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.club_alertas_inicio(p_location text default null)
returns table (tipo text, ref text, cantidad int, umbral int, fecha timestamptz, detalle jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_cfg   public.club_config%rowtype;
  v_hoy   date := (now() at time zone 'America/Costa_Rica')::date;
  v_desde timestamptz;
  v_n     int;
  v_loc   record;
  v_multi boolean;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  -- Sin local (el Inicio): TODOS los locales con el Club encendido que el usuario ve, cada aviso con su local. Así, con
  -- dos locales encendidos y ninguno elegido en el aparato, el Inicio no queda en «sin comprobar» (verificador #183).
  if p_location is null then
    select count(*) > 1 into v_multi from public.club_config c
     where c.club_activo and public.puede_ver_local(c.location_id);
    for v_loc in select c.location_id from public.club_config c
                  where c.club_activo and public.puede_ver_local(c.location_id) order by c.location_id loop
      return query select a.tipo, a.ref, a.cantidad, a.umbral, a.fecha,
                          a.detalle || jsonb_build_object('multilocal', v_multi)
                     from public.club_alertas_inicio(v_loc.location_id) a;
    end loop;
    return;
  end if;
  p_location := public.club_local(p_location, false);
  if not public.puede_ver_local(p_location) then        -- 091: el manager ve solo sus locales
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not public.club_local_activo(p_location) then return; end if;   -- Club apagado en el local: nada que revisar
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  v_desde := (v_hoy - 1)::timestamp at time zone 'America/Costa_Rica';   -- ayer 00:00 hora CR

  -- (a) más de N acumulaciones del mismo anfitrión en 24 h
  return query
  with ac as (
    select m.miembro_id, m.fecha_visita as f
      from public.club_movimientos m
     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0
       and m.origen <> 'migracion'                                     -- la carga inicial no cuenta (como la 155)
       and m.fecha_visita >= v_desde - interval '24 hours' and m.fecha_visita <= now()
    union all
    select pp.miembro_id, pp.fecha_visita
      from public.club_personas_pendientes pp
     where pp.location_id = p_location and pp.movimiento_id is null   -- aprobada = ya es movimiento (no se cuenta dos veces)
       and pp.fecha_visita >= v_desde - interval '24 hours' and pp.fecha_visita <= now()),
  ve as (   -- por cada acumulación de la ventana de revisión: cuántas del mismo anfitrión en las 24 h que terminan ahí
    select a.miembro_id, a.f as hasta,
           (select count(*) from ac b where b.miembro_id = a.miembro_id and b.f > a.f - interval '24 hours' and b.f <= a.f) as n
      from ac a where a.f >= v_desde),
  mx as (
    select distinct on (ve.miembro_id) ve.miembro_id, ve.n, ve.hasta
      from ve order by ve.miembro_id, ve.n desc, ve.hasta desc)
  select 'ANFITRION_24H'::text, 'anfitrion-24h:' || mx.miembro_id, mx.n::int, v_cfg.alerta_anfitrion_24h_max, mx.hasta,
         jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                            'miembro_id', mx.miembro_id, 'miembro', public.club_nombre_limpio(mi.nombre),
                            'tipo_miembro', mi.tipo, 'desde', mx.hasta - interval '24 hours', 'hasta', mx.hasta)
    from mx join public.club_miembros mi on mi.id = mx.miembro_id
   where mx.n > v_cfg.alerta_anfitrion_24h_max
   order by mx.n desc, mx.hasta desc;

  -- (b) el mismo usuario registra al mismo socio (visitas) o al mismo del equipo (tarjetas) más de M veces en D días
  return query
  with rg as (
    select v.miembro_id, v.registrado_por as usuario, v.registrada_en as f, 'socio'::text as que
      from public.club_visitas_socio v
     where v.location_id = p_location and v.registrado_por is not null
       and v.registrada_en >= v_desde - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and v.registrada_en <= now()
    union all
    select m.miembro_id, m.registrado_por, m.registrado_en, 'equipo'
      from public.club_movimientos m join public.club_miembros mi on mi.id = m.miembro_id
     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0 and m.origen <> 'migracion'
       and mi.tipo = 'equipo' and m.registrado_por is not null
       and m.registrado_en >= v_desde - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and m.registrado_en <= now()),
  ve as (
    select a.miembro_id, a.usuario, a.que, a.f as hasta,
           (select count(*) from rg b where b.miembro_id = a.miembro_id and b.usuario = a.usuario and b.que = a.que
               and b.f > a.f - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and b.f <= a.f) as n
      from rg a where a.f >= v_desde),
  mx as (
    select distinct on (ve.miembro_id, ve.usuario, ve.que) ve.*
      from ve order by ve.miembro_id, ve.usuario, ve.que, ve.n desc, ve.hasta desc)
  select 'MISMO_USUARIO'::text, 'mismo-usuario:' || mx.que || ':' || mx.miembro_id || ':' || mx.usuario, mx.n::int,
         v_cfg.alerta_mismo_usuario_max, mx.hasta,
         jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                            'miembro_id', mx.miembro_id, 'miembro', public.club_nombre_limpio(mi.nombre), 'que', mx.que,
                            'usuario', coalesce((select p.full_name from public.profiles p where p.id = mx.usuario), 'Sin perfil'),
                            'dias', v_cfg.alerta_mismo_usuario_dias)
    from mx join public.club_miembros mi on mi.id = mx.miembro_id
   where mx.n > v_cfg.alerta_mismo_usuario_max
   order by mx.n desc, mx.hasta desc;

  -- (c) visitas de socio sin factura cruzada (ayer y hoy): la misma cuenta que «Reportes → Visitas de socios por usuario»
  select coalesce(sum(r.sin_factura), 0)::int into v_n from public.club_reporte_visitas(v_hoy - 1, v_hoy, p_location) r;
  if v_n > v_cfg.alerta_visitas_sin_factura_max then
    return query select 'VISITAS_SIN_FACTURA'::text, 'visitas-sin-factura:' || p_location || ':' || v_hoy, v_n,
                        v_cfg.alerta_visitas_sin_factura_max, now(),
                        jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                                           'desde', v_hoy - 1, 'hasta', v_hoy);
  end if;

  -- (d) canjes sin código sin resolver (30 días): las mismas filas de Excepciones, solo el conteo
  select count(*)::int into v_n
    from public.club_excepciones(v_hoy - 30, v_hoy, p_location, 'CANJE_SIN_CODIGO') e where not e.resuelta;
  if v_n > v_cfg.alerta_canjes_sin_codigo_max then
    return query select 'CANJE_SIN_CODIGO'::text, 'canjes-sin-codigo:' || p_location || ':' || v_hoy, v_n,
                        v_cfg.alerta_canjes_sin_codigo_max, now(),
                        jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location), 'dias', 30);
  end if;
end;
$$;

revoke all on function public.club_alertas_inicio(text) from public, anon, authenticated;
grant execute on function public.club_alertas_inicio(text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
        and column_name in ('alerta_anfitrion_24h_max','alerta_mismo_usuario_max','alerta_mismo_usuario_dias',
                            'alerta_visitas_sin_factura_max','alerta_canjes_sin_codigo_max')) <> 5 then
    raise exception '164: faltan umbrales en club_config';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.club_alertas_inicio(text)'::regprocedure) then
    raise exception '164: club_alertas_inicio tiene que ser SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.club_alertas_inicio(text)', 'EXECUTE') then
    raise exception '164: anon no puede ejecutar club_alertas_inicio';
  end if;
  if not has_function_privilege('authenticated', 'public.club_alertas_inicio(text)', 'EXECUTE') then
    raise exception '164: authenticated tiene que poder ejecutar club_alertas_inicio';
  end if;
end
$$;

commit;
