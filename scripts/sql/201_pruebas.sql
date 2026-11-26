-- 201_pruebas · compras F1, hallazgos 257 y 258 (versiones por sha, respuestas en conflicto, emisor conocido, ruta con
-- sha). Transacción que termina en ROLLBACK: no deja nada. LOCALES FICTICIOS ('prueba-201', 'prueba-201b'), cédulas con
-- patrón obvio (3102019999NN receptor, 310100000001 / 310100000009 emisor), usuarios, sha y montos inventados.
-- Necesita una base CON la 199 y SIN la 201: staging (ledger 199/200) o un Postgres 16 local armado con
-- `HASTA=200 bash scripts/sql/local_armar_base.sh <base>` (+ 201_preludio_local.sql, que pone `--local`).
-- Se arma y se corre con scripts/sql/201_pruebas.py (--armar [--local] [--compacto] | --psql "<conexión>" [--local]
-- [--mutar todas | X]). Nunca contra PROD.
-- MARCADORES: «-- @@preludio@@» · «-- @@201@@» → supabase/migrations/201_fe_versiones_revisar.sql (con --mutar, roto a
-- propósito) · «-- @@201_rollback@@» → scripts/sql/201_rollback.sql.
begin;
create temp table _r201 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r201 to public;
grant usage on sequence _r201_n_seq to public;
-- @@preludio@@

create temp table _c201 on commit drop as
select '00000000-0000-4000-8201-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8201-0000000000a1'::uuid as manager,      -- manager de prueba-201
       '00000000-0000-4000-8201-0000000000a2'::uuid as manager_otro, -- manager de prueba-201b
       '00000000-0000-4000-8201-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8201-0000000000e2'::uuid as cajero;
