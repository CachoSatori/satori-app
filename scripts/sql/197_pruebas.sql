-- 197_pruebas (origen 141) · Competencias de Ventas: el contador solo mira. Postgres local o STAGING (nunca prod).
-- Aplica la 197 dentro de una transacción, corre la batería y TODAS las mutaciones (cada una en una subtransacción
-- descartada), prueba la vuelta atrás y termina en ROLLBACK: no deja nada. Se arma con scripts/sql/197_pruebas.py.
--
-- MARCADORES que llena el runner: «-- @@197@@» → cuerpo de supabase/migrations/197_ventas_comps_sin_contador.sql sin
-- begin/commit; «-- @@197R@@» → cuerpo de scripts/sql/197_rollback.sql sin begin/commit.
--
-- Datos: una competencia FICTICIA (`data->>'id'` empieza con «prueba197»; la crea la batería). Usuarios: el owner, el
-- manager, el contador y el salonero ACTIVOS de la base (los primeros por id; solo como JWT, no se les cambia nada; en
-- local los crea 197_preludio_local.sql) y un uid SIN perfil (sin rol). JWT simulados con request.jwt.claims y
-- `set local role`. NO PROBADO no da verde: si falta un usuario de un rol, cae el 00.
begin;

-- @@197@@   (aquí va el cuerpo de la 197 sin begin/commit)

create temp table _r197 (n serial, ronda text, caso text, ok boolean, detalle text) on commit drop;
grant all on _r197 to public;
grant all on sequence _r197_n_seq to public;

