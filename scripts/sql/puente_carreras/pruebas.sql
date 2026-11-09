-- CLUB-AUD-44/45, Grok 99, Grok ID 83 y Grok 113 (082 v3): pruebas de pos_ndf_ingestar (mig 082). SOLO STAGING. Una transacción que
-- termina en ROLLBACK. Locales sintéticos «prueba-082», «prueba-83» y «prueba-113» (no existen en el PoS).
-- Correr con `bash scripts/sql/puente_carreras/pruebas.sh`: crea la 082 DE ESTA RAMA dentro de la misma transacción
-- (staging puede tener otra versión) y descarta todo al final.
begin;
create temp table _r (caso text, ok boolean, detalle text);
grant insert on _r to service_role;
do $$
declare r jsonb; t jsonb := '[{"numero_factura":"0000123","fecha_registra":"2026-11-08T18:00:00-06:00","estado":"C","canal":"salon","registrado_por":"cajero","con_servicio":true,"pax_nativo":2,"pax_articulo":2,"pax":2,"pax_alerta":"ok","total_crc":1000,"total_fuente":"provisorio","efectivo_crc":1000,"tarjeta_crc":0,"electronico_crc":0,"deposito_crc":0,"cheque_crc":0,"cxc_crc":0,"dolares_efectivo":0,"dolares_tarjeta":0,"vuelto_crc":0,"descuento_crc":0,"servicio_crc":0,"valor_servido_crc":0,"iva_crc":0,"regalia_crc":0}]';
        l jsonb := '[{"numero_factura":"0000123","codigo_producto":"P1","nombre":"Plato","cantidad":1,"monto":1000,"familia":5}]';
        o jsonb := '[{"clave":"pedido:2026-11-08:1","mesa":"5","updated_at":"2026-11-08T18:00:00-06:00"},{"clave":"pedido:2026-11-08:2","mesa":"6","updated_at":"2026-11-08T18:00:00-06:00"}]';
        e text; tr jsonb; tv jsonb;
