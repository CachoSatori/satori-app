-- 082 · Ingesta del puente en UNA transacción por local (CLUB-AUD-44/45, 08-nov-2026).
--
-- Antes, el Edge `ingest-ndf` escribía con varias llamadas sueltas (upsert de tickets, borrar líneas, insertar líneas,
-- snapshot de mesas, cursor). Dos POST simultáneos del mismo local (el agente y un reintento, o el agente y el
-- backfill) podían intercalarse: los dos borraban las líneas de la misma factura y los dos las insertaban → líneas
-- DUPLICADAS. Y si una llamada del medio fallaba, quedaba el lote a medias.
--
-- Ahora todo pasa por `pos_ndf_ingestar`, en una sola transacción y con un lock por local
-- (`pg_advisory_xact_lock`): el segundo POST espera a que termine el primero, y o se guarda todo o nada.
-- El cursor se fusiona acá, con las reglas de CLUB-AUD-46: `last_poll_at` = hora del servidor; `last_factura` y
-- `last_fecha_registra` solo avanzan; una clave ausente no se toca.
--
-- ADITIVA: solo agrega una función. Va DESPUÉS de la 081 y ANTES del Edge que la usa (RUNBOOK del Club, paso 2-3).
-- Rollback: `drop function if exists public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);` (antes de volver al
-- Edge anterior, que no la usa).
begin;

