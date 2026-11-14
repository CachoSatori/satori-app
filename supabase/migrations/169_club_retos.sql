-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 169 (origen 115) — Retos de temporada baja («3 almuerzos este mes») (ítem #16 del Club v2).   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ TOCA PLATA (una cortesía de premio) y el esquema: no se mergea sin la firma del dueño. Creada como 115 (bloque CLUB);
-- prod va por la 155, así que va como 169 del bloque de PASE (regla 3), con origen 115.
-- APAGADO POR DEFECTO: la migración no crea ningún reto. Un reto nace en 'borrador' y no cuenta para nada hasta que el
-- owner lo ARMA (club_reto_armar). Sin reto armado nadie gana nada: no hay plata en juego sin su decisión.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · club_retos (NUEVA): nombre ES/EN, local(es), ventana de fechas (un solo año calendario, hasta 92 días), días y
--     franja horaria (LA MISMA definición que club_promociones: dias isodow 1–7 y hora_desde/hora_hasta, que puede
--     cruzar la medianoche, todo en hora CR), meta (N visitas que cumplen la franja), premio = una cortesía de
--     «CORTESÍA CLUB» elegida por el owner PARA CADA LOCAL ({location_id: cortesia_id}), días que vale el premio y el
--     gancho del grupo de control (control_pct: 0 o 15).
--     Estados: borrador → vigente (ARMADO, armado_en) → terminada. Armado, ya no se edita (solo se termina).
--   · Reglas en la BASE (trigger club_retos_reglas, con candado; valen aunque alguien escriba por fuera de las funciones):
--       – máximo 3 retos ARMADOS por año calendario (todos los locales juntos; un borrador no cuenta);
--       – dos retos armados no se superponen en fechas en un mismo local;
--       – armado, solo cambia el estado a terminada; terminado, nada; solo se borra un borrador.
--   · Quién participa: socio ACTIVO del Local Club (rol socio activo). El EQUIPO nunca (tipo 'equipo' o rol equipo
--     activo, con y sin la 157, D7). Grupo de control: con control_pct = 15, un sorteo FIJO y reproducible por (reto,
--     socio) (md5, no cambia con la versión de Postgres) deja ~15 % de los socios sin el reto (no lo ven ni lo ganan; el
--     beneficio base no cambia). No depende de #185 ni de la 168 (club_miembros.sin_avance no se usa).
--   · Avance (se calcula en LECTURA, desde club_visitas_socio): días CR distintos con una visita registrada en un local
--     del reto, dentro de la ventana, en uno de sus días y dentro de la franja (la hora es la del REGISTRO de la visita en
--     caja, como la promoción del Local Club). Varias visitas el mismo día cuentan una.
--   · Ganar: trigger AFTER INSERT en club_visitas_socio (club_retos_visita_trg). Si con esa visita llega a la meta, se
--     guarda el premio en club_retos_ganados (UNO por reto y socio: unique) con vence_en = ahora + vence_dias.
--     Un error del reto NO frena el registro de la visita (se avisa con WARNING) y el paso de caja vuelve a evaluar.
--   · Ofrecer: club_reto_en_visita(visita, local) — un PASO APARTE que la caja llama después de club_socio_visita, con
--     la visita recién registrada (solo de HOY y del local de la caja). Bajo el MISMO candado por socio que
--     club_socio_visita, un UPDATE condicionado (where estado = 'disponible') pasa el premio a 'usada': dos cajas a la
--     vez, una sola lo da. Mismos criterios que la 168: factura pagada con créditos, socio como invitado o sin
--     promoción → no va en esa factura, queda guardado; local sin artículo cargado/activo → NO se ofrece, queda
--     guardado y se avisa. Lo ofrecido se suma a la MISMA lista de cortesías de la visita (motivo 'reto') y a su
--     `aplicar` (el reescaneo muestra lo mismo). Idempotente: llamarla otra vez con la misma visita devuelve lo guardado.
--   · «Mi Club»: club_portal_retos(token) (PÚBLICA como club_portal, solo por club-web): retos en curso o por empezar
--     con su avance, y los premios ganados sin usar.
--   · Gerencia: club_retos_listar (owner y manager), club_reto_guardar / _armar / _terminar / _borrar (solo owner).
--
-- ── POR QUÉ NO ENVUELVE club_socio_visita (convivencia con la 168) ─────────────────────────────
-- La 168 (#187) renombra club_socio_visita → club_socio_visita_base y la envuelve. Si esta también la envolviera, la que
-- entra segunda tendría que saber de la otra (orden frágil, dos PRs que se pisan). Esta migración NO toca
-- club_socio_visita, club_socio_visita_base, club_pase_datos ni club_portal: gana con un trigger sobre la tabla de visitas
-- (lo dispara cualquier vía que registre una visita, con o sin la 168) y ofrece en una función aparte que la caja llama
-- DESPUÉS, cuando club_socio_visita (y la cortesía de bienvenida de la 168, si está) ya escribió la visita: lee el
-- `aplicar` y las `cortesias` de la FILA y les suma el premio del reto. Entran en cualquier orden (168 antes o después).
-- El pase de Wallet no muestra el reto en esta migración: club_pase_datos es de la 168; queda como pendiente.
--
-- ── DÓNDE QUEDA LA CORTESÍA (auditoría) ────────────────────────────────────────────────────────
-- Como las demás cortesías: en club_visitas_socio.cortesias / aplicar de la visita, la fila de club_retos_ganados y
-- renglones en club_auditoria (reto_ganado, reto_usado, reto_vencido; alta, armado, terminado). NO va a club_movimientos.
--
-- Pruebas: scripts/sql/169_pruebas.sql (+ 169_pruebas.py; transacción descartada) y 169_concurrencia.sh (base local).
-- Rollback: scripts/sql/169_rollback.sql (aborta si ya hay premios ganados).

begin;

-- 1. Retos
create table if not exists public.club_retos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (length(btrim(nombre)) between 2 and 80),
  nombre_en       text not null check (length(btrim(nombre_en)) between 2 and 80),
  locales         text[] not null check (cardinality(locales) between 1 and 10 and array_position(locales, null) is null),
  estado          text not null default 'borrador' check (estado in ('borrador','vigente','terminada')),
  desde           date not null,
  hasta           date not null,
  dias            int[] not null default '{1,2,3,4,5,6,7}' check (dias <@ '{1,2,3,4,5,6,7}'::int[] and cardinality(dias) between 1 and 7),
  hora_desde      time,
  hora_hasta      time,
  meta            int not null check (meta between 2 and 10),
  cortesias       jsonb not null default '{}'::jsonb check (jsonb_typeof(cortesias) = 'object'),   -- {location_id: cortesia_id}
  vence_dias      int not null default 30 check (vence_dias between 7 and 90),
  control_pct     int not null default 0 check (control_pct in (0, 15)),
  creada_por      uuid,
  creada_en       timestamptz not null default now(),
  actualizada_por uuid,
  actualizada_en  timestamptz not null default now(),
  armado_por      uuid,
  armado_en       timestamptz,
  terminada_por   uuid,
  terminada_en    timestamptz,
  check (hasta >= desde and hasta - desde <= 92 and extract(year from desde) = extract(year from hasta)),
  check ((hora_desde is null) = (hora_hasta is null)),
  check (hora_desde is null or hora_desde <> hora_hasta),
  check ((estado = 'borrador') = (armado_en is null) or (estado = 'terminada' and armado_en is null)),
  check ((estado = 'terminada') = (terminada_en is not null))
);
comment on table public.club_retos is
  '169: retos de temporada baja. borrador → vigente (armado) → terminada. Máx. 3 armados por año y sin superposición por local (trigger club_retos_reglas).';
create index if not exists club_retos_estado_idx on public.club_retos (estado, desde, hasta);
alter table public.club_retos enable row level security;
revoke all on public.club_retos from public, anon, authenticated;   -- se lee y se escribe solo por las funciones

-- 2. Reglas en la base: tope por año, superposición por local, armado inmutable. Con candado (dos owners a la vez).
create or replace function public.club_retos_reglas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anio int;
  v_n    int;
  v_otro public.club_retos%rowtype;
  v_loc  text;
begin
  if tg_op = 'DELETE' then
    if old.armado_en is not null then
      raise exception 'Un reto armado no se borra: terminalo' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.estado = 'terminada' then
    raise exception 'Un reto terminado no se cambia' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.armado_en is not null then
    if (to_jsonb(new) - array['estado','terminada_por','terminada_en','actualizada_por','actualizada_en'])
       is distinct from (to_jsonb(old) - array['estado','terminada_por','terminada_en','actualizada_por','actualizada_en'])
       or new.estado <> 'terminada' then
      raise exception 'Un reto armado no se edita: solo se puede terminar' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- todos los locales existen
  foreach v_loc in array new.locales loop
    if not exists (select 1 from public.club_config c where c.location_id = v_loc) then
      raise exception 'Local no válido: %', v_loc using errcode = 'P0001';
    end if;
  end loop;
  if new.armado_en is null then return new; end if;   -- un borrador no cuenta para el tope ni la superposición

  perform pg_advisory_xact_lock(hashtextextended('club_retos', 0));
  v_anio := extract(year from new.desde)::int;
  select count(*) into v_n from public.club_retos r
   where r.armado_en is not null and r.id <> new.id and extract(year from r.desde)::int = v_anio;
  if v_n >= 3 then
    raise exception 'Ya hay 3 retos armados en %: es el máximo por año', v_anio using errcode = 'P0001';
  end if;
  select * into v_otro from public.club_retos r
   where r.armado_en is not null and r.id <> new.id and r.locales && new.locales
     and daterange(r.desde, r.hasta, '[]') && daterange(new.desde, new.hasta, '[]')
   limit 1;
  if v_otro.id is not null then
    raise exception 'Se superpone con el reto «%» (% a %) en el mismo local', v_otro.nombre, v_otro.desde, v_otro.hasta
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists club_retos_reglas_trg on public.club_retos;
create trigger club_retos_reglas_trg before insert or update or delete on public.club_retos
  for each row execute function public.club_retos_reglas();

-- 3. Premios ganados: UNO por reto y socio
create table if not exists public.club_retos_ganados (
  id              uuid primary key default gen_random_uuid(),
  reto_id         uuid not null references public.club_retos(id),
  miembro_id      uuid not null references public.club_miembros(id),
  estado          text not null default 'disponible' check (estado in ('disponible','usada','vencida')),
  ganada_en       timestamptz not null default now(),
  visita_ganadora uuid not null references public.club_visitas_socio(id),
  vence_en        timestamptz not null,
  usada_en        timestamptz,
  visita_id       uuid unique references public.club_visitas_socio(id),
  location_id     text,
  cortesia        jsonb,
  unique (reto_id, miembro_id),
  check ((estado = 'usada') = (usada_en is not null and visita_id is not null and cortesia is not null and location_id is not null))
);
comment on table public.club_retos_ganados is
  '169: premio de un reto (uno por reto y socio). disponible → usada (una vez, en caja) o vencida.';
create index if not exists club_retos_ganados_miembro_idx on public.club_retos_ganados (miembro_id, estado);
alter table public.club_retos_ganados enable row level security;
revoke all on public.club_retos_ganados from public, anon, authenticated;
grant select on public.club_retos_ganados to authenticated;
drop policy if exists club_retos_ganados_ver on public.club_retos_ganados;
create policy club_retos_ganados_ver on public.club_retos_ganados for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- 4. Grupo de control: sorteo FIJO por (reto, socio). md5 (estable entre versiones de Postgres) → 0..99. Interna.
create or replace function public.club_reto_control(p_reto uuid, p_pct int, p_miembro uuid)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_pct, 0) > 0
     and (('x' || substr(md5(p_reto::text || ':' || p_miembro::text), 1, 7))::bit(28)::int % 100) < p_pct
