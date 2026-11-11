-- Pruebas de la 090 en STAGING, en una transacción DESCARTADA (no deja nada). Todo tiene que dar ok = true.
-- Corre como postgres (editor SQL / Management API), que es el dueño de las tablas de public.
begin;
create temp table _r (caso text, ok boolean, detalle text) on commit drop;

-- Antes: una tabla nueva le da todo a anon (lo de hoy).
create table public.prueba_090_antes (x int);
insert into _r select 'antes: tabla nueva con SELECT para anon (lo de hoy)', has_table_privilege('anon', 'public.prueba_090_antes', 'SELECT'), '';

-- La 090 (mismo SQL que el archivo, sin su begin/commit).
alter default privileges for role postgres in schema public revoke all on tables from anon;

create table public.prueba_090_despues (x int);
insert into _r select 'después: anon sin ningún permiso en una tabla nueva',
  not (has_table_privilege('anon', 'public.prueba_090_despues', 'SELECT') or has_table_privilege('anon', 'public.prueba_090_despues', 'INSERT')
       or has_table_privilege('anon', 'public.prueba_090_despues', 'UPDATE') or has_table_privilege('anon', 'public.prueba_090_despues', 'DELETE')
       or has_table_privilege('anon', 'public.prueba_090_despues', 'TRUNCATE') or has_table_privilege('anon', 'public.prueba_090_despues', 'REFERENCES')
       or has_table_privilege('anon', 'public.prueba_090_despues', 'TRIGGER')), '';
insert into _r select 'después: authenticated sigue con SELECT/INSERT/UPDATE/DELETE',
  has_table_privilege('authenticated', 'public.prueba_090_despues', 'SELECT') and has_table_privilege('authenticated', 'public.prueba_090_despues', 'INSERT')
  and has_table_privilege('authenticated', 'public.prueba_090_despues', 'UPDATE') and has_table_privilege('authenticated', 'public.prueba_090_despues', 'DELETE'), '';
insert into _r select 'después: service_role sigue con todo',
  has_table_privilege('service_role', 'public.prueba_090_despues', 'SELECT') and has_table_privilege('service_role', 'public.prueba_090_despues', 'INSERT'), '';
insert into _r select 'las tablas que ya existían no cambian (prueba_090_antes sigue con SELECT para anon)',
  has_table_privilege('anon', 'public.prueba_090_antes', 'SELECT'), '';

-- Un grant explícito abre lo que haga falta.
grant select on public.prueba_090_despues to anon;
insert into _r select 'grant explícito: anon puede leer la tabla nueva', has_table_privilege('anon', 'public.prueba_090_despues', 'SELECT'), '';

-- Secuencias y funciones nuevas: no cambian (fuera del alcance).
create sequence public.prueba_090_seq;
insert into _r select 'secuencias nuevas: igual que hoy (anon con USAGE)', has_sequence_privilege('anon', 'public.prueba_090_seq', 'USAGE'), '';

-- El rollback vuelve a lo de hoy.
alter default privileges for role postgres in schema public grant all on tables to anon;
create table public.prueba_090_rollback (x int);
insert into _r select 'rollback: una tabla nueva vuelve a darle SELECT a anon', has_table_privilege('anon', 'public.prueba_090_rollback', 'SELECT'), '';

select json_agg(json_build_object('caso', caso, 'ok', ok)) from _r;
rollback;