grant select on _c201 to public;
create temp table _a201 (k text primary key, v text) on commit drop;
grant all on _a201 to public;
insert into public.locations (id, name, is_active) values ('prueba-201', 'Local de prueba 201', false), ('prueba-201b', 'Local de prueba 201b', false)
on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 201"}'::jsonb
  from _c201 c, unnest(array[c.owner_id, c.manager, c.manager_otro, c.contador, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c201 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'contador'), (5, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.contador, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, 'prueba-201' from _c201;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'prueba-201b' from _c201;

-- ── utilidades ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- clave ficticia de 50: 506 · 301126 · emisor 310100000001 · consecutivo (n) · situación 1 · seguridad 00000201
create function pg_temp.clave(n integer) returns text language sql immutable as
$$ select '506' || '301126' || '310100000001' || lpad(n::text, 20, '0') || '1' || '00000201' $$;
create function pg_temp.sha(x text) returns text language sql immutable as $$ select repeat(x, 64) $$;
-- ruta nueva (201): AAAA/MM/<clave>/<sha>.xml · ruta vieja (199): AAAA/MM/<clave>.xml
create function pg_temp.ruta(n integer, sha text) returns text language sql immutable as
$$ select '2026/11/' || pg_temp.clave(n) || '/' || sha || '.xml' $$;
create function pg_temp.pl(n integer, receptor text, sha text, emisor text default '310100000001', estado text default 'ok',
                           ruta text default null, total text default '10000.00000')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'fuente', 'prueba-201', 'lote', 'lote-prueba-201', 'estado', estado, 'motivos', '[]'::jsonb,
    'xml_path', coalesce(ruta, pg_temp.ruta(n, sha)), 'xml_sha256', sha,
    'comprobante', jsonb_build_object(
      'clave', pg_temp.clave(n), 'tipo', 'factura', 'version', '4.4', 'consecutivo', lpad(n::text, 20, '0'),
      'fecha_emision', '2026-11-30T09:15:00-06:00', 'emisor_cedula', emisor, 'emisor_nombre', 'Proveedor de prueba',
      'receptor_cedula', receptor, 'moneda', 'CRC', 'tipo_cambio', '1.00000',
      'total_venta_neta', '9000.00000', 'total_impuesto', '650.00000', 'total_comprobante', total),
    'lineas', jsonb_build_array(
      jsonb_build_object('numero_linea', 1, 'detalle', 'Producto A', 'cantidad', '3', 'total_linea', '5650.00000'),
      jsonb_build_object('numero_linea', 2, 'detalle', 'Producto B', 'cantidad', '1', 'total_linea', '4350.00000')))
$$;
create function pg_temp.rp(n integer, mensaje text, detalle text default 'prueba', receptor text default '310201999901')
returns jsonb language sql immutable as $$
  select jsonb_build_object('fuente', 'prueba-201', 'lote', 'lote-prueba-201',
    'respuesta', jsonb_build_object('clave', pg_temp.clave(n), 'mensaje', mensaje, 'detalle', detalle, 'receptor_cedula', receptor))
$$;
create function pg_temp.intentar(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.est(n integer) returns text language sql as
$$ select estado_parseo || '|' || coalesce(motivo, '') from public.fe_comprobantes where clave = pg_temp.clave(n) $$;
grant execute on all functions in schema pg_temp to public;

-- receptores: A → prueba-201 · B → prueba-201b
insert into public.fe_receptores (cedula, location_id, activo) values ('310201999901', 'prueba-201', true), ('310201999902', 'prueba-201b', true);

-- ── ANTES de la 201: lo que ya dejó la 199 (para el relleno) y la definición de sus funciones (para la vuelta atrás) ──
select public.fe_ingestar(pg_temp.pl(90, '310201999901', pg_temp.sha('9'), ruta => '2026/11/' || pg_temp.clave(90) || '.xml'));
select public.fe_respuesta_registrar(pg_temp.rp(91, 'aceptado'));
create temp table _def201 on commit drop as
select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h,
       (select string_agg(a::text, ',' order by a::text) from unnest(coalesce(p.proacl, '{}')) a) as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fe_ingestar', 'fe_respuesta_registrar', 'fe_ingesta_resumen');

-- @@201@@

-- utilidad que lee una tabla de la 201 (se crea después)
create function pg_temp.nver(n integer) returns bigint language sql as
$$ select count(*) from public.fe_comprobante_versiones v join public.fe_comprobantes c on c.id = v.comprobante_id where c.clave = pg_temp.clave(n) $$;
grant execute on function pg_temp.nver(integer) to public;

-- emisor conocido 1 (activo) y 9 (inactivo); como postgres: la carga del owner se prueba en E
insert into public.fe_emisores_conocidos (cedula, activo) values ('310100000001', true), ('310100000009', false);

-- ═══ A. Estructura, relleno y permisos ════════════════════════════════════════════════════════════════════════════
insert into _r201 (caso, ok, detalle)
select '01 las tres tablas nuevas tienen RLS', count(*) filter (where c.relrowsecurity) = 3, count(*)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('fe_comprobante_versiones', 'fe_respuesta_versiones', 'fe_emisores_conocidos');
insert into _r201 (caso, ok, detalle)
select '02 anon y authenticated no escriben versiones; anon no escribe emisores; nadie escribe fe_respuestas',
       not bool_or(has_table_privilege(r, t, p)), null
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.fe_comprobante_versiones', 'public.fe_respuesta_versiones', 'public.fe_respuestas']) t,
     unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p;
insert into _r201 (caso, ok, detalle)
select '03 solo service_role ejecuta fe_ingestar y fe_respuesta_registrar; fe_motivo_sumar no lo ejecuta nadie de la API',
       bool_and(has_function_privilege('service_role', f, 'EXECUTE')) and not bool_or(has_function_privilege('authenticated', f, 'EXECUTE'))
       and not bool_or(has_function_privilege('anon', f, 'EXECUTE'))
       and not has_function_privilege('anon', 'public.fe_motivo_sumar(text,text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.fe_motivo_sumar(text,text)', 'EXECUTE')
       and not has_table_privilege('anon', 'public.fe_emisores_conocidos', 'INSERT')
       and not has_function_privilege('anon', 'public.fe_ingesta_resumen(integer)', 'EXECUTE'), null
from unnest(array['public.fe_ingestar(jsonb)', 'public.fe_respuesta_registrar(jsonb)']) f;
insert into _r201 (caso, ok, detalle)
select '04 las funciones de la Edge y el resumen son SECURITY DEFINER con search_path fijo',
       bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')), string_agg(p.proname, ',')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fe_ingestar', 'fe_respuesta_registrar', 'fe_ingesta_resumen');
insert into _r201 (caso, ok, detalle)
select '05 relleno: el comprobante y la respuesta de la 199 tienen su versión (ruta vieja) y su huella',
       pg_temp.nver(90) = 1
       and exists (select 1 from public.fe_comprobante_versiones v join public.fe_comprobantes c on c.id = v.comprobante_id
                   where c.clave = pg_temp.clave(90) and v.xml_path = '2026/11/' || pg_temp.clave(90) || '.xml' and v.xml_sha256 = pg_temp.sha('9'))
       and exists (select 1 from public.fe_respuestas where clave = pg_temp.clave(91) and huella ~ '^[0-9a-f]{64}$' and estado = 'ok')
       and (select count(*) from public.fe_respuesta_versiones where clave = pg_temp.clave(91)) = 1, null;

-- ═══ B. Comprobantes: mismo sha = duplicado · otro sha = revisar con las dos versiones (257) ═══════════════════════
insert into _a201 select 'b10', public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('a')))::text;
insert into _r201 (caso, ok, detalle)
select '10 factura nueva de emisor conocido: «nuevo», ok, una versión con la ruta de SU sha',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b10') = 'nuevo' and pg_temp.est(1) = 'ok|'
       and pg_temp.nver(1) = 1
       and exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(1) and xml_path = pg_temp.ruta(1, pg_temp.sha('a'))),
       (select v from _a201 where k = 'b10') || ' ' || pg_temp.est(1);
