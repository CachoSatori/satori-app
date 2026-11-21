-- 195_pruebas (origen club 139) · Correo base por local (`locations.correo_base`). Postgres local o STAGING (nunca prod).
-- Aplica la 195 dentro de una transacción, corre la batería y TODAS las mutaciones (cada una en una subtransacción
-- descartada), prueba la vuelta atrás y termina en ROLLBACK: no deja nada. Se arma con scripts/sql/195_pruebas.py.
--
-- MARCADORES que llena el runner: «-- @@195@@» → cuerpo de supabase/migrations/195_locations_correo_base.sql sin
-- begin/commit; «-- @@195R@@» → cuerpo de scripts/sql/195_rollback.sql sin begin/commit.
--
-- Datos: un local FICTICIO `prueba195` (lo crea la batería) y correos de ejemplo (@ejemplo.com). Usuarios: el owner, el
-- manager y el salonero ACTIVOS de la base (los primeros por id; solo como JWT, no se les cambia nada; en local los crea
-- 185_preludio_local.sql) y un uid SIN perfil (sin rol). JWT simulados con request.jwt.claims y `set local role`.
-- NO PROBADO no da verde: si falta la columna o un usuario de un rol, cae el 00.
begin;

-- @@195@@   (aquí va el cuerpo de la 195 sin begin/commit)

create temp table _r195 (n serial, ronda text, caso text, ok boolean, detalle text) on commit drop;
grant all on _r195 to public;
grant all on sequence _r195_n_seq to public;

create function pg_temp.caso(p_ronda text, p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r195 (ronda, caso, ok, detalle) values (p_ronda, p_caso, coalesce(p_ok, false), p_det);
$f$;

-- Corre p_sql como p_rol ('authenticated' | 'anon') con el sub dado. Devuelve 'ok:<valor>' si es un SELECT de un valor,
-- 'ok:<filas>' si es otra sentencia (filas tocadas), o '<SQLSTATE>:<mensaje>' si da error (el error es el resultado).
create function pg_temp.como(p_rol text, p_sub uuid, p_sql text) returns text language plpgsql as $f$
declare v text; r text; k int;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_rol)::text, true);
    execute format('set local role %I', p_rol);
    if p_sql ~* '^\s*select' then execute p_sql into v; r := 'ok:' || coalesce(v, 'null');
    else execute p_sql; get diagnostics k = row_count; r := 'ok:' || k; end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return r;
  exception when others then
    -- el subbloque se descarta: el rol y los claims vuelven a los de antes
    return sqlstate || ':' || sqlerrm;
  end;
end $f$;

-- Escribe el valor como el dueño de la tabla (sin RLS): 'ok' o el SQLSTATE con el que la base lo rechaza.
create function pg_temp.check195(p_valor text) returns text language plpgsql as $f$
begin
  begin
    update public.locations set correo_base = p_valor where id = 'prueba195';
    return 'ok';
  exception when others then
    return sqlstate;
  end;
end $f$;

create function pg_temp.valor195() returns text language sql as $f$
  select coalesce(correo_base, '<null>') from public.locations where id = 'prueba195';
$f$;

insert into public.locations (id, name, is_active) values ('prueba195', 'Local Ficticio 195', true)
on conflict (id) do update set name = excluded.name;

create function pg_temp.t195(ro text) returns void language plpgsql as $t$
declare
  O  uuid := (select id from public.profiles where role::text = 'owner'    and is_active order by id limit 1);
  M  uuid := (select id from public.profiles where role::text = 'manager'  and is_active order by id limit 1);
  S  uuid := (select id from public.profiles where role::text = 'salonero' and is_active order by id limit 1);
  X  constant uuid := '00000000-0000-4000-8195-000000000099';   -- uid sin perfil: get_my_role() = null
  v_t text; v_ok boolean; v_malos text;
