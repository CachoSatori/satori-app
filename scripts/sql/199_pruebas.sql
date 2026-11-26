-- 199_pruebas · compras F1 (tablas fe_*, bucket fe-xml, funciones de la Edge y la pantalla de control). Transacción que
-- termina en ROLLBACK: no deja nada. Usa LOCALES FICTICIOS ('prueba-199', 'prueba-199b'), cédulas con patrón obvio
-- (3101999999NN receptor, 999000000001 emisor, imposible de verdad), usuarios y montos inventados.
-- Corre en STAGING (antes de aplicar, R15) o en un Postgres vacío con scripts/sql/193_base_local.sql (y
-- scripts/sql/199_preludio_local.sql, que pone `--local`). Se arma y se corre con scripts/sql/199_pruebas.py
-- (--armar [--local] [--compacto] | --psql "<conexión>" [--local] [--mutar todas | X]). Nunca contra PROD.
-- MARCADORES: «-- @@preludio@@» → 199_preludio_local.sql (solo con --local) · «-- @@199@@» → cuerpo de
-- supabase/migrations/199_fe_ingesta.sql (con --mutar, roto a propósito) · «-- @@199_rollback@@» → 199_rollback.sql.
begin;
create temp table _r199 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r199 to public;
grant usage on sequence _r199_n_seq to public;
-- @@preludio@@

create temp table _c199 on commit drop as
select '00000000-0000-4000-8199-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8199-0000000000a1'::uuid as manager,      -- manager de prueba-199
       '00000000-0000-4000-8199-0000000000a2'::uuid as manager_otro, -- manager de prueba-199b
       '00000000-0000-4000-8199-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8199-0000000000e2'::uuid as cajero;