begin
  set local role service_role;
  -- v3: las R GUARDADAS retienen el corte si están en la ventana de 36 h → las facturas de las pruebas del cursor van con
  -- la hora de AHORA (con una fecha fija, la prueba cambiaría de resultado al pasar 36 h).
  tr := jsonb_set(t->0, '{fecha_registra}', to_jsonb(now() - interval '2 hours'));
  tv := jsonb_set(t->0, '{fecha_registra}', to_jsonb(now() - interval '40 hours'));
  r := public.pos_ndf_ingestar('prueba-082', t, l, o, '{"last_factura":"0000123","last_fecha_registra":"2026-11-08T18:00:00-06:00","last_poll_at":"2030-01-01T00:00:00Z"}');
  insert into _r values ('lote completo: ticket, línea, 2 mesas y cursor', r->>'tickets' = '1' and r->>'lineas' = '1' and r->>'open_guardadas' = '2'
    and r->'cursor'->>'last_factura' = '0000123' and (r->'cursor'->>'last_poll_at')::timestamptz < '2030-01-01', r::text);
  -- reingestar el mismo lote: no duplica
  r := public.pos_ndf_ingestar('prueba-082', t, l, null, null);
  insert into _r values ('reingestar no duplica líneas', (select count(*) from pos_ndf_ticket_lines x join pos_ndf_tickets y on y.id = x.ticket_id
    where y.local = 'prueba-082') = 1 and r->>'cursor_escrito' = 'false', r::text);
  -- cursor: una factura vieja no rebobina; null no borra; last_error explícito sí
  r := public.pos_ndf_ingestar('prueba-082', '[]', '[]', null, '{"last_factura":"99","last_fecha_registra":"2026-11-01T00:00:00Z","last_error":"timeout"}');
  insert into _r values ('cursor: un número viejo no rebobina (factura y fecha); last_error explícito se guarda',
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
  -- Grok 99 · lote con la MISMA factura dos veces: se rechaza el lote entero (no queda nada a medias: ni la otra
  -- factura del lote ni el cursor). El Edge ya deduplica antes (normalizarLote: gana la última); esto es la red de abajo.
  begin
    perform public.pos_ndf_ingestar('prueba-082',
      jsonb_build_array(t->0 || '{"numero_factura":"0000200"}', t->0 || '{"numero_factura":"0000201"}', t->0 || '{"numero_factura":"0000200","total_crc":2000}'),
      '[]', null, '{"last_factura":"0000201"}');
    e := 'ok';
  exception when others then e := sqlerrm; end;
  insert into _r values ('lote con factura repetida → rechaza todo (ni la otra factura ni el cursor)', e <> 'ok'
    and not exists (select 1 from pos_ndf_tickets where local = 'prueba-082' and numero_factura in ('0000200', '0000201'))
    and (select last_factura from pos_ndf_cursor where local = 'prueba-082') = '0000123', e);
  -- Grok 99 · una línea con un tipo inválido (cantidad «tres»): se rechaza el lote entero, sin ticket ni líneas a medias.
  begin
    perform public.pos_ndf_ingestar('prueba-082', jsonb_build_array(t->0 || '{"numero_factura":"0000202"}'),
      '[{"numero_factura":"0000202","codigo_producto":"P1","cantidad":1,"monto":500,"familia":5},
        {"numero_factura":"0000202","codigo_producto":"P2","cantidad":"tres","monto":500,"familia":5}]', null, '{"last_factura":"0000202"}');
    e := 'ok';
  exception when others then e := sqlerrm; end;
  insert into _r values ('línea con tipo inválido → rechaza todo (ni ticket, ni líneas, ni cursor)', e <> 'ok'
    and not exists (select 1 from pos_ndf_tickets where local = 'prueba-082' and numero_factura = '0000202')
    and (select last_factura from pos_ndf_cursor where local = 'prueba-082') = '0000123', e);
  -- ── Grok ID 83 · contrato del cursor: «corte seguro» calculado por el servidor ──────────────────────────────
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"101"}', tr || '{"numero_factura":"102"}',
         tr || '{"numero_factura":"104"}', tr || '{"numero_factura":"105"}', tr || '{"numero_factura":"103","estado":"R"}'),
         '[]', null, '{"last_factura":"102","last_error":null}');
  insert into _r values ('83 · R 103 debajo de la mayor C (105): corte 102, máximo 105', r->'cursor'->>'last_factura' = '102'
    and r->'cursor'->>'max_factura_vista' = '105' and r->>'corte_retenido_por_r' = '103', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"104"}', tr || '{"numero_factura":"105"}',
         tr || '{"numero_factura":"103","estado":"R"}'), '[]', null, '{"last_error":null}');
  insert into _r values ('83 · sin last_factura en el lote (campo ausente) y la R sigue: corte 102', r->'cursor'->>'last_factura' = '102'
    and r->'cursor'->>'max_factura_vista' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"103"}', tr || '{"numero_factura":"104"}',
         tr || '{"numero_factura":"105"}'), '[]', null, '{"last_factura":"105"}');
  insert into _r values ('83 · la R cierra y entra como C: el corte vuelve al máximo (105) y 103 queda C',
    r->'cursor'->>'last_factura' = '105' and r->>'corte_retenido_por_r' is null
    and (select estado from pos_ndf_tickets where local = 'prueba-83' and numero_factura = '103') = 'C', r::text);
  r := public.pos_ndf_ingestar('prueba-83', '[]', '[]', null, '{"last_factura":"50"}');
  insert into _r values ('83 · un agente que perdió el estado no rebobina (propone 50, sin R): sigue 105', r->'cursor'->>'last_factura' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', '[]', '[]', null, '{"last_factura":null}');
  insert into _r values ('83 · last_factura null no borra', r->'cursor'->>'last_factura' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', '[]', '[]', null, '{"last_factura":"A12"}');
  insert into _r values ('83 · un número no numérico se ignora', r->'cursor'->>'last_factura' = '105' and r->'cursor'->>'max_factura_vista' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"90","estado":"X"}'), '[]', null, '{}');
  insert into _r values ('83 · una X debajo no retiene', r->'cursor'->>'last_factura' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"106","estado":"R"}'), '[]', null, '{}');
  insert into _r values ('83 · límite: R = máximo + 1 no retiene', r->'cursor'->>'last_factura' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"105","estado":"R"}'), '[]', null, '{}');
  insert into _r values ('83 · límite: R = máximo (factura reabierta) → corte 104', r->'cursor'->>'last_factura' = '104'
    and r->'cursor'->>'max_factura_vista' = '105', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"0","estado":"R"}'), '[]', null, '{}');
  insert into _r values ('83 · límite: R = 0 → corte 0 (nunca negativo)', r->'cursor'->>'last_factura' = '0', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"50","estado":"R"}'), '[]', null, null);
  insert into _r values ('83 · backfill (sin cursor) con una R: no toca el cursor', r->'cursor'->>'last_factura' = '0'
    and r->>'cursor_escrito' = 'false', r::text);
  -- v3: las R que dejaron los casos de arriba (0, 50, 105, 106) siguen GUARDADAS como R y retienen el corte. En el PoS
  -- terminan cerrando o anuladas: se las pasa a C/X con un lote de backfill (sin cursor: no toca el corte).
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"0","estado":"X"}', tr || '{"numero_factura":"50","estado":"X"}',
         tr || '{"numero_factura":"105"}', tr || '{"numero_factura":"106","estado":"X"}'), '[]', null, null);
  insert into _r values ('113 · con R guardadas (0, 50, 105, 106) el corte quedaba retenido; cerradas/anuladas por backfill: el cursor no se toca',
    r->>'cursor_escrito' = 'false' and r->'cursor'->>'last_factura' = '0'
    and not exists (select 1 from pos_ndf_tickets where local = 'prueba-83' and estado = 'R'), r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"000107"}'), '[]', null, '{}');
  insert into _r values ('83 · sin R: corte = máximo, con sus ceros (000107)', r->'cursor'->>'last_factura' = '000107'
    and r->'cursor'->>'max_factura_vista' = '000107', r::text);
  r := public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"A-77"}', tr || '{"numero_factura":"B-1","estado":"R"}'),
         '[]', null, '{"last_factura":"A-77"}');
  insert into _r values ('83 · folios NO numéricos (una C y una R): se guardan, pero ni mueven el máximo ni retienen el corte',
    r->'cursor'->>'last_factura' = '000107' and r->'cursor'->>'max_factura_vista' = '000107' and r->>'tickets' = '2'
    and (select count(*) from pos_ndf_tickets where local = 'prueba-83' and numero_factura in ('A-77','B-1')) = 2, r::text);
  begin
    perform public.pos_ndf_ingestar('prueba-83', jsonb_build_array(tr || '{"numero_factura":"108"}', tr || '{"numero_factura":"108"}'),
              '[]', null, '{"last_factura":"108"}');
    e := 'ok';
  exception when others then e := sqlerrm; end;
  insert into _r values ('83 · error de la RPC (lote rechazado): no mueve el corte (sigue 000107) ni guarda la 108', e <> 'ok'
    and (select last_factura from pos_ndf_cursor where local = 'prueba-83') = '000107'
    and not exists (select 1 from pos_ndf_tickets where local = 'prueba-83' and numero_factura = '108'), e);
  -- ── Grok 113 · 082 v3: lote vacío sin last_factura y R guardadas ─────────────────────────────────────────────────
  -- Punto de partida: máximo 205, R 203 abierta → corte 202.
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"201"}', tr || '{"numero_factura":"204"}',
         tr || '{"numero_factura":"205"}', tr || '{"numero_factura":"203","estado":"R"}'), '[]', null, '{"last_factura":"202","last_error":null}');
  insert into _r values ('113 · partida: R 203 debajo del máximo 205 → corte 202', r->'cursor'->>'last_factura' = '202'
    and r->'cursor'->>'max_factura_vista' = '205' and r->>'corte_retenido_por_r' = '203', r::text);
  -- (a) corte retenido + lote VACÍO con cursor (el aviso de error del PoS del agente 4d3513a: {tickets:[], cursor:{last_error}})
  r := public.pos_ndf_ingestar('prueba-113', '[]', '[]', null, '{"last_error":"PoS: timeout"}');
  insert into _r values ('113 (a) · corte retenido + lote vacío con last_error: NO recalcula (sigue 202 / 205), guarda el error y el latido',
    r->'cursor'->>'last_factura' = '202' and r->'cursor'->>'max_factura_vista' = '205' and r->'cursor'->>'last_error' = 'PoS: timeout'
    and (r->'cursor'->>'last_poll_at')::timestamptz = now() and r->>'cursor_recalculado' = 'false' and r->>'corte_retenido_por_r' is null, r::text);
  r := public.pos_ndf_ingestar('prueba-113', '[]', '[]', null, '{"last_error":null}');
  insert into _r values ('113 (a) · ciclo sin nada (lote vacío, last_error null): sigue 202 y limpia el error',
    r->'cursor'->>'last_factura' = '202' and r->'cursor'->>'last_error' is null and r->>'cursor_recalculado' = 'false', r::text);
  r := public.pos_ndf_ingestar('prueba-113', '[]', '[]', null, '{}');
  insert into _r values ('113 (a) · lote vacío y cursor sin claves: no borra el error ni recalcula',
    r->'cursor'->>'last_factura' = '202' and r->'cursor'->>'max_factura_vista' = '205', r::text);
  -- (b) error_pos + REINICIO con la R cerrada: el saludo (sin cursor) devuelve 202; el ciclo siguiente lee cerradas > 202
  r := public.pos_ndf_ingestar('prueba-113', '[]', '[]', null, '{"last_error":"PoS: apagado"}');
  r := public.pos_ndf_ingestar('prueba-113', '[]', '[]', null, null);
  insert into _r values ('113 (b) · error del PoS y reinicio: el saludo devuelve el corte retenido (202)', r->'cursor'->>'last_factura' = '202'
    and r->>'cursor_escrito' = 'false', r::text);
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"203"}', tr || '{"numero_factura":"204"}',
         tr || '{"numero_factura":"205"}'), '[]', null, '{"last_factura":"205","last_error":null}');
  insert into _r values ('113 (b) · la R cerró mientras el PoS estaba caído: entra como C y el corte vuelve a 205',
    r->'cursor'->>'last_factura' = '205' and r->>'corte_retenido_por_r' is null and r->'cursor'->>'last_error' is null
    and (select estado from pos_ndf_tickets where local = 'prueba-113' and numero_factura = '203') = 'C', r::text);
  -- (c) R que CIERRA entre leerCerradas y leerProvisionales: no viene en ninguna lectura; la guardada retiene
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"207","estado":"R"}', tr || '{"numero_factura":"208"}'),
         '[]', null, '{"last_factura":"206","last_error":null}');
  insert into _r values ('113 (c) · partida: R 207 debajo de 208 → corte 206', r->'cursor'->>'last_factura' = '206', r::text);
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"209"}'), '[]', null, '{"last_factura":"209","last_error":null}');
  insert into _r values ('113 (c) · la 207 cerró entre las dos lecturas (no vino): la R GUARDADA retiene → corte 206, máximo 209',
    r->'cursor'->>'last_factura' = '206' and r->'cursor'->>'max_factura_vista' = '209' and r->>'corte_retenido_por_r' = '207', r::text);
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"207"}', tr || '{"numero_factura":"208"}',
         tr || '{"numero_factura":"209"}'), '[]', null, '{"last_error":null}');
  insert into _r values ('113 (c) · el ciclo siguiente lee cerradas > 206: 207 entra como C y el corte vuelve a 209',
    r->'cursor'->>'last_factura' = '209' and (select estado from pos_ndf_tickets where local = 'prueba-113' and numero_factura = '207') = 'C', r::text);
  -- ventana: una R guardada de hace 40 h ya no retiene (fuera de la ventana del agente)
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tv || '{"numero_factura":"150","estado":"R"}'), '[]', null, null);
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"210"}'), '[]', null, '{"last_error":null}');
  insert into _r values ('113 · una R guardada de hace 40 h (fuera de las 36 h) no retiene: corte 210', r->'cursor'->>'last_factura' = '210', r::text);
  -- una R guardada de OTRO local no retiene este
  r := public.pos_ndf_ingestar('prueba-082', jsonb_build_array(tr || '{"numero_factura":"100","estado":"R"}'), '[]', null, null);
  r := public.pos_ndf_ingestar('prueba-113', jsonb_build_array(tr || '{"numero_factura":"211"}'), '[]', null, '{"last_error":null}');
  insert into _r values ('113 · una R guardada de otro local no retiene: corte 211', r->'cursor'->>'last_factura' = '211', r::text);
  -- primera vez de un local: lote vacío con last_error crea la fila sin corte (no inventa uno)
  r := public.pos_ndf_ingestar('prueba-113b', '[]', '[]', null, '{"last_error":"PoS: sin red"}');
  insert into _r values ('113 · local nuevo + lote vacío con error: fila con el error y sin corte',
    r->'cursor'->>'last_factura' is null and r->'cursor'->>'last_error' = 'PoS: sin red', r::text);
  begin perform public.pos_ndf_ingestar('Local Raro!', '[]', '[]', null, null); e := 'ok'; exception when others then e := sqlerrm; end;
  insert into _r values ('local inválido → rechaza', e = 'local no válido', e);
  reset role;
  insert into _r values ('solo service_role ejecuta', not has_function_privilege('anon', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'), '');
end $$;
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', left(detalle, 160))) from _r;
rollback;