create function pg_temp.caso(p_ronda text, p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r197 (ronda, caso, ok, detalle) values (p_ronda, p_caso, coalesce(p_ok, false), p_det);
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

-- Lo que hay en la base (como dueño de la tabla, sin RLS)
create function pg_temp.n197(p_id text) returns int language sql as $f$
  select count(*)::int from public.ventas_comps where data->>'id' = p_id;
$f$;
create function pg_temp.nombre197(p_id text) returns text language sql as $f$
  select coalesce(max(data->>'nombre'), '<no está>') from public.ventas_comps where data->>'id' = p_id;
$f$;

create function pg_temp.t197(ro text) returns void language plpgsql as $t$
declare
  O  uuid := (select id from public.profiles where role::text = 'owner'    and is_active order by id limit 1);
  M  uuid := (select id from public.profiles where role::text = 'manager'  and is_active order by id limit 1);
  C  uuid := (select id from public.profiles where role::text = 'contador' and is_active order by id limit 1);
  S  uuid := (select id from public.profiles where role::text = 'salonero' and is_active order by id limit 1);
  X  constant uuid := '00000000-0000-4000-8197-000000000099';   -- uid sin perfil: get_my_role() = null
  NUEVA constant text := $j$insert into public.ventas_comps (data, created_at, updated_at) values (jsonb_build_object('id', '%s', 'nombre', 'Competencia ficticia', 'tipo', 'especial', 'inicio', '2026-01-01', 'fin', '2026-01-31', 'premio', 'Premio ficticio', 'prods', '[]'::jsonb, 'parts', '[]'::jsonb), now(), now())$j$;
  CAMBIA constant text := $j$update public.ventas_comps set data = data || '{"nombre":"%s"}'::jsonb, updated_at = now() where data->>'id' = '%s'$j$;
  BORRA  constant text := $j$delete from public.ventas_comps where data->>'id' = '%s'$j$;
  LEE    constant text := $j$select count(*)::text from public.ventas_comps where data->>'id' = '%s'$j$;
  v_t text; v_t2 text; v_t3 text; w record;
begin
  perform pg_temp.caso(ro, '00 prerrequisitos: owner, manager, contador y salonero activos',
    O is not null and M is not null and C is not null and S is not null,
    concat_ws(' ', 'O', O is not null, 'M', M is not null, 'C', C is not null, 'S', S is not null));
  if O is null or M is null or C is null or S is null then return; end if;

  -- la competencia base (como dueño de la tabla)
  execute format(NUEVA, 'prueba197-base');

  -- 01–02. catálogo
  select p.cmd, p.roles::text as roles, p.qual, p.with_check into w from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'ventas_comps' and p.policyname = 'ventas_comps_write';
  perform pg_temp.caso(ro, '01 escritura: RLS encendida, solo read+write, write = ALL a authenticated, owner y manager sin contador',
    (select relrowsecurity from pg_class where oid = 'public.ventas_comps'::regclass)
    and (select string_agg(policyname, ',' order by policyname) from pg_policies
          where schemaname = 'public' and tablename = 'ventas_comps') = 'ventas_comps_read,ventas_comps_write'
    and w.cmd = 'ALL' and w.roles = '{authenticated}' and w.qual = w.with_check
    and w.qual like '%''owner''%' and w.qual like '%''manager''%' and w.qual not like '%contador%'
    and obj_description((select oid from pg_policy where polrelid = 'public.ventas_comps'::regclass
                          and polname = 'ventas_comps_write'), 'pg_policy') like 'Mig 197:%',
    concat_ws(' · ', w.cmd, w.roles, w.qual, w.with_check));
  select p.qual into v_t from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'ventas_comps' and p.policyname = 'ventas_comps_read';
  perform pg_temp.caso(ro, '02 lectura intacta (la de la 093: cualquier perfil activo)',
    v_t = '(( SELECT get_my_role() AS get_my_role) IS NOT NULL)', v_t);

  -- 03–05. owner escribe
  v_t := pg_temp.como('authenticated', O, format(NUEVA, 'prueba197-o'));
  perform pg_temp.caso(ro, '03 owner crea (1 fila)', v_t = 'ok:1' and pg_temp.n197('prueba197-o') = 1, v_t);
  v_t := pg_temp.como('authenticated', O, format(CAMBIA, 'cambio owner', 'prueba197-base'));
  perform pg_temp.caso(ro, '04 owner cambia (1 fila)', v_t = 'ok:1' and pg_temp.nombre197('prueba197-base') = 'cambio owner', v_t);
  v_t := pg_temp.como('authenticated', O, format(BORRA, 'prueba197-o'));
  perform pg_temp.caso(ro, '05 owner borra (1 fila)', v_t = 'ok:1' and pg_temp.n197('prueba197-o') = 0, v_t);

  -- 06–08. manager escribe (sin columna de local: cualquier competencia, como hoy)
  v_t := pg_temp.como('authenticated', M, format(NUEVA, 'prueba197-m'));
  perform pg_temp.caso(ro, '06 manager crea (1 fila)', v_t = 'ok:1' and pg_temp.n197('prueba197-m') = 1, v_t);
  v_t := pg_temp.como('authenticated', M, format(CAMBIA, 'cambio manager', 'prueba197-base'));
  perform pg_temp.caso(ro, '07 manager cambia (1 fila)', v_t = 'ok:1' and pg_temp.nombre197('prueba197-base') = 'cambio manager', v_t);
  v_t := pg_temp.como('authenticated', M, format(BORRA, 'prueba197-m'));
  perform pg_temp.caso(ro, '08 manager borra (1 fila)', v_t = 'ok:1' and pg_temp.n197('prueba197-m') = 0, v_t);

  -- 09–12. contador: solo mira
  v_t := pg_temp.como('authenticated', C, format(NUEVA, 'prueba197-c'));
  perform pg_temp.caso(ro, '09 contador NO crea (42501, no queda fila)', v_t like '42501:%' and pg_temp.n197('prueba197-c') = 0, v_t);
  v_t := pg_temp.como('authenticated', C, format(CAMBIA, 'cambio contador', 'prueba197-base'));
  perform pg_temp.caso(ro, '10 contador NO cambia (0 filas, nombre intacto)',
    v_t = 'ok:0' and pg_temp.nombre197('prueba197-base') = 'cambio manager', v_t);
  v_t := pg_temp.como('authenticated', C, format(BORRA, 'prueba197-base'));
  perform pg_temp.caso(ro, '11 contador NO borra (0 filas, sigue)', v_t = 'ok:0' and pg_temp.n197('prueba197-base') = 1, v_t);
  v_t := pg_temp.como('authenticated', C, format(LEE, 'prueba197-base'));
  perform pg_temp.caso(ro, '12 contador SÍ lee la competencia', v_t = 'ok:1', v_t);

  -- 13–14. salonero: no escribe, lee (como hoy)
  v_t  := pg_temp.como('authenticated', S, format(NUEVA, 'prueba197-s'));
  v_t2 := pg_temp.como('authenticated', S, format(CAMBIA, 'cambio salonero', 'prueba197-base'));
  v_t3 := pg_temp.como('authenticated', S, format(BORRA, 'prueba197-base'));
  perform pg_temp.caso(ro, '13 salonero NO crea (42501), NO cambia ni borra (0 filas)',
    v_t like '42501:%' and v_t2 = 'ok:0' and v_t3 = 'ok:0'
    and pg_temp.n197('prueba197-s') = 0 and pg_temp.n197('prueba197-base') = 1
    and pg_temp.nombre197('prueba197-base') = 'cambio manager', concat_ws(' · ', v_t, v_t2, v_t3));
  v_t := pg_temp.como('authenticated', S, format(LEE, 'prueba197-base'));
  perform pg_temp.caso(ro, '14 salonero lee (como hoy, la 197 no toca la lectura)', v_t = 'ok:1', v_t);

  -- 15–16. sin rol y anon
  v_t  := pg_temp.como('authenticated', X, format(LEE, 'prueba197-base'));
  v_t2 := pg_temp.como('authenticated', X, format(NUEVA, 'prueba197-x'));
  perform pg_temp.caso(ro, '15 sin rol: no ve (0) y no crea (42501)',
    v_t = 'ok:0' and v_t2 like '42501:%' and pg_temp.n197('prueba197-x') = 0, concat_ws(' · ', v_t, v_t2));
  v_t  := pg_temp.como('anon', null, format(LEE, 'prueba197-base'));
  v_t2 := pg_temp.como('anon', null, format(NUEVA, 'prueba197-a'));
  perform pg_temp.caso(ro, '16 anon: no ve y no crea',
    (v_t like '42501:%' or v_t = 'ok:0') and v_t2 like '42501:%' and pg_temp.n197('prueba197-a') = 0,
    concat_ws(' · ', v_t, v_t2));
end $t$;

-- Una ronda en una subtransacción descartada; los resultados salen por el DETAIL del error que la descarta.
create function pg_temp.correr(p_ronda text, p_mut text) returns void language plpgsql as $f$
declare d text;
begin
  begin
    if p_mut is not null then execute p_mut; end if;
    perform pg_temp.t197(p_ronda);
    raise exception 'FIN197' using detail = coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n)
                                                        from _r197 where ronda = p_ronda), '[]')::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'FIN197' then
      insert into _r197 (ronda, caso, ok, detalle)
      select p_ronda, x->>'caso', (x->>'ok')::boolean, x->>'detalle' from jsonb_array_elements(d::jsonb) x;
    else
      insert into _r197 (ronda, caso, ok, detalle) values (p_ronda, 'ERROR', false, sqlerrm);
    end if;
  end;
