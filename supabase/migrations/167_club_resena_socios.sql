-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 167 (origen 113) — Reseña de Google a socios cada N visitas (ítem #14 de la spec del Club v2).   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Cambia el esquema y una función PÚBLICA del Club (club_portal): no se mergea sin el OK del dueño. Sin plata.
-- Firma del dueño: 14-nov (decisión 3 de la spec: «sí; N en config, recomendado 5; máximo una vez cada 90 días»).
-- Creada como 113 (bloque CLUB); prod va por la 155, así que va como 167 del bloque de PASE (regla 3), con origen 113.
-- Necesita la 158 (club_config.resena_url): va apilada sobre el PR #177.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · club_config_global.resena_socio_cada (int, 5) y resena_socio_espera_dias (int, 90): cada cuántas visitas con
--     beneficio se le pide la reseña al socio y la espera mínima entre dos pedidos. Solo owner (policy de la 150); cada
--     cambio queda en club_auditoria (trigger club_config_global_auditar_trg de la 150: quién, cuándo, de cuánto a cuánto).
--   · club_resena_socio (NUEVA): un renglón por pedido de reseña. Sin datos personales: socio (id interno), local, la
--     visita que lo disparó y tres horas (mostrada, cerrada, clic). Nada más.
--   · club_resena_socio_toca(miembro) (interna): ¿le toca la tarjeta? y de qué local. Reglas:
--       – solo socio ACTIVO del Local Club; el EQUIPO (tipo o rol 'equipo', D7) nunca (no es cliente). Funciona con y sin
--         la 157 (el tipo 'equipo' existe desde la 150).
--       – un pedido mostrado y sin cerrar ni clic sigue a la vista (la misma tarjeta, el mismo local) hasta que lo cierra.
--       – si no: cuenta las visitas CON beneficio ('aplica', 'pendiente_configuracion', como el tope del día) desde la
--         visita que disparó el pedido anterior (o desde siempre); con N o más y pasada la espera desde el último pedido
--         mostrado, toca. El local es el de la ÚLTIMA visita con beneficio; sin resena_url en ese local, no se muestra.
--       – a TODOS los que llegan a N: no mira satisfacción, ni consumo, ni nada del socio (política de Google).
--   · club_portal: la de antes pasa a llamarse club_portal_datos (interna, sin anon) y club_portal la envuelve y suma UNA
--     clave: `resena` = {url, local} o null. Las claves de antes no cambian (sean de la 150 o de la 157). No expone nada
--     nuevo del socio (ni cuántas visitas tiene, ni cuándo).
--   · club_portal_resena(token, accion) (NUEVA, pública como club_portal): marca 'mostrada' | 'cerrada' | 'clic' del
--     pedido que toca. Mismo portón (club_web_ok) y mismo token. Si no toca, no marca nada. Responde siempre {ok:true}
--     (no dice si el socio tiene visitas). Tope por IP en club-web (RL_LEER con clave propia, como el clic del #177).
--
-- ── POLÍTICA DE GOOGLE (se respeta en el diseño) ───────────────────────────────────────────────
-- Se le pide a todos los socios que llegan a N visitas (no se filtra por satisfacción), sin premio, y la pide la página
-- del socio, no el personal.
--
-- ── ORDEN CON LA 157 ───────────────────────────────────────────────────────────────────────────
-- La 157 (#176, D7) redefine club_portal con `create or replace`. Tiene que estar aplicada ANTES que esta (157 < 167,
-- orden natural). Si la 157 se renumerara a después de la 167, pisaría el envoltorio: en ese caso hay que cambiar la 157
-- para que redefina club_portal_datos (no club_portal). El caso 0 de 167_pruebas.sql y la verificación de abajo lo miran.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni plata, ni saldos, ni créditos, ni visitas, ni la caja. Ni club_cupon_ver ni la reseña del cupón (158).
--
-- Pruebas: scripts/sql/167_pruebas.sql (+ 167_pruebas.py; transacción descartada, sobre 155→158 y también con la 157).
-- Rollback: scripts/sql/167_rollback.sql (club_portal vuelve a ser la de antes, sin envoltorio, ni tabla, ni columnas).

begin;

-- 1. Configuración global (una sola para todo el Club, como el tope del día)
alter table public.club_config_global add column if not exists resena_socio_cada int not null default 5;
alter table public.club_config_global add column if not exists resena_socio_espera_dias int not null default 90;
alter table public.club_config_global drop constraint if exists club_config_global_resena_socio_cada_chk;
alter table public.club_config_global add constraint club_config_global_resena_socio_cada_chk
  check (resena_socio_cada between 1 and 50);
alter table public.club_config_global drop constraint if exists club_config_global_resena_socio_espera_chk;
alter table public.club_config_global add constraint club_config_global_resena_socio_espera_chk
  check (resena_socio_espera_dias between 30 and 365);
comment on column public.club_config_global.resena_socio_cada is
  '167: cada cuántas visitas con beneficio se le pide la reseña de Google al socio (recomendado 5). Solo owner.';
comment on column public.club_config_global.resena_socio_espera_dias is
  '167: días mínimos entre dos pedidos de reseña al mismo socio (90). Solo owner.';
grant update (resena_socio_cada, resena_socio_espera_dias) on public.club_config_global to authenticated;   -- solo owner (policy)

-- 2. Pedidos de reseña (sin datos personales: id interno del socio, local, visita y horas)
create table if not exists public.club_resena_socio (
  id          uuid primary key default gen_random_uuid(),
  miembro_id  uuid not null references public.club_miembros(id),
  location_id text not null,
  visita_id   uuid not null references public.club_visitas_socio(id),
  mostrada_en timestamptz not null default now(),
  cerrada_en  timestamptz,
  clic_en     timestamptz,
  constraint club_resena_socio_visita_uq unique (visita_id)
);
create index if not exists club_resena_socio_miembro_idx on public.club_resena_socio (miembro_id, mostrada_en desc);
comment on table public.club_resena_socio is
  '167: pedidos de reseña de Google al socio (cada N visitas, máx. 1 cada X días). Sin datos personales.';
alter table public.club_resena_socio enable row level security;
revoke all on public.club_resena_socio from public, anon, authenticated;
grant select on public.club_resena_socio to authenticated;
drop policy if exists club_resena_socio_ver on public.club_resena_socio;
create policy club_resena_socio_ver on public.club_resena_socio for select to authenticated
  using (public.get_my_role() is not null and public.get_my_role() in ('owner','manager'));

-- 3. ¿Le toca la tarjeta? (interna)
create or replace function public.club_resena_socio_toca(p_miembro uuid)
returns table (visita_id uuid, location_id text, url text, local_nombre text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.club_miembros%rowtype;
  v_g     public.club_config_global%rowtype;
  v_ult   public.club_resena_socio%rowtype;
  v_desde timestamptz;
  v_n     int;
  v_vis   uuid;
  v_loc   text;
begin
  select * into v_m from public.club_miembros m where m.id = p_miembro;
  if not found or v_m.estado <> 'activo' then return; end if;
  -- D7: el equipo no es cliente (tipo o rol 'equipo'; con y sin la 157)
  if v_m.tipo = 'equipo'
     or exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol = 'equipo' and r.estado = 'activo') then
    return;
  end if;
  if not exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol = 'socio' and r.estado = 'activo') then
    return;
  end if;

  select * into v_ult from public.club_resena_socio s where s.miembro_id = v_m.id order by s.mostrada_en desc, s.id limit 1;
  if found and v_ult.cerrada_en is null and v_ult.clic_en is null then
    -- pedido a la vista y sin cerrar: la misma tarjeta, del mismo local (si el local sigue con link)
    return query select v_ult.visita_id, c.location_id, c.resena_url, coalesce(c.nombre, c.location_id)
                   from public.club_config c where c.location_id = v_ult.location_id and c.resena_url is not null;
    return;
  end if;

  select * into v_g from public.club_config_global limit 1;
  if v_ult.id is not null and v_ult.mostrada_en > now() - make_interval(days => coalesce(v_g.resena_socio_espera_dias, 90)) then
    return;   -- máximo un pedido cada X días
  end if;
  if v_ult.id is not null then
    select vs.registrada_en into v_desde from public.club_visitas_socio vs where vs.id = v_ult.visita_id;
  end if;

  select count(*)::int into v_n from public.club_visitas_socio vs
   where vs.miembro_id = v_m.id and vs.estado_beneficio in ('aplica','pendiente_configuracion')
     and (v_desde is null or vs.registrada_en > v_desde);
  if v_n < coalesce(v_g.resena_socio_cada, 5) then return; end if;

  select vs.id, vs.location_id into v_vis, v_loc from public.club_visitas_socio vs
   where vs.miembro_id = v_m.id and vs.estado_beneficio in ('aplica','pendiente_configuracion')
   order by vs.registrada_en desc, vs.id limit 1;
  return query select v_vis, c.location_id, c.resena_url, coalesce(c.nombre, c.location_id)
                 from public.club_config c where c.location_id = v_loc and c.resena_url is not null;
end;
$$;
revoke all on function public.club_resena_socio_toca(uuid) from public, anon, authenticated;

-- 4. club_portal: la de antes (150 o 157) pasa a club_portal_datos (interna) y club_portal la envuelve
do $$
begin
  if to_regprocedure('public.club_portal_datos(text)') is null then
    alter function public.club_portal(text) rename to club_portal_datos;
  end if;
end
$$;
revoke all on function public.club_portal_datos(text) from public, anon, authenticated;
comment on function public.club_portal_datos(text) is
  '167: el portal del socio/anfitrión de antes (150 o 157), sin la reseña. Lo llama club_portal. Para cambiar el portal, '
  'se cambia ESTA (create or replace club_portal_datos), no club_portal.';

create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_j  jsonb;
  v_id uuid;
  v_r  record;
begin
  v_j := public.club_portal_datos(p_token);   -- portón, formato del token y socio activo: igual que siempre
  select m.id into v_id from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo';
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  -- 167: la reseña de Google del local de la última visita, cada N visitas con beneficio (a todos, sin premio)
  return v_j || jsonb_build_object('resena', case when v_r.url is not null
                                                  then jsonb_build_object('url', v_r.url, 'local', v_r.local_nombre) end);
end;
$$;
comment on function public.club_portal(text) is
  '167: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null). El portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

-- 5. Marcas de la tarjeta (PÚBLICA, como club_portal): mostrada · cerrada · clic. Sin datos personales.
create or replace function public.club_portal_resena(p_token text, p_accion text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok text := lower(btrim(coalesce(p_token, '')));
  v_acc text := lower(btrim(coalesce(p_accion, '')));
  v_id  uuid;
  v_r   record;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_tok !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  if v_acc not in ('mostrada', 'cerrada', 'clic') then
    raise exception 'Acción no válida' using errcode = 'P0001';
  end if;
  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';
  if not found then
    raise exception 'Enlace no válido' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_resena_socio:' || v_id::text, 0));
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  if v_r.visita_id is null then
    return jsonb_build_object('ok', true);   -- no toca: no se marca nada (y no se dice por qué)
  end if;
  insert into public.club_resena_socio as s (miembro_id, location_id, visita_id, cerrada_en, clic_en)
  values (v_id, v_r.location_id, v_r.visita_id,
          case when v_acc = 'cerrada' then now() end, case when v_acc = 'clic' then now() end)
  on conflict (visita_id) do update
     set cerrada_en = coalesce(s.cerrada_en, excluded.cerrada_en),
         clic_en    = coalesce(s.clic_en, excluded.clic_en);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.club_portal_resena(text, text) from public, anon, authenticated;
grant execute on function public.club_portal_resena(text, text) to anon, authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if to_regprocedure('public.club_portal_datos(text)') is null then
    raise exception '167: falta club_portal_datos (el portal de antes)';
  end if;
  if position('club_portal_datos(p_token)' in (select prosrc from pg_proc where oid = 'public.club_portal(text)'::regprocedure)) = 0 then
    raise exception '167: club_portal no envuelve a club_portal_datos';
  end if;
  if not (select bool_and(prosecdef) from pg_proc where oid in ('public.club_portal(text)'::regprocedure,
            'public.club_portal_datos(text)'::regprocedure, 'public.club_portal_resena(text,text)'::regprocedure,
            'public.club_resena_socio_toca(uuid)'::regprocedure)) then
    raise exception '167: las cuatro funciones tienen que ser SECURITY DEFINER';
  end if;
  if not has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.club_portal_resena(text,text)', 'EXECUTE') then
    raise exception '167: club-web (anon) tiene que poder leer el portal y marcar la tarjeta';
  end if;
  if has_function_privilege('anon', 'public.club_portal_datos(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_resena_socio_toca(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_resena_socio_toca(uuid)', 'EXECUTE') then
    raise exception '167: las internas no se abren';
  end if;
  if has_table_privilege('anon', 'public.club_resena_socio', 'SELECT') then
    raise exception '167: anon no lee club_resena_socio';
  end if;
end
$$;

commit;