grant select on _c199 to public;
create temp table _a199 (k text primary key, v text) on commit drop;
grant all on _a199 to public;
insert into public.locations (id, name, is_active) values ('prueba-199', 'Local de prueba 199', false), ('prueba-199b', 'Local de prueba 199b', false)
on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 199"}'::jsonb
  from _c199 c, unnest(array[c.owner_id, c.manager, c.manager_otro, c.contador, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c199 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'contador'), (5, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.contador, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, 'prueba-199' from _c199;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'prueba-199b' from _c199;

-- @@199@@

-- ── utilidades (después de la migración: usan sus tablas) ─────────────────────────────────────────────────────────
-- clave ficticia de 50: 506 · 301126 · emisor 310100000001 · consecutivo (n) · situación 1 · seguridad 00000001
create function pg_temp.clave(n integer) returns text language sql immutable as
$$ select '506' || '301126' || '310100000001' || lpad(n::text, 20, '0') || '1' || '00000001' $$;
create function pg_temp.pl(n integer, receptor text, estado text default 'ok', sha text default repeat('a', 64),
                           tipo text default 'factura', ref text default null, motivos jsonb default '[]'::jsonb,
                           total text default '10000.00000')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'fuente', 'prueba-199', 'lote', 'lote-prueba-199', 'estado', estado, 'motivos', motivos,
    'xml_path', '2026/11/' || pg_temp.clave(n) || '.xml', 'xml_sha256', sha,
    'comprobante', jsonb_build_object(
      'clave', pg_temp.clave(n), 'tipo', tipo, 'version', '4.4', 'consecutivo', lpad(n::text, 20, '0'),
      'fecha_emision', '2026-11-30T09:15:00-06:00', 'emisor_cedula', '310100000001', 'emisor_nombre', 'Proveedor de prueba 1',
      'receptor_cedula', receptor, 'moneda', 'CRC', 'tipo_cambio', '1.00000', 'condicion_venta', '02',
      'total_venta_neta', '9000.00000', 'total_impuesto', '650.00000', 'total_comprobante', total,
      'ref_clave', ref, 'ref_codigo', case when ref is not null then '01' end),
    'lineas', jsonb_build_array(
      jsonb_build_object('numero_linea', 1, 'cabys', '1234567890123', 'codigo_comercial', 'ABC-24', 'detalle', 'Producto A',
                         'cantidad', '3.000', 'unidad', 'Unid', 'precio_unitario', '1000.00000', 'impuesto_monto', '650.00000',
                         'total_linea', '5650.00000'),
      jsonb_build_object('numero_linea', 2, 'detalle', 'Producto B', 'cantidad', '1', 'total_linea', '4350.00000')))
$$;
-- corre una sentencia y devuelve 'ok' o el SQLSTATE (para casos que TIENEN que fallar)
create function pg_temp.intentar(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
grant execute on all functions in schema pg_temp to public;

-- ═══ A. Estructura y permisos de tabla ═════════════════════════════════════════════════════════════════════════════
insert into _r199 (caso, ok, detalle)
select '01 las seis tablas fe_* tienen RLS', count(*) filter (where c.relrowsecurity) = 6, count(*)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('fe_receptores', 'fe_comprobantes', 'fe_lineas', 'fe_respuestas', 'fe_ingesta_bitacora', 'fe_ingesta_latido');
insert into _r199 (caso, ok, detalle)
select '02 authenticated y anon no escriben comprobantes, líneas, respuestas, bitácora ni latido',
       not bool_or(has_table_privilege(r, t, p)), null
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.fe_comprobantes', 'public.fe_lineas', 'public.fe_respuestas', 'public.fe_ingesta_bitacora', 'public.fe_ingesta_latido']) t,
     unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p;
insert into _r199 (caso, ok, detalle)
select '03 solo service_role ejecuta las funciones de la Edge; anon no ejecuta el resumen',
       bool_and(has_function_privilege('service_role', f, 'EXECUTE')) and not bool_or(has_function_privilege('authenticated', f, 'EXECUTE'))
       and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
       and not has_function_privilege('anon', 'public.fe_ingesta_resumen(integer)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.fe_ingesta_resumen(integer)', 'EXECUTE'), null
from unnest(array['public.fe_ingestar(jsonb)', 'public.fe_respuesta_registrar(jsonb)',
                  'public.fe_bitacora_anotar(text,text,text,text,text)', 'public.fe_latido(text)']) f;
insert into _r199 (caso, ok, detalle)
select '04 el bucket fe-xml existe y es privado', exists (select 1 from storage.buckets where id = 'fe-xml' and public is false), null;
insert into _r199 (caso, ok, detalle)
select '05 anon no lee ninguna tabla fe_*', not bool_or(has_table_privilege('anon', t, 'SELECT')), null
from unnest(array['public.fe_receptores', 'public.fe_comprobantes', 'public.fe_lineas', 'public.fe_respuestas', 'public.fe_ingesta_bitacora', 'public.fe_ingesta_latido']) t;

-- receptores: A → prueba-199 · B → prueba-199b · C inactivo (como postgres: la carga del owner se prueba en E)
insert into public.fe_receptores (cedula, location_id, activo) values
  ('310199999901', 'prueba-199', true), ('310199999902', 'prueba-199b', true), ('310199999903', 'prueba-199', false);

-- ═══ B. Ingesta: idempotencia, local por cédula, revisar, nota de crédito, dato roto ═══════════════════════════════
insert into _a199 select 'b10', public.fe_ingestar(pg_temp.pl(1, '310199999901'))::text;
insert into _r199 (caso, ok, detalle)
select '10 factura nueva: «nuevo», una fila con local por cédula, sus 2 líneas y la bitácora',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b10') = 'nuevo'
       and (select count(*) from public.fe_comprobantes where clave = pg_temp.clave(1) and location_id = 'prueba-199' and estado_parseo = 'ok' and motivo is null) = 1
       and (select count(*) from public.fe_lineas l join public.fe_comprobantes c on c.id = l.comprobante_id where c.clave = pg_temp.clave(1)) = 2
       and (select count(*) from public.fe_ingesta_bitacora where clave = pg_temp.clave(1) and resultado = 'nuevo' and location_id = 'prueba-199') = 1,
       (select v from _a199 where k = 'b10');
insert into _a199 select 'b11', public.fe_ingestar(pg_temp.pl(1, '310199999901'))::text;
insert into _r199 (caso, ok, detalle)
select '11 el mismo XML otra vez: «duplicado», sigue una fila y dos líneas, bitácora «duplicado» sin motivo',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b11') = 'duplicado'
       and (select count(*) from public.fe_comprobantes where clave = pg_temp.clave(1)) = 1
       and (select count(*) from public.fe_lineas l join public.fe_comprobantes c on c.id = l.comprobante_id where c.clave = pg_temp.clave(1)) = 2
       and (select count(*) from public.fe_ingesta_bitacora where clave = pg_temp.clave(1) and resultado = 'duplicado' and motivo is null) = 1,
       (select v from _a199 where k = 'b11');
select public.fe_ingestar(pg_temp.pl(1, '310199999901')) from generate_series(1, 8);
insert into _r199 (caso, ok, detalle)
select '12 diez envíos del mismo XML dejan UNA fila', (select count(*) from public.fe_comprobantes where clave = pg_temp.clave(1)) = 1, null;
insert into _a199 select 'b13', public.fe_ingestar(pg_temp.pl(1, '310199999901', sha => repeat('b', 64), total => '1.00000'))::text;
insert into _r199 (caso, ok, detalle)
select '13 misma clave con otro XML: «duplicado» con aviso, queda el primero intacto',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b13') = 'duplicado'
       and (select xml_sha256 = repeat('a', 64) and total_comprobante = 10000 from public.fe_comprobantes where clave = pg_temp.clave(1))
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(1) and resultado = 'duplicado' and motivo like 'misma clave con otro XML%'), null;
insert into _a199 select 'b14', public.fe_ingestar(pg_temp.pl(2, '310199999999'))::text;
insert into _r199 (caso, ok, detalle)
select '14 cédula del receptor desconocida: «receptor_distinto», sin local, motivo, bitácora «revisar»',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b14') = 'revisar'
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(2) and location_id is null
                   and estado_parseo = 'receptor_distinto' and motivo like 'cédula del receptor no configurada%')
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(2) and resultado = 'revisar' and location_id is null), null;
insert into _a199 select 'b15', public.fe_ingestar(pg_temp.pl(3, '310199999903'))::text;
insert into _r199 (caso, ok, detalle)
select '15 receptor configurado pero INACTIVO: «receptor_distinto»',
       exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(3) and location_id is null and estado_parseo = 'receptor_distinto'), null;