insert into _a201 select 'b11', public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('a')))::text;
insert into _r201 (caso, ok, detalle)
select '11 mismo sha otra vez: «duplicado», sin versión nueva, sigue ok, bitácora «duplicado» sin motivo',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b11') = 'duplicado' and pg_temp.nver(1) = 1 and pg_temp.est(1) = 'ok|'
       and (select count(*) from public.fe_comprobantes where clave = pg_temp.clave(1)) = 1
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(1) and resultado = 'duplicado' and motivo is null),
       (select v from _a201 where k = 'b11');
insert into _a201 select 'b12', public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('b'), total => '1.00000'))::text;
insert into _r201 (caso, ok, detalle)
select '12 misma clave con OTRO sha: «revisar» con motivo, ambas versiones con su sha y su ruta, el primero intacto',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b12') = 'revisar'
       and (select v::jsonb ->> 'versiones' from _a201 where k = 'b12') = '2'
       and pg_temp.est(1) like 'revisar|misma clave con otro XML%'
       and (select array_agg(v.xml_sha256 || '@' || v.xml_path order by v.xml_sha256)
              from public.fe_comprobante_versiones v join public.fe_comprobantes c on c.id = v.comprobante_id where c.clave = pg_temp.clave(1))
           = array[pg_temp.sha('a') || '@' || pg_temp.ruta(1, pg_temp.sha('a')), pg_temp.sha('b') || '@' || pg_temp.ruta(1, pg_temp.sha('b'))]
       and (select xml_sha256 = pg_temp.sha('a') and total_comprobante = 10000 and location_id = 'prueba-201' from public.fe_comprobantes where clave = pg_temp.clave(1))
       and (select count(*) from public.fe_lineas l join public.fe_comprobantes c on c.id = l.comprobante_id where c.clave = pg_temp.clave(1)) = 2
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(1) and resultado = 'revisar' and motivo like 'misma clave con otro XML%(2 versiones)'),
       (select v from _a201 where k = 'b12') || ' ' || pg_temp.est(1);
insert into _a201 select 'b13', public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('b')))::text;
select public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('c')));
insert into _r201 (caso, ok, detalle)
select '13 la segunda versión repetida es «duplicado»; una tercera suma su versión sin repetir el motivo',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b13') = 'duplicado' and pg_temp.nver(1) = 3
       and (select (length(motivo) - length(replace(motivo, 'misma clave con otro XML', ''))) / length('misma clave con otro XML')
              from public.fe_comprobantes where clave = pg_temp.clave(1)) = 1, pg_temp.est(1);
