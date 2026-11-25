-- clasificacion.sql · FRAGMENTO (no se corre solo: lo arma scripts/staging-anonimizar/correr.py). SOLO STAGING.
-- Clase de CADA columna de texto, varchar, text[] y JSON de las tablas de `public` (SPEC-anonimizar-staging §1 y §2
-- «a futuro»). anonimizar.sql actúa por clase y verificar.sql FALLA si en la base aparece una columna que no está acá.
-- Inventario tomado del catálogo de staging el 20-nov (470 columnas, 117 tablas; ninguna fila leída).
--
-- Clases (qué hace anonimizar.sql):
--   mantener        no se toca (códigos, estados, catálogo, productos, configuración, logins del PoS, SOP).
--   alias_empleado · alias_proveedor · alias_socio · alias_cliente
--                   «Empleado NN» … desde un mapa armado con la UNIÓN de todas las columnas de ese tipo (D2).
--   correo          anon-<hash>@staging-satori.test (la misma dirección da el mismo correo en toda la base).
--   correo_auth     el correo de auth.users del mismo usuario (ya saneado).
--   telefono        uno del bloque ficticio +506 8000 00NN (lista blanca de src/privacidadRepo.test.ts).
--   nota            «Nota de prueba» (vacío y null quedan igual).
--   descripcion_fact «Nota de prueba» + el sufijo «· fact AAAA-MM-DD» (regla 11); las descripciones que arma el
--                   sistema sin texto libre (ventas del cierre, retiro, apertura del pozo, propinas por turno, ajuste
--                   de cierre sin su motivo) se conservan: el cierre las busca por texto (071/074, cash.ts).
--   nulo            null ('' si la columna es NOT NULL): banco, IBAN, cédula del receptor, contacto, comprobantes.
--   seudonimo       'S' + 16 hex de un hash con sal al azar que se descarta (mismo valor → mismo seudónimo).
--   token           nuevo al azar con el MISMO formato (hex, alfabeto del Club, largo): respeta check y unique.
--   clave_fe        clave FE de 50 dígitos: posiciones 10–21 (cédula del emisor) → 999999999999 (D7).
--   json            lista blanca de claves (D4): las claves que no están en la política se borran; ver anonimizar.sql.
--                   Si la columna tiene un perfil en _anon_json_perfil (abajo), la lista es SOLO la de su perfil.
--   json_mantener   JSON sin datos de personas (productos, beneficios, refs del PoS, configuración).
--   adjuntos        arreglo JSON de rutas de Storage → la imagen ficticia (D3).
--   ruta_storage    ruta de Storage → la imagen ficticia (D3).
--   vaciar_tabla    la tabla entera se vacía con TRUNCATE (no DROP: no agrega drift).
--   especial        lo resuelve un paso propio de anonimizar.sql (nombrado en el comentario de la fila).
drop table if exists _anon_clases;
create temp table _anon_clases (tabla text, columna text, clase text not null, primary key (tabla, columna)) on commit drop;
insert into _anon_clases (tabla, columna, clase)
select v.tabla, btrim(c), v.clase
  from (values
  -- caja
  ('accounting_entries', 'account_id,currency,source_type,kind,status', 'mantener'),
  ('accounting_entries', 'note', 'nota'),
  ('bitacora_permisos', 'campo,antes,despues,origen', 'mantener'),                 -- §1: se mantiene (roles y activo)
  ('cash_cierres_dia', 'tipo,ajuste_tipo,location_id', 'mantener'),
  ('cash_cierres_dia', 'manager', 'alias_empleado'),
  ('cash_cierres_dia', 'ajuste_motivo,notas', 'nota'),                             -- «Resumen del día» y motivo
  ('cash_movements', 'movement_type,status,account_id,caja_origen,method,shift,subcategory,classification,suggested_classification,location_id', 'mantener'),
  ('cash_movements', 'description', 'descripcion_fact'),
  ('cash_movements', 'employee_name', 'alias_empleado'),
  ('cash_movements', 'supplier_name', 'alias_proveedor'),
  ('cash_movements', 'attachments', 'adjuntos'),
  ('cash_movements_pre_migracion_2026_07', 'movement_type,description,status,account_id,caja_origen,employee_name,method,shift,subcategory,supplier_name,attachments,classification,suggested_classification', 'vaciar_tabla'),
  ('cash_sessions', 'status,shift_type,location_id', 'mantener'),
  ('cash_sessions', 'notes', 'nota'),
  ('cash_sessions', 'cajero_name', 'alias_empleado'),
  ('credit_applications', 'currency', 'mantener'),
  ('exchange_rates', 'source', 'mantener'),
  ('supplier_credits', 'origin,currency', 'mantener'),
  ('supplier_credits', 'motivo,referencia', 'nota'),
  ('tip_entries', 'covered_role', 'mantener'),
  ('tip_sessions', 'status,shift_type,location_id', 'mantener'),
  ('tip_sessions', 'notes', 'nota'),
  ('movement_deletions', 'note', 'nota'),
  ('movement_deletions', 'movement_snapshot,inventory_snapshot,credit_applications_snapshot', 'json'),
  ('movement_edits', 'before,after,changed', 'json'),
  -- documentos, proveedores e inventario
  ('documents', 'sha256,tipo,estado', 'mantener'),
  ('documents', 'image_path', 'ruta_storage'),
  ('documents', 'clave_fe', 'clave_fe'),
  ('documents', 'raw_json', 'json'),
  ('suppliers', 'category,ciclo_pago,metodo_pago,moneda,notificar_pago', 'mantener'),
  ('suppliers', 'name', 'alias_proveedor'),
  ('suppliers', 'aliases', 'especial'),                                            -- = {su alias} (paso «aliases»)
  ('suppliers', 'contact,cuenta_iban,whatsapp', 'nulo'),
  ('suppliers', 'payment_iban', 'nulo'),                                          -- solo en bases armadas desde la 001
  ('suppliers', 'email', 'correo'),
  ('suppliers_pre_migracion_2026_07', 'name,category,contact,aliases,ciclo_pago,cuenta_iban,metodo_pago,moneda', 'vaciar_tabla'),
  ('supplier_item_map', 'codigo,descripcion_factura,unidad_factura', 'mantener'),
  ('ingredients', 'name,unit,category', 'mantener'),
  ('ingredients', 'supplier', 'alias_proveedor'),
  ('ingredients', 'notes', 'nota'),
  ('ingredient_prices', 'unidad', 'mantener'),
  ('inventory_movements', 'movement_type,unit,reference_id', 'mantener'),
  ('inventory_movements', 'notes', 'nota'),
  ('inventory_movements', 'created_by', 'alias_empleado'),                          -- guarda un id o un nombre: el id queda
  ('inventory_review_task', 'status,classification,suggested_classification,currency', 'mantener'),
  ('inventory_review_task', 'discard_reason', 'nota'),
  ('recipe_ingredients', 'unit', 'mantener'),
  ('recipes', 'product_name,yield_unit', 'mantener'),
  ('recipes', 'notes', 'nota'),
  -- personal, sueldos y marcas (D5: los montos de sueldo los pone el paso «sueldos»)
  ('profiles', 'full_name', 'alias_empleado'),
  ('profiles', 'email', 'correo_auth'),
  ('profile_locations', 'location_id', 'mantener'),
  ('employees', 'biotime_emp_code,pos_login', 'mantener'),                          -- logins del PoS: códigos (la 194)
  ('employees', 'full_name,pos_name', 'alias_empleado'),
  ('employees', 'banco,cuenta_iban_alias,nombre_homebanking', 'nulo'),
  ('employee_bajas', 'pos_login', 'mantener'),
  ('employee_bajas', 'full_name', 'alias_empleado'),
  ('employee_bank_info', 'nombre_homebanking,banco,cuenta_iban_alias', 'vaciar_tabla'),
  ('employee_payments', 'metodo,estado', 'mantener'),
  ('employee_payments', 'referencia,comprobante_url', 'nulo'),
  ('employee_wage_rates', 'tipo', 'mantener'),
  ('employee_wage_rates', 'nota', 'nota'),
  ('payroll_config', 'local', 'mantener'),
  ('salary_lines', 'snapshot', 'nulo'),
  ('salary_periods', 'tipo,estado,local', 'mantener'),
  ('salary_periods', 'reopen_motivo', 'nota'),
  ('time_punches', 'local,emp_code,punch_state,terminal', 'mantener'),
  ('time_punches', 'raw', 'json'),                                                 -- BioTime trae nombre y apellido
  ('punch_exceptions', 'emp_code,local,tipo,estado', 'mantener'),
  ('punch_exceptions', 'detalle', 'json'),
  ('work_days', 'local,source', 'mantener'),
  ('work_days', 'flags', 'json_mantener'),
  ('seguridad_cambio_clave', 'huella_hash', 'token'),
  -- clientes
  ('customers', 'channel_origin,tier', 'mantener'),
  ('customers', 'phone', 'telefono'),
  ('customers', 'name', 'alias_cliente'),
  ('customers', 'email', 'correo'),
  ('customers', 'wallet_pass_id', 'nulo'),
  ('customers', 'notes', 'nota'),
  ('customer_interactions', 'type,channel,reference_id', 'mantener'),
  ('customer_interactions', 'notes', 'nota'),
  ('fe_documentos', 'tipo,estado,consecutivo,provider,provider_ref', 'mantener'),
  ('fe_documentos', 'receptor_nombre', 'alias_cliente'),
  ('fe_documentos', 'receptor_id', 'nulo'),                                          -- cédula del receptor
  ('fe_documentos', 'receptor_email', 'correo'),
  ('fe_documentos', 'clave', 'clave_fe'),
  ('fe_documentos', 'error_msg', 'nota'),
  ('loyalty_config', 'rules', 'json_mantener'),
  ('loyalty_rewards', 'name,description,category', 'mantener'),
  -- Club Satori
  ('club_alertas', 'location_id,tipo,canal', 'mantener'),
  ('club_alertas', 'detalle', 'json'),
  ('club_alertas', 'revisada_nota', 'nota'),
  ('club_auditoria', 'rol,accion,tabla', 'mantener'),
  ('club_auditoria', 'antes,despues', 'json'),
  ('club_avisos_privacidad', 'version,sha256_es,sha256_en', 'mantener'),
  ('club_campana_asignaciones', 'grupo', 'mantener'),
  ('club_campanas', 'location_id,nombre,fuente,semilla', 'mantener'),
  ('club_campanas', 'cierre_motivo', 'nota'),
  ('club_canje_intentos', 'motivo', 'mantener'),
  ('club_cargas_papel', 'location_id,lote_sha256,fecha_movimiento', 'mantener'),
  ('club_codigos_canje', 'location_id', 'mantener'),
  ('club_codigos_canje', 'codigo_hash', 'token'),
  ('club_comparacion_vieja', 'location_id', 'mantener'),
  ('club_config', 'location_id,promo_articulo_codigo,aviso_privacidad_version,lc_articulo_codigo,articulos_cero_permitidos,lc_invitado_codigo,nombre,direccion,mapa_url,pos_logins_caja,resena_url,reserva_url', 'mantener'),
  ('club_config_global', 'club_url', 'mantener'),
  ('club_config_historial', 'location_id,campo,valor_anterior,valor_nuevo', 'mantener'),
  ('club_cortesias', 'location_id,codigo_producto,nombre', 'mantener'),
  ('club_cruces_manuales', 'location_id,numero_factura', 'mantener'),
  ('club_cruces_manuales', 'nota', 'nota'),
  ('club_cruces_manuales_historial', 'location_id,numero_factura', 'mantener'),
  ('club_cruces_manuales_historial', 'nota', 'nota'),
  ('club_cumple_config', 'location_id,beneficio,reserva_url', 'mantener'),
  ('club_cumple_envios', 'location_id', 'mantener'),
  ('club_cumple_usos', 'location_id,visita_clave,cortesia_codigo', 'mantener'),
  ('club_cumple_usos', 'deshecho_nota', 'nota'),
  ('club_cupones', 'location_id,estado,factura_pos', 'mantener'),
  ('club_cupones', 'codigo', 'token'),
  ('club_cupones', 'pos_ref', 'json_mantener'),                                      -- club_pos_ref: local, factura, mesa, total
  ('club_cupones_contactos', 'aviso_version', 'mantener'),
  ('club_cupones_contactos', 'nombre', 'alias_cliente'),
  ('club_cupones_contactos', 'whatsapp', 'telefono'),
  ('club_cupones_contactos', 'email', 'correo'),
  ('club_cupones_contactos', 'baja_token', 'token'),
  ('club_descuentos_tipo', 'location_id,nombre', 'mantener'),
  ('club_entorno', 'nombre', 'mantener'),
  ('club_excepciones_resueltas', 'location_id,tipo,ref', 'mantener'),
  ('club_excepciones_resueltas', 'nota', 'nota'),
  ('club_excepciones_resueltas', 'actor_pos', 'json_mantener'),                      -- logins del PoS e ids
  ('club_marcadores_descuento', 'location_id,codigo_producto,nombre', 'mantener'),
  ('club_miembro_roles', 'rol,estado,alta_por,aviso_version,baja_por', 'mantener'),
  ('club_miembros', 'location_id,tipo,estado,origen', 'mantener'),
  ('club_miembros', 'nombre', 'alias_socio'),
  ('club_miembros', 'codigo,token_portal,codigo_socio,token_pase', 'token'),
  ('club_miembros', 'legacy_id', 'seudonimo'),
  ('club_miembros_contacto', 'location_id', 'mantener'),
  ('club_miembros_contacto', 'telefono', 'telefono'),
  ('club_miembros_contacto', 'email', 'correo'),
  ('club_movimientos', 'location_id,tipo,factura_pos,origen,visita_clave', 'mantener'),
  ('club_movimientos', 'legacy_ids', 'seudonimo'),
  ('club_movimientos', 'nota', 'nota'),
  ('club_movimientos', 'pos_ref', 'json_mantener'),
  ('club_negocios', 'location_id,tipo,origen', 'mantener'),
  ('club_negocios', 'nombre', 'alias_cliente'),
  ('club_pase_cursor', 'nombre', 'mantener'),
  ('club_pase_eventos', 'motivo', 'mantener'),
  ('club_pases', 'plataforma,object_id', 'vaciar_tabla'),                             -- apunta a pases reales de Wallet
  ('club_personas_pendientes', 'location_id,factura_pos,visita_clave,estado', 'mantener'),
  ('club_personas_pendientes', 'pos_ref', 'json_mantener'),
  ('club_personas_pendientes', 'nota', 'nota'),
  ('club_pm_cargos', 'location_id,factura_pos,estado,origen', 'mantener'),
  ('club_pm_cargos', 'legacy_ids', 'seudonimo'),
  ('club_pm_pagos', 'location_id,origen', 'mantener'),
  ('club_pm_pagos', 'nota', 'nota'),
  ('club_pm_pagos', 'legacy_ids', 'seudonimo'),
  ('club_pos_login_historial', 'pos_login_antes,pos_login_despues,rol', 'mantener'),
  ('club_premios', 'location_id,estado', 'mantener'),
  ('club_premios', 'motivo', 'nota'),
  ('club_primeros90', 'estado,location_id', 'mantener'),
  ('club_primeros90', 'cortesia', 'json_mantener'),
  ('club_promociones', 'location_id,nombre,nombre_en,para,estado', 'mantener'),
  ('club_reportes_cerrados', 'location_id', 'mantener'),
  ('club_reportes_cerrados', 'datos', 'json'),
  ('club_reportes_cerrados', 'sha256,sha256_prev', 'especial'),                       -- paso «cadena»: se recalcula
  ('club_reportes_cerrados', 'motivo', 'nota'),
  ('club_resena_socio', 'location_id', 'mantener'),
  ('club_retos', 'nombre,nombre_en,locales,estado', 'mantener'),
  ('club_retos', 'cortesias', 'json_mantener'),
  ('club_retos_ganados', 'estado,location_id', 'mantener'),
  ('club_retos_ganados', 'cortesia', 'json_mantener'),
  ('club_socio_solicitudes', 'location_id,aviso_version', 'mantener'),
  ('club_visitas', 'location_id,factura_pos,origen', 'mantener'),
  ('club_visitas', 'platos', 'json_mantener'),
  ('club_visitas_socio', 'location_id,visita_clave,estado_beneficio', 'mantener'),
  ('club_visitas_socio', 'pos_ref,cortesias,aplicar', 'json_mantener'),
  ('club_web_clave', 'sha256', 'token'),
  -- PoS, ventas y carta
  ('pos_checks', 'kind', 'mantener'),
  ('pos_checks', 'label', 'nota'),                                                   -- el salonero puede escribir un nombre
  ('pos_checks', 'items_snapshot', 'json_mantener'),
  ('pos_kds_settings', 'location_id', 'mantener'),
  ('pos_kds_settings', 'category_order,course_thresholds,subcategory_order', 'json_mantener'),
  ('pos_mesas_internas', 'local,mesa', 'mantener'),
  ('pos_ndf_cursor', 'local,last_factura,max_factura_vista', 'mantener'),
  ('pos_ndf_cursor', 'last_error', 'nota'),
  ('pos_ndf_open', 'local,numero_factura,id_pedido,mesa,salonero_login,canal,pax_alerta,area', 'mantener'),
  ('pos_ndf_open', 'clave', 'clave_fe'),
  ('pos_ndf_open', 'detalle_productos', 'json_mantener'),
  ('pos_ndf_ticket_lines', 'codigo_producto,nombre,usuario_registra', 'mantener'),
  ('pos_ndf_tickets', 'local,numero_factura,estado,tipo,area,canal,mesa,salonero_login,registrado_por,turno,cajero_login,numero_pedido,pax_alerta,total_fuente,clase_ingreso,mesa_factura,consecutivo_fe,area_factura', 'mantener'),
  ('pos_ndf_tickets', 'clave_fe', 'clave_fe'),
  ('pos_order_items', 'product_name,course,kitchen_status,tax_type,station,subcategory', 'mantener'),
  ('pos_order_items', 'modifiers', 'json_mantener'),
  ('pos_order_items', 'void_reason,note', 'nota'),
  ('pos_orders', 'location_id,table_name,status,channel', 'mantener'),
  ('pos_orders', 'salonero_name', 'alias_empleado'),
  ('pos_orders', 'notes', 'nota'),
  ('pos_orders', 'transfers,merge_trace', 'json'),
  ('pos_payments', 'method,currency,tip_currency', 'mantener'),
  ('pos_payments', 'note', 'nota'),
  ('pos_prices', 'product_name,location_id,tax_type', 'mantener'),
  ('product_map', 'nombre,tipo,clasificacion,subclasificacion,station,allergens,photo_url,ciiu,cabys', 'mantener'),
  ('product_modifier_groups', 'product_name', 'mantener'),
  ('product_modifier_options', 'product_name', 'mantener'),
  ('menu_categories', 'category,family_id,subfamily', 'mantener'),
  ('menu_families', 'id,label,icon', 'mantener'),
  ('modifier_groups', 'name,location_id', 'mantener'),
  ('modifiers', 'name', 'mantener'),
  ('salon_tables', 'location_id,name,shape,kind', 'mantener'),
  ('ventas_comps', 'data', 'json'),
  ('ventas_dias', 'file_name,data', 'vaciar_tabla'),                                -- D4
  ('ventas_hist', 'source', 'mantener'),
  ('ventas_hist', 'data', 'json'),                                                   -- D4: solo los totales del día (perfil abajo)
  ('ventas_metas', 'key', 'mantener'),
  ('ventas_metas', 'value', 'json_mantener'),
  -- finanzas, locales y SOP
  ('finance_accounts', 'id,code,name,parent_id,section', 'mantener'),
  ('finance_actuals', 'account_id,source', 'mantener'),
  ('finance_actuals', 'note', 'nota'),
  ('finance_budget', 'account_id', 'mantener'),
  ('locations', 'id,name', 'mantener'),
  ('sops', 'title,category,content,code,area,doc_type,version,pdf_path', 'mantener')  -- D6
  ) v(tabla, cols, clase),
  unnest(string_to_array(v.cols, ',')) c;

