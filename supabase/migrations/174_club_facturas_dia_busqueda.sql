-- 174 (origen club 120) · Club → Escanear, plan B: facturas cobradas HOY + búsqueda por número de tiquete (3 días).
--
-- ⚠ Lleva firma: esquema. Decisión del dueño (15-nov, opción A), tras un caso real: una mesa cobrada a las 19:03 no se
-- pudo elegir a las 21:33 para cargar la tarjeta física del referente («Factura (plan B)» solo listaba las últimas 2 h) y
-- no había otra vía para vincular la tarjeta a su factura: se perdía el consumo del referente.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. club_facturas_desde(ahora, días) y club_facturas_dias_busqueda() (= 3): el corte por DÍA CALENDARIO de Costa Rica
--     (America/Costa_Rica, 00:00). Una sola fuente para la lista, la búsqueda y el control del servidor.
--  2. club_visita_con_tarjeta(local, visita): ¿esa visita ya tiene una tarjeta o un cupón cargado (movimiento `tarjeta`
--     de la app o personas pendientes de aprobación)? club_factura_usada(local, factura): lo mismo para una factura, con
--     la clave canónica de la visita (club_visita_canonica, CLUB-AUD-15).
--  3. club_facturas_lista(local, buscar, ahora) (interna): sin `buscar`, las facturas cobradas HOY (C o R, sin
--     anuladas), más recientes primero; con `buscar` (4 a 20 dígitos: los últimos del consecutivo FE, el número del
--     tiquete), las de hoy y los 3 días CR anteriores cuyo consecutivo termina así. Cada fila trae `usada`.
--  4. club_facturas_buscar(p_buscar, p_location): NUEVA, con la receta de la 170 (envoltorio con club_exigir_local +
--     club_facturas_buscar__nucleo sin EXECUTE para la API). owner, manager y cajero, como la lista de siempre.
--  5. club_facturas_recientes__nucleo (receta de la 170: se cambia el NÚCLEO, no el envoltorio): misma firma y mismo
--     resultado; ahora devuelve las cobradas HOY (antes: las últimas 2 h). Queda para las PWA en caché.
--  6. club_pos_ref (interna, cuerpo de la 150): la factura elegida se acepta si se cobró desde las 00:00 CR de hace 3
--     días (antes: 2 h 15 min). Mensajes nuevos: «no está en el PoS de este local (o está anulada)» y «tiene más de 3
--     días: pedile al owner un ajuste».
--  7. club_visita_control (interna, cuerpo de la 150): con la factura del plan B, si la visita ya tiene una tarjeta o un
--     cupón cargado, corta («ya tiene una tarjeta o un cupón cargado: no se puede usar otra vez»). Con el pedido abierto
--     sigue CLUB-AUD-02 (dos referentes en la misma mesa, Σ personas ≤ pax).
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata ni movimientos: no cambia cómo se calcula ni qué se guarda (fecha_visita sigue siendo la hora del registro).
--  · Ni sagrados, ni envoltorios de la 170/172 (el de club_facturas_recientes queda igual; cambia su núcleo).
--  · Ni el cruce: con la factura elegida el cruce ya era por número de factura, sin ventana de horas.
--
-- ⚠ ORDEN: va DESPUÉS de la 172 (#202) y la 173 (#203). No toca nada de las dos (probado en base local con y sin ellas).
-- Usa club_exigir_local (170): aborta si falta.
-- Pruebas: scripts/sql/174_pruebas.sql (+ 174_pruebas.py; transacción descartada). Rollback: scripts/sql/174_rollback.sql.
begin;

do $pre$ begin
  if to_regprocedure('public.club_exigir_local(text)') is null
     or to_regprocedure('public.club_facturas_recientes__nucleo(text)') is null then
    raise exception '174: falta la 170 (club_exigir_local / club_facturas_recientes__nucleo)';
  end if;
end $pre$;

-- ── 1. El corte por día calendario de Costa Rica ───────────────────────────────────────────────────────────────────
-- Las 00:00 CR del día de `p_ahora` menos `p_dias_atras` días. CR es UTC-6 todo el año (sin horario de verano).
create or replace function public.club_facturas_desde(p_ahora timestamptz, p_dias_atras int)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select (((p_ahora at time zone 'America/Costa_Rica')::date - greatest(coalesce(p_dias_atras, 0), 0))::timestamp)
         at time zone 'America/Costa_Rica'
$$;
revoke all on function public.club_facturas_desde(timestamptz, int) from public, anon, authenticated;
comment on function public.club_facturas_desde(timestamptz, int) is
  '174: las 00:00 de Costa Rica del día de p_ahora menos p_dias_atras días (corte de la lista y la búsqueda del plan B).';

-- Hasta cuántos días CR hacia atrás llega la búsqueda por tiquete (y el control de club_pos_ref): hoy y los 3 anteriores.
create or replace function public.club_facturas_dias_busqueda()
returns int
language sql
immutable
set search_path = public, pg_temp
as $$ select 3 $$;
revoke all on function public.club_facturas_dias_busqueda() from public, anon, authenticated;
comment on function public.club_facturas_dias_busqueda() is
  '174: días CR hacia atrás de la búsqueda por tiquete del plan B (decisión del dueño, 15-nov: 3).';

-- ── 2. ¿La visita / la factura ya tiene una tarjeta o un cupón cargado? ───────────────────────────────────────────
create or replace function public.club_visita_con_tarjeta(p_location text, p_visita text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_visita is not null and p_visita <> '' and (
    exists (select 1 from public.club_movimientos mv
             where mv.location_id = p_location and mv.tipo = 'tarjeta' and mv.origen = 'app' and mv.visita_clave = p_visita)
    or exists (select 1 from public.club_personas_pendientes pp
                where pp.location_id = p_location and pp.estado = 'pendiente' and pp.visita_clave = p_visita))
$$;
revoke all on function public.club_visita_con_tarjeta(text, text) from public, anon, authenticated;
comment on function public.club_visita_con_tarjeta(text, text) is
  '174 (interna): ¿la visita ya tiene una tarjeta o un cupón cargado (movimiento tarjeta de la app o personas pendientes)?';

create or replace function public.club_factura_usada(p_location text, p_numero_factura text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.club_visita_con_tarjeta(p_location,
           public.club_visita_canonica(p_location, jsonb_build_object('modo', 'factura', 'numero_factura', p_numero_factura), null))
$$;
revoke all on function public.club_factura_usada(text, text) from public, anon, authenticated;
comment on function public.club_factura_usada(text, text) is
  '174 (interna): ¿la factura (por la clave canónica de su visita) ya tiene una tarjeta o un cupón cargado?';

-- ── 3. La lista y la búsqueda (interna; el local ya viene resuelto y chequeado) ─────────────────────────────────────
create or replace function public.club_facturas_lista(p_location text, p_buscar text, p_ahora timestamptz)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, pedido text, consecutivo_fe text,
               estado text, usada boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_bus text := nullif(regexp_replace(coalesce(p_buscar, ''), '\D', '', 'g'), '');
begin
  if btrim(coalesce(p_buscar, '')) <> '' and (v_bus is null or length(v_bus) not between 4 and 20) then
    raise exception 'Escribí al menos 4 dígitos del número de tiquete (los últimos)' using errcode = 'P0001';
  end if;
  return query
    select t.numero_factura, t.fecha_registra, t.total_crc,
           nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
           (select case when btrim(coalesce(x, '')) in ('', '0') then null else upper(btrim(x)) end
              from (select coalesce(t.mesa_factura, t.mesa) as x) m),
           t.numero_pedido, t.consecutivo_fe, t.estado,
           public.club_factura_usada(p_location, t.numero_factura)
      from public.pos_ndf_tickets t
     where t.local = p_location and t.estado in ('C', 'R')                       -- cobradas; nunca anuladas (X)
       and t.fecha_registra >= public.club_facturas_desde(p_ahora,
                                 case when v_bus is null then 0 else public.club_facturas_dias_busqueda() end)
       and t.fecha_registra <= p_ahora + interval '5 minutes'                    -- margen por el reloj de la PC del PoS
       and (v_bus is null or t.consecutivo_fe like '%' || v_bus)
     order by t.fecha_registra desc, t.numero_factura desc
     limit case when v_bus is null then 300 else 50 end;
end;
$$;
revoke all on function public.club_facturas_lista(text, text, timestamptz) from public, anon, authenticated;
comment on function public.club_facturas_lista(text, text, timestamptz) is
  '174 (interna): facturas cobradas del plan B. Sin buscar: las de HOY (día CR de p_ahora). Con buscar (4 a 20 dígitos '
  'del final del consecutivo FE): hoy y los 3 días CR anteriores. C o R, sin anuladas; usada = ya tiene tarjeta o cupón.';

-- ── 4. Búsqueda por tiquete: envoltorio + núcleo (receta de la 170) ────────────────────────────────────────────────
create or replace function public.club_facturas_buscar__nucleo(p_buscar text default null, p_location text default null)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, pedido text, consecutivo_fe text,
               estado text, usada boolean)
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
  return query select * from public.club_facturas_lista(p_location, p_buscar, now());
end;
$$;
revoke all on function public.club_facturas_buscar__nucleo(text, text) from public, anon, authenticated;
comment on function public.club_facturas_buscar__nucleo(text, text) is
  '174: núcleo de club_facturas_buscar (sin EXECUTE para la API). owner, manager, cajero.';

create or replace function public.club_facturas_buscar(p_buscar text default null, p_location text default null)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, pedido text, consecutivo_fe text,
               estado text, usada boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.club_exigir_local(p_location);
  return query select * from public.club_facturas_buscar__nucleo(p_buscar => p_buscar, p_location => p_location);
end;
$$;
revoke all on function public.club_facturas_buscar(text, text) from public, anon, authenticated, service_role;
grant execute on function public.club_facturas_buscar(text, text) to authenticated;
comment on function public.club_facturas_buscar(text, text) is
  '174: envoltorio. Chequea el local (club_exigir_local: el manager, solo sus locales) y llama a club_facturas_buscar__nucleo. '
  'Sin p_buscar: las facturas cobradas HOY (CR); con p_buscar (últimos 4 a 20 dígitos del tiquete): hasta 3 días CR atrás.';

-- ── 5. La lista de siempre: se cambia el NÚCLEO (misma firma y resultado), ahora «cobradas hoy» ────────────────────
create or replace function public.club_facturas_recientes__nucleo(p_location text default null)
returns table (numero_factura text, hora timestamptz, total_crc numeric, area text, mesa text, pedido text, consecutivo_fe text,
               estado text)
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
  -- 174: las cobradas HOY (día CR), más recientes primero. Antes: las últimas 2 h.
  return query
    select l.numero_factura, l.hora, l.total_crc, l.area, l.mesa, l.pedido, l.consecutivo_fe, l.estado
      from public.club_facturas_lista(p_location, null, now()) l;
end;
$$;
revoke all on function public.club_facturas_recientes__nucleo(text) from public, anon, authenticated;

-- ── 6. club_pos_ref: la factura elegida vale si se cobró desde las 00:00 CR de hace 3 días ─────────────────────────
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
    -- S0b (09-nov): en este PoS la factura queda en R (cobrada) hasta el cierre de caja; la caja la puede elegir igual.
    -- Una anulada (X) no.
    select * into t from public.pos_ndf_tickets x where x.local = v_local and x.numero_factura = v_nf and x.estado in ('C', 'R');
    if not found then
      raise exception 'Esa factura no está en el PoS de este local (o está anulada): tocá «Actualizar» o buscala por número de tiquete. Si no aparece, pedile al owner un ajuste' using errcode = 'P0001';
    end if;
    -- 174: la lista muestra las cobradas HOY (día CR) y la búsqueda por tiquete llega a los 3 días CR anteriores: es
    -- el mismo tope (club_facturas_desde). Antes: 2 h 15 min.
    if t.fecha_registra < public.club_facturas_desde(now(), public.club_facturas_dias_busqueda()) then
      raise exception 'Esa factura tiene más de % días: pedile al owner un ajuste', public.club_facturas_dias_busqueda() using errcode = 'P0001';
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
revoke all on function public.club_pos_ref(jsonb, text) from public, anon, authenticated;

-- ── 7. club_visita_control: la factura del plan B con tarjeta o cupón ya cargado no se usa otra vez ────────────────
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
  -- 174 (decisión del dueño, 15-nov): con la factura del plan B (elegida de la lista o buscada por tiquete), si esa
  -- visita ya tiene una tarjeta o un cupón cargado (de cualquier referente), no se carga otra vez. Con el pedido abierto
  -- sigue CLUB-AUD-02 (dos referentes en la misma mesa, Σ personas ≤ pax).
  if p_pos is not null and p_pos->>'modo' = 'factura' and public.club_visita_con_tarjeta(p_location, p_visita) then
    raise exception 'Esa factura ya tiene una tarjeta o un cupón cargado: no se puede usar otra vez. Si falta algo, pedile al owner un ajuste' using errcode = 'P0001';
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
revoke all on function public.club_visita_control(text, text, jsonb, text, uuid, int) from public, anon, authenticated;

commit;
