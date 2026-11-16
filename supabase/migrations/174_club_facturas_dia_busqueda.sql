-- 174 (origen club 120) · Club → Escanear → Tarjeta física, plan B: facturas cobradas HOY + búsqueda por tiquete (3 días).
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
--     club_facturas_buscar__nucleo sin EXECUTE para la API). owner, manager y cajero. La usa SOLO la tarjeta física.
--  5. club_pos_ref_tarjeta (interna): la referencia al PoS de la tarjeta física. La factura del plan B se acepta si se
--     cobró desde las 00:00 CR de hace 3 días; pedido abierto y lo demás → club_pos_ref, igual que siempre.
--  6. club_tarjeta_manual__nucleo (receta de la 170/172: se cambia el NÚCLEO, no el envoltorio de la 172): cuerpo de la
--     150 con dos cambios marcados «174»: usa club_pos_ref_tarjeta y, con la factura del plan B, si la visita ya tiene
--     una tarjeta o un cupón cargado (de cualquier referente), corta («ya tiene una tarjeta o un cupón cargado»).
--
-- SOLO TARJETA FÍSICA (verificador del #206, 15-nov): cupón, canje y visita de socio NO cambian. club_pos_ref,
-- club_visita_control, club_facturas_recientes (envoltorio y núcleo) y todos los demás núcleos quedan como en main: la
-- factura del plan B de esos flujos sigue siendo la de las últimas 2 h 15 min, y su lista la de las últimas 2 h.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata ni movimientos: no cambia cómo se calcula ni qué se guarda (fecha_visita sigue siendo la hora del registro).
--  · Ni sagrados, ni envoltorios de la 170/172 (el de club_tarjeta_manual queda igual; cambia su núcleo).
--  · Ni el cruce: con la factura elegida el cruce ya era por número de factura, sin ventana de horas.
--
-- ⚠ ORDEN: va DESPUÉS de la 172 y la 173 (en prod desde el 15-nov). Usa club_exigir_local (170) y el núcleo de
-- club_tarjeta_manual (172): aborta si faltan.
-- Pruebas: scripts/sql/174_pruebas.sql (+ 174_pruebas.py; transacción descartada). Rollback: scripts/sql/174_rollback.sql.
begin;

do $pre$ begin
  if to_regprocedure('public.club_exigir_local(text)') is null
     or to_regprocedure('public.club_tarjeta_manual__nucleo(uuid,integer,text,uuid,jsonb)') is null then
    raise exception '174: falta la 170 o la 172 (club_exigir_local / club_tarjeta_manual__nucleo)';
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

-- Hasta cuántos días CR hacia atrás llega la búsqueda por tiquete (y el control de club_pos_ref_tarjeta): hoy y los 3 anteriores.
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

-- ── 5. La referencia al PoS SOLO para la tarjeta física: la factura vale hasta 3 días CR ───────────────────────────
-- club_pos_ref (150) NO cambia: cupón, canje y visita de socio siguen con la factura de las últimas 2 h 15 min.
-- Esta es la misma regla para la factura del plan B, con la ventana de la tarjeta física (decisión del dueño, 15-nov).
-- Pedido abierto, vacío o algo que no es una factura: lo resuelve club_pos_ref, igual que siempre.
create or replace function public.club_pos_ref_tarjeta(p jsonb, p_location text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nf text;
  t    public.pos_ndf_tickets%rowtype;
  r    jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or coalesce(p->>'modo', '') <> 'factura' then
    return public.club_pos_ref(p, p_location);
  end if;
  if p_location is null or (nullif(btrim(p->>'local'), '') is not null and btrim(p->>'local') <> p_location) then
    raise exception 'Pedido no válido: elegilo de la lista' using errcode = 'P0001';   -- CLUB-AUD-18
  end if;
  v_nf := btrim(coalesce(p->>'numero_factura', ''));
  if v_nf !~ '^[0-9]{1,30}$' then
    raise exception 'Factura no válida: elegila de la lista' using errcode = 'P0001';
  end if;
  -- Cobrada (C o R); una anulada (X) no.
  select * into t from public.pos_ndf_tickets x where x.local = p_location and x.numero_factura = v_nf and x.estado in ('C', 'R');
  if not found then
    raise exception 'Esa factura no está en el PoS de este local (o está anulada): tocá «Actualizar» o buscala por número de tiquete. Si no aparece, pedile al owner un ajuste' using errcode = 'P0001';
  end if;
  -- La lista muestra las de HOY y la búsqueda llega a los 3 días CR anteriores: el mismo tope (club_facturas_desde).
  if t.fecha_registra < public.club_facturas_desde(now(), public.club_facturas_dias_busqueda()) then
    raise exception 'Esa factura tiene más de % días: pedile al owner un ajuste', public.club_facturas_dias_busqueda() using errcode = 'P0001';
  end if;
  -- Lo que se guarda: lo mismo que club_pos_ref (150) para la factura.
  r := jsonb_build_object('modo', 'factura', 'local', p_location, 'numero_factura', v_nf,
                          'area', nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
                          'mesa', nullif(upper(btrim(coalesce(t.mesa_factura, t.mesa, ''))), ''), 'total', t.total_crc,
                          'pax', nullif(t.pax, 0),
                          'hora_factura', t.fecha_registra, 'hora', now());
  return r || jsonb_build_object('visita', public.club_visita_canonica(p_location, r, null));
end;
$$;
revoke all on function public.club_pos_ref_tarjeta(jsonb, text) from public, anon, authenticated;
comment on function public.club_pos_ref_tarjeta(jsonb, text) is
  '174 (interna): club_pos_ref para la TARJETA FÍSICA: la factura del plan B vale hasta 3 días CR (club_pos_ref: 2 h 15 min).';

-- ── 6. Tarjeta física: se cambia el NÚCLEO (receta de la 170/172), cuerpo de la 150 con dos cambios marcados «174» ──
create or replace function public.club_tarjeta_manual__nucleo(p_miembro uuid, p_personas int, p_factura text, p_op uuid, p_pos jsonb default null)
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
    -- Grok 159 (10-nov): el replay exige también las mismas personas (si no, la caja creería que registró otra cantidad)
    if v_prev.tipo <> 'tarjeta' or v_prev.miembro_id is distinct from p_miembro or v_prev.cupon_id is not null
       or v_prev.personas is distinct from p_personas then
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
  v_pos := public.club_pos_ref_tarjeta(p_pos, v_loc);   -- 174: la factura del plan B vale hasta 3 días CR
  perform public.club_visita_control(v_loc, coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, null, v_fac)),
                                     v_pos, v_fac, p_miembro, p_personas);
  -- 174 (decisión del dueño, 15-nov, opción A): con la factura del plan B, si esa visita ya tiene una tarjeta o un cupón
  -- cargado (de cualquier referente, o personas pendientes), no se carga otra vez. Va DESPUÉS de club_visita_control,
  -- que ya tomó el lock de la visita. Con el pedido abierto sigue CLUB-AUD-02.
  if v_pos->>'modo' = 'factura' and public.club_visita_con_tarjeta(v_loc, v_pos->>'visita') then
    raise exception 'Esa factura ya tiene una tarjeta o un cupón cargado: no se puede usar otra vez. Si falta algo, pedile al owner un ajuste' using errcode = 'P0001';
  end if;
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
revoke all on function public.club_tarjeta_manual__nucleo(uuid, int, text, uuid, jsonb) from public, anon, authenticated;

commit;
