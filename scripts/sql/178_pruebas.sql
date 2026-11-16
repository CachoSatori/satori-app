-- 178_pruebas · SOLO BASE LOCAL (Postgres 16 armada con scripts/sql/local_armar_base.sh; nunca staging ni prod: la
-- batería BORRA las 5 columnas adentro de su transacción para simular el repo de antes y crea un trigger de evento).
-- Cada parte pasa dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   psql -X -d <base> -v ON_ERROR_STOP=1 -v migracion=supabase/migrations/178_esquema_columnas_caja_como_prod.sql \
--        -f scripts/sql/178_pruebas.sql
--   (o scripts/sql/178_pruebas.sh, que además corre las mutaciones)
--
-- Casos (parte A: base «repo antes de la 178», sin las 5 columnas):
--  00 la base de partida tiene las 5 columnas (si no, NO PROBADO: la base no se armó con la 178)
--  01 sin las 5 columnas, el detector ve exactamente 5 diferencias con prod (muerde)
--  02 después de la 178, las 5 columnas son idénticas a prod: tipo, nullable, default, sin comentario, sin constraint
--     ni índice, sin identity ni generada
--  03 la primera corrida hizo exactamente 5 ALTER TABLE (los cuenta un trigger de evento ddl_command_end)
--  04 la segunda corrida no falla y hace 0 ALTER TABLE (idempotente)
--  05 el detector de ALTER funciona: un ALTER de control sí queda registrado
--  06 un insert sin las columnas guarda lo de prod: amount_usd 0; initial_* 0; final_* null
--  07 si una columna existe con otra definición (amount_usd numeric(12,2)), la 178 aborta con «178: …» y no cambia nada
-- Casos (parte B: base «como PROD», ya con las 5 columnas, transacción nueva):
--  08 la 178 no hace ningún ALTER TABLE
--  09 la 178 no toma ningún lock de tabla sobre cash_movements ni cash_sessions (pg_locks de esta sesión)
--  10 ninguna tabla reescrita (relfilenode igual) y las 5 columnas siguen idénticas a prod
\set ON_ERROR_STOP 1
\set m178 `cat :migracion`

-- ═════════════════════════════════════════ PARTE A ═════════════════════════════════════════
begin;
select set_config('t178.sql', :'m178', true) is not null as migracion_cargada;
create temp table _r178 (n serial, caso text, ok boolean, detalle text);
create temp table _ddl178 (n serial, tag text, obj text);

-- definición en PROD (yiczgdti…, solo lectura, 16-nov-2026 -06:00): col | tipo | notnull | default ('' = sin default)
create temp table _prod178 (col text, tipo text, nn boolean, def text);
insert into _prod178 values
 ('cash_movements.amount_usd',      'numeric', false, '0'),
 ('cash_sessions.initial_cash_crc', 'numeric', false, '0'),
 ('cash_sessions.initial_cash_usd', 'numeric', false, '0'),
 ('cash_sessions.final_cash_crc',   'numeric', false, ''),
 ('cash_sessions.final_cash_usd',   'numeric', false, '');

create temp view _base178 as
select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo,
       a.attnotnull as nn, coalesce(pg_get_expr(d.adbin, d.adrelid), '') as def,
       a.attidentity = '' and a.attgenerated = '' as simple,
       col_description(c.oid, a.attnum) as comentario,
       exists (select 1 from pg_constraint co where co.conrelid = c.oid and a.attnum = any(co.conkey)) as con_constraint,
       exists (select 1 from pg_index ix where ix.indrelid = c.oid and a.attnum = any(ix.indkey::int2[])) as con_indice
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where n.nspname = 'public' and c.relname in ('cash_movements', 'cash_sessions') and a.attnum > 0 and not a.attisdropped;

-- diferencias: falta, o distinta en algo
create temp view _dif178 as
select p.col,
       case when b.col is null then 'falta'
            else concat_ws(' ', nullif(b.tipo, p.tipo), case when b.nn <> p.nn then 'notnull' end,
                           case when b.def <> p.def then 'default=' || b.def end, case when not b.simple then 'identity/generada' end,
                           case when b.comentario is not null then 'comentario' end,
                           case when b.con_constraint then 'constraint' end, case when b.con_indice then 'indice' end) end as que
  from _prod178 p left join _base178 b using (col)
 where b.col is null or b.tipo <> p.tipo or b.nn <> p.nn or b.def <> p.def or not b.simple
    or b.comentario is not null or b.con_constraint or b.con_indice;

-- 00
insert into _r178 (caso, ok, detalle)
select '00 la base de partida tiene las 5', count(*) = 5, count(*) || ' de 5'
  from _prod178 p join _base178 b using (col);

