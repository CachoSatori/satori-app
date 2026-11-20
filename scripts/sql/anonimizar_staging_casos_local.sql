-- anonimizar_staging_casos_local.sql · Casos que SOLO corren con --local (sobre anonimizar_staging_semilla_local.sql,
-- datos inventados): miran que cada dato sembrado salió como dice la spec. Los inserta la batería en «-- @@LOCAL@@».
select set_config('anon.casos_locales', '16', true);

-- L01 · el mismo nombre (con otra mayúscula, tildes iguales o espacios) queda con el mismo alias en todas las columnas
insert into _rA (caso, ok, detalle)
select 'L01 alias: un nombre, el mismo «Empleado NN» en empleados, perfil, caja, cierre, PoS y Club no',
       e.full_name ~ '^Empleado [0-9]{2,}$' and e.full_name = p.full_name and e.full_name = e.pos_name
   and e.full_name = (select cajero_name from public.cash_sessions where id = '00000000-0000-4000-8a00-0000000000b1')
   and e.full_name = (select manager from public.cash_cierres_dia where session_date = '2026-11-01' and location_id = 'santa-teresa')
   and e.full_name = (select salonero_name from public.pos_orders limit 1)
   and (select nombre from public.club_miembros where id = '00000000-0000-4000-8a00-0000000000a7') ~ '^Socio [0-9]{2,}$',
       format('%s / %s / %s', e.full_name, p.full_name, e.pos_name)
  from public.employees e join public.profiles p on p.id = e.profile_id where e.id = '00000000-0000-4000-8a00-0000000000e1';