insert into _a201 select 'b14', public.fe_ingestar(pg_temp.pl(90, '310201999901', pg_temp.sha('9')))::text;
insert into _a201 select 'b14b', public.fe_ingestar(pg_temp.pl(90, '310201999901', pg_temp.sha('d')))::text;
insert into _r201 (caso, ok, detalle)
select '14 comprobante de la 199: el mismo sha por la ruta nueva es «duplicado»; otro sha lo pasa a «revisar» (2 versiones)',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b14') = 'duplicado'
       and (select v::jsonb ->> 'resultado' from _a201 where k = 'b14b') = 'revisar' and pg_temp.nver(90) = 2
       and pg_temp.est(90) like 'revisar|misma clave%', pg_temp.est(90);
select public.fe_ingestar(pg_temp.pl(2, '310201999999', pg_temp.sha('a')));
insert into _a201 select 'b15', public.fe_ingestar(pg_temp.pl(2, '310201999999', pg_temp.sha('e')))::text;
insert into _r201 (caso, ok, detalle)
select '15 conflicto en un comprobante sin local: sigue «receptor_distinto» (sin local) y suma el motivo',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'b15') = 'revisar'
       and pg_temp.est(2) like 'receptor_distinto|misma clave con otro XML%cédula del receptor no configurada%'
       and (select location_id is null from public.fe_comprobantes where clave = pg_temp.clave(2)), pg_temp.est(2);

-- ═══ C. Emisor conocido ═══════════════════════════════════════════════════════════════════════════════════════════
insert into _a201 select 'c16', public.fe_ingestar(pg_temp.pl(3, '310201999901', pg_temp.sha('a'), emisor => '310100000077'))::text;
insert into _r201 (caso, ok, detalle)
select '16 emisor desconocido: entra con local, a «revisar» con motivo (no se descarta ni se crea proveedor)',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'c16') = 'revisar'
       and pg_temp.est(3) = 'revisar|emisor no conocido (cédula sin cargar en emisores conocidos)'
       and (select location_id = 'prueba-201' and supplier_id is null from public.fe_comprobantes where clave = pg_temp.clave(3)),
       pg_temp.est(3);
select public.fe_ingestar(pg_temp.pl(4, '310201999901', pg_temp.sha('a'), emisor => '310100000009'));
insert into _r201 (caso, ok, detalle)
select '17 emisor cargado pero INACTIVO: «revisar»', pg_temp.est(4) like 'revisar|emisor no conocido%', pg_temp.est(4);
select public.fe_ingestar(pg_temp.pl(5, '310201999902', pg_temp.sha('a'), emisor => null));
insert into _r201 (caso, ok, detalle)
select '18 sin cédula del emisor: «revisar» con su motivo', pg_temp.est(5) = 'revisar|sin cédula del emisor', pg_temp.est(5);

-- ═══ D. Ruta con sha (258) ════════════════════════════════════════════════════════════════════════════════════════
insert into _a201 select 'd20', pg_temp.intentar($q$select public.fe_ingestar(pg_temp.pl(6, '310201999901', pg_temp.sha('a'), ruta => '2026/11/' || pg_temp.clave(6) || '.xml'))$q$);
insert into _a201 select 'd21', pg_temp.intentar($q$select public.fe_ingestar(pg_temp.pl(6, '310201999901', pg_temp.sha('a'), ruta => pg_temp.ruta(6, pg_temp.sha('b'))))$q$);
insert into _a201 select 'd22', pg_temp.intentar($q$select public.fe_ingestar(pg_temp.pl(6, '310201999901', null))$q$);
insert into _r201 (caso, ok, detalle)
select '20 ruta sin el sha o con OTRO sha: no entra (P0001, la Edge reintenta) ni deja fila; sin sha: 22023',
       (select v from _a201 where k = 'd20') = 'P0001' and (select v from _a201 where k = 'd21') = 'P0001'
       and (select v from _a201 where k = 'd22') = '22023'
       and not exists (select 1 from public.fe_comprobantes where clave = pg_temp.clave(6))
       and not exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(6)),
       concat_ws('/', (select v from _a201 where k = 'd20'), (select v from _a201 where k = 'd21'), (select v from _a201 where k = 'd22'));
insert into _a201 select 'd23', pg_temp.intentar($q$insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente)
  select id, pg_temp.sha('f'), '2026/11/x.xml', 'x' from public.fe_comprobantes where clave = pg_temp.clave(1)$q$);
