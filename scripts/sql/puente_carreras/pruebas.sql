-- CLUB-AUD-44/45/46: pruebas de pos_ndf_ingestar (mig 082). SOLO STAGING. Una transacción que termina en ROLLBACK.
-- Local sintético «prueba-082» (no existe en el PoS) para no tocar el cursor ni las mesas de santa-teresa.
begin;
create temp table _r (caso text, ok boolean, detalle text);
grant insert on _r to service_role;
do $$
declare r jsonb; t jsonb := '[{"numero_factura":"0000123","fecha_registra":"2026-11-08T18:00:00-06:00","estado":"C","canal":"salon","registrado_por":"cajero","con_servicio":true,"pax_nativo":2,"pax_articulo":2,"pax":2,"pax_alerta":"ok","total_crc":1000,"total_fuente":"provisorio","efectivo_crc":1000,"tarjeta_crc":0,"electronico_crc":0,"deposito_crc":0,"cheque_crc":0,"cxc_crc":0,"dolares_efectivo":0,"dolares_tarjeta":0,"vuelto_crc":0,"descuento_crc":0,"servicio_crc":0,"valor_servido_crc":0,"iva_crc":0,"regalia_crc":0}]';
        l jsonb := '[{"numero_factura":"0000123","codigo_producto":"P1","nombre":"Plato","cantidad":1,"monto":1000,"familia":5}]';
        o jsonb := '[{"clave":"pedido:2026-11-08:1","mesa":"5","updated_at":"2026-11-08T18:00:00-06:00"},{"clave":"pedido:2026-11-08:2","mesa":"6","updated_at":"2026-11-08T18:00:00-06:00"}]';
        e text;
begin
  set local role service_role;
  r := public.pos_ndf_ingestar('prueba-082', t, l, o, '{"last_factura":"0000123","last_fecha_registra":"2026-11-08T18:00:00-06:00","last_poll_at":"2030-01-01T00:00:00Z"}');
  insert into _r values ('lote completo: ticket, línea, 2 mesas y cursor', r->>'tickets' = '1' and r->>'lineas' = '1' and r->>'open_guardadas' = '2'
    and r->'cursor'->>'last_factura' = '0000123' and (r->'cursor'->>'last_poll_at')::timestamptz < '2030-01-01', r::text);
  -- reingestar el mismo lote: no duplica
  r := public.pos_ndf_ingestar('prueba-082', t, l, null, null);
  insert into _r values ('reingestar no duplica líneas', (select count(*) from pos_ndf_ticket_lines x join pos_ndf_tickets y on y.id = x.ticket_id
    where y.local = 'prueba-082') = 1 and r->>'cursor_escrito' = 'false', r::text);
  -- cursor: una factura vieja no rebobina; null no borra; last_error explícito sí
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[]', null, '{"last_factura":"99","last_fecha_registra":"2026-11-01T00:00:00Z","last_error":"timeout"}');
  insert into _r values ('cursor solo avanza (factura y fecha); last_error explícito se guarda',
    r->'cursor'->>'last_factura' = '0000123' and (r->'cursor'->>'last_fecha_registra')::timestamptz = '2026-11-08T18:00:00-06:00'
    and r->'cursor'->>'last_error' = 'timeout', r::text);
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[]', null, '{"last_factura":null,"last_error":null}');
  insert into _r values ('null no borra el corte; last_error null lo limpia', r->'cursor'->>'last_factura' = '0000123' and r->'cursor'->>'last_error' is null, r::text);
  -- snapshot de mesas: la que no vino se borra; [] cierra todas
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[]', '[{"clave":"pedido:2026-11-08:2","mesa":"6","updated_at":"2026-11-08T18:05:00-06:00"}]', null);
  insert into _r values ('snapshot: la mesa que no vino se borra', r->>'open_guardadas' = '1' and r->>'open_borradas' = '1', r::text);
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[]', '[]', null);
  insert into _r values ('snapshot vacío cierra todas', r->>'open_borradas' = '1' and not exists (select 1 from pos_ndf_open where local = 'prueba-082'), r::text);
  -- una línea de una factura que no vino en el lote no se inserta
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[{"numero_factura":"999","codigo_producto":"X","cantidad":1,"monto":1}]', null, null);
  insert into _r values ('línea sin su factura en el lote: se ignora', r->>'lineas' = '0', r::text);
  begin perform public.pos_ndf_ingestar('Local Raro!', '[]', '[]', null, null); e := 'ok'; exception when others then e := sqlerrm; end;
  insert into _r values ('local inválido → rechaza', e = 'local no válido', e);
  reset role;
  insert into _r values ('solo service_role ejecuta', not has_function_privilege('anon', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'), '');
end $$;
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', left(detalle, 160))) from _r;
rollback;
