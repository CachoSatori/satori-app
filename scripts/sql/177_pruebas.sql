-- 177_pruebas · SOLO BASE LOCAL (Postgres 16 armada con scripts/sql/local_armar_base.sh; nunca staging ni prod: la
-- batería vuelve a poner los tipos VIEJOS del repo adentro de su transacción y crea un trigger de evento).
-- Todo pasa dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   psql -X -d <base> -v ON_ERROR_STOP=1 -v migracion=supabase/migrations/177_esquema_centimos_como_prod.sql \
--        -f scripts/sql/177_pruebas.sql
--   (o scripts/sql/177_pruebas.sh, que además corre las mutaciones)
--
-- Casos:
--  00 las 39 columnas de la lista existen (si no, NO PROBADO: no da verde)
--  01 con los tipos viejos del repo, la base difiere de prod en exactamente esas 39 (el detector muerde)
--  02 después de la 177, TODA columna numérica de public que está en la base tiene el tipo de prod (lectura del 15-nov)
--  03 la primera corrida hizo exactamente 39 ALTER TABLE (los cuenta un trigger de evento ddl_command_end)
--  04 la segunda corrida no falla y hace 0 ALTER TABLE (idempotente; así se comporta en una base como PROD)
--  05 la segunda corrida no reescribe ninguna tabla (relfilenode igual antes y después)
--  06 el detector de ALTER funciona: un ALTER de control sí queda registrado
--  07 nunca redondea en silencio: con un valor 1.0005 en una columna sin escala, la 177 aborta con «177: …»
--  08 las únicas columnas numéricas de prod que faltan en la base son las 5 conocidas (fuera del alcance de la 177)
\set ON_ERROR_STOP 1
\set m177 `cat :migracion`
begin;
select set_config('t177.sql', :'m177', true) is not null as migracion_cargada;
create temp table _r177 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _ddl177 (n serial, tag text, obj text) on commit drop;