-- base «como el repo antes de la 178»: sin las 5 columnas (cascade: si algo dependiera, se vería en 02)
alter table public.cash_movements drop column amount_usd;
alter table public.cash_sessions drop column initial_cash_crc, drop column initial_cash_usd,
                                 drop column final_cash_crc,   drop column final_cash_usd;

-- 01
insert into _r178 (caso, ok, detalle)
select '01 antes: faltan las 5', count(*) = 5 and bool_and(que = 'falta'), count(*) || ' diferencias' from _dif178;

-- trigger de evento: cuenta cada ALTER TABLE que se ejecuta de verdad
create function public._t178_ddl() returns event_trigger language plpgsql as $$
declare r record; begin
  for r in select * from pg_event_trigger_ddl_commands() loop
    insert into _ddl178 (tag, obj) values (r.command_tag, r.object_identity);
  end loop; end $$;
create event trigger _t178 on ddl_command_end execute function public._t178_ddl();

-- 1.ª corrida de la 178 (el archivo exacto)
do $$ begin
  execute current_setting('t178.sql');
exception when others then
  insert into _r178 (caso, ok, detalle) values ('02 1.ª corrida: la 178 falló', false, sqlerrm);
end $$;

-- 02
insert into _r178 (caso, ok, detalle)
select '02 después: las 5 idénticas a prod', count(*) = 0, coalesce(string_agg(col || ' ' || que, ', '), 'sin diferencias') from _dif178;
-- 03
insert into _r178 (caso, ok, detalle)
select '03 1.ª corrida: 5 ALTER', count(*) = 5, count(*) || ' ALTER TABLE' from _ddl178 where tag = 'ALTER TABLE';

-- 2.ª corrida
truncate _ddl178;
do $$ begin
  execute current_setting('t178.sql');
exception when others then
  insert into _r178 (caso, ok, detalle) values ('04 2.ª corrida: la 178 falló', false, sqlerrm);
end $$;
-- 04
insert into _r178 (caso, ok, detalle)
select '04 2.ª corrida: no falla y 0 ALTER', count(*) = 0, count(*) || ' ALTER TABLE' from _ddl178 where tag = 'ALTER TABLE';

-- 05 control del detector
truncate _ddl178;
alter table public.cash_sessions alter column notes set statistics -1;   -- no cambia nada, pero es un ALTER TABLE
insert into _r178 (caso, ok, detalle)
select '05 el detector de ALTER muerde', count(*) = 1, count(*) || ' ALTER TABLE registrados' from _ddl178 where tag = 'ALTER TABLE';
drop event trigger _t178;

-- 06 defaults en un insert real (sin triggers de usuario ni FKs: solo mira lo que pone la columna)
do $$ declare v_m numeric; v_ic numeric; v_iu numeric; v_fc numeric; v_fu numeric; v_ok boolean; begin
  set local session_replication_role = replica;
  insert into public.cash_movements (session_id, created_by, movement_type, amount_crc, description)
       values (gen_random_uuid(), gen_random_uuid(), 'ingreso', 1, 'prueba 178') returning amount_usd into v_m;
  insert into public.cash_sessions (session_date, opened_by)
       values (date '2000-01-01', gen_random_uuid()) returning initial_cash_crc, initial_cash_usd, final_cash_crc, final_cash_usd
       into v_ic, v_iu, v_fc, v_fu;
  v_ok := v_m = 0 and v_ic = 0 and v_iu = 0 and v_fc is null and v_fu is null;
  insert into _r178 (caso, ok, detalle)
  values ('06 insert sin las columnas: lo de prod', v_ok,
          format('amount_usd=%s initial=%s/%s final=%s/%s', v_m, v_ic, v_iu, coalesce(v_fc::text,'null'), coalesce(v_fu::text,'null')));
  set local session_replication_role = origin;
exception when others then
  insert into _r178 (caso, ok, detalle) values ('06 insert sin las columnas: lo de prod', false, sqlerrm);
end $$;

-- 07 una columna existe distinta a prod: aborta y no cambia nada
do $$ declare v_ok boolean := false; v_msg text; begin
  begin
    alter table public.cash_movements alter column amount_usd type numeric(12,2);
    alter table public.cash_sessions drop column final_cash_usd;
  exception when others then
    v_msg := 'preparación: ' || sqlerrm;
  end;
  if v_msg is not null then
    insert into _r178 (caso, ok, detalle) values ('07 distinta a prod: aborta', false, v_msg);
    return;
  end if;
  begin
    execute current_setting('t178.sql');
  exception when others then
    v_msg := sqlerrm; v_ok := v_msg like '178: public.cash_movements.amount_usd existe distinta a prod%';
  end;
  insert into _r178 (caso, ok, detalle) values ('07 distinta a prod: aborta', v_ok, coalesce(v_msg, 'no abortó'));