insert into _rA (caso, ok, detalle)
select 'L02 alias: «andrés inventado vargas  » en caja = el empleado; la baja y el de prueba',
       (select employee_name from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c4')
         = (select full_name from public.employees where id = '00000000-0000-4000-8a00-0000000000e2')
   and (select full_name from public.employee_bajas limit 1) ~ '^Empleado [0-9]{2,}$'
   and (select full_name from public.employees where id = '00000000-0000-4000-8a00-0000000000e3') = 'Prueba Cajero'
   and (select full_name from public.profiles where id = '00000000-0000-4000-8a00-000000000001') = 'Prueba Owner',
       null;

-- L03 · proveedor: nombre, alias del proveedor, caja, ingredientes y Bandeja → el mismo «Proveedor NN»; contacto fuera
insert into _rA (caso, ok, detalle)
select 'L03 proveedor: un alias en todas lados, aliases = {alias}, IBAN y contacto en null, correo .test',
       s.name ~ '^Proveedor [0-9]{2,}$' and s.aliases = array[s.name]
   and s.name = (select supplier_name from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c1')
   and s.name = (select supplier from public.ingredients where name = 'Arroz de la semilla anon')
   and s.cuenta_iban is null and s.contact is null and s.whatsapp is null and pg_temp.anon_correo_ok(s.email)
   and (select raw_json->>'proveedor' from public.documents where id = '00000000-0000-4000-8a00-0000000000d1') ~ '^Proveedor [0-9]{2,}$',
       format('%s · %s', s.name, s.aliases)
  from public.suppliers s where s.id = '00000000-0000-4000-8a00-0000000000f1';

-- L04 · descripciones de caja (regla 11 y patrones del sistema)
insert into _rA (caso, ok, detalle)
select 'L04 caja: descripciones, notas y adjuntos',
       (select description from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c1') = 'Nota de prueba · fact 2026-11-02'
   and (select description from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c2') = 'Ventas efectivo Noche 2026-11-01'
   and (select description from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c3') = 'Ajuste de cierre 2026-11-01 · Faltante · Nota de prueba'
   and (select description from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c4') = 'Propinas turno 2026-11-01 Noche'
   and (select attachments from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c1') = '["anon/ficticia.png"]'::jsonb
   and (select notes from public.cash_sessions where id = '00000000-0000-4000-8a00-0000000000b1') = 'Nota de prueba'
   and (select notas from public.cash_cierres_dia where session_date = '2026-11-01') = 'Nota de prueba'
   and (select amount_crc from public.cash_movements where id = '00000000-0000-4000-8a00-0000000000c1') = 15000,
       null;

-- L05 · BioTime: sin nombre ni apellido ni departamento; código y hora quedan
insert into _rA (caso, ok, detalle)
select 'L05 marcas: raw sin first_name/last_name/department, con emp_code y punch_time',
       not (raw ? 'first_name') and not (raw ? 'last_name') and not (raw ? 'department')
   and raw->>'emp_code' = '101' and raw->>'punch_time' = '2026-11-01 08:00:00', raw::text
  from public.time_punches where emp_code = '101' and terminal = 'T1';

-- L06 · Club: llaves nuevas con su forma, seudónimo del legacy, teléfonos del bloque, cumpleaños día/mes
insert into _rA (caso, ok, detalle)
select 'L06 Club: llaves nuevas con su forma, legacy seudónimo, teléfono ficticio, cumpleaños día/mes',
       m.codigo ~ '^[A-HJ-NP-Z2-9]{8}$' and m.codigo <> 'ABCDEFGH' and m.token_portal ~ '^[0-9a-f]{64}$'
   and m.token_portal <> repeat('a1', 32) and m.token_pase ~ '^[0-9a-f]{64}$' and m.codigo_socio ~ '^[A-HJ-NP-Z2-9]{9}$'
   and m.legacy_id ~ '^S[0-9a-f]{16}$' and c.telefono ~ '^\+506800000[0-9]{2}$' and pg_temp.anon_correo_ok(c.email)
   and c.cumple_dia = 15 and c.cumple_mes = 3
   and (select telefono from public.club_miembros_contacto where miembro_id = '00000000-0000-4000-8a00-0000000000a8') ~ '^\+506800000[0-9]{2}$'
   and (select legacy_id from public.club_miembros where id = '00000000-0000-4000-8a00-0000000000a8') ~ '^S[0-9a-f]{16}$',
       format('%s %s %s', m.codigo, m.legacy_id, c.telefono)
  from public.club_miembros m join public.club_miembros_contacto c on c.miembro_id = m.id
 where m.id = '00000000-0000-4000-8a00-0000000000a7';

-- L07 · clientes: teléfono único del bloque, cumpleaños con año 2000, sin pase de Wallet
insert into _rA (caso, ok, detalle)
select 'L07 clientes: teléfonos distintos del bloque, cumpleaños 2000-03-15, alias y nota',
       count(*) = 2 and count(distinct phone) = 2 and bool_and(phone ~ '^\+506800000[0-9]{2}$')
   and bool_and(name ~ '^Cliente [0-9]{2,}$') and bool_and(wallet_pass_id is null)
   and max(birth_date) = date '2000-03-15' and bool_and(notes is null or notes = 'Nota de prueba'),
       string_agg(phone || ' ' || name, ', ')
  from public.customers;

-- L08 · Bandeja: imagen ficticia, clave FE del emisor reemplazada, raw_json sin cédula ni banco
insert into _rA (caso, ok, detalle)
select 'L08 Bandeja: imagen ficticia, clave FE con cédula ficticia, raw_json sin cédula ni banco',
       image_path = 'anon/ficticia.png' and substr(clave_fe, 10, 12) = '999999999999' and length(clave_fe) = 50
   and raw_json->'proveedor_cedula' = 'null'::jsonb and raw_json->'banco' = 'null'::jsonb and raw_json->'referencia' = 'null'::jsonb
   and raw_json->>'concepto' = 'Nota de prueba' and raw_json->>'clave_fe' = clave_fe and (raw_json->>'total')::int = 15000
   and raw_json->'items'->0->>'descripcion' = 'Arroz 1 kg', raw_json::text
  from public.documents where id = '00000000-0000-4000-8a00-0000000000d1';

-- L09 · Auth: el «real» queda .test, sin clave, sin teléfono, con ban y sin sesiones; el de prueba intacto
insert into _rA (caso, ok, detalle)
select 'L09 auth: saneo del clonado sobre el real; el de prueba y su sesión intactos',
       (select email ~ '^prod-[0-9a-f]{12}@staging-satori\.test$' and encrypted_password = '' and phone is null
               and raw_user_meta_data = '{}'::jsonb and banned_until > now() + interval '90 years' and recovery_token = ''
          from auth.users where id = '00000000-0000-4000-8a00-0000000000a1')
   and (select count(*) from auth.sessions where user_id = '00000000-0000-4000-8a00-0000000000a1') = 0
   and (select count(*) from auth.refresh_tokens where user_id = '00000000-0000-4000-8a00-0000000000a1') = 0
   and (select count(*) from auth.mfa_amr_claims) = 0 and (select count(*) from auth.audit_log_entries) = 0
   and (select count(*) from auth.sessions where user_id = '00000000-0000-4000-8a00-000000000001') = 1
   and (select email from auth.users where id = '00000000-0000-4000-8a00-000000000001') = 'prueba-owner@staging-satori.test'
   and (select email from public.profiles where id = '00000000-0000-4000-8a00-0000000000a1')
         = (select email from auth.users where id = '00000000-0000-4000-8a00-0000000000a1')
   and (select provider_id from auth.identities where provider = 'google') = md5('id-de-google-123')
   and (select identity_data ? 'name' from auth.identities where provider = 'google') is false,
       null;

-- L10 · tablas que se vacían y sueldos ficticios (D5)
insert into _rA (caso, ok, detalle)
select 'L10 vaciadas (banco, ventas_dias, pases, pre_migracion) y sueldos ficticios por tipo',
       (select count(*) from public.employee_bank_info) = 0 and (select count(*) from public.ventas_dias) = 0
   and (select count(*) from public.club_pases) = 0 and (select count(*) from public.cash_movements_pre_migracion_2026_07) = 0
   and (select hourly_rate_crc from public.employee_wage_rates where tipo = 'hora') = 2500
   and (select fixed_salary_crc from public.employee_wage_rates where tipo = 'mes') = 500000
   and (select nota from public.employee_wage_rates where tipo = 'hora') = 'Nota de prueba',
       null;

-- L11 · auditoría del Club: el nombre del socio pasa a su alias y las llaves no quedan como estaban
insert into _rA (caso, ok, detalle)
select 'L11 club_auditoria: nombre → alias del socio, teléfono ficticio, llaves nuevas',
       count(*) > 0
   and bool_and(coalesce(despues->>'nombre', 'Socio 00') ~ '^(Socio|Empleado|Cliente|Proveedor) [0-9]{2,}$|^Nota de prueba$')
   and bool_and(jsonb_typeof(despues->'telefono') is distinct from 'string' or despues->>'telefono' ~ '^\+506800000[0-9]{2}$')
   and bool_and(coalesce(despues->>'token_portal', '') not in (repeat('a1', 32), repeat('c3', 32))),
       string_agg(left(despues::text, 120), ' | ')
  from public.club_auditoria where tabla in ('club_miembros', 'club_miembros_contacto');

-- L12 · cadena de cierres del Club recalculada sobre los datos nuevos
insert into _rA (caso, ok, detalle)
select 'L12 cierres del Club: datos sin nombres y cadena de hashes válida',
       count(*) = 2 and bool_and(not (datos::text like '%Carolina%'))
   and bool_and(sha256 = encode(extensions.digest(coalesce(prev, '') || datos::text, 'sha256'), 'hex'))
   and bool_and(sha256_prev is not distinct from prev),
       string_agg(datos::text, ' | ')
  from (select r.*, lag(r.sha256) over (partition by r.location_id order by r.id) prev from public.club_reportes_cerrados r) x;

-- L13 · ventas: la clave FE de los tiquetes mantiene consecutivo y largo; los montos no cambian
insert into _rA (caso, ok, detalle)
select 'L13 tiquetes: cédula ficticia, consecutivo = clave[22..41], totales iguales',
       bool_and(substr(clave_fe, 10, 12) = '999999999999' and substr(clave_fe, 22, 20) = consecutivo_fe and length(clave_fe) = 50)
   and sum(total_crc) = 27700, string_agg(clave_fe, ', ')
  from public.pos_ndf_tickets where numero_factura in ('9001', '9002');

-- L14 · PoS propio: transferencias sin nombres (lista blanca), notas fuera; nada de la semilla queda en el barrido
insert into _rA (caso, ok, detalle)
select 'L14 PoS: transfers sin from/to, notes = nota de prueba',
       transfers = '[{"pax": 2}]'::jsonb and notes = 'Nota de prueba', transfers::text
  from public.pos_orders limit 1;

-- L15 · ventas_hist: quedan exactamente las claves de HistDay (sin saloneros ni nada más)
insert into _rA (caso, ok, detalle)
select 'L15 ventas_hist: solo los totales del día de HistDay',
       (select array_agg(k order by k) from jsonb_object_keys(data) k)
         = array['delivery', 'iva', 'pax', 'promPax', 'salon', 'serv', 'source', 'ventaBruta', 'ventaNeta']
   and (data->>'ventaBruta')::int = 500000, data::text
  from public.ventas_hist where session_date = '2023-05-01';

-- L16 · fuera de public vacío; mesas y productos de catálogo intactos
insert into _rA (caso, ok, detalle)
select 'L16 cron, net y realtime vacíos; mesas y detalle_productos intactos',
       (select count(*) from cron.job_run_details) = 0 and (select count(*) from net.http_request_queue) = 0
   and (select count(*) from realtime.messages) = 0 and (select count(*) from net._http_response) = 0
   and (select mesa from public.pos_ndf_tickets where numero_factura = '9001') = 'M7'
   and (select detalle_productos from public.pos_ndf_open where clave = 'abierta-anon-1') = '[{"nombre": "Producto ficticio uno", "cantidad": 2}]'::jsonb,
       null;