-- tipos de PROD (yiczgdti…, information_schema/pg_attribute, solo lectura, 15-nov-2026 23:38 -06:00): tabla.col|relkind|tipo
create temp table _prod177 on commit drop as
select split_part(x, '|', 1) as col, split_part(x, '|', 3) as tipo
  from unnest(string_to_array(
  'accounting_entries.amount_crc|r|numeric(12,2);accounting_entries.fx_rate|r|numeric;' ||
  'accounting_entries.month|r|integer;accounting_entries.year|r|integer;bitacora_permisos.id|r|bigint;' ||
  'cash_cierres_dia.diferencia_crc|r|numeric(12,2);cash_cierres_dia.ef_real_m_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.ef_real_n_crc|r|numeric(12,2);cash_cierres_dia.otros_m_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.otros_n_crc|r|numeric(12,2);cash_cierres_dia.primer_conteo_crc|r|numeric;' ||
  'cash_cierres_dia.primer_conteo_usd|r|numeric;cash_cierres_dia.propinas_m_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.propinas_n_crc|r|numeric(12,2);cash_cierres_dia.remanente_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.remanente_usd|r|numeric(8,2);cash_cierres_dia.sep_diaria_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.sep_diaria_usd|r|numeric(8,2);cash_cierres_dia.sep_registradora_crc|r|numeric(12,2);' ||
  'cash_cierres_dia.sep_registradora_usd|r|numeric(8,2);cash_cierres_dia.tipo_cambio|r|numeric(8,2);' ||
  'cash_cierres_dia.vm_crc|r|numeric(12,2);cash_cierres_dia.vm_usd|r|numeric(8,2);' ||
  'cash_cierres_dia.vn_crc|r|numeric(12,2);cash_cierres_dia.vn_usd|r|numeric(8,2);' ||
  'cash_movements.amount_crc|r|numeric(12,2);cash_movements.amount_usd|r|numeric;' ||
  'cash_movements.exchange_rate|r|numeric(10,2);cash_movements.suggested_confidence|r|numeric;' ||
  'cash_sessions.final_bank_crc|r|numeric(12,2);cash_sessions.final_cash_crc|r|numeric;' ||
  'cash_sessions.final_cash_usd|r|numeric;cash_sessions.final_safe_crc|r|numeric(12,2);' ||
  'cash_sessions.final_service_crc|r|numeric(12,2);cash_sessions.final_suppliers_crc|r|numeric(12,2);' ||
  'cash_sessions.initial_cash_crc|r|numeric;cash_sessions.initial_cash_usd|r|numeric;' ||
  'cash_sessions.initial_service_crc|r|numeric(12,2);cash_sessions.initial_suppliers_crc|r|numeric(12,2);' ||
  'club_alertas.id|r|bigint;club_auditoria.id|r|bigint;club_campana_asignaciones.sorteo|r|numeric(10,9);' ||
  'club_campanas.control_pct|r|numeric(5,2);club_canje_intentos.id|r|bigint;club_cargas_papel.filas|r|integer;' ||
  'club_cargas_papel.id|r|bigint;club_cargas_papel.personas|r|integer;club_comparacion_vieja.id|r|bigint;' ||
  'club_comparacion_vieja.personas|r|integer;club_config.alerta_anfitrion_24h_max|r|integer;' ||
  'club_config.alerta_canjes_sin_codigo_max|r|integer;club_config.alerta_mismo_usuario_dias|r|integer;' ||
  'club_config.alerta_mismo_usuario_max|r|integer;club_config.alerta_visitas_sin_factura_max|r|integer;' ||
  'club_config.anfitrion_nuevo_dias|r|integer;club_config.anfitrion_tope_mes_crc|r|numeric;' ||
  'club_config.buscar_tope_minuto|r|integer;club_config.canje_min|r|numeric(4,1);' ||
  'club_config.canje_paso|r|numeric(4,1);club_config.cortesia_costo_pct|r|numeric(5,2);' ||
  'club_config.cortesia_familia|r|integer;club_config.cortesia_subclasificacion|r|integer;' ||
  'club_config.cortesias_por_visita|r|integer;club_config.cupon_dias|r|integer;' ||
  'club_config.cupones_max_dia_referente|r|integer;club_config.cupones_max_minuto_local|r|integer;' ||
  'club_config.max_creditos_por_visita|r|numeric(4,1);club_config.personas_por_credito|r|integer;' ||
  'club_config.pm_pct|r|numeric(5,2);club_config.premio_vence_dias|r|integer;' ||
  'club_config.premios_referente_mes|r|integer;club_config.premios_validador_mes|r|integer;' ||
  'club_config.puente_latencia_min|r|integer;club_config.socio_autoalta_max_dia|r|integer;' ||
  'club_config.socio_autoalta_purga_dias|r|integer;club_config.socio_provisional_dias|r|integer;' ||
  'club_config.socio_visitas_semana_max|r|integer;club_config.socios_por_factura|r|integer;' ||
  'club_config.tarjeta_manual_tope_dia|r|integer;club_config.valor_credito_crc|r|integer;' ||
  'club_config.vencimiento_meses|r|integer;club_config_global.contactos_ofertas_meses|r|integer;' ||
  'club_config_global.primeros90_dias|r|integer;club_config_global.primeros90_vence_dias|r|integer;' ||
  'club_config_global.primeros90_visitas|r|integer;club_config_global.resena_socio_cada|r|integer;' ||
  'club_config_global.resena_socio_espera_dias|r|integer;club_config_global.socio_visitas_por_dia|r|integer;' ||
  'club_config_historial.id|r|bigint;club_cortesias.familia|r|integer;' ||
  'club_cruces_manuales_historial.id|r|bigint;club_cumple_config.dias_antes|r|integer;' ||
  'club_cumple_config.dias_despues|r|integer;club_cumple_config.min_personas|r|integer;' ||
  'club_cumple_envios.anio|r|integer;club_cupones.personas|r|integer;club_descuentos_tipo.pct|r|numeric(5,2);' ||
  'club_excepciones_resueltas.id|r|bigint;club_marcadores_descuento.pct_esperado|r|numeric(5,2);' ||
  'club_miembros_contacto.cumple_dia|r|smallint;club_miembros_contacto.cumple_mes|r|smallint;' ||
  'club_movimientos.creditos|r|numeric(4,1);club_movimientos.personas|r|integer;' ||
  'club_movimientos.personas_por_credito|r|integer;club_movimientos.valor_credito_crc|r|integer;' ||
  'club_pase_cursor.ultimo_id|r|bigint;club_pase_eventos.id|r|bigint;' ||
  'club_personas_pendientes.ganado_mes_crc|r|numeric;club_personas_pendientes.personas|r|integer;' ||
  'club_personas_pendientes.personas_por_credito|r|integer;' ||
  'club_personas_pendientes.valor_credito_crc|r|numeric;club_pm_cargos.monto_crc|r|numeric(12,2);' ||
  'club_pm_cargos.pct|r|numeric(5,2);club_pm_cargos.subtotal_crc|r|numeric(12,2);' ||
  'club_pm_pagos.monto_crc|r|numeric(12,2);club_pos_login_historial.id|r|bigint;' ||
  'club_promociones.cortesias|r|integer;club_promociones.porcentaje|r|numeric(5,2);' ||
  'club_reportes_cerrados.id|r|bigint;club_reportes_cerrados.version|r|integer;' ||
  'club_retos.control_pct|r|integer;club_retos.meta|r|integer;club_retos.vence_dias|r|integer;' ||
  'club_saldos.creditos|v|numeric;club_saldos.personas|v|integer;' ||
  'club_saldos.personas_proximo_credito|v|integer;club_socio_solicitudes.id|r|bigint;' ||
  'club_visitas.monto_neto|r|numeric(12,2);club_visitas.personas|r|integer;' ||
  'club_visitas_socio.porcentaje|r|numeric(5,2);club_web_clave.id|r|bigint;' ||
  'credit_applications.amount_applied|r|numeric(12,2);customer_interactions.amount_crc|r|numeric;' ||
  'customer_interactions.points_earned|r|integer;customer_interactions.points_spent|r|integer;' ||
  'customers.points|r|integer;customers.total_spent_crc|r|numeric;customers.total_visits|r|integer;' ||
  'exchange_rates.usd_to_crc|r|numeric(10,2);finance_accounts.sort|r|integer;finance_actuals.amount|r|numeric;' ||
  'finance_actuals.month|r|integer;finance_actuals.year|r|integer;finance_budget.amount|r|numeric;' ||
  'finance_budget.month|r|integer;finance_budget.year|r|integer;ingredient_prices.precio_unitario|r|numeric;' ||
  'ingredients.cost_per_unit|r|numeric(12,2);ingredients.current_stock|r|numeric(12,3);' ||
  'ingredients.min_stock|r|numeric(12,3);inventory_movements.qty_delta|r|numeric(12,3);' ||
  'inventory_movements.unit_cost|r|numeric(12,2);inventory_review_task.amount_crc|r|numeric(12,2);' ||
  'inventory_review_task.fx_rate|r|numeric;inventory_review_task.suggested_confidence|r|numeric;' ||
  'loyalty_config.id|r|integer;loyalty_rewards.points_cost|r|integer;pos_ndf_open.items_valor|r|smallint;' ||
  'pos_ndf_open.monto_estimado_crc|r|numeric(14,2);pos_ndf_open.pax|r|integer;' ||
  'pos_ndf_open.pax_pedido|r|smallint;pos_ndf_ticket_lines.cantidad|r|numeric;' ||
  'pos_ndf_ticket_lines.familia|r|integer;pos_ndf_ticket_lines.monto|r|numeric;' ||
  'pos_ndf_ticket_lines.precio|r|numeric;pos_ndf_tickets.cheque_crc|r|numeric;' ||
  'pos_ndf_tickets.cxc_crc|r|numeric;pos_ndf_tickets.deposito_crc|r|numeric;' ||
  'pos_ndf_tickets.descuento_crc|r|numeric;pos_ndf_tickets.dolares_efectivo|r|numeric;' ||
  'pos_ndf_tickets.dolares_tarjeta|r|numeric;pos_ndf_tickets.efectivo_crc|r|numeric;' ||
  'pos_ndf_tickets.electronico_crc|r|numeric;pos_ndf_tickets.iva_crc|r|numeric;pos_ndf_tickets.pax|r|integer;' ||
  'pos_ndf_tickets.pax_articulo|r|integer;pos_ndf_tickets.pax_nativo|r|integer;' ||
  'pos_ndf_tickets.regalia_crc|r|numeric;pos_ndf_tickets.servicio_crc|r|numeric;' ||
  'pos_ndf_tickets.tarjeta_crc|r|numeric;pos_ndf_tickets.total_crc|r|numeric;' ||
  'pos_ndf_tickets.valor_servido_crc|r|numeric;pos_ndf_tickets.vuelto_crc|r|numeric;' ||
  'product_map.costo_unitario|r|numeric;product_map.multiplicador|r|integer;' ||
  'recipe_ingredients.quantity|r|numeric(12,4);recipe_ingredients.waste_factor|r|numeric(5,4);' ||
  'recipes.yield_qty|r|numeric(10,3);role_tip_points.points|r|numeric(4,1);sops.display_order|r|integer;' ||
  'supplier_credits.amount_crc|r|numeric(12,2);supplier_credits.amount_usd|r|numeric(12,2);' ||
  'supplier_item_map.factor_conversion|r|numeric;tip_entries.hours_worked|r|numeric(4,2);' ||
  'tip_entries.payout_crc|r|numeric(12,2);tip_entries.points|r|numeric(10,4);' ||
  'tip_entries.tip_amount_crc|r|numeric(12,2);tip_entries.tip_amount_usd|r|numeric(10,2);' ||
  'tip_sessions.exchange_rate|r|numeric(10,2);tip_sessions.pool_barra_crc|r|numeric(12,2);' ||
  'tip_sessions.pool_barra_electronico_crc|r|numeric;tip_sessions.pool_efectivo_crc|r|numeric(12,2);' ||
  'tip_sessions.pool_efectivo_usd|r|numeric(10,2);tip_sessions.pool_total_crc|r|numeric;'
  , ';')) x where x <> '';