insert into _a199 select 'b16', public.fe_ingestar(pg_temp.pl(4, null))::text;
insert into _r199 (caso, ok, detalle)
select '16 sin cédula del receptor (tiquete): «receptor_distinto» con su motivo',
       exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(4) and location_id is null and motivo like 'sin cédula del receptor%'), null;
insert into _a199 select 'b17', public.fe_ingestar(pg_temp.pl(5, '310199999902'))::text;
insert into _r199 (caso, ok, detalle)
select '17 la cédula decide el local: receptor B → prueba-199b',
       (select v::jsonb ->> 'location_id' from _a199 where k = 'b17') = 'prueba-199b'
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(5) and location_id = 'prueba-199b'), null;
insert into _a199 select 'b18', public.fe_ingestar(pg_temp.pl(6, '310199999901', estado => 'revisar',
                                motivos => '["la suma de las líneas no calza con el total", "moneda no prevista (JPY)"]'))::text;
insert into _r199 (caso, ok, detalle)
select '18 lo dudoso entra a «revisar» con sus motivos, con local y con líneas (no se descarta)',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b18') = 'revisar'
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(6) and estado_parseo = 'revisar' and location_id = 'prueba-199'
                   and motivo = 'la suma de las líneas no calza con el total · moneda no prevista (JPY)')
       and (select count(*) from public.fe_lineas l join public.fe_comprobantes c on c.id = l.comprobante_id where c.clave = pg_temp.clave(6)) = 2, null;
insert into _a199 select 'b19', public.fe_ingestar(pg_temp.pl(7, '310199999901', tipo => 'nota_credito', ref => pg_temp.clave(1), total => '-10000.00000'))::text;
insert into _r199 (caso, ok, detalle)
select '19 nota de crédito: tipo nota_credito con la clave de la factura que corrige; la factura no cambia',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'b19') = 'nuevo'
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(7) and tipo = 'nota_credito' and ref_clave = pg_temp.clave(1) and ref_codigo = '01')
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(1) and tipo = 'factura' and total_comprobante = 10000), null;
insert into _a199 select 'b20', pg_temp.intentar($q$select public.fe_ingestar(jsonb_set(pg_temp.pl(8, '310199999901'), '{lineas,0,cantidad}', '"tres"'))$q$);
insert into _r199 (caso, ok, detalle)
select '20 un dato roto hace caer TODO el comprobante (22P02): ni cabecera, ni líneas, ni bitácora',
       (select v from _a199 where k = 'b20') = '22P02'
       and not exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(8))
       and not exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(8)), (select v from _a199 where k = 'b20');
