-- Rollback de la 174 (origen club 120): vuelve el plan B a «las últimas 2 h».
--  · club_facturas_recientes__nucleo, club_pos_ref y club_visita_control vuelven a su cuerpo de la 150 (create or replace
--    conserva los permisos: los tres sin EXECUTE para la API).
--  · Borra club_facturas_buscar (envoltorio y núcleo) y las internas club_facturas_lista, club_factura_usada,
--    club_visita_con_tarjeta, club_facturas_desde y club_facturas_dias_busqueda.
--  · Borra la fila 174 del ledger.
-- No toca tablas ni datos: lo que se registró con la 174 (tarjetas con facturas de más de 2 h) queda.
-- ANTES: el revert del código de la app (Escanear llama a club_facturas_buscar; sin la función, el plan B falla).
-- Si se corre en prod, en el mismo momento sale el .sql de main en un PR (regla 10 / satori-migraciones-y-prod §6).
-- ORDEN: antes de revertir la 172, la 173 o la 170.
begin;

drop function if exists public.club_facturas_buscar(text, text);
drop function if exists public.club_facturas_buscar__nucleo(text, text);

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
  return query
    select t.numero_factura, t.fecha_registra, t.total_crc,
           nullif(upper(btrim(coalesce(t.area_factura, t.area, ''))), ''),
           (select case when btrim(coalesce(x, '')) in ('', '0') then null else upper(btrim(x)) end
              from (select coalesce(t.mesa_factura, t.mesa) as x) m),
           t.numero_pedido, t.consecutivo_fe, t.estado
      from public.pos_ndf_tickets t
     where t.local = p_location and t.estado in ('C', 'R') and t.fecha_registra >= now() - interval '2 hours'
       and t.fecha_registra <= now() + interval '5 minutes'   -- margen por el reloj de la PC del PoS
     order by t.fecha_registra desc, t.numero_factura desc
     limit 100;
end;
$$;
revoke all on function public.club_facturas_recientes__nucleo(text) from public, anon, authenticated;

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
revoke all on function public.club_pos_ref(jsonb, text) from public, anon, authenticated;

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
revoke all on function public.club_visita_control(text, text, jsonb, text, uuid, int) from public, anon, authenticated;

drop function if exists public.club_facturas_lista(text, text, timestamptz);
drop function if exists public.club_factura_usada(text, text);
drop function if exists public.club_visita_con_tarjeta(text, text);
drop function if exists public.club_facturas_desde(timestamptz, int);
drop function if exists public.club_facturas_dias_busqueda();

delete from supabase_migrations.schema_migrations where version = '174';

commit;