insert into _r201 (caso, ok, detalle)
select '21 la tabla de versiones tampoco acepta una ruta nueva sin su sha (23514), aunque las filas viejas sigan',
       (select v from _a201 where k = 'd23') = '23514', (select v from _a201 where k = 'd23');

-- ═══ E. Respuestas de Hacienda ════════════════════════════════════════════════════════════════════════════════════
insert into _a201 select 'e30', public.fe_respuesta_registrar(pg_temp.rp(20, 'aceptado'))::text;
insert into _a201 select 'e31', public.fe_respuesta_registrar(pg_temp.rp(20, 'aceptado'))::text;
insert into _r201 (caso, ok, detalle)
select '30 respuesta nueva «nuevo» con huella; la misma otra vez «duplicado» sin versión nueva',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'e30') = 'nuevo' and (select v::jsonb ->> 'resultado' from _a201 where k = 'e31') = 'duplicado'
       and (select count(*) from public.fe_respuesta_versiones where clave = pg_temp.clave(20)) = 1
       and (select estado from public.fe_respuestas where clave = pg_temp.clave(20)) = 'ok', null;
insert into _a201 select 'e32', public.fe_respuesta_registrar(pg_temp.rp(20, 'rechazado', 'otro detalle'))::text;
insert into _r201 (caso, ok, detalle)
select '31 otra respuesta para la misma clave: «revisar», las dos versiones, queda la primera, bitácora «revisar»',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'e32') = 'revisar'
       and (select estado || '|' || mensaje || '|' || motivo from public.fe_respuestas where clave = pg_temp.clave(20))
           = 'revisar|aceptado|respuesta de Hacienda repetida con otro contenido: revisar'
       and (select array_agg(mensaje order by mensaje) from public.fe_respuesta_versiones where clave = pg_temp.clave(20)) = array['aceptado', 'rechazado']
       and exists (select 1 from public.fe_ingesta_bitacora where clave = pg_temp.clave(20) and resultado = 'revisar' and motivo like 'respuesta de Hacienda repetida%(rechazado)'),
       (select v from _a201 where k = 'e32');
-- comprobante que llega DESPUÉS de una respuesta en conflicto
select public.fe_ingestar(pg_temp.pl(20, '310201999901', pg_temp.sha('a')));
insert into _r201 (caso, ok, detalle)
select '32 el comprobante de una clave con respuesta en conflicto entra a «revisar» con ese motivo',
       pg_temp.est(20) = 'revisar|respuesta de Hacienda repetida con otro contenido: revisar', pg_temp.est(20);
-- respuesta en conflicto para un comprobante que YA estaba ok
select public.fe_respuesta_registrar(pg_temp.rp(7, 'aceptado'));
select public.fe_ingestar(pg_temp.pl(7, '310201999901', pg_temp.sha('a')));
insert into _a201 select 'e33a', pg_temp.est(7);
select public.fe_respuesta_registrar(pg_temp.rp(7, 'aceptado', 'detalle cambiado'));
insert into _r201 (caso, ok, detalle)
select '33 una respuesta distinta para un comprobante ok lo pasa a «revisar» (con su local)',
       (select v from _a201 where k = 'e33a') = 'ok|' and pg_temp.est(7) = 'revisar|respuesta de Hacienda repetida con otro contenido: revisar'
       and (select location_id from public.fe_comprobantes where clave = pg_temp.clave(7)) = 'prueba-201', pg_temp.est(7);
select public.fe_respuesta_registrar(pg_temp.rp(21, 'aceptado'));
select public.fe_respuesta_registrar(pg_temp.rp(21, 'aceptado', 'prueba', '310201999902'));
insert into _r201 (caso, ok, detalle)
select '34 cambia solo la cédula del receptor: también es otro contenido («revisar»)',
       (select estado from public.fe_respuestas where clave = pg_temp.clave(21)) = 'revisar', null;

