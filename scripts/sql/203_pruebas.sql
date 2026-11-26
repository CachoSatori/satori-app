-- 203_pruebas · compras F1: «Es un proveedor real · recordar» (fe_emisor_recordar / fe_emisor_desactivar).
-- Transacción que termina en ROLLBACK: no deja nada. LOCALES FICTICIOS ('prueba-203', 'prueba-203b'), cédulas con patrón
-- obvio (3102020399NN receptor, 3101000003NN emisor), usuarios, sha y montos inventados.
-- Necesita una base CON la 201 y SIN la 203: staging (ledger 201) o un Postgres 16 local armado con
-- `HASTA=201 bash scripts/sql/local_armar_base.sh <base>` (+ 203_preludio_local.sql, que pone `--local`).
-- Se arma y se corre con scripts/sql/203_pruebas.py (--armar [--local] [--compacto] | --psql "<conexión>" [--local]
-- [--mutar todas | X]). Nunca contra PROD.
-- MARCADORES: «-- @@preludio@@» · «-- @@203@@» → supabase/migrations/203_fe_emisor_recordar.sql (con --mutar, roto a
-- propósito) · «-- @@203_rollback@@» → scripts/sql/203_rollback.sql · «-- @@203_texto@@» → la 203 como texto (caso 92).
begin;
create temp table _r203 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r203 to public;
grant usage on sequence _r203_n_seq to public;
-- @@preludio@@

create temp table _c203 on commit drop as
select '00000000-0000-4000-8203-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8203-0000000000a1'::uuid as manager,
       '00000000-0000-4000-8203-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8203-0000000000e2'::uuid as cajero;