insert into _a199 select 'b21', pg_temp.intentar($q$select public.fe_ingestar(pg_temp.pl(9, '310199999901', estado => 'receptor_distinto'))$q$);
insert into _r199 (caso, ok, detalle)
select '21 la Edge no puede mandar un estado fuera de ok / revisar (22023)', (select v from _a199 where k = 'b21') = '22023', (select v from _a199 where k = 'b21');
insert into _a199 select 'b22', pg_temp.intentar($q$select public.fe_ingestar(jsonb_set(pg_temp.pl(10, '310199999901'), '{comprobante,clave}', '"506123"'))$q$);
insert into _r199 (caso, ok, detalle)
select '22 una clave que no tiene 50 caracteres no entra (23514)', (select v from _a199 where k = 'b22') = '23514', (select v from _a199 where k = 'b22');

-- ═══ C. Respuestas de Hacienda ═════════════════════════════════════════════════════════════════════════════════════
insert into _a199 select 'c30', public.fe_respuesta_registrar(jsonb_build_object('fuente', 'prueba-199', 'lote', 'lote-prueba-199',
  'respuesta', jsonb_build_object('clave', pg_temp.clave(20), 'mensaje', 'rechazado', 'detalle', 'prueba', 'receptor_cedula', '310199999901')))::text;
insert into _r199 (caso, ok, detalle)
select '30 la respuesta puede llegar antes que la factura: se guarda por clave, con local por la cédula',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'c30') = 'nuevo'
       and exists (select 1 from public.fe_respuestas where clave = pg_temp.clave(20) and mensaje = 'rechazado')
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(20) and location_id = 'prueba-199' and motivo = 'respuesta de Hacienda: rechazado'), null;
insert into _a199 select 'c31', public.fe_respuesta_registrar(jsonb_build_object('fuente', 'prueba-199', 'lote', 'lote-prueba-199',
  'respuesta', jsonb_build_object('clave', pg_temp.clave(20), 'mensaje', 'aceptado')))::text;
insert into _r199 (caso, ok, detalle)
select '31 respuesta repetida: «duplicado» y queda la primera',
       (select v::jsonb ->> 'resultado' from _a199 where k = 'c31') = 'duplicado'
       and (select mensaje from public.fe_respuestas where clave = pg_temp.clave(20)) = 'rechazado', null;

-- ═══ D. Bitácora suelta y latido ═══════════════════════════════════════════════════════════════════════════════════
select public.fe_bitacora_anotar('prueba-199', 'lote-prueba-199', 'error', null, 'XML ilegible: prueba');
select public.fe_bitacora_anotar('prueba-199', 'lote-prueba-199', 'sin_xml', null, null);
select public.fe_bitacora_anotar('prueba-199', 'lote-prueba-199', 'nuevo', pg_temp.clave(99), 'no tiene que entrar');
insert into _r199 (caso, ok, detalle)
select '40 fe_bitacora_anotar guarda error y sin_xml, y NO acepta «nuevo» (eso solo lo escribe fe_ingestar)',
       exists (select 1 from public.fe_ingesta_bitacora where resultado = 'error' and motivo = 'XML ilegible: prueba')
       and exists (select 1 from public.fe_ingesta_bitacora where resultado = 'sin_xml' and fuente = 'prueba-199')
       and not exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(99)), null;
select public.fe_latido('prueba-199'); select public.fe_latido('prueba-199');
insert into _r199 (caso, ok, detalle)
select '41 el latido es una fila por cuenta', (select count(*) from public.fe_ingesta_latido where fuente = 'prueba-199') = 1, null;