-- ═══ F. Lectura y carga por rol (JWT real del rol, regla 4) ══════════════════════════════════════════════════════
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
create temp table _ids201 on commit drop as select id, clave from public.fe_comprobantes where fuente = 'prueba-201';
grant select on _ids201 to public;
-- clave 1, 3, 4, 7, 20, 90 → prueba-201 · 5 → prueba-201b · 2 → sin local
create temp table _v201 on commit drop as
select k, pg_temp.ver(u, q) as v
from _c201 c, lateral (values
  ('own_v',   c.owner_id,     $$select count(*) from public.fe_comprobante_versiones where comprobante_id in (select id from _ids201)$$),
  ('cont_v',  c.contador,     $$select count(*) from public.fe_comprobante_versiones where comprobante_id in (select id from _ids201)$$),
  ('mgr_v',   c.manager,      $$select count(*) from public.fe_comprobante_versiones where comprobante_id in (select id from _ids201)$$),
  ('mgr2_v',  c.manager_otro, $$select count(*) from public.fe_comprobante_versiones where comprobante_id in (select id from _ids201)$$),
  ('caj_v',   c.cajero,       $$select count(*) from public.fe_comprobante_versiones$$),
  ('caj_rv',  c.cajero,       $$select count(*) from public.fe_respuesta_versiones$$),
  ('mgr_rv',  c.manager,      $$select string_agg(right(clave, 10), ',' order by clave) from public.fe_respuesta_versiones where fuente = 'prueba-201'$$),
  ('own_rv',  c.owner_id,     $$select count(*) from public.fe_respuesta_versiones where fuente = 'prueba-201'$$),
  ('mgr_em',  c.manager,      $$select count(*) from public.fe_emisores_conocidos$$),
  ('cont_em', c.contador,     $$select count(*) from public.fe_emisores_conocidos$$),
  ('ins_v',   c.owner_id,     $$insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente) select id, repeat('f', 64), 'a/' || repeat('f', 64) || '.xml', 'x' from _ids201 limit 1 returning 'entró'$$),
  ('upd_r',   c.owner_id,     $$update public.fe_respuestas set estado = 'ok' where fuente = 'prueba-201' returning 'cambió'$$),
  ('em_own',  c.owner_id,     $$insert into public.fe_emisores_conocidos (cedula) values ('310100000055') returning (actualizado_por = auth.uid())::text$$),
  ('em_own_falso', c.owner_id, $$insert into public.fe_emisores_conocidos (cedula, actualizado_por) values ('310100000056', gen_random_uuid()) returning 'entró'$$),
  ('em_cont', c.contador,     $$insert into public.fe_emisores_conocidos (cedula) values ('310100000057') returning 'entró'$$),
  ('em_mgr',  c.manager,      $$update public.fe_emisores_conocidos set activo = false where cedula = '310100000001' returning 'cambió'$$),
  ('em_del',  c.owner_id,     $$delete from public.fe_emisores_conocidos where cedula = '310100000001' returning 'borró'$$),
  ('ing_own', c.owner_id,     $$select public.fe_ingestar('{}'::jsonb)::text$$),
  ('res_own', c.owner_id,     $$select public.fe_ingesta_resumen(14)::text$$),
  ('res_mgr', c.manager,      $$select public.fe_ingesta_resumen(14)::text$$)
) as x(k, u, q);
create function pg_temp.v(k text) returns text language sql as $$ select v from _v201 where _v201.k = $1 $$;
insert into _r201 (caso, ok, detalle)
select '50 owner y contador ven todas las versiones de prueba (12)', pg_temp.v('own_v') = '12' and pg_temp.v('cont_v') = '12',
       pg_temp.v('own_v') || '/' || pg_temp.v('cont_v');
insert into _r201 (caso, ok, detalle)
select '51 manager ve solo las versiones de su local (1×3, 3, 4, 7, 20, 90×2 = 9); el del otro local solo la suya (1)',
       pg_temp.v('mgr_v') = '9' and pg_temp.v('mgr2_v') = '1', pg_temp.v('mgr_v') || '/' || pg_temp.v('mgr2_v');
insert into _r201 (caso, ok, detalle)
select '52 cajero no ve versiones ni respuestas', pg_temp.v('caj_v') = '0' and pg_temp.v('caj_rv') = '0', pg_temp.v('caj_v') || '/' || pg_temp.v('caj_rv');
insert into _r201 (caso, ok, detalle)
select '53 respuestas: owner ve todas; manager solo las de claves con comprobante de su local (7 y 20)',
       pg_temp.v('own_rv')::int >= 6 and pg_temp.v('mgr_rv') = concat_ws(',', right(pg_temp.clave(7), 10), right(pg_temp.clave(7), 10), right(pg_temp.clave(20), 10), right(pg_temp.clave(20), 10)),
       pg_temp.v('own_rv') || '/' || coalesce(pg_temp.v('mgr_rv'), 'null');