grant select on _c203 to public;
create temp table _a203 (k text primary key, v text) on commit drop;
grant all on _a203 to public;
insert into public.locations (id, name, is_active) values ('prueba-203', 'Local de prueba 203', false), ('prueba-203b', 'Local de prueba 203b', false)
on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 203"}'::jsonb
  from _c203 c, unnest(array[c.owner_id, c.manager, c.contador, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c203 c, (values (1, 'owner'), (2, 'manager'), (3, 'contador'), (4, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.contador, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, 'prueba-203' from _c203;

-- ── utilidades ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.clave(n integer) returns text language sql immutable as
$$ select '506' || '301126' || '310100000300' || lpad(n::text, 20, '0') || '1' || '00000203' $$;
create function pg_temp.sha(x text) returns text language sql immutable as $$ select repeat(x, 64) $$;
create function pg_temp.pl(n integer, emisor text, sha text default null, receptor text default '310202039901',
                           motivos jsonb default '[]'::jsonb, estado text default 'ok')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'fuente', 'prueba-203', 'lote', 'lote-prueba-203', 'estado', estado, 'motivos', motivos,
    'xml_path', '2026/11/' || pg_temp.clave(n) || '/' || coalesce(sha, pg_temp.sha('a')) || '.xml',
    'xml_sha256', coalesce(sha, pg_temp.sha('a')),
    'comprobante', jsonb_build_object(
      'clave', pg_temp.clave(n), 'tipo', 'factura', 'version', '4.4', 'consecutivo', lpad(n::text, 20, '0'),
      'fecha_emision', '2026-11-30T09:15:00-06:00', 'emisor_cedula', emisor, 'emisor_nombre', 'Proveedor ficticio ' || coalesce(right(emisor, 2), '?'),
      'receptor_cedula', receptor, 'moneda', 'CRC', 'tipo_cambio', '1.00000',
      'total_venta_neta', '900.00000', 'total_impuesto', '100.00000', 'total_comprobante', '1000.00000'),
    'lineas', '[]'::jsonb)
$$;
create function pg_temp.rp(n integer, mensaje text) returns jsonb language sql immutable as $$
  select jsonb_build_object('fuente', 'prueba-203', 'lote', 'lote-prueba-203',
    'respuesta', jsonb_build_object('clave', pg_temp.clave(n), 'mensaje', mensaje, 'detalle', 'prueba ' || mensaje, 'receptor_cedula', '310202039901'))
$$;
create function pg_temp.est(n integer) returns text language sql as
$$ select estado_parseo || '|' || coalesce(motivo, '') from public.fe_comprobantes where clave = pg_temp.clave(n) $$;
-- ejecuta q con el JWT real del rol (regla 4)
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
create function pg_temp.como(k text, u uuid, q text) returns void language sql as
$$ insert into _a203 values (k, pg_temp.ver(u, q)) $$;
create function pg_temp.a(k text) returns text language sql as $$ select v from _a203 where _a203.k = $1 $$;
create function pg_temp.j(k text, campo text) returns text language sql as $$ select v::jsonb ->> campo from _a203 where _a203.k = $1 and v like '{%' $$;
create function pg_temp.res(k text) returns text language sql as $$ select pg_temp.j(k, 'resultado') $$;
grant execute on all functions in schema pg_temp to public;

insert into public.fe_receptores (cedula, location_id, activo) values ('310202039901', 'prueba-203', true);
-- K = conocido activo · C = conocido INACTIVO (lo desactivó el owner)
insert into public.fe_emisores_conocidos (cedula, activo) values ('310100000301', true), ('310100000339', false);

-- comprobantes (como postgres: es la Edge)
select public.fe_ingestar(pg_temp.pl(1, '310100000331'));                                         -- A, único motivo emisor
select public.fe_ingestar(pg_temp.pl(2, '310100000331'));
select public.fe_ingestar(pg_temp.pl(2, '310100000331', pg_temp.sha('b')));                       -- A + otro XML misma clave
select public.fe_respuesta_registrar(pg_temp.rp(3, 'aceptado'));
select public.fe_respuesta_registrar(pg_temp.rp(3, 'rechazado'));
select public.fe_ingestar(pg_temp.pl(3, '310100000331'));                                         -- A + respuesta distinta
select public.fe_ingestar(pg_temp.pl(4, '310100000331', receptor => '310202039999'));             -- A + receptor no configurado
select public.fe_ingestar(pg_temp.pl(5, '310100000331', motivos => '["suma de líneas no calza"]', estado => 'revisar')); -- A + motivo de la Edge
select public.fe_ingestar(pg_temp.pl(6, '310100000332'));                                         -- B, otro emisor
select public.fe_ingestar(pg_temp.pl(7, '310100000339'));                                         -- C inactivo
select public.fe_ingestar(pg_temp.pl(8, '310100000301'));
select public.fe_ingestar(pg_temp.pl(8, '310100000301', pg_temp.sha('c')));                       -- K: SOLO otro XML misma clave
select public.fe_ingestar(pg_temp.pl(9, '310100000333'));                                         -- E: se carga a mano después

-- ── @@ la 203 ───────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _ing203 on commit drop as select count(*) as n, max(ts) as ultima from public.fe_ingesta_bitacora;
-- @@203@@

-- utilidad que lee la tabla nueva (se crea después de la 203)
create function pg_temp.nbit(ced text) returns bigint language sql as
$$ select count(*) from public.fe_emisores_bitacora where cedula = ced $$;
grant execute on function pg_temp.nbit(text) to public;

-- ═══ A. Estructura y permisos ═════════════════════════════════════════════════════════════════════════════════════
insert into _r203 (caso, ok, detalle)
select '01 bitácora con RLS; anon y authenticated no la escriben; las columnas nuevas de emisores no se escriben por la API',
       (select relrowsecurity from pg_class where oid = 'public.fe_emisores_bitacora'::regclass)
       and not bool_or(has_table_privilege(r, 'public.fe_emisores_bitacora', p))
       and not has_table_privilege('anon', 'public.fe_emisores_bitacora', 'SELECT')
       and not bool_or(has_column_privilege('authenticated', 'public.fe_emisores_conocidos', c, 'INSERT')
                    or has_column_privilege('authenticated', 'public.fe_emisores_conocidos', c, 'UPDATE')), null
from unnest(array['anon', 'authenticated']) r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p,
     unnest(array['nombre', 'origen', 'aprobado_por', 'aprobado_en']) c;
insert into _r203 (caso, ok, detalle)
select '02 las dos funciones: SECURITY DEFINER, search_path fijo, authenticated sí y anon no las ejecuta',
       bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')
                and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
       and count(*) = 2, string_agg(p.proname, ',')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fe_emisor_recordar', 'fe_emisor_desactivar');

-- ═══ B. Quién puede ═══════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.como('b_mgr', manager, $$select public.fe_emisor_recordar('310100000331')::text$$) from _c203;
select pg_temp.como('b_caj', cajero,  $$select public.fe_emisor_recordar('310100000331')::text$$) from _c203;
select pg_temp.como('b_anon_sin_jwt', null, $$select public.fe_emisor_recordar('310100000331')::text$$);
insert into _r203 (caso, ok, detalle)
select '10 manager y cajero: 42501 (validado en la base) y no cambia nada',
       pg_temp.a('b_mgr') = 'ERR 42501' and pg_temp.a('b_caj') = 'ERR 42501' and pg_temp.a('b_anon_sin_jwt') = 'ERR 42501'
       and not exists (select 1 from public.fe_emisores_conocidos where cedula = '310100000331')
       and pg_temp.est(1) like 'revisar|emisor no conocido%' and pg_temp.nbit('310100000331') = 0,
       concat_ws('/', pg_temp.a('b_mgr'), pg_temp.a('b_caj'), pg_temp.a('b_anon_sin_jwt'));

-- ═══ C. Recordar (contador) ══════════════════════════════════════════════════════════════════════════════════════
select pg_temp.como('c11', contador, $$select public.fe_emisor_recordar('310100000331')::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '11 contador recuerda A: alta activa con quién/cuándo; solo-emisor → ok; los otros pierden SOLO ese motivo y siguen',
       pg_temp.res('c11') = 'recordar'
       and pg_temp.j('c11', 'pasan_a_ok') = '1' and pg_temp.j('c11', 'siguen_revisar') = '4'
       and (select activo and origen = 'revision' and aprobado_por = c.contador and actualizado_por = c.contador
                   and aprobado_en is not null and nombre = 'Proveedor ficticio 31'
              from public.fe_emisores_conocidos, _c203 c where cedula = '310100000331')
       and pg_temp.est(1) = 'ok|'
       and pg_temp.est(2) = 'revisar|misma clave con otro XML: revisar cuál es el real (quedan todas las versiones)'
       and pg_temp.est(3) = 'revisar|respuesta de Hacienda repetida con otro contenido: revisar'
       and pg_temp.est(4) = 'receptor_distinto|cédula del receptor no configurada'
       and pg_temp.est(5) = 'revisar|suma de líneas no calza'
       and pg_temp.est(6) like 'revisar|emisor no conocido%'
       and (select count(*) from public.fe_emisores_bitacora b, _c203 c
             where b.cedula = '310100000331' and b.accion = 'recordar' and b.por = c.contador and b.rol = 'contador'
               and b.pasan_a_ok = 1 and b.siguen_revisar = 4) = 1,
       pg_temp.a('c11') || ' ' || concat_ws(' / ', pg_temp.est(1), pg_temp.est(2), pg_temp.est(4), pg_temp.est(5));
select pg_temp.como('c12', owner_id, $$select public.fe_emisor_recordar('310100000331')::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '12 tocar otra vez (owner): «ya_estaba», 0/0, sin fila duplicada ni bitácora nueva, aprobado_por sigue siendo el contador',
       pg_temp.res('c12') = 'ya_estaba' and pg_temp.j('c12', 'pasan_a_ok') = '0'
       and (select count(*) from public.fe_emisores_conocidos where cedula = '310100000331') = 1
       and pg_temp.nbit('310100000331') = 1
       and (select aprobado_por = c.contador from public.fe_emisores_conocidos, _c203 c where cedula = '310100000331'),
       pg_temp.a('c12');
select public.fe_ingestar(pg_temp.pl(10, '310100000331'));
insert into _r203 (caso, ok, detalle)
select '13 la factura siguiente de A ya entra «ok» (la 201 lo usa)', pg_temp.est(10) = 'ok|', pg_temp.est(10);

-- ═══ D. Inactivo: solo el owner lo reactiva ══════════════════════════════════════════════════════════════════════
select pg_temp.como('d14c', contador, $$select public.fe_emisor_recordar('310100000339')::text$$) from _c203;
insert into _a203 select 'd14c_est', pg_temp.est(7);
select pg_temp.como('d14o', owner_id, $$select public.fe_emisor_recordar('310100000339')::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '14 emisor desactivado por el owner: el contador no lo reactiva (42501, nada cambia); el owner sí («reactivar», su comprobante → ok)',
       pg_temp.a('d14c') = 'ERR 42501' and pg_temp.a('d14c_est') like 'revisar|emisor no conocido%'
       and pg_temp.res('d14o') = 'reactivar' and pg_temp.est(7) = 'ok|'
       and (select activo and aprobado_por = c.owner_id from public.fe_emisores_conocidos, _c203 c where cedula = '310100000339')
       and (select string_agg(accion || ':' || rol, ',') from public.fe_emisores_bitacora where cedula = '310100000339') = 'reactivar:owner',
       concat_ws(' / ', pg_temp.a('d14c'), pg_temp.a('d14o'));

-- ═══ E. Otro XML con la misma clave NO se resuelve con el botón ══════════════════════════════════════════════════
select pg_temp.como('e15', owner_id, $$select public.fe_emisor_recordar('310100000301')::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '15 emisor ya conocido con «revisar» SOLO por otro XML: «ya_estaba», el comprobante sigue «revisar» con su motivo, sin bitácora',
       pg_temp.res('e15') = 'ya_estaba'
       and pg_temp.est(8) = 'revisar|misma clave con otro XML: revisar cuál es el real (quedan todas las versiones)'
       and pg_temp.nbit('310100000301') = 0, pg_temp.a('e15') || ' ' || pg_temp.est(8);

-- ═══ F. Cédulas que no llegaron / inválidas ══════════════════════════════════════════════════════════════════════
select pg_temp.como('f16a', owner_id, $$select public.fe_emisor_recordar('310100000398')::text$$) from _c203;
select pg_temp.como('f16b', owner_id, $$select public.fe_emisor_recordar('31-01')::text$$) from _c203;
select pg_temp.como('f16c', owner_id, $$select public.fe_emisor_recordar(null)::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '16 una cédula sin comprobantes, inválida o nula: 22023 y no se carga nada',
       pg_temp.a('f16a') = 'ERR 22023' and pg_temp.a('f16b') = 'ERR 22023' and pg_temp.a('f16c') = 'ERR 22023'
       and not exists (select 1 from public.fe_emisores_conocidos where cedula = '310100000398'),
       concat_ws('/', pg_temp.a('f16a'), pg_temp.a('f16b'), pg_temp.a('f16c'));

-- ═══ G. Desactivar (solo owner) ══════════════════════════════════════════════════════════════════════════════════
select pg_temp.como('g17c', contador, $$select public.fe_emisor_desactivar('310100000331')::text$$) from _c203;
select pg_temp.como('g17o', owner_id, $$select public.fe_emisor_desactivar('310100000331')::text$$) from _c203;
select pg_temp.como('g17o2', owner_id, $$select public.fe_emisor_desactivar('310100000331')::text$$) from _c203;
select pg_temp.como('g17x', owner_id, $$select public.fe_emisor_desactivar('310100000398')::text$$) from _c203;
select public.fe_ingestar(pg_temp.pl(11, '310100000331'));
insert into _r203 (caso, ok, detalle)
select '17 desactivar: contador 42501; owner «desactivar» con bitácora; otra vez «ya_estaba»; cédula ajena 22023; lo ya «ok» queda ok; lo nuevo vuelve a «revisar»',
       pg_temp.a('g17c') = 'ERR 42501' and pg_temp.res('g17o') = 'desactivar' and pg_temp.res('g17o2') = 'ya_estaba'
       and pg_temp.a('g17x') = 'ERR 22023'
       and not (select activo from public.fe_emisores_conocidos where cedula = '310100000331')
       and (select string_agg(accion, ',' order by id) from public.fe_emisores_bitacora where cedula = '310100000331') = 'recordar,desactivar'
       and pg_temp.est(1) = 'ok|' and pg_temp.est(11) like 'revisar|emisor no conocido%',
       concat_ws('/', pg_temp.a('g17c'), pg_temp.a('g17o'), pg_temp.a('g17o2'), pg_temp.a('g17x'), pg_temp.est(11));

-- ═══ H. Carga manual de la 201 sigue igual; «resolver» lo que quedó de antes ══════════════════════════════════════
select pg_temp.como('h18', owner_id, $$insert into public.fe_emisores_conocidos (cedula) values ('310100000333') returning origen$$) from _c203;
select pg_temp.como('h18b', owner_id, $$insert into public.fe_emisores_conocidos (cedula, origen) values ('310100000334', 'revision') returning origen$$) from _c203;
select pg_temp.como('h19', contador, $$select public.fe_emisor_recordar('310100000333')::text$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '18 el owner sigue cargando a mano (origen «manual»), pero no puede escribir origen/nombre/aprobado por la API (42501)',
       pg_temp.a('h18') = 'manual' and pg_temp.a('h18b') = 'ERR 42501', concat_ws('/', pg_temp.a('h18'), pg_temp.a('h18b'));
insert into _r203 (caso, ok, detalle)
select '19 cargado a mano DESPUÉS de que entró su factura: el botón la saca de «revisar» («resolver», con bitácora)',
       pg_temp.res('h19') = 'resolver' and pg_temp.est(9) = 'ok|'
       and (select string_agg(accion || ':' || pasan_a_ok, ',') from public.fe_emisores_bitacora where cedula = '310100000333') = 'resolver:1',
       pg_temp.a('h19');

-- ═══ I. Lectura de la bitácora y no ensuciar la ingesta ══════════════════════════════════════════════════════════
select pg_temp.como('i_own', owner_id, $$select count(*)::text from public.fe_emisores_bitacora where cedula like '3101000003%'$$) from _c203;
select pg_temp.como('i_cont', contador, $$select count(*)::text from public.fe_emisores_bitacora where cedula like '3101000003%'$$) from _c203;
select pg_temp.como('i_mgr', manager, $$select count(*)::text from public.fe_emisores_bitacora$$) from _c203;
select pg_temp.como('i_caj', cajero, $$select count(*)::text from public.fe_emisores_bitacora$$) from _c203;
select pg_temp.como('i_ins', owner_id, $$insert into public.fe_emisores_bitacora (cedula, accion, por, rol) values ('310100000399', 'recordar', auth.uid(), 'owner') returning 'entró'$$) from _c203;
insert into _r203 (caso, ok, detalle)
select '20 bitácora: owner y contador la leen (4); manager y cajero no (0); nadie la escribe por la API',
       pg_temp.a('i_own') = '4' and pg_temp.a('i_cont') = '4' and pg_temp.a('i_mgr') = '0' and pg_temp.a('i_caj') = '0'
       and pg_temp.a('i_ins') = 'ERR 42501',
       concat_ws('/', pg_temp.a('i_own'), pg_temp.a('i_cont'), pg_temp.a('i_mgr'), pg_temp.a('i_caj'), pg_temp.a('i_ins'));
insert into _r203 (caso, ok, detalle)
select '21 recordar/desactivar no escriben fe_ingesta_bitacora («Última ingesta» y el conteo por día no cambian por la app)',
       (select count(*) from public.fe_ingesta_bitacora) = i.n + 2   -- solo las 2 facturas (10 y 11) que entraron por la Edge
       and not exists (select 1 from public.fe_ingesta_bitacora b where b.ts > i.ultima and b.fuente <> 'prueba-203'),
       (select count(*) from public.fe_ingesta_bitacora)::text || ' vs ' || i.n
from _ing203 i;

-- ═══ J. Vuelta atrás ═════════════════════════════════════════════════════════════════════════════════════════════
-- @@203_rollback@@
insert into _r203 (caso, ok, detalle)
select '90 después de 203_rollback.sql: sin bitácora, funciones ni columnas nuevas; los emisores recordados siguen (activos según quedaron)',
       to_regclass('public.fe_emisores_bitacora') is null
       and to_regprocedure('public.fe_emisor_recordar(text)') is null and to_regprocedure('public.fe_emisor_desactivar(text)') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fe_emisores_conocidos'
                         and column_name in ('nombre', 'origen', 'aprobado_por', 'aprobado_en'))
       and (select activo from public.fe_emisores_conocidos where cedula = '310100000339')
       and pg_temp.est(1) = 'ok|', null;

-- R13: si fe_ingestar no es la de la 201, la 203 se para y no crea nada
create function pg_temp.error_de(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create or replace function public.fe_ingestar(p jsonb) returns jsonb language sql security definer
  set search_path = public, pg_temp as $f$ select '{"resultado": "cambiada a mano"}'::jsonb $f$;
insert into _a203 select 'j92', pg_temp.error_de(
-- @@203_texto@@
);
insert into _r203 (caso, ok, detalle)
select '92 guarda R13: fe_ingestar cambiada a mano → la 203 se para (P0001) y no crea nada',
       pg_temp.a('j92') like 'P0001 203: public.fe_ingestar no es la de la 201%'
       and to_regclass('public.fe_emisores_bitacora') is null and to_regprocedure('public.fe_emisor_recordar(text)') is null,
       pg_temp.a('j92');

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r203 order by n;
select json_build_object(
  'ok', (select count(*) from _r203 where ok), 'fallas', (select count(*) from _r203 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r203 where ok is not true)) as resultado;
rollback;
