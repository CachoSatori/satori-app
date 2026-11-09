-- 082 · Ingesta del puente en UNA transacción por local (CLUB-AUD-44/45, 08-nov-2026).
--
-- Antes, el Edge `ingest-ndf` escribía con varias llamadas sueltas (upsert de tickets, borrar líneas, insertar líneas,
-- snapshot de mesas, cursor). Dos POST simultáneos del mismo local (el agente y un reintento, o el agente y el
-- backfill) podían intercalarse: los dos borraban las líneas de la misma factura y los dos las insertaban → líneas
-- DUPLICADAS. Y si una llamada del medio fallaba, quedaba el lote a medias.
--
-- Ahora todo pasa por `pos_ndf_ingestar`, en una sola transacción y con un lock por local
-- (`pg_advisory_xact_lock`): el segundo POST espera a que termine el primero, y o se guarda todo o nada.
-- El cursor se calcula acá (`last_poll_at` = hora del servidor; una clave ausente no se toca).
--
-- ── CONTRATO DEL CURSOR (Grok ID 83, 09-nov; reemplaza el «solo avanza» de CLUB-AUD-46) ─────────────────────────
-- El agente lee las cerradas con `NumeroFactura > cursor` y relee las provisionales (`R` en curso, `X` anulada) de
-- toda la ventana en cada ciclo. Una `R` con número MENOR al cursor no se leería nunca cuando cierre. El agente de
-- prod (4d3513a) lo resolvía mandando un cursor más bajo («rebobinar»); el «solo avanza» de la primera 082 se lo
-- impedía. Ahora el cursor lo calcula el SERVIDOR con lo que trae el lote, sin cambiar el agente:
--   · `max_factura_vista` (columna nueva, solo avanza) = la mayor CERRADA (`C`) guardada para el local: la del
--     cursor anterior, la del máximo anterior y las `C` de este lote. Las `R`/`X` no la mueven.
--   · `last_factura` (lo que se le devuelve al agente y lo que lee al arrancar) = el «corte seguro»:
--     si en el lote viene una `R` con número menor o igual al máximo, `menor R − 1`; si no, el máximo.
--   · el número que PROPONE el agente ya no manda: solo se usa para arrancar (sin nada guardado y sin `C` en el lote).
--     Uno que no es numérico se ignora (el agente nunca lo manda: normaliza a dígitos). Si lo GUARDADO no es numérico
--     (no pasa hoy), no hay orden confiable y vale el propuesto, como antes.
-- El agente viejo adopta el cursor que le devuelve el servidor (ciclo.ts: «el cursor que manda es el que quedó
-- GUARDADO»), así que en el ciclo siguiente relee desde el corte: la `R` que cierre entra como `C`, y las `C` de
-- arriba se vuelven a leer (el upsert por factura no duplica: sus líneas se reemplazan). Cuando ya no viene ninguna
-- `R` por debajo, el corte vuelve al máximo. Un lote viejo o un agente que perdió el estado no puede rebobinar: solo
-- una `R` presente en el lote baja el corte. Un lote SIN la clave `cursor` (el backfill) no toca nada.
-- Límite que queda (no lo arregla ningún cursor): una factura que abre con número menor al corte Y cierra dentro del
-- mismo ciclo (~75 s) sin haberse visto nunca como `R`. Para eso está la conciliación contra el PoS (paquete §7).
--
-- ADITIVA: agrega una función y una columna que acepta vacío. Va DESPUÉS de la 081 y ANTES del Edge que la usa.
-- Rollback: PRIMERO el Edge anterior y RECIÉN DESPUÉS
-- `drop function if exists public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);` (con el Edge nuevo y sin la
-- función no entra ninguna venta). La columna `max_factura_vista` puede quedar: el Edge anterior no la mira.
begin;

alter table public.pos_ndf_cursor add column if not exists max_factura_vista text;
comment on column public.pos_ndf_cursor.max_factura_vista is
  'Mayor factura CERRADA guardada del local (solo avanza). last_factura puede quedar por debajo (corte seguro) mientras haya una R abierta con número menor (Grok ID 83, mig 082).';

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
  v_max_c      text;
  v_min_r      numeric;
  v_alto       text;
  v_corte      text;
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
  --    Contrato: ver la cabecera (Grok ID 83).
  select * into v_cur from public.pos_ndf_cursor where local = p_local for update;
  if p_cursor is not null then
    v_fac := case when p_cursor ? 'last_factura' then nullif(btrim(p_cursor ->> 'last_factura'), '') end;
    if v_fac !~ '^\d+$' then v_fac := null; end if;
    v_fec := case when p_cursor ? 'last_fecha_registra' then (p_cursor ->> 'last_fecha_registra')::timestamptz end;
    -- la mayor C y la menor R del lote (números del PoS; los que no son numéricos no entran en el orden)
    select x ->> 'numero_factura' into v_max_c
      from jsonb_array_elements(coalesce(p_tickets, '[]')) x
     where x ->> 'estado' = 'C' and x ->> 'numero_factura' ~ '^\d+$'
     order by (x ->> 'numero_factura')::numeric desc limit 1;
    select min((x ->> 'numero_factura')::numeric) into v_min_r
      from jsonb_array_elements(coalesce(p_tickets, '[]')) x
     where x ->> 'estado' = 'R' and x ->> 'numero_factura' ~ '^\d+$';
    if coalesce(v_cur.last_factura, '0') ~ '^\d+$' and coalesce(v_cur.max_factura_vista, '0') ~ '^\d+$' then
      -- el máximo: el mayor de lo guardado y las C del lote (el texto tal cual, con sus ceros)
      select f into v_alto from unnest(array[v_cur.max_factura_vista, v_cur.last_factura, v_max_c]) f
       where f is not null order by f::numeric desc limit 1;
      v_alto := coalesce(v_alto, v_fac);   -- arranque: nada guardado y ninguna C en el lote → lo propuesto
      v_corte := case when v_alto is not null and v_min_r is not null and v_min_r <= v_alto::numeric
                      then greatest(v_min_r - 1, 0)::text else v_alto end;
    else
      -- lo guardado no es numérico: no hay orden confiable, vale lo propuesto (null no borra)
      v_corte := coalesce(v_fac, v_cur.last_factura);
      v_alto  := coalesce(v_fac, v_cur.max_factura_vista);
    end if;
    insert into public.pos_ndf_cursor (local, last_factura, max_factura_vista, last_fecha_registra, last_poll_at, last_error)
    values (p_local, v_corte, v_alto,
      case when v_fec is null then v_cur.last_fecha_registra else greatest(v_fec, v_cur.last_fecha_registra) end,
      now(),
      case when p_cursor ? 'last_error' then p_cursor ->> 'last_error' else v_cur.last_error end)
    on conflict (local) do update set
      last_factura = excluded.last_factura, max_factura_vista = excluded.max_factura_vista,
      last_fecha_registra = excluded.last_fecha_registra, last_poll_at = excluded.last_poll_at,
      last_error = excluded.last_error;
    select * into v_cur from public.pos_ndf_cursor where local = p_local;
  end if;

  return jsonb_build_object('tickets', v_tickets, 'lineas', v_lineas, 'open_guardadas', v_open, 'open_borradas', v_borradas,
                            'cursor', case when v_cur.local is null then null else to_jsonb(v_cur) end,
                            'cursor_escrito', p_cursor is not null,
                            -- la R que retiene el corte (null = ninguna): para el control del paquete y los logs
                            'corte_retenido_por_r', case when p_cursor is not null and v_corte is distinct from v_alto
                                                         then v_min_r::text end);
end;
$$;

revoke all on function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb) to service_role;

commit;