end $f$;

-- Mutaciones: cada una rompe UNA pieza y declara qué casos tienen que caer.
create temp table _m197 (orden int, nombre text, sql text, caen text[]) on commit drop;
insert into _m197 values
  (1, 'contador_escribe',  $q$alter policy ventas_comps_write on public.ventas_comps
                               using (public.get_my_role() in ('owner', 'manager', 'contador'))
                               with check (public.get_my_role() in ('owner', 'manager', 'contador'))$q$, '{01,09,10,11}'),
  (2, 'solo_owner',        $q$alter policy ventas_comps_write on public.ventas_comps
                               using (public.get_my_role() = 'owner') with check (public.get_my_role() = 'owner')$q$, '{06,07,08}'),
  (3, 'check_abierto',     $q$alter policy ventas_comps_write on public.ventas_comps with check (true)$q$, '{01,09,13}'),
  (4, 'lectura_cerrada',   $q$alter policy ventas_comps_read on public.ventas_comps
                               using (public.get_my_role() in ('owner', 'manager'))$q$, '{02,12,14}'),
  (5, 'extra_crea_contador', $q$create policy _m5 on public.ventas_comps for insert to authenticated
                               with check (public.get_my_role() = 'contador')$q$, '{01,09}'),
  (6, 'extra_borra_contador', $q$create policy _m6 on public.ventas_comps for delete to authenticated
                               using (public.get_my_role() = 'contador')$q$, '{01,11}'),
  (7, 'sin_rls',           $q$alter table public.ventas_comps disable row level security$q$, '{01,09,10,11,13,15}');