-- ═══ E. Lectura por rol (JWT real del rol, regla 4) ═════════════════════════════════════════════════════════════════
create function pg_temp.ver(u uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute q into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
grant execute on function pg_temp.ver(uuid, text) to public;
-- ids de TODOS los comprobantes de prueba, leídos sin RLS: la prueba de líneas no puede depender de la política de cabecera
create temp table _ids199 on commit drop as select id from public.fe_comprobantes where fuente = 'prueba-199';
grant select on _ids199 to public;
-- claves de prueba: 1, 6, 7 → prueba-199 · 5 → prueba-199b · 2, 3, 4 → sin local
create temp table _v199 on commit drop as
select k, pg_temp.ver(u, q) as v
from _c199 c, lateral (values
  ('own_c',  c.owner_id,     $$select count(*) from public.fe_comprobantes where clave like '506301126310100000001%' and fuente = 'prueba-199'$$),
  ('cont_c', c.contador,     $$select count(*) from public.fe_comprobantes where fuente = 'prueba-199'$$),
  ('mgr_c',  c.manager,      $$select string_agg(right(clave, 11), ',' order by clave) from public.fe_comprobantes where fuente = 'prueba-199'$$),
  ('mgr2_c', c.manager_otro, $$select string_agg(right(clave, 11), ',' order by clave) from public.fe_comprobantes where fuente = 'prueba-199'$$),
  ('mgr_l',  c.manager,      $$select count(*) from public.fe_lineas l where l.comprobante_id in (select id from _ids199)$$),
  ('caj_c',  c.cajero,       $$select count(*) from public.fe_comprobantes$$),
  ('caj_l',  c.cajero,       $$select count(*) from public.fe_lineas$$),
  ('mgr_b',  c.manager,      $$select count(*) from public.fe_ingesta_bitacora$$),
  ('mgr_lt', c.manager,      $$select count(*) from public.fe_ingesta_latido$$),
  ('mgr_rc', c.manager,      $$select count(*) from public.fe_receptores$$),
  ('cont_b', c.contador,     $$select count(*) from public.fe_ingesta_bitacora where fuente = 'prueba-199'$$),
  ('mgr_rs', c.manager,      $$select count(*) from public.fe_respuestas$$),
  ('own_rs', c.owner_id,     $$select count(*) from public.fe_respuestas where fuente = 'prueba-199'$$),
  ('res_own', c.owner_id,    $$select public.fe_ingesta_resumen(14)::text$$),
  ('res_cont', c.contador,   $$select (public.fe_ingesta_resumen(14) ? 'dias')::text$$),
  ('res_mgr', c.manager,     $$select public.fe_ingesta_resumen(14)::text$$),
  ('res_caj', c.cajero,      $$select public.fe_ingesta_resumen(14)::text$$),
  ('ins_c',  c.owner_id,     $$insert into public.fe_comprobantes (clave, tipo, moneda, xml_path, xml_sha256, estado_parseo, fuente, location_id) values (repeat('7', 50), 'factura', 'CRC', 'x', repeat('c', 64), 'ok', 'x', 'prueba-199') returning 'entró'$$),
  ('rec_own', c.owner_id,    $$insert into public.fe_receptores (cedula, location_id) values ('310199999904', 'prueba-199') returning (actualizado_por = auth.uid())::text$$),
  ('rec_own_falso', c.owner_id, $$insert into public.fe_receptores (cedula, location_id, actualizado_por) values ('310199999905', 'prueba-199', gen_random_uuid()) returning 'entró'$$),
  ('rec_cont', c.contador,   $$insert into public.fe_receptores (cedula, location_id) values ('310199999906', 'prueba-199') returning 'entró'$$),
  ('rec_mgr', c.manager,     $$update public.fe_receptores set activo = false where cedula = '310199999901' returning 'cambió'$$),
  ('rec_del', c.owner_id,    $$delete from public.fe_receptores where cedula = '310199999901' returning 'borró'$$)
) as x(k, u, q);
create function pg_temp.v(k text) returns text language sql as $$ select v from _v199 where _v199.k = $1 $$;
insert into _r199 (caso, ok, detalle) select '50 owner ve los 7 comprobantes de prueba (con y sin local)', pg_temp.v('own_c') = '7', pg_temp.v('own_c');
insert into _r199 (caso, ok, detalle) select '51 contador ve los 7', pg_temp.v('cont_c') = '7', pg_temp.v('cont_c');
insert into _r199 (caso, ok, detalle)
select '52 manager ve SOLO los de su local (1, 6, 7): ni el de otro local ni los sin local',
       pg_temp.v('mgr_c') = concat_ws(',', right(pg_temp.clave(1), 11), right(pg_temp.clave(6), 11), right(pg_temp.clave(7), 11)), pg_temp.v('mgr_c');
insert into _r199 (caso, ok, detalle)
select '53 el manager del otro local ve solo el suyo (5)', pg_temp.v('mgr2_c') = right(pg_temp.clave(5), 11), pg_temp.v('mgr2_c');
insert into _r199 (caso, ok, detalle) select '54 manager ve las líneas solo de su local (3 × 2)', pg_temp.v('mgr_l') = '6', pg_temp.v('mgr_l');
insert into _r199 (caso, ok, detalle) select '55 cajero no ve comprobantes ni líneas', pg_temp.v('caj_c') = '0' and pg_temp.v('caj_l') = '0', pg_temp.v('caj_c') || '/' || pg_temp.v('caj_l');
insert into _r199 (caso, ok, detalle)
select '56 manager no ve bitácora, latido ni receptores; contador sí ve la bitácora',
       pg_temp.v('mgr_b') = '0' and pg_temp.v('mgr_lt') = '0' and pg_temp.v('mgr_rc') = '0' and pg_temp.v('cont_b')::int >= 10,
       concat_ws('/', pg_temp.v('mgr_b'), pg_temp.v('mgr_lt'), pg_temp.v('mgr_rc'), pg_temp.v('cont_b'));
insert into _r199 (caso, ok, detalle)
select '57 respuestas: owner las ve; el manager no ve la de una clave sin comprobante de su local',
       pg_temp.v('own_rs') = '1' and pg_temp.v('mgr_rs') = '0', pg_temp.v('own_rs') || '/' || pg_temp.v('mgr_rs');
insert into _r199 (caso, ok, detalle)
select '58 resumen: owner y contador sí; manager y cajero 42501',
       pg_temp.v('res_own') like '{%' and pg_temp.v('res_cont') = 'true' and pg_temp.v('res_mgr') = 'ERR 42501' and pg_temp.v('res_caj') = 'ERR 42501',
       concat_ws(' / ', left(pg_temp.v('res_own'), 40), pg_temp.v('res_cont'), pg_temp.v('res_mgr'), pg_temp.v('res_caj'));
insert into _r199 (caso, ok, detalle)
select '59 resumen de hoy: la bitácora de prueba cuenta 7 nuevo/revisar, duplicados, 1 error y 1 sin_xml; latido y errores presentes',
       (select (d -> 1)::int >= 3 and (d -> 2)::int >= 10 and (d -> 3)::int >= 4 and (d -> 5)::int >= 1 and (d -> 6)::int >= 1
          from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'dias') d
         where d ->> 0 = (now() at time zone 'America/Costa_Rica')::date::text)
       and exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'latidos') l where l ->> 0 = 'prueba-199')
       and exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'errores') e where e ->> 2 = 'XML ilegible: prueba')
       and exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'revisar') r where r ->> 0 = 'receptor_distinto'),
       left(pg_temp.v('res_own'), 280);