begin
  perform pg_temp.caso(ro, '00 prerrequisitos: columna, local ficticio y owner/manager/salonero activos',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'locations' and column_name = 'correo_base')
    and exists (select 1 from public.locations where id = 'prueba195')
    and O is not null and M is not null and S is not null,
    concat_ws(' ', 'O', O is not null, 'M', M is not null, 'S', S is not null));
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'locations' and column_name = 'correo_base')
     or O is null or M is null or S is null then return; end if;
  update public.locations set correo_base = null where id = 'prueba195';

  -- 01. catálogo
  perform pg_temp.caso(ro, '01 columna: text, nullable, con comentario; RLS de locations encendida',
    (select data_type = 'text' and is_nullable = 'YES' from information_schema.columns
      where table_schema = 'public' and table_name = 'locations' and column_name = 'correo_base')
    and col_description('public.locations'::regclass,
          (select attnum from pg_attribute where attrelid = 'public.locations'::regclass and attname = 'correo_base')) like 'Mig 195:%'
    and (select relrowsecurity from pg_class where oid = 'public.locations'::regclass));

  -- 02–04. check de formato (como dueño de la tabla, sin RLS)
  perform pg_temp.caso(ro, '02 check: existe y acepta null (sin cargar)',
    exists (select 1 from pg_constraint where conrelid = 'public.locations'::regclass
             and conname = 'locations_correo_base_formato' and contype = 'c')
    and pg_temp.check195(null) = 'ok');
  select string_agg(v, ' | ') into v_malos
    from unnest(array['local@ejemplo.com', 'mi.local_2@sub.ejemplo.co', 'a-b%c@ejemplo.org',
                      repeat('a', 242) || '@ejemplo.com']) v      -- 254 justos
   where pg_temp.check195(v) <> 'ok';
  perform pg_temp.caso(ro, '03 check acepta correos válidos (hasta 254)', v_malos is null, v_malos);
  select string_agg(coalesce(v, '<null>') || '→' || pg_temp.check195(v), ' | ') into v_malos
    from unnest(array['', ' ', 'sin-arroba', 'a@b', 'a@@ejemplo.com', '@ejemplo.com', 'a@.com',
                      'x+y@ejemplo.com', ' local@ejemplo.com', 'local@ejemplo.com ', 'a b@ejemplo.com',
                      repeat('a', 243) || '@ejemplo.com']) v     -- 255: uno de más
   where pg_temp.check195(v) <> '23514';
  perform pg_temp.caso(ro, '04 check rechaza (23514) vacío, sin arroba, «+», espacios y más de 254', v_malos is null, v_malos);
  update public.locations set correo_base = null where id = 'prueba195';

  -- 05–07. escribir: solo owner (locations_write_owner)
  v_t := pg_temp.como('authenticated', O, $q$update public.locations set correo_base = 'owner@ejemplo.com' where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '05 owner escribe el correo base (1 fila)', v_t = 'ok:1' and pg_temp.valor195() = 'owner@ejemplo.com', v_t);
  v_t := pg_temp.como('authenticated', O, $q$update public.locations set correo_base = 'x+y@ejemplo.com' where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '05b owner con formato inválido: la base lo rechaza (23514)',
    v_t like '23514:%' and pg_temp.valor195() = 'owner@ejemplo.com', v_t);
  v_t := pg_temp.como('authenticated', M, $q$update public.locations set correo_base = 'manager@ejemplo.com' where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '06 manager NO escribe (0 filas, valor intacto)', v_t = 'ok:0' and pg_temp.valor195() = 'owner@ejemplo.com', v_t);
  v_t := pg_temp.como('authenticated', S, $q$update public.locations set correo_base = 'salonero@ejemplo.com' where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '07 salonero NO escribe (0 filas, valor intacto)', v_t = 'ok:0' and pg_temp.valor195() = 'owner@ejemplo.com', v_t);

  -- 08–10. leer: quien hoy lee locations (authenticated con rol); sin rol no; anon nada
  select bool_and(pg_temp.como('authenticated', u, $q$select correo_base from public.locations where id = 'prueba195'$q$)
                  = 'ok:owner@ejemplo.com')
    into v_ok from unnest(array[O, M, S]) u;
  perform pg_temp.caso(ro, '08 owner, manager y salonero leen el correo base (igual que el nombre)', v_ok);
  v_t := pg_temp.como('authenticated', X, $q$select count(*)::text from public.locations where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '09 sin rol (uid sin perfil) no ve el local', v_t = 'ok:0', v_t);
  v_t := pg_temp.como('anon', null, $q$select correo_base from public.locations where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '10 anon no lee (42501)', v_t like '42501:%', v_t);
  v_t := pg_temp.como('anon', null, $q$update public.locations set correo_base = 'anon@ejemplo.com' where id = 'prueba195'$q$);
  perform pg_temp.caso(ro, '11 anon no escribe (42501) y el valor sigue', v_t like '42501:%' and pg_temp.valor195() = 'owner@ejemplo.com', v_t);

  -- 12. la 195 no agrega políticas: las de locations son las dos de la 091/151
  select string_agg(policyname, ',' order by policyname) into v_t from pg_policies
   where schemaname = 'public' and tablename = 'locations';
  perform pg_temp.caso(ro, '12 políticas de locations: solo locations_select_activos y locations_write_owner',
    v_t = 'locations_select_activos,locations_write_owner', v_t);
end $t$;

-- Una ronda en una subtransacción descartada; los resultados salen por el DETAIL del error que la descarta.
create function pg_temp.correr(p_ronda text, p_mut text) returns void language plpgsql as $f$
declare d text;
begin
  begin
    if p_mut is not null then execute p_mut; end if;
    perform pg_temp.t195(p_ronda);
    raise exception 'FIN195' using detail = coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n)
                                                        from _r195 where ronda = p_ronda), '[]')::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'FIN195' then
      insert into _r195 (ronda, caso, ok, detalle)
      select p_ronda, x->>'caso', (x->>'ok')::boolean, x->>'detalle' from jsonb_array_elements(d::jsonb) x;
    else
      insert into _r195 (ronda, caso, ok, detalle) values (p_ronda, 'ERROR', false, sqlerrm);
    end if;
  end;