select pg_temp.correr('base', null);
select pg_temp.correr(m.nombre, m.sql) from _m197 m order by m.orden;

-- Vuelta atrás (en esta misma transacción descartada): la política queda EXACTAMENTE como en prod antes de la 197.
-- @@197R@@   (aquí va el cuerpo de scripts/sql/197_rollback.sql sin begin/commit)
insert into _r197 (ronda, caso, ok, detalle)
select 'rollback', 'R1 rollback: write como prod (011) sin comentario; read intacta; solo esas dos; RLS encendida',
       (select relrowsecurity from pg_class where oid = 'public.ventas_comps'::regclass)
       and p.cmd = 'ALL' and p.roles::text = '{authenticated}'
       and p.qual = $e$(get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))$e$
       and p.with_check = p.qual
       and obj_description((select oid from pg_policy where polrelid = 'public.ventas_comps'::regclass
                             and polname = 'ventas_comps_write'), 'pg_policy') is null
       and (select qual from pg_policies where schemaname = 'public' and tablename = 'ventas_comps'
             and policyname = 'ventas_comps_read') = '(( SELECT get_my_role() AS get_my_role) IS NOT NULL)'
       and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ventas_comps') = 2,
       concat_ws(' · ', p.cmd, p.roles::text, p.qual, p.with_check)
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'ventas_comps' and p.policyname = 'ventas_comps_write';
insert into _r197 (ronda, caso, ok, detalle)
select 'rollback', 'R2 rollback: el contador vuelve a crear (como hoy en prod)', v like 'ok:1', v
  from (select pg_temp.como('authenticated',
                 (select id from public.profiles where role::text = 'contador' and is_active order by id limit 1),
                 $q$insert into public.ventas_comps (data) values ('{"id":"prueba197-r"}'::jsonb)$q$) v) s;

-- Resultado legible
select jsonb_build_object(
  'base', (select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r197 where ronda in ('base', 'rollback')),
  'mutaciones', (select jsonb_agg(jsonb_build_object('m', m.nombre, 'esperan', m.caen, 'caen', c.caen,
                                                     'muerde', m.caen <@ coalesce(c.caen, '{}')) order by m.orden)
                   from _m197 m
                   left join lateral (select array_agg(distinct split_part(r.caso, ' ', 1)) as caen from _r197 r
                                       where r.ronda = m.nombre and not r.ok) c on true)) as resultado;

-- ASSERT: cada caso de la base que falla y cada mutación que NO muerde sale como WARNING («197 FALLA …»), después el
-- resumen («197 RESUMEN: pasaron X / fallaron Y de N») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «197-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 19;    -- 17 casos de la base (00–16) + R1 y R2 (rollback)
  v_mut constant int := 7;
  v_tot int; v_ok int; v_mal int; v_lista text; v_nm int;
begin
  for r in select caso, detalle from _r197 where ronda in ('base', 'rollback') and ok is not true order by n loop
    raise warning '197 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true),
         string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r197 where ronda in ('base', 'rollback');
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '197 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  -- mutaciones: cada una tiene que hacer caer TODOS los casos que declara
  select count(*) into v_nm from _m197;
  for r in select m.nombre, m.caen, c.caen as cayeron
             from _m197 m
             left join lateral (select array_agg(distinct split_part(x.caso, ' ', 1)) as caen from _r197 x
                                 where x.ronda = m.nombre and not x.ok) c on true
            where not (m.caen <@ coalesce(c.caen, '{}')) order by m.orden loop
    raise warning '197 FALLA mutación % no muerde: esperaba % y cayeron %', r.nombre, r.caen, coalesce(r.cayeron::text, '{}');
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mut:' || r.nombre);
  end loop;
  if v_nm <> v_mut then
    raise warning '197 FALLA cantidad de mutaciones: se esperaban % y hay %', v_mut, v_nm;
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mutaciones');
  end if;
  raise notice '197 RESUMEN: pasaron % / fallaron % de % (+ % mutaciones)', v_ok, v_mal, v_esp, v_mut;
  if v_mal > 0 then raise exception '197-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