create or replace function public.pos_ndf_ingestar(p_local text, p_tickets jsonb, p_lineas jsonb, p_open jsonb, p_cursor jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids        jsonb;
  v_tickets    int := 0;
  v_lineas     int := 0;
  v_open       int := 0;
  v_borradas   int := 0;
  v_cur        public.pos_ndf_cursor%rowtype;
  v_fac        text;
  v_fec        timestamptz;
begin
  if p_local is null or p_local !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'local no válido' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_tickets, '[]')) <> 'array' or jsonb_typeof(coalesce(p_lineas, '[]')) <> 'array'
     or (p_open is not null and jsonb_typeof(p_open) <> 'array') then
    raise exception 'lote no válido' using errcode = 'P0001';
  end if;

  -- Un lote a la vez por local: el segundo POST espera al primero.
  perform pg_advisory_xact_lock(hashtextextended('pos_ndf_ingest:' || p_local, 0));

  -- 1. Tickets: upsert por (local, numero_factura). Pisa con lo último leído (si el PoS corrigió un monto, vale la
  --    corrección). `local` sale del parámetro, nunca del lote.
  with entrantes as (
    select t.* from jsonb_populate_recordset(null::public.pos_ndf_tickets, coalesce(p_tickets, '[]')) t
  ), up as (
    insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, fecha_cierra, estado, tipo, area, canal, mesa,
      salonero_login, registrado_por, turno, cajero_login, numero_pedido, efectivo_crc, tarjeta_crc, electronico_crc,
      deposito_crc, cheque_crc, cxc_crc, dolares_efectivo, dolares_tarjeta, vuelto_crc, descuento_crc, con_servicio,
      servicio_crc, valor_servido_crc, iva_crc, regalia_crc, clase_ingreso, pax_nativo, pax_articulo, pax, pax_alerta,
      total_crc, total_fuente, area_factura, mesa_factura, consecutivo_fe, clave_fe, pedido_abierto_en, ingested_at)
    select p_local, e.numero_factura, e.fecha_registra, e.fecha_cierra, e.estado, e.tipo, e.area, e.canal, e.mesa,
      e.salonero_login, e.registrado_por, e.turno, e.cajero_login, e.numero_pedido, e.efectivo_crc, e.tarjeta_crc,
      e.electronico_crc, e.deposito_crc, e.cheque_crc, e.cxc_crc, e.dolares_efectivo, e.dolares_tarjeta, e.vuelto_crc,
      e.descuento_crc, e.con_servicio, e.servicio_crc, e.valor_servido_crc, e.iva_crc, e.regalia_crc, e.clase_ingreso,
      e.pax_nativo, e.pax_articulo, e.pax, e.pax_alerta, e.total_crc, e.total_fuente, e.area_factura, e.mesa_factura,
      e.consecutivo_fe, e.clave_fe, e.pedido_abierto_en, now()
      from entrantes e
    on conflict (local, numero_factura) do update set
      fecha_registra = excluded.fecha_registra, fecha_cierra = excluded.fecha_cierra, estado = excluded.estado,
      tipo = excluded.tipo, area = excluded.area, canal = excluded.canal, mesa = excluded.mesa,
      salonero_login = excluded.salonero_login, registrado_por = excluded.registrado_por, turno = excluded.turno,
      cajero_login = excluded.cajero_login, numero_pedido = excluded.numero_pedido, efectivo_crc = excluded.efectivo_crc,
      tarjeta_crc = excluded.tarjeta_crc, electronico_crc = excluded.electronico_crc, deposito_crc = excluded.deposito_crc,
      cheque_crc = excluded.cheque_crc, cxc_crc = excluded.cxc_crc, dolares_efectivo = excluded.dolares_efectivo,
      dolares_tarjeta = excluded.dolares_tarjeta, vuelto_crc = excluded.vuelto_crc, descuento_crc = excluded.descuento_crc,
      con_servicio = excluded.con_servicio, servicio_crc = excluded.servicio_crc,
      valor_servido_crc = excluded.valor_servido_crc, iva_crc = excluded.iva_crc, regalia_crc = excluded.regalia_crc,
      clase_ingreso = excluded.clase_ingreso, pax_nativo = excluded.pax_nativo, pax_articulo = excluded.pax_articulo,
      pax = excluded.pax, pax_alerta = excluded.pax_alerta, total_crc = excluded.total_crc,
      total_fuente = excluded.total_fuente, area_factura = excluded.area_factura, mesa_factura = excluded.mesa_factura,
      consecutivo_fe = excluded.consecutivo_fe, clave_fe = excluded.clave_fe,
      pedido_abierto_en = excluded.pedido_abierto_en, ingested_at = now()
    returning id, numero_factura
  )
  select coalesce(jsonb_object_agg(numero_factura, id), '{}'::jsonb), count(*) into v_ids, v_tickets from up;

  -- 2. Líneas: se REEMPLAZAN enteras para las facturas del lote (borrar + insertar, dentro de la misma transacción).
  delete from public.pos_ndf_ticket_lines l
   where l.ticket_id in (select (value #>> '{}')::uuid from jsonb_each(v_ids));
  insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia,
                                           es_pax, es_extra, es_cortesia, usuario_registra)
  select (v_ids ->> (x ->> 'numero_factura'))::uuid, x ->> 'codigo_producto', x ->> 'nombre', (x ->> 'cantidad')::numeric,
         (x ->> 'precio')::numeric, (x ->> 'monto')::numeric, (x ->> 'familia')::int,
         coalesce((x ->> 'es_pax')::boolean, false), coalesce((x ->> 'es_extra')::boolean, false),
         coalesce((x ->> 'es_cortesia')::boolean, false), x ->> 'usuario_registra'
    from jsonb_array_elements(coalesce(p_lineas, '[]')) x
   where v_ids ? (x ->> 'numero_factura');
  get diagnostics v_lineas = row_count;

  -- 3. Mesas abiertas: snapshot del local (null = el agente no mandó snapshot: no se toca nada).
  if p_open is not null then
    insert into public.pos_ndf_open (local, clave, numero_factura, id_pedido, mesa, salonero_login, canal, pax, pax_alerta,
                                     updated_at, monto_estimado_crc, pax_pedido, items_valor, detalle_productos,
                                     pedido_abierto_en, area)
    select p_local, o.clave, o.numero_factura, o.id_pedido, o.mesa, o.salonero_login, o.canal, o.pax, o.pax_alerta,
           o.updated_at, o.monto_estimado_crc, o.pax_pedido, o.items_valor, o.detalle_productos, o.pedido_abierto_en, o.area
      from jsonb_populate_recordset(null::public.pos_ndf_open, p_open) o
    on conflict (local, clave) do update set
      numero_factura = excluded.numero_factura, id_pedido = excluded.id_pedido, mesa = excluded.mesa,
      salonero_login = excluded.salonero_login, canal = excluded.canal, pax = excluded.pax, pax_alerta = excluded.pax_alerta,
      updated_at = excluded.updated_at, monto_estimado_crc = excluded.monto_estimado_crc, pax_pedido = excluded.pax_pedido,
      items_valor = excluded.items_valor, detalle_productos = excluded.detalle_productos,
      pedido_abierto_en = excluded.pedido_abierto_en, area = excluded.area;
    get diagnostics v_open = row_count;
    delete from public.pos_ndf_open o
     where o.local = p_local
       and not exists (select 1 from jsonb_array_elements(p_open) x where x ->> 'clave' = o.clave);
    get diagnostics v_borradas = row_count;
  end if;

  -- 4. Cursor (null = no se escribe; es lo que deja correr el backfill en paralelo sin mover el corte del agente).
  select * into v_cur from public.pos_ndf_cursor where local = p_local for update;
  if p_cursor is not null then
    v_fac := case when p_cursor ? 'last_factura' then p_cursor ->> 'last_factura' end;
    v_fec := case when p_cursor ? 'last_fecha_registra' then (p_cursor ->> 'last_fecha_registra')::timestamptz end;
    insert into public.pos_ndf_cursor (local, last_factura, last_fecha_registra, last_poll_at, last_error)
    values (p_local,
      -- CLUB-AUD-46: solo avanza (números del PoS sin los ceros; si alguno no es numérico, vale el nuevo); null no borra
      case when v_fac is null then v_cur.last_factura
           when v_cur.last_factura is null then v_fac
           when v_fac ~ '^\d+$' and v_cur.last_factura ~ '^\d+$'
             then case when v_fac::numeric >= v_cur.last_factura::numeric then v_fac else v_cur.last_factura end
           else v_fac end,
      case when v_fec is null then v_cur.last_fecha_registra else greatest(v_fec, v_cur.last_fecha_registra) end,
      now(),
      case when p_cursor ? 'last_error' then p_cursor ->> 'last_error' else v_cur.last_error end)
    on conflict (local) do update set
      last_factura = excluded.last_factura, last_fecha_registra = excluded.last_fecha_registra,
      last_poll_at = excluded.last_poll_at, last_error = excluded.last_error;
    select * into v_cur from public.pos_ndf_cursor where local = p_local;
  end if;

  return jsonb_build_object('tickets', v_tickets, 'lineas', v_lineas, 'open_guardadas', v_open, 'open_borradas', v_borradas,
                            'cursor', case when v_cur.local is null then null else to_jsonb(v_cur) end,
                            'cursor_escrito', p_cursor is not null);
end;
$$;

revoke all on function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb) to service_role;

commit;