-- Claves de JSON que NO son nombres de columna (o que piden otro trato que su columna). Ganan sobre lo que sale de las
-- columnas. Una clave que no está acá ni es nombre de columna de public se BORRA del JSON (lista blanca, D4).
drop table if exists _anon_json_extra;
create temp table _anon_json_extra (clave text primary key, trato text not null) on commit drop;
insert into _anon_json_extra (clave, trato)
select btrim(c), v.trato
  from (values
  -- movement_edits.changed = { campo: {old, new} }
  ('old,new', 'mantener'),
  -- documents.raw_json (DocExtract de src/shared/api/documents.ts)
  ('proveedor,aliases', 'alias'),
  ('proveedor_cedula', 'nulo'),
  ('concepto,error', 'nota'),
  ('numero_documento,fecha,moneda,condicion_pago,plazo_dias,metodo_pago,subtotal,descuento,impuesto_1pct,impuesto_13pct,impuesto_total,total,items,descripcion,cantidad,unidad,precio_unitario,iva_pct,cuenta_qb_sugerida,confianza,requiere_revision,fecha_leida,fecha_origen,aviso_fecha,fecha_opciones', 'mantener'),
  -- time_punches.raw (BioTime): sin first_name, last_name, department, position ni gps (no están: se borran)
  ('emp,punch_time,punch_state_display,verify_type,verify_type_display,work_code,terminal_sn,terminal_alias,area_alias,upload_time', 'mantener'),
  -- club_alertas.detalle y actor del PoS (club_excepciones, club_pos_ref)
  ('local,local_nombre,multilocal,umbral,pos_logins,logins_fijos,registradores,mapeo,login,en,modo,pedido,visto,abierto_en,hora,hora_factura,visita', 'mantener')
  ) v(claves, trato),
  unnest(string_to_array(v.claves, ',')) c;

-- Perfiles JSON por columna: la lista blanca de esa columna es EXACTAMENTE esta (no se suma la general).
-- ventas_hist.data = HistDay de src/shared/types/ventas.ts (totales del día; lo lee getVentasHist en shared/api/ventas.ts).
drop table if exists _anon_json_perfil;
create temp table _anon_json_perfil (tabla text, columna text, clave text, trato text not null,
                                     primary key (tabla, columna, clave)) on commit drop;
insert into _anon_json_perfil (tabla, columna, clave, trato)
select 'ventas_hist', 'data', btrim(c), 'mantener'
  from unnest(string_to_array('ventaBruta,ventaNeta,iva,serv,salon,delivery,pax,promPax,source', ',')) c;