$$;

-- ¿Participa? Socio activo del Local Club, no equipo (D7), no en el grupo de control de ese reto. Interna.
create or replace function public.club_reto_participa(p_reto public.club_retos, p_miembro uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.club_miembros m
      join public.club_miembro_roles r on r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo'
     where m.id = p_miembro and m.estado = 'activo'
       and m.tipo <> 'equipo'   -- D7: el equipo no es cliente (con y sin la 157)
       and not exists (select 1 from public.club_miembro_roles e where e.miembro_id = m.id and e.rol = 'equipo' and e.estado = 'activo'))
     and not public.club_reto_control(p_reto.id, p_reto.control_pct, p_miembro)
$$;

-- 5. ¿Ese momento cumple el reto? Fechas, día y franja en hora CR. MISMA regla que club_promo_vigente_en (150):
--    franja [hora_desde, hora_hasta), y si hora_desde > hora_hasta cruza la medianoche. Interna.
create or replace function public.club_reto_en_franja(p_reto public.club_retos, p_ts timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select (p_ts at time zone 'America/Costa_Rica')::date between p_reto.desde and p_reto.hasta
     and extract(isodow from p_ts at time zone 'America/Costa_Rica')::int = any(p_reto.dias)
     and (p_reto.hora_desde is null
          or (p_reto.hora_desde <= p_reto.hora_hasta and (p_ts at time zone 'America/Costa_Rica')::time >= p_reto.hora_desde
                                                      and (p_ts at time zone 'America/Costa_Rica')::time <  p_reto.hora_hasta)
          or (p_reto.hora_desde >  p_reto.hora_hasta and ((p_ts at time zone 'America/Costa_Rica')::time >= p_reto.hora_desde
                                                       or (p_ts at time zone 'America/Costa_Rica')::time <  p_reto.hora_hasta)))
$$;

-- Avance: días CR distintos con visita que cumple (local del reto, ventana, día y franja). Interna.
create or replace function public.club_reto_avance(p_reto public.club_retos, p_miembro uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct (vs.registrada_en at time zone 'America/Costa_Rica')::date)::int
    from public.club_visitas_socio vs
   where vs.miembro_id = p_miembro
     and vs.fecha between p_reto.desde - 1 and p_reto.hasta + 1   -- índice (miembro_id, fecha); el filtro fino es la franja
     and vs.location_id = any(p_reto.locales)
     and public.club_reto_en_franja(p_reto, vs.registrada_en)
$$;

-- 6. Ganar: evalúa los retos armados y en curso de esa visita. Idempotente (unique). Devuelve cuántos ganó. Interna.
create or replace function public.club_retos_evaluar(p_visita uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_v  public.club_visitas_socio%rowtype;
  v_r  public.club_retos%rowtype;
  v_id uuid;
  v_n  int := 0;
begin
  select * into v_v from public.club_visitas_socio where id = p_visita;
  if not found then return 0; end if;
  for v_r in
    select r.* from public.club_retos r
     where r.estado = 'vigente' and v_v.location_id = any(r.locales)
       and public.club_reto_en_franja(r, v_v.registrada_en)
  loop
    continue when not public.club_reto_participa(v_r, v_v.miembro_id);
    continue when exists (select 1 from public.club_retos_ganados g where g.reto_id = v_r.id and g.miembro_id = v_v.miembro_id);
    continue when public.club_reto_avance(v_r, v_v.miembro_id) < v_r.meta;
    v_id := null;
    insert into public.club_retos_ganados (reto_id, miembro_id, visita_ganadora, vence_en)
    values (v_r.id, v_v.miembro_id, v_v.id, now() + make_interval(days => v_r.vence_dias))
    on conflict (reto_id, miembro_id) do nothing
    returning id into v_id;
    if v_id is not null then
      v_n := v_n + 1;
      perform public.club_auditar('reto_ganado', 'club_retos_ganados', v_id, null,
                                  (select to_jsonb(g) from public.club_retos_ganados g where g.id = v_id));
    end if;
  end loop;
  return v_n;
end;
$$;

-- Trigger: cualquier visita nueva (por club_socio_visita, con o sin la 168) evalúa los retos. Un error del reto NO
-- frena el registro de la visita: se avisa y el paso de caja (club_reto_en_visita) vuelve a evaluar.
create or replace function public.club_retos_visita_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.club_retos_evaluar(new.id);
  exception when others then
    raise warning '169: no se pudo evaluar el reto de la visita %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists club_retos_visita_trg on public.club_visitas_socio;
create trigger club_retos_visita_trg after insert on public.club_visitas_socio
  for each row execute function public.club_retos_visita_trg();

-- 7. Ofrecer en caja: paso aparte, DESPUÉS de club_socio_visita. owner, manager, cajero.
create or replace function public.club_reto_en_visita(p_visita uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_loc  text;
  v_v    public.club_visitas_socio%rowtype;
  v_g    public.club_retos_ganados%rowtype;
  v_r    public.club_retos%rowtype;
  v_k    public.club_cortesias%rowtype;
  v_hoy  date := (now() at time zone 'America/Costa_Rica')::date;
  v_a    jsonb;
  v_x    jsonb;
  v_out  jsonb;
  v_id   uuid;
  v_nom  text;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_visita is null then raise exception 'Falta la visita' using errcode = 'P0001'; end if;
  v_loc := public.club_local(p_location, true);
  select * into v_v from public.club_visitas_socio where id = p_visita;
  if not found then raise exception 'No se encontró la visita: escaneá de nuevo' using errcode = 'P0001'; end if;
  if v_v.location_id <> v_loc then raise exception 'Esa visita es de otro local' using errcode = 'P0001'; end if;
  -- el MISMO candado por socio que club_socio_visita: una visita y una entrega a la vez por socio
  perform pg_advisory_xact_lock(hashtextextended('club_socio_visita:' || v_v.miembro_id::text, 0));
  select * into v_v from public.club_visitas_socio where id = p_visita;   -- lo último (la 168 pudo escribir aplicar)
  v_a := v_v.aplicar;
  if v_a ? 'reto' or v_v.fecha <> v_hoy then
    return v_a;   -- ya resuelto en esta visita (reescaneo / reintento) o una visita vieja: nada nuevo
  end if;

  perform public.club_retos_evaluar(v_v.id);   -- red por si el trigger avisó un error

  -- el premio disponible más próximo a vencer; los vencidos se marcan
  loop
    select * into v_g from public.club_retos_ganados g
     where g.miembro_id = v_v.miembro_id and g.estado = 'disponible'
     order by g.vence_en, g.ganada_en limit 1 for update;
    exit when v_g.id is null or v_g.vence_en > now();
    update public.club_retos_ganados set estado = 'vencida' where id = v_g.id and estado = 'disponible';
    perform public.club_auditar('reto_vencido', 'club_retos_ganados', v_g.id, to_jsonb(v_g),
                                (select to_jsonb(g) from public.club_retos_ganados g where g.id = v_g.id));
    v_g := null;
  end loop;
  if v_g.id is null then return v_a; end if;
  select * into v_r from public.club_retos where id = v_g.reto_id;
  v_nom := v_r.nombre;

  if v_v.estado_beneficio not in ('aplica','pendiente_configuracion') then
    -- regla fija (como la 168): pagada con créditos / como invitado / sin promoción → no va en esta factura
    v_out := v_a || jsonb_build_object('reto', jsonb_build_object('estado', 'guardada', 'nombre', v_nom),
      'avisos', coalesce(v_a->'avisos', '[]'::jsonb)
                || to_jsonb(format('Tiene el premio del reto «%s» guardado: NO va en esta factura. Queda para su próxima visita.', v_nom)));
    update public.club_visitas_socio set aplicar = v_out where id = v_v.id;
    return v_out;
  end if;

  select * into v_k from public.club_cortesias k
   where k.id = case when (v_r.cortesias->>v_v.location_id) ~ '^[0-9a-f-]{36}$' then (v_r.cortesias->>v_v.location_id)::uuid end
     and k.location_id = v_v.location_id and k.activa;
  if v_k.id is null then
    -- el salón tiene que poder cumplirla: sin artículo cargado y activo en ESTE local, no se ofrece
    v_out := v_a || jsonb_build_object('reto', jsonb_build_object('estado', 'sin_configurar', 'nombre', v_nom),
      'avisos', coalesce(v_a->'avisos', '[]'::jsonb)
                || to_jsonb(format('Este socio ganó el premio del reto «%s», pero en este local no está configurado (o el artículo está inactivo): NO lo ofrezcas. Queda guardado; avisale al owner.', v_nom)));
    update public.club_visitas_socio set aplicar = v_out where id = v_v.id;
    return v_out;
  end if;

  update public.club_retos_ganados g
     set estado = 'usada', usada_en = now(), visita_id = v_v.id, location_id = v_v.location_id,
         cortesia = jsonb_build_object('id', v_k.id, 'codigo', v_k.codigo_producto, 'nombre', v_k.nombre)
   where g.id = v_g.id and g.estado = 'disponible'
  returning g.id into v_id;
  if v_id is null then return v_a; end if;   -- otra caja lo usó primero

  v_x := jsonb_build_object('id', v_k.id, 'codigo', v_k.codigo_producto, 'nombre', v_k.nombre, 'motivo', 'reto');
  v_out := v_a || jsonb_build_object(
    'estado', 'aplica',
    'cortesias', coalesce(v_v.cortesias, '[]'::jsonb) || v_x,
    'texto', concat_ws(' + ', nullif(nullif(v_a->>'texto', ''), 'Sin beneficio'), '1 cortesía de premio del reto: ' || v_k.nombre),
    'avisos', coalesce(v_a->'avisos', '[]'::jsonb)
              || to_jsonb(format('Premio del reto «%s» (cumplió %s visitas): marcá el artículo %s de «CORTESÍA CLUB». Va una sola vez.',
                                 v_nom, v_r.meta, v_k.codigo_producto)),
    'reto', jsonb_build_object('estado', 'ofrecida', 'nombre', v_nom, 'cortesia', v_k.nombre, 'codigo', v_k.codigo_producto));
  update public.club_visitas_socio
     set cortesias = v_out->'cortesias', estado_beneficio = 'aplica', aplicar = v_out
   where id = v_v.id;
  perform public.club_auditar('reto_usado', 'club_retos_ganados', v_g.id, to_jsonb(v_g),
                              (select to_jsonb(g) from public.club_retos_ganados g where g.id = v_g.id));
  insert into public.club_pase_eventos (miembro_id, motivo) values (v_v.miembro_id, 'cortesia');
  return v_out;
end;
$$;

-- 8. Lo que ve el socio (interna): retos en curso o por empezar, con su avance, y premios sin usar.
create or replace function public.club_retos_del_socio(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Costa_Rica')::date;
  v_out jsonb := '[]'::jsonb;
  v_r   public.club_retos%rowtype;
  v_g   public.club_retos_ganados%rowtype;
begin
  for v_r in
    select r.* from public.club_retos r
     where r.armado_en is not null
       and (exists (select 1 from public.club_retos_ganados g where g.reto_id = r.id and g.miembro_id = p_miembro)
            or (r.estado = 'vigente' and r.hasta >= v_hoy))
     order by r.desde
  loop
    select * into v_g from public.club_retos_ganados g where g.reto_id = v_r.id and g.miembro_id = p_miembro;
    if v_g.id is not null then
      continue when v_g.estado <> 'disponible' or v_g.vence_en <= now();   -- usado o vencido: ya no se muestra
    elsif not public.club_reto_participa(v_r, p_miembro) then
      continue;
    end if;
    v_out := v_out || jsonb_build_object(
      'nombre', v_r.nombre, 'nombre_en', v_r.nombre_en, 'desde', v_r.desde, 'hasta', v_r.hasta, 'dias', to_jsonb(v_r.dias),
      'hora_desde', to_char(v_r.hora_desde, 'HH24:MI'), 'hora_hasta', to_char(v_r.hora_hasta, 'HH24:MI'),
      'meta', v_r.meta,
      'avance', case when v_g.id is not null then v_r.meta else least(public.club_reto_avance(v_r, p_miembro), v_r.meta) end,
      'ganada', v_g.id is not null,
      'vence_en', case when v_g.id is not null then (v_g.vence_en at time zone 'America/Costa_Rica')::date end,
      'locales', (select coalesce(jsonb_agg(coalesce(c.nombre, c.location_id) order by c.location_id), '[]'::jsonb)
                    from public.club_config c where c.location_id = any(v_r.locales)));
  end loop;
  return v_out;
end;
$$;

-- «Mi Club» (PÚBLICA, solo por club-web, mismo portón y token que club_portal)
create or replace function public.club_portal_retos(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok text := lower(btrim(coalesce(p_token, '')));
  v_id  uuid;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  return jsonb_build_object('retos', public.club_retos_del_socio(v_id));
end;
$$;

-- 9. Gerencia: lista (owner y manager)
create or replace function public.club_retos_listar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_hoy date := (now() at time zone 'America/Costa_Rica')::date;
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'nombre', r.nombre, 'nombre_en', r.nombre_en, 'locales', to_jsonb(r.locales), 'estado', r.estado,
             'desde', r.desde, 'hasta', r.hasta, 'dias', to_jsonb(r.dias),
             'hora_desde', to_char(r.hora_desde, 'HH24:MI'), 'hora_hasta', to_char(r.hora_hasta, 'HH24:MI'),
             'meta', r.meta, 'vence_dias', r.vence_dias, 'control_pct', r.control_pct, 'armado', r.armado_en is not null,
             'en_curso', r.estado = 'vigente' and v_hoy between r.desde and r.hasta,
             'cortesias', (select coalesce(jsonb_object_agg(e.key, jsonb_build_object('id', k.id, 'codigo', k.codigo_producto,
                                                                                     'nombre', k.nombre, 'activa', k.activa)), '{}'::jsonb)
                             from jsonb_each_text(r.cortesias) e
                             join public.club_cortesias k on k.id::text = e.value and k.location_id = e.key),
             'ganados', (select count(*) from public.club_retos_ganados g where g.reto_id = r.id),
             'usados', (select count(*) from public.club_retos_ganados g where g.reto_id = r.id and g.estado = 'usada'),
             'disponibles', (select count(*) from public.club_retos_ganados g where g.reto_id = r.id and g.estado = 'disponible' and g.vence_en > now()))
           order by r.desde desc, r.creada_en desc)
      from public.club_retos r), '[]'::jsonb);
end;
$$;

-- Valida el mapa de cortesías {location_id: cortesia_id} contra los locales del reto (interna).
create or replace function public.club_reto_cortesias_validar(p_locales text[], p_cort jsonb, p_todas boolean)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e   record;
  v_k public.club_cortesias%rowtype;
  v_l text;
begin
  for e in select * from jsonb_each_text(coalesce(p_cort, '{}'::jsonb)) loop
    if not (e.key = any(p_locales)) then
      raise exception 'Hay una cortesía de un local que no está en el reto' using errcode = 'P0001';
    end if;
    select * into v_k from public.club_cortesias k
     where k.id::text = e.value and k.location_id = e.key;
    if not found then raise exception 'Esa cortesía no es de ese local: recargá la lista' using errcode = 'P0001'; end if;
    if not v_k.activa then
      raise exception 'La cortesía «%» está inactiva: activala primero (el salón tiene que poder darla)', v_k.nombre using errcode = 'P0001';
    end if;
  end loop;
  if p_todas then
    foreach v_l in array p_locales loop
      if coalesce(p_cort->>v_l, '') = '' then
        raise exception 'Para armarlo, elegí la cortesía de premio de cada local del reto' using errcode = 'P0001';
      end if;
    end loop;
  end if;
end;
$$;

-- Guardar un borrador (solo owner). p_id null = nuevo. Devuelve el id.
create or replace function public.club_reto_guardar(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_ant  public.club_retos%rowtype;
  v_id   uuid;
  v_loc  text[];
  v_cort jsonb := coalesce(p_datos->'cortesias', '{}'::jsonb);
  v_hoy  date := (now() at time zone 'America/Costa_Rica')::date;
  v_dias int[];
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'Faltan los datos del reto' using errcode = 'P0001'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_loc from jsonb_array_elements_text(coalesce(p_datos->'locales', '[]'::jsonb)) x;
  if cardinality(v_loc) = 0 then raise exception 'Elegí al menos un local' using errcode = 'P0001'; end if;
  select coalesce(array_agg(distinct x::int order by x::int), '{}') into v_dias from jsonb_array_elements_text(coalesce(p_datos->'dias', '[1,2,3,4,5,6,7]'::jsonb)) x;
  if nullif(p_datos->>'desde', '')::date < v_hoy then
    raise exception 'El reto no puede empezar en el pasado (hoy es %)', v_hoy using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_cort) <> 'object' then raise exception 'Cortesías no válidas' using errcode = 'P0001'; end if;
  v_cort := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(v_cort) e where e.value <> 'null'::jsonb and e.value <> '""'::jsonb);
  perform public.club_reto_cortesias_validar(v_loc, v_cort, false);

  if p_id is null then
    insert into public.club_retos (nombre, nombre_en, locales, desde, hasta, dias, hora_desde, hora_hasta, meta, cortesias,
                                   vence_dias, control_pct, creada_por, actualizada_por)
    values (btrim(p_datos->>'nombre'), btrim(p_datos->>'nombre_en'), v_loc,
            nullif(p_datos->>'desde', '')::date, nullif(p_datos->>'hasta', '')::date, v_dias,
            nullif(p_datos->>'hora_desde', '')::time, nullif(p_datos->>'hora_hasta', '')::time,
            (p_datos->>'meta')::int, v_cort, coalesce((p_datos->>'vence_dias')::int, 30), coalesce((p_datos->>'control_pct')::int, 0),
            auth.uid(), auth.uid())
    returning id into v_id;
    perform public.club_auditar('reto_alta', 'club_retos', v_id, null, (select to_jsonb(r) from public.club_retos r where r.id = v_id));
  else
    select * into v_ant from public.club_retos where id = p_id for update;
    if not found then raise exception 'No se encontró el reto: recargá la lista' using errcode = 'P0001'; end if;
    if v_ant.armado_en is not null or v_ant.estado <> 'borrador' then
      raise exception 'Un reto armado no se edita: solo se puede terminar' using errcode = 'P0001';
    end if;
    update public.club_retos set
      nombre = btrim(p_datos->>'nombre'), nombre_en = btrim(p_datos->>'nombre_en'), locales = v_loc,
      desde = nullif(p_datos->>'desde', '')::date, hasta = nullif(p_datos->>'hasta', '')::date, dias = v_dias,
      hora_desde = nullif(p_datos->>'hora_desde', '')::time, hora_hasta = nullif(p_datos->>'hora_hasta', '')::time,
      meta = (p_datos->>'meta')::int, cortesias = v_cort, vence_dias = coalesce((p_datos->>'vence_dias')::int, 30),
      control_pct = coalesce((p_datos->>'control_pct')::int, 0), actualizada_por = auth.uid(), actualizada_en = now()
     where id = p_id;
    v_id := p_id;
    perform public.club_auditar('reto_edicion', 'club_retos', v_id, to_jsonb(v_ant), (select to_jsonb(r) from public.club_retos r where r.id = v_id));
  end if;
  return v_id;