-- lo que declaraba el repo antes de la 177 (para simular una base vieja)
create temp table _viejo177 (tabla text, col text, tipo text) on commit drop;
insert into _viejo177 values
 ('cash_movements','amount_crc','numeric(12,0)'),('cash_sessions','initial_service_crc','numeric(12,0)'),
 ('cash_sessions','initial_suppliers_crc','numeric(12,0)'),('cash_sessions','final_service_crc','numeric(12,0)'),
 ('cash_sessions','final_suppliers_crc','numeric(12,0)'),('cash_sessions','final_safe_crc','numeric(12,0)'),
 ('cash_sessions','final_bank_crc','numeric(12,0)'),('tip_entries','tip_amount_crc','numeric(12,0)'),
 ('tip_entries','payout_crc','numeric(12,0)'),('tip_entries','tip_amount_usd','numeric(8,2)'),
 ('tip_entries','points','numeric(8,2)'),('tip_entries','hours_worked','numeric(4,1)'),
 ('role_tip_points','points','integer'),
 ('cash_cierres_dia','vm_crc','numeric'),('cash_cierres_dia','vm_usd','numeric'),('cash_cierres_dia','propinas_m_crc','numeric'),
 ('cash_cierres_dia','otros_m_crc','numeric'),('cash_cierres_dia','ef_real_m_crc','numeric'),('cash_cierres_dia','vn_crc','numeric'),
 ('cash_cierres_dia','vn_usd','numeric'),('cash_cierres_dia','propinas_n_crc','numeric'),('cash_cierres_dia','otros_n_crc','numeric'),
 ('cash_cierres_dia','ef_real_n_crc','numeric'),('cash_cierres_dia','sep_diaria_crc','numeric'),
 ('cash_cierres_dia','sep_diaria_usd','numeric'),('cash_cierres_dia','sep_registradora_crc','numeric'),
 ('cash_cierres_dia','sep_registradora_usd','numeric'),('cash_cierres_dia','remanente_crc','numeric'),
 ('cash_cierres_dia','remanente_usd','numeric'),('cash_cierres_dia','diferencia_crc','numeric'),
 ('cash_cierres_dia','tipo_cambio','numeric'),('ingredients','cost_per_unit','numeric'),('ingredients','current_stock','numeric'),
 ('ingredients','min_stock','numeric'),('inventory_movements','qty_delta','numeric'),('inventory_movements','unit_cost','numeric'),
 ('recipes','yield_qty','numeric'),('recipe_ingredients','quantity','numeric'),('recipe_ingredients','waste_factor','numeric');

