-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 168 (origen 114) — Primeros 90 días: «Visita 2 de 4» y cortesía especial (ítem #15 del Club v2). ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ TOCA PLATA (una cortesía) y el esquema: no se mergea sin la firma del dueño. Creada como 114 (bloque CLUB); prod va
-- por la 155, así que va como 168 del bloque de PASE (regla 3), con origen 114.
-- APAGADO POR DEFECTO: club_config_global.primeros90_activo = false. Hasta que el owner lo encienda (y cargue la
-- cortesía del local) nadie gana nada: no hay plata en juego sin su decisión.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · Config GLOBAL (club_config_global, solo owner; cada cambio queda en club_auditoria por el trigger de la 150):
--       primeros90_activo (false) · primeros90_visitas (4) · primeros90_dias (90) · primeros90_vence_dias (60).
--   · Config POR LOCAL (club_config, solo owner; cada cambio queda en club_config_historial por el trigger de la 150):
--       primeros90_cortesia_id = el artículo de «CORTESÍA CLUB» (club_cortesias) que da ESE local. Sin cargar, o con el
--       artículo inactivo, la caja NO la ofrece y avisa (la cortesía ganada queda guardada).
--   · club_miembros.sin_avance (false): gancho del grupo de control (#185). Con true, el socio no ve el avance ni gana
--     la cortesía (el beneficio base no cambia). Por ahora nadie lo setea.
--   · club_primeros90 (NUEVA): UNA fila por socio (unique), cuando gana: disponible → usada (una vez) o vencida.
--   · Conteo: socio ACTIVO del Local Club (el EQUIPO nunca, D7; con y sin la 157). El día del alta (hora CR) es la
--     1.ª visita («ventaja inicial»); después cuenta cada DÍA CR distinto con visita registrada (club_visitas_socio,
--     en cualquier local; varias visitas el mismo día cuentan una), dentro de los primeros N días desde el alta.
--   · club_socio_visita: la de antes (150) pasa a llamarse club_socio_visita_base (interna) y club_socio_visita la
--     envuelve. Después de registrar una visita NUEVA: si con ella llega a la 4.ª dentro de los 90 días, gana; y si
--     tiene una ganada disponible, la caja la recibe como una cortesía más (motivo 'primeros_90') en la MISMA lista de
--     cortesías de la visita (club_visitas_socio.cortesias y `aplicar`, como el premio por referir), con texto y aviso.
--     Regla fija: una factura pagada con créditos, un socio que va como invitado o sin promoción vigente → no va en
--     esa factura; queda guardada para la próxima. Una sola vez: el paso disponible → usada es un UPDATE condicionado
--     (where estado = 'disponible') bajo el candado por socio de club_socio_visita: dos cajas a la vez, una sola gana.
--   · club_pase_datos: la de antes (150 o 157) pasa a club_pase_datos_base y club_pase_datos suma `socio.avance`.
--   · club_portal_avance(token) (NUEVA, PÚBLICA como club_portal, solo por club-web): {avance} para «Mi Club».
--   · club_primeros90_config_ver / _guardar (owner y manager leen; solo el owner guarda).
--
-- ── DÓNDE QUEDA LA CORTESÍA (auditoría) ────────────────────────────────────────────────────────
-- Como las demás cortesías (promo y premio por referir): en club_visitas_socio.cortesias / aplicar de la visita, más la
-- fila de club_primeros90 y dos renglones en club_auditoria (ganada y usada). NO va a club_movimientos: esa tabla es el
-- libro de CRÉDITOS de los anfitriones (tipos tarjeta/canje/…, solo inserción) y ninguna cortesía vive ahí.
--
-- ── ORDEN CON LA 157 Y LA 167 ──────────────────────────────────────────────────────────────────
-- No toca club_portal (la 157 la redefine y la 167 la envuelve): «Mi Club» lee el avance con club_portal_avance.
-- La 157 redefine club_pase_datos con `create or replace`: tiene que estar aplicada ANTES que esta (157 < 168, orden
-- natural). Si la 157 entrara después, tiene que redefinir club_pase_datos_base (no club_pase_datos). El caso 0 de
-- 168_pruebas.sql y la verificación de abajo miran el envoltorio.
--
-- Pruebas: scripts/sql/168_pruebas.sql (+ 168_pruebas.py; transacción descartada) y 168_concurrencia.sh (base local).
-- Rollback: scripts/sql/168_rollback.sql (aborta si ya hay cortesías ganadas).

begin;

-- 1. Configuración global (solo owner; club_config_global_auditar_trg de la 150 audita cada cambio)
alter table public.club_config_global add column if not exists primeros90_activo boolean not null default false;
alter table public.club_config_global add column if not exists primeros90_visitas int not null default 4;
alter table public.club_config_global add column if not exists primeros90_dias int not null default 90;
alter table public.club_config_global add column if not exists primeros90_vence_dias int not null default 60;
alter table public.club_config_global drop constraint if exists club_config_global_primeros90_chk;
alter table public.club_config_global add constraint club_config_global_primeros90_chk
  check (primeros90_visitas between 2 and 10 and primeros90_dias between 30 and 180 and primeros90_vence_dias between 7 and 365);
comment on column public.club_config_global.primeros90_activo is
  '168: programa «primeros 90 días» encendido (false por defecto: nadie gana la cortesía hasta que el owner lo enciende).';
comment on column public.club_config_global.primeros90_visitas is '168: visitas para ganar la cortesía (el alta cuenta como la 1.ª).';
comment on column public.club_config_global.primeros90_dias is '168: ventana desde el alta (días CR).';
comment on column public.club_config_global.primeros90_vence_dias is '168: días que la cortesía ganada queda guardada.';
grant update (primeros90_activo, primeros90_visitas, primeros90_dias, primeros90_vence_dias)
  on public.club_config_global to authenticated;   -- solo owner (policy club_config_global_owner)

-- 2. La cortesía de cada local (club_config_auditar de la 150 deja el historial)
alter table public.club_config add column if not exists primeros90_cortesia_id uuid references public.club_cortesias(id);
comment on column public.club_config.primeros90_cortesia_id is
  '168: artículo de «CORTESÍA CLUB» que da este local como cortesía especial de los primeros 90 días. Null = no la ofrece.';

-- 3. Gancho del grupo de control (#185): con true, sin avance ni cortesía especial. Nadie lo setea todavía.
alter table public.club_miembros add column if not exists sin_avance boolean not null default false;
comment on column public.club_miembros.sin_avance is
  '168: grupo de control de «primeros 90 días» (gancho para #185). true = no ve el avance ni gana la cortesía especial.';

-- 4. Cortesías ganadas: UNA por socio
create table if not exists public.club_primeros90 (
  id              uuid primary key default gen_random_uuid(),
  miembro_id      uuid not null unique references public.club_miembros(id),
  estado          text not null default 'disponible' check (estado in ('disponible','usada','vencida')),
  ganada_en       timestamptz not null default now(),
  visita_ganadora uuid not null references public.club_visitas_socio(id),
  vence_en        timestamptz not null,
  usada_en        timestamptz,
  visita_id       uuid unique references public.club_visitas_socio(id),
  location_id     text,
  cortesia        jsonb,
  check ((estado = 'usada') = (usada_en is not null and visita_id is not null and cortesia is not null and location_id is not null))
);
comment on table public.club_primeros90 is
  '168: cortesía especial de los primeros 90 días (una por socio). disponible → usada (una vez) o vencida.';
alter table public.club_primeros90 enable row level security;
revoke all on public.club_primeros90 from public, anon, authenticated;
grant select on public.club_primeros90 to authenticated;
drop policy if exists club_primeros90_ver on public.club_primeros90;
create policy club_primeros90_ver on public.club_primeros90 for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- 5. ¿Participa? Devuelve el día CR del alta, o null (no activo, pendiente, equipo, grupo de control). Interna.
create or replace function public.club_primeros90_alta(p_miembro uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (r.desde at time zone 'America/Costa_Rica')::date
    from public.club_miembros m
    join public.club_miembro_roles r on r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo'
   where m.id = p_miembro and m.estado = 'activo' and not m.sin_avance
     and m.tipo <> 'equipo'   -- D7: el equipo no es cliente (con y sin la 157)
     and not exists (select 1 from public.club_miembro_roles e where e.miembro_id = m.id and e.rol = 'equipo' and e.estado = 'activo')
$$;

-- Visitas que cuentan: el alta (1) + cada día CR distinto con visita, después del alta y dentro de la ventana. Interna.
create or replace function public.club_primeros90_visitas(p_miembro uuid, p_alta date, p_dias int)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 1 + count(distinct vs.fecha)::int
    from public.club_visitas_socio vs
   where vs.miembro_id = p_miembro and vs.fecha > p_alta and vs.fecha < p_alta + p_dias
$$;

-- 6. El avance para «Mi Club» y el pase. Interna. null = no se muestra nada.
--    {visita, de, hasta, ganada:false} mientras corre la ventana · {visita=de, de, ganada:true, vence_en} con la
--    cortesía disponible. Apagado: solo la ganada disponible (lo ganado se respeta); sin avance nuevo.
create or replace function public.club_primeros90_avance(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_g    public.club_config_global%rowtype;
  v_p    public.club_primeros90%rowtype;
  v_alta date;
  v_hoy  date := (now() at time zone 'America/Costa_Rica')::date;
  v_n    int;
begin
  v_alta := public.club_primeros90_alta(p_miembro);
  if v_alta is null then return null; end if;
  select * into v_g from public.club_config_global limit 1;
  select * into v_p from public.club_primeros90 p where p.miembro_id = p_miembro;
  if v_p.id is not null then
    if v_p.estado = 'disponible' and v_p.vence_en > now() then
      return jsonb_build_object('visita', v_g.primeros90_visitas, 'de', v_g.primeros90_visitas, 'ganada', true,
                                'vence_en', (v_p.vence_en at time zone 'America/Costa_Rica')::date);
    end if;
    return null;   -- ya la usó (o venció): el avance termina
  end if;
  if not coalesce(v_g.primeros90_activo, false) or v_hoy - v_alta >= v_g.primeros90_dias then return null; end if;
  v_n := least(public.club_primeros90_visitas(p_miembro, v_alta, v_g.primeros90_dias), v_g.primeros90_visitas);
  return jsonb_build_object('visita', v_n, 'de', v_g.primeros90_visitas, 'ganada', false,
                            'hasta', v_alta + v_g.primeros90_dias - 1);
end;
$$;

-- 7. Después de una visita NUEVA: ganar y ofrecer. Interna (la llama el envoltorio de club_socio_visita).
create or replace function public.club_primeros90_en_visita(p_visita uuid, r jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_v    public.club_visitas_socio%rowtype;
  v_g    public.club_config_global%rowtype;
  v_cfg  public.club_config%rowtype;
  v_k    public.club_cortesias%rowtype;
  v_p    public.club_primeros90%rowtype;
  v_alta date;
  v_x    jsonb;
  v_id   uuid;
  v_est  text;
  v_out  jsonb := null;
begin
  select * into v_v from public.club_visitas_socio where id = p_visita;
  if not found then return r; end if;
  v_alta := public.club_primeros90_alta(v_v.miembro_id);
  if v_alta is null then return r; end if;   -- equipo, grupo de control, pendiente o baja: nada
  select * into v_g from public.club_config_global limit 1;

  -- a) ganar (una sola vez por socio: unique miembro_id)
  if coalesce(v_g.primeros90_activo, false)
     and v_v.fecha - v_alta < v_g.primeros90_dias
     and not exists (select 1 from public.club_primeros90 p where p.miembro_id = v_v.miembro_id)
     and public.club_primeros90_visitas(v_v.miembro_id, v_alta, v_g.primeros90_dias) >= v_g.primeros90_visitas then
    insert into public.club_primeros90 (miembro_id, visita_ganadora, vence_en)
    values (v_v.miembro_id, v_v.id, now() + make_interval(days => v_g.primeros90_vence_dias))
    on conflict (miembro_id) do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.club_auditar('primeros90_ganada', 'club_primeros90', v_id, null,
                                  (select to_jsonb(p) from public.club_primeros90 p where p.id = v_id));
      insert into public.club_pase_eventos (miembro_id, motivo) values (v_v.miembro_id, 'cortesia');
    end if;
  end if;

  -- b) ofrecer la disponible (lo ganado se respeta aunque después se apague el programa)
  select * into v_p from public.club_primeros90 p where p.miembro_id = v_v.miembro_id and p.estado = 'disponible' for update;
  if v_p.id is null then return r; end if;
  if v_p.vence_en <= now() then
    update public.club_primeros90 set estado = 'vencida' where id = v_p.id and estado = 'disponible';
    perform public.club_auditar('primeros90_vencida', 'club_primeros90', v_p.id, to_jsonb(v_p),
                                (select to_jsonb(p) from public.club_primeros90 p where p.id = v_p.id));
    return r;
  end if;

  v_est := r->>'estado';
  if v_est not in ('aplica','pendiente_configuracion') then
    -- regla fija: pagada con créditos / como invitado / sin promoción → no va en esta factura
    v_out := r || jsonb_build_object('primeros90', jsonb_build_object('estado', 'guardada'),
      'avisos', coalesce(r->'avisos', '[]'::jsonb) || to_jsonb('Tiene la cortesía especial de bienvenida guardada: NO va en esta factura. Queda para su próxima visita.'::text));
    update public.club_visitas_socio set aplicar = v_out where id = v_v.id;   -- el reescaneo muestra lo mismo
    return v_out;
  end if;

  select * into v_cfg from public.club_config where location_id = v_v.location_id;
  select * into v_k from public.club_cortesias k
   where k.id = v_cfg.primeros90_cortesia_id and k.location_id = v_v.location_id and k.activa;
  if v_k.id is null then
    -- el salón tiene que poder cumplirla: sin artículo cargado y activo en ESTE local, no se ofrece
    v_out := r || jsonb_build_object('primeros90', jsonb_build_object('estado', 'sin_configurar'),
      'avisos', coalesce(r->'avisos', '[]'::jsonb) || to_jsonb('Este socio ganó la cortesía especial de bienvenida, pero en este local no está configurada (o el artículo está inactivo): NO la ofrezcas. Queda guardada; avisale al owner.'::text));
    update public.club_visitas_socio set aplicar = v_out where id = v_v.id;
    return v_out;
  end if;

  update public.club_primeros90 p
     set estado = 'usada', usada_en = now(), visita_id = v_v.id, location_id = v_v.location_id,
         cortesia = jsonb_build_object('id', v_k.id, 'codigo', v_k.codigo_producto, 'nombre', v_k.nombre)
   where p.id = v_p.id and p.estado = 'disponible'
  returning p.id into v_id;
  if v_id is null then return r; end if;   -- otra caja la usó primero

  v_x := jsonb_build_object('id', v_k.id, 'codigo', v_k.codigo_producto, 'nombre', v_k.nombre, 'motivo', 'primeros_90');
  v_out := r || jsonb_build_object(
    'estado', 'aplica',
    'cortesias', coalesce(r->'cortesias', '[]'::jsonb) || v_x,
    'texto', concat_ws(' + ', nullif(nullif(r->>'texto', ''), 'Sin beneficio'),
                       '1 cortesía especial de bienvenida: ' || v_k.nombre),
    'avisos', coalesce(r->'avisos', '[]'::jsonb)
              || to_jsonb(format('Cortesía especial de bienvenida (%s.ª visita en sus primeros %s días): marcá el artículo %s de «CORTESÍA CLUB». Va una sola vez.',
                                 v_g.primeros90_visitas, v_g.primeros90_dias, v_k.codigo_producto)),
    'primeros90', jsonb_build_object('estado', 'ofrecida', 'nombre', v_k.nombre, 'codigo', v_k.codigo_producto));
  -- como el premio por referir: una visita 'pendiente_configuracion' (sin cortesía de la promo) pasa a 'aplica'
  update public.club_visitas_socio
     set cortesias = v_out->'cortesias', estado_beneficio = 'aplica', aplicar = v_out
   where id = v_v.id;
  perform public.club_auditar('primeros90_usada', 'club_primeros90', v_p.id, to_jsonb(v_p),
                              (select to_jsonb(p) from public.club_primeros90 p where p.id = v_p.id));
  insert into public.club_pase_eventos (miembro_id, motivo) values (v_v.miembro_id, 'cortesia');
  return v_out;
end;
$$;

-- 8. club_socio_visita: la de antes pasa a club_socio_visita_base (interna) y club_socio_visita la envuelve
do $$
begin
  if to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is null then
    alter function public.club_socio_visita(uuid, jsonb, uuid, text) rename to club_socio_visita_base;
  end if;
end
$$;
revoke all on function public.club_socio_visita_base(uuid, jsonb, uuid, text) from public, anon, authenticated;
comment on function public.club_socio_visita_base(uuid, jsonb, uuid, text) is
  '168: la visita del socio de antes (150), sin la cortesía de los primeros 90 días. La llama club_socio_visita. Para '
  'cambiar la visita, se cambia ESTA (create or replace club_socio_visita_base), no club_socio_visita.';

create or replace function public.club_socio_visita(p_miembro uuid, p_pos jsonb, p_op uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
begin
  -- permisos, candado por socio (hasta el fin de la transacción), tope, sorteo y registro: igual que siempre
  r := public.club_socio_visita_base(p_miembro, p_pos, p_op, p_location);
  if coalesce((r->>'repetida')::boolean, false) or r->>'visita_id' is null then
    return r;   -- reescaneo (devuelve lo guardado, con la especial si la tuvo) o «ya usó hoy»: nada nuevo
  end if;
  return public.club_primeros90_en_visita((r->>'visita_id')::uuid, r);
end;
$$;
comment on function public.club_socio_visita(uuid, jsonb, uuid, text) is
  '168: envoltorio de club_socio_visita_base + la cortesía especial de los primeros 90 días.';
revoke all on function public.club_socio_visita(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.club_socio_visita(uuid, jsonb, uuid, text) to authenticated;

-- 9. club_pase_datos: la de antes (150 o 157) pasa a club_pase_datos_base y club_pase_datos suma socio.avance
do $$
begin
  if to_regprocedure('public.club_pase_datos_base(uuid)') is null then
    alter function public.club_pase_datos(uuid) rename to club_pase_datos_base;
  end if;
end
$$;
revoke all on function public.club_pase_datos_base(uuid) from public, anon, authenticated;
grant execute on function public.club_pase_datos_base(uuid) to service_role;
comment on function public.club_pase_datos_base(uuid) is
  '168: datos del pase de antes (150 o 157), sin el avance. Lo llama club_pase_datos. Para cambiar el pase, se cambia '
  'ESTA (create or replace club_pase_datos_base), no club_pase_datos.';

create or replace function public.club_pase_datos(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb;
begin
  d := public.club_pase_datos_base(p_miembro);
  if d is null or jsonb_typeof(d->'socio') is distinct from 'object' then return d; end if;
  return jsonb_set(d, '{socio,avance}', coalesce(public.club_primeros90_avance(p_miembro), 'null'::jsonb));
end;
$$;
comment on function public.club_pase_datos(uuid) is
  '168: envoltorio de club_pase_datos_base + socio.avance (primeros 90 días). El pase se cambia en club_pase_datos_base.';
revoke all on function public.club_pase_datos(uuid) from public, anon, authenticated;
grant execute on function public.club_pase_datos(uuid) to service_role;

-- 10. «Mi Club» (PÚBLICA, solo por club-web, mismo portón y token que club_portal)
create or replace function public.club_portal_avance(p_token text)
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
  return jsonb_build_object('avance', public.club_primeros90_avance(v_id));
end;
$$;
revoke all on function public.club_portal_avance(text) from public, anon, authenticated;
grant execute on function public.club_portal_avance(text) to anon, authenticated;

-- 11. Configuración (owner y manager ven; solo el owner guarda)
create or replace function public.club_primeros90_config_ver(p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_g   public.club_config_global%rowtype;
  v_cfg public.club_config%rowtype;
  v_k   public.club_cortesias%rowtype;
begin
  p_location := public.club_local(p_location, false);
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v_g from public.club_config_global limit 1;
  select * into v_cfg from public.club_config where location_id = p_location;
  select * into v_k from public.club_cortesias k where k.id = v_cfg.primeros90_cortesia_id and k.location_id = p_location;
  return jsonb_build_object(
    'activo', v_g.primeros90_activo, 'visitas', v_g.primeros90_visitas, 'dias', v_g.primeros90_dias,
    'vence_dias', v_g.primeros90_vence_dias,
    'cortesia', case when v_k.id is not null then jsonb_build_object('id', v_k.id, 'codigo', v_k.codigo_producto,
                                                                      'nombre', v_k.nombre, 'activa', v_k.activa) end,
    'lista_para_caja', v_k.id is not null and v_k.activa,
    'disponibles', (select count(*) from public.club_primeros90 p where p.estado = 'disponible' and p.vence_en > now()),
    'usadas', (select count(*) from public.club_primeros90 p where p.estado = 'usada'));
end;
$$;

create or replace function public.club_primeros90_config_guardar(p_activo boolean, p_cortesia uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_k   public.club_cortesias%rowtype;
  v_ant boolean;
begin
  p_location := public.club_local(p_location, false);
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_cortesia is not null then
    select * into v_k from public.club_cortesias k where k.id = p_cortesia and k.location_id = p_location;
    if not found then raise exception 'Esa cortesía no es de este local: recargá la lista' using errcode = 'P0001'; end if;
    if not v_k.activa then raise exception 'Esa cortesía está inactiva: activala primero (el salón tiene que poder darla)' using errcode = 'P0001'; end if;
  end if;
  if coalesce(p_activo, false) and p_cortesia is null then
    raise exception 'Para encenderlo, elegí la cortesía que da este local' using errcode = 'P0001';
  end if;
  update public.club_config set primeros90_cortesia_id = p_cortesia
   where location_id = p_location and primeros90_cortesia_id is distinct from p_cortesia;   -- historial por trigger
  select g.primeros90_activo into v_ant from public.club_config_global g limit 1;
  if p_activo is not null and p_activo is distinct from v_ant then
    update public.club_config_global set primeros90_activo = p_activo, actualizado_en = now();   -- auditoría por trigger
    insert into public.club_pase_eventos (miembro_id, motivo) values (null, 'config');           -- el avance cambia en todos los pases
  end if;
  return public.club_primeros90_config_ver(p_location);
end;
$$;

revoke all on function public.club_primeros90_alta(uuid)                 from public, anon, authenticated;
revoke all on function public.club_primeros90_visitas(uuid, date, int)   from public, anon, authenticated;
revoke all on function public.club_primeros90_avance(uuid)               from public, anon, authenticated;
revoke all on function public.club_primeros90_en_visita(uuid, jsonb)     from public, anon, authenticated;
revoke all on function public.club_primeros90_config_ver(text)           from public, anon, authenticated;
revoke all on function public.club_primeros90_config_guardar(boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.club_primeros90_config_ver(text)        to authenticated;
grant execute on function public.club_primeros90_config_guardar(boolean, uuid, text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if (select primeros90_activo from public.club_config_global limit 1) then
    raise exception '168: el programa tiene que quedar APAGADO (lo enciende el owner)';
  end if;
  if position('club_socio_visita_base(' in (select prosrc from pg_proc where oid = 'public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) = 0 then
    raise exception '168: club_socio_visita no envuelve a club_socio_visita_base';
  end if;
  if position('club_pase_datos_base(' in (select prosrc from pg_proc where oid = 'public.club_pase_datos(uuid)'::regprocedure)) = 0 then
    raise exception '168: club_pase_datos no envuelve a club_pase_datos_base';
  end if;
  if not (select bool_and(prosecdef) from pg_proc where oid in (
            'public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure, 'public.club_pase_datos(uuid)'::regprocedure,
            'public.club_portal_avance(text)'::regprocedure, 'public.club_primeros90_en_visita(uuid,jsonb)'::regprocedure,
            'public.club_primeros90_avance(uuid)'::regprocedure, 'public.club_primeros90_config_guardar(boolean,uuid,text)'::regprocedure)) then
    raise exception '168: las funciones tienen que ser SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_portal_avance(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.club_pase_datos(uuid)', 'EXECUTE') then
    raise exception '168: la caja, club-web y el Edge del pase tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('authenticated', 'public.club_socio_visita_base(uuid,jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_primeros90_en_visita(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_primeros90_avance(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_pase_datos(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_pase_datos_base(uuid)', 'EXECUTE') then
    raise exception '168: las internas no se abren';
  end if;
  if has_table_privilege('anon', 'public.club_primeros90', 'SELECT') then
    raise exception '168: anon no lee club_primeros90';
  end if;
end
$$;

commit;