exception
  when check_violation or not_null_violation or invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
    raise exception 'Revisá los datos del reto: nombre y nombre en inglés (2 a 80 letras), fechas dentro de un mismo año y hasta 92 días, meta de 2 a 10 visitas, premio de 7 a 90 días y una franja con dos horas distintas'
      using errcode = 'P0001';
end;
$$;

-- Armar (solo owner): borrador → vigente. La base aplica el tope por año y la superposición (trigger).
create or replace function public.club_reto_armar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_ant public.club_retos%rowtype;
  v_hoy date := (now() at time zone 'America/Costa_Rica')::date;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v_ant from public.club_retos where id = p_id for update;
  if not found then raise exception 'No se encontró el reto: recargá la lista' using errcode = 'P0001'; end if;
  if v_ant.estado <> 'borrador' then raise exception 'Ese reto ya está armado o terminado' using errcode = 'P0001'; end if;
  if v_ant.desde < v_hoy then
    raise exception 'El reto empieza en el pasado: cambiá las fechas (hoy es %)', v_hoy using errcode = 'P0001';
  end if;
  perform public.club_reto_cortesias_validar(v_ant.locales, v_ant.cortesias, true);
  update public.club_retos set estado = 'vigente', armado_por = auth.uid(), armado_en = now(),
                               actualizada_por = auth.uid(), actualizada_en = now()
   where id = p_id;
  perform public.club_auditar('reto_armado', 'club_retos', p_id, to_jsonb(v_ant), (select to_jsonb(r) from public.club_retos r where r.id = p_id));
  return public.club_retos_listar();