insert into _r201 (caso, ok, detalle)
select '54 nadie escribe versiones ni cambia respuestas por la API, ni el owner; nadie ejecuta fe_ingestar (42501)',
       pg_temp.v('ins_v') = 'ERR 42501' and pg_temp.v('upd_r') = 'ERR 42501' and pg_temp.v('ing_own') = 'ERR 42501',
       concat_ws('/', pg_temp.v('ins_v'), pg_temp.v('upd_r'), pg_temp.v('ing_own'));
insert into _r201 (caso, ok, detalle)
select '55 emisores: el owner carga y queda sellado; no falsea quién; contador no carga; manager no los ve ni cambia; nadie borra',
       pg_temp.v('em_own') = 'true' and pg_temp.v('em_own_falso') = 'ERR 42501' and pg_temp.v('em_cont') = 'ERR 42501'
       and pg_temp.v('mgr_em') = '0' and pg_temp.v('cont_em')::int >= 2 and pg_temp.v('em_mgr') is distinct from 'cambió'
       and pg_temp.v('em_del') = 'ERR 42501' and (select activo from public.fe_emisores_conocidos where cedula = '310100000001'),
       concat_ws('/', pg_temp.v('em_own'), pg_temp.v('em_own_falso'), pg_temp.v('em_cont'), pg_temp.v('mgr_em'), pg_temp.v('cont_em'), coalesce(pg_temp.v('em_mgr'), 'null'), pg_temp.v('em_del'));
insert into _r201 (caso, ok, detalle)
select '56 resumen: «revisar» muestra el conflicto de XML y la respuesta en conflicto sin comprobante; manager 42501',
       exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'revisar') r where r ->> 0 = 'revisar' and r ->> 1 like 'misma clave con otro XML%')
       and exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'revisar') r where r ->> 0 = 'respuesta_revisar' and (r ->> 2)::int >= 1)
       and exists (select 1 from jsonb_array_elements(pg_temp.v('res_own')::jsonb -> 'revisar') r where r ->> 1 like 'emisor no conocido%')
       and pg_temp.v('res_mgr') = 'ERR 42501', left(pg_temp.v('res_own'), 300);

-- ═══ G. Vuelta atrás ══════════════════════════════════════════════════════════════════════════════════════════════
-- @@201_rollback@@
insert into _r201 (caso, ok, detalle)
select '90 después de 201_rollback.sql: sin tablas, columnas ni función nuevas; fe_ingestar, fe_respuesta_registrar y el resumen IGUALES a la 199 (definición y permisos)',
       to_regclass('public.fe_comprobante_versiones') is null and to_regclass('public.fe_respuesta_versiones') is null
       and to_regclass('public.fe_emisores_conocidos') is null and to_regprocedure('public.fe_motivo_sumar(text,text)') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fe_respuestas' and column_name in ('huella', 'estado', 'motivo'))
       and (select count(*) from _def201 d
             where md5(pg_get_functiondef(d.f::regprocedure)) = d.h
               and (select string_agg(a::text, ',' order by a::text)
                      from pg_proc p, unnest(coalesce(p.proacl, '{}')) a where p.oid = d.f::regprocedure) is not distinct from d.acl) = 3
       and to_regclass('public.fe_comprobantes') is not null, null;
insert into _a201 select 'g91', public.fe_ingestar(pg_temp.pl(1, '310201999901', pg_temp.sha('a'), ruta => '2026/11/x.xml'))::text;
insert into _r201 (caso, ok, detalle)
select '91 con la 199 de vuelta, la Edge nueva sigue andando (la misma clave da «duplicado» como antes)',
       (select v::jsonb ->> 'resultado' from _a201 where k = 'g91') = 'duplicado', (select v from _a201 where k = 'g91');

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r201 order by n;
select json_build_object(
  'ok', (select count(*) from _r201 where ok), 'fallas', (select count(*) from _r201 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r201 where ok is not true)) as resultado;
rollback;