end $f$;

-- Mutaciones: cada una rompe UNA pieza y declara qué casos tienen que caer.
create temp table _m195 (orden int, nombre text, sql text, caen text[]) on commit drop;
insert into _m195 values
  (1, 'sin_check',        $q$alter table public.locations drop constraint locations_correo_base_formato$q$, '{02,04,05b}'),
  (2, 'check_flojo',      $q$alter table public.locations drop constraint locations_correo_base_formato;
                             alter table public.locations add constraint locations_correo_base_formato check (correo_base is null or correo_base like '%@%')$q$, '{04,05b}'),
  (3, 'check_sin_largo',  $q$alter table public.locations drop constraint locations_correo_base_formato;
                             alter table public.locations add constraint locations_correo_base_formato check (correo_base is null or correo_base ~ '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')$q$, '{04}'),
  (4, 'manager_escribe',  $q$create policy _m4 on public.locations for update to authenticated
                               using (public.get_my_role()::text in ('owner', 'manager')) with check (true)$q$, '{06,12}'),
  (5, 'todos_escriben',   $q$alter policy locations_write_owner on public.locations using (true) with check (true)$q$, '{06,07}'),
  (6, 'lee_sin_rol',      $q$alter policy locations_select_activos on public.locations using (true)$q$, '{09}'),
  (7, 'anon_lee',         $q$grant select on public.locations to anon;
                             create policy _m7 on public.locations for select to anon using (true)$q$, '{10,12}'),
  (8, 'sin_rls',          $q$alter table public.locations disable row level security$q$, '{01,06,07,09}');

select pg_temp.correr('base', null);
select pg_temp.correr(m.nombre, m.sql) from _m195 m order by m.orden;

-- Vuelta atrás (en esta misma transacción descartada): sin columna y sin check; el resto de locations intacto.
-- @@195R@@   (aquí va el cuerpo de scripts/sql/195_rollback.sql sin begin/commit)
insert into _r195 (ronda, caso, ok, detalle)
select 'rollback', '13 rollback: sin columna ni check; políticas y RLS de locations como antes',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'locations' and column_name = 'correo_base')
       and not exists (select 1 from pg_constraint where conname = 'locations_correo_base_formato')
       and (select relrowsecurity from pg_class where oid = 'public.locations'::regclass)
       and (select string_agg(policyname, ',' order by policyname) from pg_policies
             where schemaname = 'public' and tablename = 'locations') = 'locations_select_activos,locations_write_owner',
       null;

-- Resultado legible
select jsonb_build_object(
  'base', (select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r195 where ronda in ('base', 'rollback')),
  'mutaciones', (select jsonb_agg(jsonb_build_object('m', m.nombre, 'esperan', m.caen, 'caen', c.caen,
                                                     'muerde', m.caen <@ coalesce(c.caen, '{}')) order by m.orden)
                   from _m195 m
                   left join lateral (select array_agg(distinct split_part(r.caso, ' ', 1)) as caen from _r195 r
                                       where r.ronda = m.nombre and not r.ok) c on true)) as resultado;

-- ASSERT: cada caso de la base que falla y cada mutación que NO muerde sale como WARNING («195 FALLA …»), después el
-- resumen («195 RESUMEN: pasaron X / fallaron Y de N») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «195-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 15;    -- 14 casos de la base (00–12 con 05b) + el 13 (rollback)
  v_mut constant int := 8;
  v_tot int; v_ok int; v_mal int; v_lista text; v_nm int;
begin
  for r in select caso, detalle from _r195 where ronda in ('base', 'rollback') and ok is not true order by n loop
    raise warning '195 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true),
         string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r195 where ronda in ('base', 'rollback');
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '195 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  -- mutaciones: cada una tiene que hacer caer TODOS los casos que declara
  select count(*) into v_nm from _m195;
  for r in select m.nombre, m.caen, c.caen as cayeron
             from _m195 m
             left join lateral (select array_agg(distinct split_part(x.caso, ' ', 1)) as caen from _r195 x
                                 where x.ronda = m.nombre and not x.ok) c on true
            where not (m.caen <@ coalesce(c.caen, '{}')) order by m.orden loop
    raise warning '195 FALLA mutación % no muerde: esperaba % y cayeron %', r.nombre, r.caen, coalesce(r.cayeron::text, '{}');
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mut:' || r.nombre);
  end loop;
  if v_nm <> v_mut then
    raise warning '195 FALLA cantidad de mutaciones: se esperaban % y hay %', v_mut, v_nm;
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mutaciones');
  end if;
  raise notice '195 RESUMEN: pasaron % / fallaron % de % (+ % mutaciones)', v_ok, v_mal, v_esp, v_mut;
  if v_mal > 0 then raise exception '195-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