end $$;
insert into _r178 (caso, ok, detalle)
select '07b tras abortar no cambió nada', count(*) filter (where col = 'cash_sessions.final_cash_usd') = 0
       and bool_and(tipo = 'numeric(12,2)') filter (where col = 'cash_movements.amount_usd'),
       string_agg(col || '=' || tipo, ', ')
  from _base178 where col in ('cash_movements.amount_usd', 'cash_sessions.final_cash_usd');

\pset format aligned
select n, caso, ok, detalle from _r178 order by n;
-- el resultado de la parte A sobrevive al rollback en variables de psql
select count(*) as a_total, coalesce(string_agg(caso, ' | ' order by n) filter (where not ok), '') as a_fallan from _r178 \gset
rollback;

-- ═════════════════════════════════════════ PARTE B ═════════════════════════════════════════
-- Base «como PROD»: la de partida ya tiene las 5 columnas (caso 00). Transacción nueva, sin locks previos.
begin;
select set_config('t178.sql', :'m178', true) is not null as migracion_cargada;
create temp table _r178 (n serial, caso text, ok boolean, detalle text);
create temp table _ddl178 (n serial, tag text, obj text);
create temp table _rf178 as
select relname, relfilenode from pg_class where oid in ('public.cash_movements'::regclass, 'public.cash_sessions'::regclass);
create temp table _antes178 as
select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
       coalesce(pg_get_expr(d.adbin, d.adrelid), '') as def
  from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attrelid in ('public.cash_movements'::regclass, 'public.cash_sessions'::regclass) and a.attnum > 0 and not a.attisdropped;

create function public._t178_ddl() returns event_trigger language plpgsql as $$
declare r record; begin
  for r in select * from pg_event_trigger_ddl_commands() loop
    insert into _ddl178 (tag, obj) values (r.command_tag, r.object_identity);
  end loop; end $$;

-- 09 primero, antes de crear el trigger de evento (que toma sus propios locks): corrida pura de la 178.
-- Si la 178 corre bien, el bloque con exception se confirma y sus locks pasan a esta transacción (se ven en pg_locks);
-- si falla en una base como prod, cae 09 con el error.
do $$ begin
  execute current_setting('t178.sql');
exception when others then
  insert into _r178 (caso, ok, detalle) values ('09 base como prod: la 178 falló', false, sqlerrm);
end $$;
insert into _r178 (caso, ok, detalle)
select '09 base como prod: 0 locks de tabla', count(*) = 0, coalesce(string_agg(relation::regclass || ' ' || mode, ', '), 'ninguno')
  from pg_locks
 where pid = pg_backend_pid() and locktype = 'relation'
   and relation in ('public.cash_movements'::regclass, 'public.cash_sessions'::regclass);

-- 08
create event trigger _t178 on ddl_command_end execute function public._t178_ddl();
do $$ begin
  execute current_setting('t178.sql');
exception when others then
  insert into _r178 (caso, ok, detalle) values ('08 base como prod: la 178 falló', false, sqlerrm);
end $$;
insert into _r178 (caso, ok, detalle)
select '08 base como prod: 0 ALTER', count(*) = 0, count(*) || ' ALTER TABLE' from _ddl178 where tag = 'ALTER TABLE';
drop event trigger _t178;

-- 10
insert into _r178 (caso, ok, detalle)
select '10 base como prod: sin reescritura ni cambios',
       (select bool_and(c.relfilenode = r.relfilenode) from _rf178 r join pg_class c on c.relname = r.relname and c.relnamespace = 'public'::regnamespace)
       and not exists (
         (select * from _antes178 except
          select c.relname || '.' || a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '')
            from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attrelid in ('public.cash_movements'::regclass, 'public.cash_sessions'::regclass) and a.attnum > 0 and not a.attisdropped)),
       'relfilenode y columnas comparados';

select n, caso, ok, detalle from _r178 order by n;
select count(*) as b_total, coalesce(string_agg(caso, ' | ' order by n) filter (where not ok), '') as b_fallan from _r178 \gset
rollback;

-- veredicto: 9 casos en A (00–07b) + 3 en B (08–10) = 12 (más los de «la 178 falló», que ya son falla)
select set_config('t178.a_total', :'a_total', false), set_config('t178.a_fallan', :'a_fallan', false),
       set_config('t178.b_total', :'b_total', false), set_config('t178.b_fallan', :'b_fallan', false) \g /dev/null
do $$ declare v text; n int; begin
  n := current_setting('t178.a_total')::int + current_setting('t178.b_total')::int;
  v := concat_ws(' | ', nullif(current_setting('t178.a_fallan'), ''), nullif(current_setting('t178.b_fallan'), ''));
  if v <> '' then raise exception '178-FALLAN: %', v; end if;
  if n < 12 then raise exception '178-FALLAN: se esperaban 12 casos, hay %', n; end if;
  raise notice '178-OK: 12/12';
end $$;