create temp view _base177 as
select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','v','m','p') and a.attnum > 0 and not a.attisdropped
   and a.atttypid in ('numeric'::regtype,'int4'::regtype,'int8'::regtype,'int2'::regtype,'float4'::regtype,'float8'::regtype);

create temp view _dif177 as
select p.col, b.tipo as base, p.tipo as prod from _prod177 p join _base177 b using (col) where b.tipo <> p.tipo;

-- 00
insert into _r177 (caso, ok, detalle)
select '00 las 39 columnas existen', count(*) = 39, count(*) || ' de 39'
  from _viejo177 v join _base177 b on b.col = v.tabla || '.' || v.col;

-- base «como el repo antes de la 177»: tipos viejos (tablas vacías en la base local)
do $$ declare r record; begin
  for r in select * from _viejo177 loop
    execute format('alter table public.%I alter column %I type %s using %I::%s', r.tabla, r.col, r.tipo, r.col, r.tipo);
  end loop; end $$;

-- 01
insert into _r177 (caso, ok, detalle)
select '01 antes: 39 diferencias con prod', count(*) = 39 and count(*) filter (where (split_part(col,'.',1), split_part(col,'.',2)) in (select tabla, col from _viejo177)) = 39,
       count(*) || ' diferencias' from _dif177;

