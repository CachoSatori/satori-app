-- 151_pruebas (antes 100_pruebas) · SOLO STAGING. Aplica la 151 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Devuelve un JSON con cada caso y ok. Se corre con scripts/sql/151_pruebas.py (sale 1 si algún caso falla).
--
-- (Grok 180, 10-nov) Los MARCADORES que llena el runner (este archivo no se corre tal cual):
--   · la línea «-- @@151@@ …» → el cuerpo de supabase/migrations/151_club_catalogo_locales.sql, sin sus líneas begin; y
--     commit; (la 151 corre DENTRO de esta transacción; la 151 es idempotente, así que también vale sobre un staging que
--     ya la tiene);
--   · <OWNER_UUID> y <CAJERO_UUID> → un owner y un cajero ACTIVOS de staging (variables de entorno del runner).
-- «Falla sin el arreglo» (probado el 09-nov): con el cuerpo de la 100 SIN el trigger, caen los casos 3 y 5 con 23503.
begin;
-- @@151@@   (aquí va el cuerpo de supabase/migrations/151_club_catalogo_locales.sql sin begin/commit)
create temp table _r100 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- 1. FK validada y ningún local del Club fuera del catálogo
insert into _r100 (caso, ok, detalle)
select '1 FK club_config → locations validada; ningún local del Club fuera del catálogo',
       coalesce((select convalidated from pg_constraint where conname = 'club_config_location_fk'), false)
       and not exists (select 1 from public.club_config c where not exists (select 1 from public.locations l where l.id = c.location_id)),
       null;

-- 2. los locales que ya estaban en el catálogo NO cambian de estado ni de nombre
insert into _r100 (caso, ok, detalle)
select '2 santa-teresa sigue activa para caja, con su nombre',
       exists (select 1 from public.locations where id = 'santa-teresa' and is_active), null;

-- 3. INSERT directo en club_config (RUNBOOK, migrador, batería): el local entra al catálogo, INACTIVO para caja
do $$ begin
  insert into public.club_config (location_id, nombre, club_activo) values ('prueba-100-sql', 'Local Cien', false);
  insert into _r100 (caso, ok, detalle)
  select '3 INSERT directo en club_config → el local queda en locations, inactivo para caja, con el nombre del Club',
         exists (select 1 from public.locations where id = 'prueba-100-sql' and not is_active and name = 'Local Cien'), null;
exception when others then
  insert into _r100 (caso, ok, detalle) values ('3 INSERT directo en club_config → el local queda en locations, inactivo para caja, con el nombre del Club', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 4. un local que ya existe en el catálogo (local de caja, ACTIVO) se reutiliza sin tocarlo
insert into public.locations (id, name, is_active) values ('prueba-100-caja', 'Local de caja', true);
insert into public.club_config (location_id, nombre, club_activo) values ('prueba-100-caja', 'Otro nombre', false);
insert into _r100 (caso, ok, detalle)
select '4 local de caja existente: sigue activo y con su nombre',
       exists (select 1 from public.locations where id = 'prueba-100-caja' and is_active and name = 'Local de caja'), null;

-- 5. club_local_crear (owner): el local queda en locations (inactivo) y en club_config
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<OWNER_UUID>', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.club_local_crear('prueba-100-app', 'Local App');
  reset role;
  insert into _r100 (caso, ok, detalle)
  select '5 club_local_crear (owner) → en locations inactivo y en club_config',
         exists (select 1 from public.locations where id = 'prueba-100-app' and not is_active)
         and exists (select 1 from public.club_config where location_id = 'prueba-100-app'), null;
exception when others then
  reset role;
  insert into _r100 (caso, ok, detalle) values ('5 club_local_crear (owner) → en locations inactivo y en club_config', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 6. no se puede borrar del catálogo un local que el Club usa
do $$ begin
  delete from public.locations where id = 'prueba-100-sql';
  insert into _r100 (caso, ok, detalle) values ('6 borrar del catálogo un local del Club → 23503', false, 'se borró');
exception when foreign_key_violation then
  insert into _r100 (caso, ok, detalle) values ('6 borrar del catálogo un local del Club → 23503', true, null);
end $$;

-- 7. un cajero no escribe el catálogo (RLS) y anon no lo lee
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<CAJERO_UUID>', 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.locations set name = 'x' where id = 'santa-teresa';
  get diagnostics n = row_count;
  reset role;
  insert into _r100 (caso, ok, detalle) values ('7a cajero: update del catálogo no toca filas (RLS)', n = 0, n::text);
exception when insufficient_privilege then
  reset role;
  insert into _r100 (caso, ok, detalle) values ('7a cajero: update del catálogo no toca filas (RLS)', true, '42501');
end $$;
insert into _r100 (caso, ok, detalle)
select '7b anon sin SELECT en locations', not has_table_privilege('anon', 'public.locations', 'SELECT'), null;

-- 8 (Grok 180). La RLS de locations está ENCENDIDA (sin ella, las negativas de 7 y 9 no probarían nada)
insert into _r100 (caso, ok, detalle)
select '8 RLS encendida en locations', (select relrowsecurity from pg_class where oid = 'public.locations'::regclass), null;

-- 9 (Grok 180). El cajero tampoco INSERTA ni BORRA en el catálogo
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<CAJERO_UUID>', 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.locations (id, name, is_active) values ('prueba-180-cajero', 'Cajero', true);
  reset role;
  insert into _r100 (caso, ok, detalle) values ('9a cajero: INSERT en el catálogo → rechazado', false, 'insertó');
exception when insufficient_privilege then
  reset role;
  insert into _r100 (caso, ok, detalle) values ('9a cajero: INSERT en el catálogo → rechazado', true, '42501');
end $$;
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<CAJERO_UUID>', 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.locations where id = 'prueba-100-caja';
  get diagnostics n = row_count;
  reset role;
  insert into _r100 (caso, ok, detalle) values ('9b cajero: DELETE en el catálogo no borra filas', n = 0, n::text);
exception when insufficient_privilege then
  reset role;
  insert into _r100 (caso, ok, detalle) values ('9b cajero: DELETE en el catálogo no borra filas', true, '42501');
end $$;

-- 10 (Grok 180). Control POSITIVO: el owner sí escribe (si esto falla, las negativas no prueban la RLS sino un error)
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<OWNER_UUID>', 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.locations set name = 'Local de caja (owner)' where id = 'prueba-100-caja';
  get diagnostics n = row_count;
  reset role;
  insert into _r100 (caso, ok, detalle) values ('10 owner: update del catálogo toca 1 fila (control positivo)', n = 1, n::text);
exception when others then
  reset role;
  insert into _r100 (caso, ok, detalle) values ('10 owner: update del catálogo toca 1 fila (control positivo)', false, sqlstate || ' ' || sqlerrm);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r100;
rollback;