end;
$$;

-- Terminar (solo owner): vigente o borrador → terminada. Los premios ya ganados se respetan.
create or replace function public.club_reto_terminar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_ant public.club_retos%rowtype;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v_ant from public.club_retos where id = p_id for update;
  if not found then raise exception 'No se encontró el reto: recargá la lista' using errcode = 'P0001'; end if;
  if v_ant.estado = 'terminada' then raise exception 'Ese reto ya está terminado' using errcode = 'P0001'; end if;
  update public.club_retos set estado = 'terminada', terminada_por = auth.uid(), terminada_en = now(),
                               actualizada_por = auth.uid(), actualizada_en = now()
   where id = p_id;
  perform public.club_auditar('reto_terminado', 'club_retos', p_id, to_jsonb(v_ant), (select to_jsonb(r) from public.club_retos r where r.id = p_id));
  return public.club_retos_listar();
end;
$$;

-- Borrar un borrador (solo owner). Un armado no se borra (trigger).
create or replace function public.club_reto_borrar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_ant public.club_retos%rowtype;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v_ant from public.club_retos where id = p_id for update;
  if not found then raise exception 'No se encontró el reto: recargá la lista' using errcode = 'P0001'; end if;
  delete from public.club_retos where id = p_id;
  perform public.club_auditar('reto_borrado', 'club_retos', p_id, to_jsonb(v_ant), null);
  return public.club_retos_listar();