-- trigger de evento: cuenta cada ALTER TABLE que se ejecuta de verdad
create function public._t177_ddl() returns event_trigger language plpgsql as $$
declare r record; begin
  for r in select * from pg_event_trigger_ddl_commands() loop
    insert into _ddl177 (tag, obj) values (r.command_tag, r.object_identity);
  end loop; end $$;
create event trigger _t177 on ddl_command_end execute function public._t177_ddl();

-- 1.ª corrida de la 177 (el archivo exacto)
do $$ begin execute current_setting('t177.sql'); end $$;

-- 02
insert into _r177 (caso, ok, detalle)
select '02 después: tipos = prod', count(*) = 0, coalesce(string_agg(col || ' ' || base || '≠' || prod, ', '), 'sin diferencias') from _dif177;
-- 03
insert into _r177 (caso, ok, detalle)
select '03 1.ª corrida: 39 ALTER', count(*) = 39, count(*) || ' ALTER TABLE' from _ddl177 where tag = 'ALTER TABLE';

-- 2.ª corrida: como en una base que ya tiene los tipos de prod (PROD)
create temp table _rf177 on commit drop as
select oid::regclass::text as t, relfilenode from pg_class where oid in (select distinct ('public.' || quote_ident(tabla))::regclass from _viejo177);
truncate _ddl177;
do $$ begin execute current_setting('t177.sql'); end $$;

-- 04
insert into _r177 (caso, ok, detalle)
select '04 2.ª corrida: no falla y 0 ALTER', count(*) = 0, count(*) || ' ALTER TABLE' from _ddl177 where tag = 'ALTER TABLE';
-- 05
insert into _r177 (caso, ok, detalle)
select '05 2.ª corrida: sin reescritura', count(*) = 9 and bool_and(c.relfilenode = r.relfilenode),
       count(*) filter (where c.relfilenode <> r.relfilenode) || ' tablas reescritas de ' || count(*)
  from _rf177 r join pg_class c on c.oid = r.t::regclass;

-- 06 control del detector
truncate _ddl177;
alter table public.recipes alter column yield_qty type numeric(10,3);
insert into _r177 (caso, ok, detalle)
select '06 el detector de ALTER muerde', count(*) = 1, count(*) || ' ALTER TABLE registrados' from _ddl177 where tag = 'ALTER TABLE';
drop event trigger _t177;

-- 07 nunca redondea: columna sin escala con un valor de cuatro decimales (yield_qty es (10,3) en prod)
alter table public.recipes alter column yield_qty type numeric;
insert into public.recipes (yield_qty) values (1.0005);
do $$ declare v_ok boolean := false; v_msg text; begin
  begin
    execute current_setting('t177.sql');
  exception when others then
    v_msg := sqlerrm; v_ok := v_msg like '177: public.recipes.yield_qty tiene 1 valores que se redondearían%';
  end;
  insert into _r177 (caso, ok, detalle) values ('07 no redondea en silencio: aborta', v_ok, coalesce(v_msg, 'no abortó'));
end $$;
-- y no cambió nada (el bloque se deshizo entero)
insert into _r177 (caso, ok, detalle)
select '07b tras abortar, la columna sigue sin escala', format_type(atttypid, atttypmod) = 'numeric', format_type(atttypid, atttypmod)
  from pg_attribute where attrelid = 'public.recipes'::regclass and attname = 'yield_qty';

-- 08
insert into _r177 (caso, ok, detalle)
select '08 faltan solo las 5 conocidas',
       coalesce(bool_and(col in ('cash_movements.amount_usd','cash_sessions.initial_cash_crc','cash_sessions.initial_cash_usd',
                                 'cash_sessions.final_cash_crc','cash_sessions.final_cash_usd')), true),
       coalesce(string_agg(col, ', '), 'ninguna')
  from _prod177 p where not exists (select 1 from _base177 b where b.col = p.col);

\pset format aligned
select n, caso, ok, detalle from _r177 order by n;
do $$ declare v text; begin
  select string_agg(caso, ' | ' order by n) into v from _r177 where not ok;
  if (select count(*) from _r177) <> 10 then raise exception '177-FALLAN: se esperaban 10 casos, hay %', (select count(*) from _r177); end if;
  if v is not null then raise exception '177-FALLAN: %', v; end if;
  raise notice '177-OK: 10/10';
end $$;
rollback;