insert into _r199 (caso, ok, detalle)
select '60 nadie inserta un comprobante por la API, ni el owner (42501)', pg_temp.v('ins_c') = 'ERR 42501', pg_temp.v('ins_c');
insert into _r199 (caso, ok, detalle)
select '61 el owner carga un receptor y queda sellado con su usuario; no puede falsear quién (42501)',
       pg_temp.v('rec_own') = 'true' and pg_temp.v('rec_own_falso') = 'ERR 42501', pg_temp.v('rec_own') || '/' || pg_temp.v('rec_own_falso');
insert into _r199 (caso, ok, detalle)
select '62 contador no carga receptores (42501) y el manager no los cambia',
       pg_temp.v('rec_cont') = 'ERR 42501' and pg_temp.v('rec_mgr') is distinct from 'cambió'
       and (select activo from public.fe_receptores where cedula = '310199999901'), pg_temp.v('rec_cont') || '/' || coalesce(pg_temp.v('rec_mgr'), 'null');
insert into _r199 (caso, ok, detalle)
select '63 nadie borra un receptor (se desactiva)', pg_temp.v('rec_del') = 'ERR 42501', pg_temp.v('rec_del');

-- ═══ F. Vuelta atrás ═══════════════════════════════════════════════════════════════════════════════════════════════
-- @@199_rollback@@
insert into _r199 (caso, ok, detalle)
-- El bucket `fe-xml` NO lo borra el .sql (Storage frena el delete directo, 42501): es el paso aparte por la API de
-- Storage (PASE-199 §6). Acá se mira que el .sql no lo tocó: el bucket sigue y su fila no cambió.
select '90 después de 199_rollback.sql no queda ninguna tabla ni función fe_*, y el bucket queda para la API de Storage',
       to_regclass('public.fe_comprobantes') is null and to_regclass('public.fe_lineas') is null and to_regclass('public.fe_receptores') is null
       and to_regclass('public.fe_respuestas') is null and to_regclass('public.fe_ingesta_bitacora') is null and to_regclass('public.fe_ingesta_latido') is null
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fe\_%')
       and exists (select 1 from storage.buckets where id = 'fe-xml' and public is false), null;

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r199 order by n;
select json_build_object(
  'ok', (select count(*) from _r199 where ok), 'fallas', (select count(*) from _r199 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r199 where ok is not true)) as resultado;
rollback;