end;
$$;

revoke all on function public.club_retos_reglas()                              from public, anon, authenticated;
revoke all on function public.club_reto_control(uuid, int, uuid)               from public, anon, authenticated;
revoke all on function public.club_reto_participa(public.club_retos, uuid)     from public, anon, authenticated;
revoke all on function public.club_reto_en_franja(public.club_retos, timestamptz) from public, anon, authenticated;
revoke all on function public.club_reto_avance(public.club_retos, uuid)        from public, anon, authenticated;
revoke all on function public.club_retos_evaluar(uuid)                         from public, anon, authenticated;
revoke all on function public.club_retos_visita_trg()                          from public, anon, authenticated;
revoke all on function public.club_reto_en_visita(uuid, text)                  from public, anon, authenticated;
revoke all on function public.club_retos_del_socio(uuid)                       from public, anon, authenticated;
revoke all on function public.club_portal_retos(text)                          from public, anon, authenticated;
revoke all on function public.club_retos_listar()                              from public, anon, authenticated;
revoke all on function public.club_reto_cortesias_validar(text[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.club_reto_guardar(uuid, jsonb)                   from public, anon, authenticated;
revoke all on function public.club_reto_armar(uuid)                            from public, anon, authenticated;
revoke all on function public.club_reto_terminar(uuid)                         from public, anon, authenticated;
revoke all on function public.club_reto_borrar(uuid)                           from public, anon, authenticated;
grant execute on function public.club_reto_en_visita(uuid, text)  to authenticated;   -- rol chequeado adentro
grant execute on function public.club_portal_retos(text)          to anon, authenticated;   -- portón de club-web adentro
grant execute on function public.club_retos_listar()              to authenticated;
grant execute on function public.club_reto_guardar(uuid, jsonb)   to authenticated;
grant execute on function public.club_reto_armar(uuid)            to authenticated;
grant execute on function public.club_reto_terminar(uuid)         to authenticated;
grant execute on function public.club_reto_borrar(uuid)           to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if exists (select 1 from public.club_retos where armado_en is not null) then
    raise exception '169: no puede quedar ningún reto armado (lo arma el owner)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'club_retos_visita_trg' and tgrelid = 'public.club_visitas_socio'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'club_retos_reglas_trg' and tgrelid = 'public.club_retos'::regclass) then
    raise exception '169: faltan los triggers';
  end if;
  if not (select bool_and(prosecdef) from pg_proc where oid in (
            'public.club_reto_en_visita(uuid,text)'::regprocedure, 'public.club_portal_retos(text)'::regprocedure,
            'public.club_retos_evaluar(uuid)'::regprocedure, 'public.club_retos_listar()'::regprocedure,
            'public.club_reto_guardar(uuid,jsonb)'::regprocedure, 'public.club_reto_armar(uuid)'::regprocedure,
            'public.club_retos_reglas()'::regprocedure, 'public.club_retos_visita_trg()'::regprocedure)) then
    raise exception '169: las funciones tienen que ser SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.club_reto_en_visita(uuid,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_portal_retos(text)', 'EXECUTE') then
    raise exception '169: la caja y club-web tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('authenticated', 'public.club_retos_evaluar(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_retos_del_socio(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_reto_en_visita(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_reto_avance(public.club_retos,uuid)', 'EXECUTE') then
    raise exception '169: las internas no se abren';
  end if;
  if has_table_privilege('anon', 'public.club_retos', 'SELECT') or has_table_privilege('authenticated', 'public.club_retos', 'INSERT')
     or has_table_privilege('anon', 'public.club_retos_ganados', 'SELECT') then
    raise exception '169: las tablas no se abren';
  end if;
end
$$;

commit;
