-- 157_pruebas (origen 104) · SOLO STAGING. D7 A: el equipo no canjea, no vence, no cuenta en el pasivo; saldos congelados.
-- Aplica la 157 dentro de una transacción, corre la batería y TODAS las mutaciones, y termina en ROLLBACK: no deja nada.
--
-- MARCADOR que llena el runner (157_pruebas.py): la línea «-- @@157@@ …» → el cuerpo de
-- supabase/migrations/157_club_equipo_sin_creditos.sql sin begin; / commit;.
-- Antes del marcador se guarda una foto del catálogo (permisos, definer, search_path) y de club_movimientos: la 157 no
-- puede cambiar ni los permisos de las funciones vigentes ni el libro.
--
-- Cada ronda (la base y una por mutación) corre en una subtransacción que se descarta: la batería crea sus miembros de
-- prueba (nombres ficticios, UUID fijos), los perfiles de manager y cajero se activan solo adentro, y los JWT se simulan con
-- set_config('request.jwt.claims', …, true). Una mutación rompe a propósito UN arreglo (reemplazo de texto sobre
-- pg_get_functiondef, o un drop) y declara qué casos tienen que caer. Resultado: un JSON con los casos que fallan en la
-- base (tiene que ser []) y, por mutación, si muerde. NO PROBADO no da verde: si falta un perfil o el local, cae el 00.
begin;

create temp table _pre157 on commit drop as
select p.oid::regprocedure::text as fn, p.proacl::text as acl, p.prosecdef as def, p.proconfig::text as cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('club_canje_codigo_generar','club_canje_codigo_generar_pase','club_canje_aplicar','club_canje_aprobado',
                     'club_canje','club_canje_aviso','club_portal','club_pase_datos','club_vencer_candidatos','club_vencer',
                     'club_vencer_simular','club_referente_json','club_reporte_mes');
create temp table _mov157 on commit drop as
select count(*) as n, coalesce(sum(personas), 0) as p, md5(coalesce(string_agg(id::text, ',' order by id), '')) as h
  from public.club_movimientos;

-- @@157@@   (aquí va el cuerpo de la 157 sin begin/commit)

create temp table _r157 (n serial, ronda text, caso text, ok boolean, detalle text) on commit drop;

-- Reemplazo de texto sobre la definición vigente (para las mutaciones). Sin ancla, error: la mutación no prueba nada.
create function pg_temp.reemplazar(p_fn regprocedure, p_viejo text, p_nuevo text) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_viejo in d) = 0 then raise exception 'ANCLA: «%» no está en %', p_viejo, p_fn; end if;
  execute replace(d, p_viejo, p_nuevo);
end $f$;

create function pg_temp.caso(p_ronda text, p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r157 (ronda, caso, ok, detalle) values (p_ronda, p_caso, coalesce(p_ok, false), p_det);
$f$;

create function pg_temp.como(p_id uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', case when p_id is null then '' else json_build_object('sub', p_id, 'role', 'authenticated')::text end, true);
$f$;

create function pg_temp.t157(ro text) returns void language plpgsql as $t$
declare
  E uuid := '00000000-0000-4000-8000-0000000157e1';   -- equipo
  R uuid := '00000000-0000-4000-8000-0000000157a1';   -- referente (control)
  V uuid := '00000000-0000-4000-8000-0000000157b1';   -- referente viejo (control del vencimiento)
  X uuid := '00000000-0000-4000-8000-0000000157c1';   -- equipo que pasa a referente
  S uuid := '00000000-0000-4000-8000-0000000157d1';   -- socio que se anotó con el link de E
  v_loc text; v_cfg public.club_config%rowtype;
  v_own uuid; v_man uuid; v_caj uuid;
  v_clave text := 'clave-de-prueba-157-club-web-no-es-real-0123456789';
  v_tokE text; v_tokR text; v_tokX text; v_paseE text;
  v_cup text; v_cod text; v_n int; v_j jsonb; v_r0 jsonb; v_r1 jsonb; v_t text; v_ok boolean;
  v_crE numeric; v_n2 int;
begin
  select c.* into v_cfg from public.club_config c where c.club_activo order by c.location_id limit 1;
  v_loc := v_cfg.location_id;
  select id into v_own from public.profiles where role::text = 'owner' and is_active order by id limit 1;
  select id into v_man from public.profiles where role::text = 'manager' order by is_active desc, id limit 1;
  select id into v_caj from public.profiles where role::text = 'cajero' order by is_active desc, id limit 1;
  update public.profiles set is_active = true where id in (v_man, v_caj);
  perform pg_temp.caso(ro, '00 prerrequisitos: owner activo, manager, cajero y un local con el Club encendido',
    v_loc is not null and v_own is not null and v_man is not null and v_caj is not null,
    'local = ' || coalesce(v_loc, 'NINGUNO'));
  if v_loc is null or v_own is null or v_man is null or v_caj is null then return; end if;

  -- 0a. funciones nuevas: definer, search_path; internas cerradas; el ranking solo authenticated
  select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'EXECUTE')
                  and has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.proname = 'club_reporte_equipo')), count(*)
    into v_ok, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('club_corte_equipo','club_saldo_canjeable','club_reporte_equipo','club_equipo_corte_trg');
  perform pg_temp.caso(ro, '0a funciones nuevas: definer · search_path · sin anon · internas sin authenticated', v_ok and v_n = 4, v_n || ' funciones');
  -- 0b. las vigentes: mismos permisos, definer y search_path que antes de la 157
  select count(*) into v_n from _pre157 a
    join pg_proc p on p.oid = a.fn::regprocedure
   where p.proacl::text is distinct from a.acl or p.prosecdef <> a.def or p.proconfig::text is distinct from a.cfg;
  perform pg_temp.caso(ro, '0b vigentes: permisos, definer y search_path iguales a antes', v_n = 0 and (select count(*) from _pre157) = 13,
    v_n || ' distintas de ' || (select count(*) from _pre157));
  -- 0c. la 157 no escribió movimientos y dejó una foto por cada cuenta del equipo, con su saldo
  perform pg_temp.caso(ro, '0c la 157 no escribe en club_movimientos',
    (select n = (select count(*) from public.club_movimientos) and h = (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.club_movimientos) from _mov157));
  select count(*) into v_n from public.club_miembros m
   where m.tipo = 'equipo'
     and not exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'equipo_corte'
                       and a.despues->>'motivo' = 'd7_congelar'
                       and (a.despues->>'personas')::int = public.club_saldo_personas(m.id)
                       and not (a.despues ? 'nombre'));
  perform pg_temp.caso(ro, '0c foto del corte: una por cuenta del equipo, con el saldo y sin nombre',
    v_n = 0 and exists (select 1 from public.club_miembros where tipo = 'equipo'), v_n || ' sin foto');

  -- ── datos de prueba ──
  insert into public.club_web_clave (sha256) values (encode(extensions.digest(v_clave, 'sha256'), 'hex'));
  perform set_config('request.headers', json_build_object('x-club-web', v_clave)::text, true);
  insert into public.club_miembros (id, location_id, tipo, nombre) values
    (E, v_loc, 'equipo', 'Equipo Prueba Uno'), (R, v_loc, 'referente', 'Referente Prueba Uno'),
    (V, v_loc, 'referente', 'Referente Prueba Viejo'), (X, v_loc, 'equipo', 'Equipo Prueba Dos'),
    (S, v_loc, 'socio', 'Socio Prueba Uno');
  select token_portal into v_tokE from public.club_miembros where id = E;
  select token_portal into v_tokR from public.club_miembros where id = R;
  select token_portal into v_tokX from public.club_miembros where id = X;
  select token_pase into v_paseE from public.club_miembros where id = E;
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                       fecha_visita, registrado_en, origen, nota) values
    (v_loc, R, 'tarjeta', 3 * v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, now() - interval '1 day', now() - interval '1 day', 'app', 'prueba 157'),
    (v_loc, V, 'tarjeta', v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, now() - interval '800 days', now() - interval '800 days', 'app', 'prueba 157');
  perform pg_temp.como(v_man);
  v_r0 := public.club_reporte_mes((now() at time zone 'America/Costa_Rica')::date, v_loc, true);
  -- saldo viejo del equipo (2 créditos) y de X (2 créditos) antes de su corte
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                       fecha_visita, registrado_en, origen, nota) values
    (v_loc, E, 'tarjeta', 2 * v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, now() - interval '800 days', now() - interval '800 days', 'app', 'prueba 157'),
    (v_loc, X, 'tarjeta', 2 * v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, now() - interval '3 days', now() - interval '3 days', 'app', 'prueba 157');
  update public.club_miembros set tipo = 'referente' where id = X;   -- sale del equipo → corte (trigger)
  perform pg_temp.como(v_man);
  v_r1 := public.club_reporte_mes((now() at time zone 'America/Costa_Rica')::date, v_loc, true);
  perform pg_temp.como(null);

  -- 16. reporte del mes: el saldo del equipo y el congelado de X no entran al pasivo ni a la antigüedad; van aparte
  v_crE := public.club_creditos(2 * v_cfg.personas_por_credito, v_cfg.personas_por_credito);
  perform pg_temp.caso(ro, '16 reporte: pasivo, cuentas con saldo y antigüedad sin el equipo ni el congelado; el congelado va aparte',
    (v_r1->'kpis'->>'saldo_creditos_al_cierre')::numeric = (v_r0->'kpis'->>'saldo_creditos_al_cierre')::numeric
    and (v_r1->'kpis'->>'cuentas_con_saldo')::int = (v_r0->'kpis'->>'cuentas_con_saldo')::int
    and (select coalesce(sum((b->>'creditos')::numeric), 0) from jsonb_array_elements(v_r1->'antiguedad') b)
        = (v_r1->'kpis'->>'saldo_creditos_al_cierre')::numeric
    and (v_r1->'equipo'->>'congelado_creditos')::numeric - (v_r0->'equipo'->>'congelado_creditos')::numeric = 2 * v_crE
    and not (v_r1->'equipo' ? 'creditos'),
    format('pasivo %s→%s · congelado %s→%s', v_r0->'kpis'->>'saldo_creditos_al_cierre', v_r1->'kpis'->>'saldo_creditos_al_cierre',
           v_r0->'equipo'->>'congelado_creditos', v_r1->'equipo'->>'congelado_creditos'));

  -- 14. X salió del equipo: lo de antes del corte no revive; el corte quedó con la foto
  perform pg_temp.caso(ro, '14 sale del equipo → canjeable 0 (el saldo congelado no revive) y foto «sale_del_equipo»',
    public.club_saldo_canjeable(X) = 0 and public.club_saldo_personas(X) = 2 * v_cfg.personas_por_credito
    and exists (select 1 from public.club_auditoria a where a.objeto_id = X and a.accion = 'equipo_corte'
                  and a.despues->>'motivo' = 'sale_del_equipo' and (a.despues->>'personas')::int = 2 * v_cfg.personas_por_credito),
    'canjeable = ' || public.club_saldo_canjeable(X));

  -- 1–2. el equipo no genera código de canje (portal ni pase)
  begin
    perform * from public.club_canje_codigo_generar(v_tokE);
    perform pg_temp.caso(ro, '1 equipo: el portal no genera código de canje', false, 'generó un código');
  exception when others then
    perform pg_temp.caso(ro, '1 equipo: el portal no genera código de canje', sqlerrm = 'Las cuentas del equipo no canjean créditos', sqlerrm);
  end;
  begin
    perform * from public.club_canje_codigo_generar_pase(v_paseE);
    perform pg_temp.caso(ro, '2 equipo: el pase no genera código de canje', false, 'generó un código');
  exception when others then
    perform pg_temp.caso(ro, '2 equipo: el pase no genera código de canje', sqlerrm = 'Las cuentas del equipo no canjean créditos', sqlerrm);
  end;
  -- 3. referente: sí (control)
  begin
    select g.codigo into v_cod from public.club_canje_codigo_generar(v_tokR) g;
    perform pg_temp.caso(ro, '3 referente: genera su código (control)', v_cod ~ '^[A-HJ-NP-Z2-9]{6}$', v_cod);
  exception when others then
    perform pg_temp.caso(ro, '3 referente: genera su código (control)', false, sqlerrm);
  end;

  -- 4. equipo con un código (de antes de la 157) → caja no canjea
  insert into public.club_codigos_canje (location_id, miembro_id, codigo_hash, vence_en)
  values (v_loc, E, public.club_codigo_hash('EQPXYZ'), now() + interval '10 minutes');
  perform pg_temp.como(v_caj);
  begin
    perform * from public.club_canje(E, 'EQPXYZ', v_cfg.canje_min, '000157', gen_random_uuid(), null);
    perform pg_temp.caso(ro, '4 equipo: la caja no canjea aunque traiga código', false, 'canjeó');
  exception when others then
    perform pg_temp.caso(ro, '4 equipo: la caja no canjea aunque traiga código', sqlerrm like 'Es del equipo:%', sqlerrm);
  end;
  -- 6. referente con su código: sí (control)
  begin
    select c.personas into v_n from public.club_canje(R, v_cod, v_cfg.canje_min, '000158', gen_random_uuid(), null) c;
    perform pg_temp.caso(ro, '6 referente: canje con código (control)',
      v_n = 3 * v_cfg.personas_por_credito - (v_cfg.canje_min * v_cfg.personas_por_credito)::int, 'queda ' || v_n);
  exception when others then
    perform pg_temp.caso(ro, '6 referente: canje con código (control)', false, sqlerrm);
  end;
  -- 7. el equipo sí suma personas con sus cupones
  insert into public.club_cupones (location_id, referente_id, vence_en) values (v_loc, E, now() + interval '1 day') returning codigo into v_cup;
  begin
    perform public.club_cupon_usar(v_cup, 2, '000159', gen_random_uuid(), null);
    perform pg_temp.caso(ro, '7 equipo: el cupón usado registra las personas a su nombre',
      exists (select 1 from public.club_movimientos mv join public.club_cupones c on c.id = mv.cupon_id
               where c.codigo = v_cup and mv.miembro_id = E and mv.tipo = 'tarjeta' and mv.personas = 2));
  exception when others then
    perform pg_temp.caso(ro, '7 equipo: el cupón usado registra las personas a su nombre', false, sqlerrm);
  end;
  -- 12. ficha de caja del equipo: sin créditos, con las personas del mes
  v_j := public.club_resolver_miembro(E);
  perform pg_temp.caso(ro, '12 caja: la ficha del equipo dice sin_creditos, saldo 0 y las personas del mes',
    (v_j->'datos'->>'sin_creditos')::boolean and (v_j->'datos'->>'personas')::int = 0 and (v_j->'datos'->>'creditos')::numeric = 0
    and (v_j->'datos'->>'personas_mes')::int = 2, v_j->>'datos');
  perform pg_temp.como(null);

  -- 5. equipo, canje sin celular (manager) → no
  perform pg_temp.como(v_man);
  begin
    perform * from public.club_canje_aprobado(E, v_cfg.canje_min, '000160', gen_random_uuid(), null, 'prueba 157 sin celular');
    perform pg_temp.caso(ro, '5 equipo: «canje sin celular» tampoco', false, 'canjeó');
  exception when others then
    perform pg_temp.caso(ro, '5 equipo: «canje sin celular» tampoco', sqlerrm like 'Es del equipo:%', sqlerrm);
  end;
  -- 15. X (ex equipo) gana personas después del corte: solo eso es canjeable
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                       fecha_visita, registrado_en, origen, nota)
  values (v_loc, X, 'tarjeta', v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, now(), now() + interval '1 minute', 'app', 'prueba 157');
  v_ok := public.club_saldo_canjeable(X) = v_cfg.personas_por_credito;
  begin
    perform * from public.club_canje_aprobado(X, 2, '000161', gen_random_uuid(), null, 'prueba 157 sin celular');
    v_ok := false; v_t := 'canjeó 2 con el saldo congelado';
  exception when others then
    v_ok := v_ok and sqlerrm like 'Saldo insuficiente%'; v_t := sqlerrm;
  end;
  begin
    perform * from public.club_canje_aprobado(X, 1, '000162', gen_random_uuid(), null, 'prueba 157 sin celular');
  exception when others then
    v_ok := false; v_t := v_t || ' · 1 crédito: ' || sqlerrm;
  end;
  perform pg_temp.caso(ro, '15 ex equipo: canjea solo lo de después del corte (2 no, 1 sí)', v_ok, v_t);
  -- 17. ranking del equipo (manager): cupones, personas, mesas y altas; el cajero no lo ve
  insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (S, 'socio', 'activo', 'autoalta')
  on conflict (miembro_id, rol) do nothing;
  update public.club_miembro_roles set referido_por = E, desde = now() where miembro_id = S and rol = 'socio';
  begin
    select jsonb_agg(to_jsonb(q)) into v_j from public.club_reporte_equipo((now() at time zone 'America/Costa_Rica')::date, v_loc) q where q.miembro_id = E;
    v_ok := jsonb_array_length(v_j) = 1 and (v_j->0->>'cupones_usados')::int = 1 and (v_j->0->>'personas')::int = 2
            and (v_j->0->>'mesas')::int = 1 and (v_j->0->>'altas_socios')::int = 1 and v_j->0->>'nombre' = 'Equipo Prueba Uno'
            and not exists (select 1 from public.club_reporte_equipo((now() at time zone 'America/Costa_Rica')::date, v_loc) q where q.miembro_id in (R, X));
    v_t := v_j::text;
  exception when others then
    v_ok := false; v_t := sqlerrm;
  end;
  perform pg_temp.como(v_caj);
  begin
    perform * from public.club_reporte_equipo((now() at time zone 'America/Costa_Rica')::date, v_loc);
    v_ok := false; v_t := v_t || ' · el cajero lo vio';
  exception when others then
    v_ok := v_ok and sqlstate = '42501';
  end;
  perform pg_temp.caso(ro, '17 ranking del equipo: cupones, personas, mesas y altas; solo owner/manager', v_ok, v_t);
  perform pg_temp.como(null);

  -- 8–9. portal: el equipo ve personas registradas, sin créditos ni vencimiento ni otros movimientos
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, origen, nota)
  values (v_loc, E, 'ajuste', -v_cfg.personas_por_credito, v_cfg.personas_por_credito, v_cfg.valor_credito_crc, 'app', 'prueba 157');
  v_j := public.club_portal(v_tokE);
  perform pg_temp.caso(ro, '8 portal del equipo: personas registradas, 0 créditos, sin vencimiento, solo tarjetas',
    (v_j->>'equipo')::boolean and (v_j->>'creditos')::numeric = 0 and (v_j->>'personas')::int = 0
    and (v_j->>'personas_registradas')::int = 2 * v_cfg.personas_por_credito + 2 and (v_j->>'personas_registradas_mes')::int = 2
    and v_j->'vencimiento_meses' = 'null'::jsonb
    and not exists (select 1 from jsonb_array_elements(v_j->'movimientos') x where x->>'tipo' <> 'tarjeta'),
    (v_j - 'socio' - 'nombre' - 'codigo')::text);
  v_j := public.club_portal(v_tokR);
  perform pg_temp.caso(ro, '9 portal del referente: créditos y vencimiento como siempre (control)',
    not (v_j->>'equipo')::boolean and (v_j->>'creditos')::numeric > 0 and (v_j->>'vencimiento_meses')::int = v_cfg.vencimiento_meses
    and v_j->'personas_registradas' = 'null'::jsonb, (v_j - 'socio' - 'nombre' - 'codigo')::text);
  v_j := public.club_portal(v_tokX);
  perform pg_temp.caso(ro, '9b portal de X: solo lo de después del corte (saldo y movimientos)',
    (v_j->>'personas')::int = public.club_saldo_canjeable(X)
    and not exists (select 1 from jsonb_array_elements(v_j->'movimientos') x where (x->>'fecha')::timestamptz < now() - interval '1 day'),
    (v_j - 'socio' - 'nombre' - 'codigo')::text);

  -- 10–11. pase
  v_j := public.club_pase_datos(E);
  perform pg_temp.caso(ro, '10 pase del equipo: con_creditos false, 0 créditos, sin «Canjear», personas del mes',
    v_j->'anfitrion'->>'con_creditos' = 'false' and (v_j->'anfitrion'->>'creditos')::numeric = 0
    and (v_j->'anfitrion'->>'creditos_ganados_mes')::numeric = 0 and v_j->'canjear_url' = 'null'::jsonb
    and (v_j->'anfitrion'->>'referidos_mes')::int = 2, (v_j->'anfitrion')::text || ' · ' || coalesce(v_j->>'canjear_url', 'sin canjear_url'));
  v_j := public.club_pase_datos(R);
  perform pg_temp.caso(ro, '11 pase del referente: con créditos y «Canjear» (control)',
    v_j->'anfitrion'->>'con_creditos' = 'true' and v_j->>'canjear_url' like '%/w/%' and (v_j->'anfitrion'->>'creditos')::numeric > 0);

  -- 13. vencimiento: el equipo no entra; el referente viejo sí (control)
  perform pg_temp.como(v_own);
  begin
    select count(*) filter (where s.miembro_id = E), count(*) filter (where s.miembro_id = V) into v_n, v_n2
      from (select k.miembro_id from public.club_vencer_simular((now() at time zone 'America/Costa_Rica')::date) k) s;
  exception when others then
    v_n := -1; v_t := sqlerrm;
  end;
  perform pg_temp.caso(ro, '13 vencimiento: el equipo no es candidato; el referente viejo sí',
    v_n = 0 and v_n2 = 1 and (select count(*) from public.club_vencer_candidatos((now() at time zone 'America/Costa_Rica')::date) k where k.miembro_id = V) = 1,
    'equipo en la lista: ' || v_n);
  perform pg_temp.como(null);
end $t$;

-- Una ronda en una subtransacción descartada; los resultados salen por el DETAIL del error que la descarta.
create function pg_temp.correr(p_ronda text, p_mut text) returns void language plpgsql as $f$
declare d text;
begin
  begin
    if p_mut is not null then execute p_mut; end if;
    perform pg_temp.t157(p_ronda);
    raise exception 'FIN157' using detail = coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n)
                                                        from _r157 where ronda = p_ronda), '[]')::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'FIN157' then
      insert into _r157 (ronda, caso, ok, detalle)
      select p_ronda, x->>'caso', (x->>'ok')::boolean, x->>'detalle' from jsonb_array_elements(d::jsonb) x;
    else
      insert into _r157 (ronda, caso, ok, detalle) values (p_ronda, 'ERROR', false, sqlerrm);
    end if;
  end;
end $f$;

create temp table _m157 (orden int, nombre text, sql text, caen text[]) on commit drop;
insert into _m157 values
  (1, 'gen_sin_guarda',      $q$select pg_temp.reemplazar('public.club_canje_codigo_generar(text)', 'if v_m.tipo = ''equipo'' then', 'if false then')$q$, '{1,2}'),
  (2, 'aplicar_sin_guarda',  $q$select pg_temp.reemplazar('public.club_canje_aplicar(uuid,text,numeric,text,uuid,jsonb,text)', 'if v_m.tipo = ''equipo'' then', 'if false then')$q$, '{4,5}'),
  (3, 'canjeable_es_saldo',  $q$create or replace function public.club_saldo_canjeable(p_miembro uuid) returns int language sql stable security definer set search_path = public, pg_temp as $$ select public.club_saldo_personas(p_miembro) $$$q$, '{8,10,12,14,15}'),
  (4, 'sin_corte',           $q$create or replace function public.club_corte_equipo(p_miembro uuid) returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$ select null::timestamptz $$$q$, '{14,15,16}'),
  (5, 'sin_trigger',         $q$drop trigger club_equipo_corte_trg on public.club_miembros$q$, '{14,15,16}'),
  (6, 'vence_el_equipo',     $q$select pg_temp.reemplazar('public.club_vencer_candidatos(date)', 'where m.tipo <> ''equipo''', 'where true')$q$, '{13}'),
  (7, 'pasivo_con_equipo',   $q$select pg_temp.reemplazar('public.club_reporte_mes(date,text,boolean)', 'case when p.tipo = ''equipo'' then 0 else greatest(p.canj_p, 0) end', 'greatest(p.saldo_p, 0)')$q$, '{16}'),
  (8, 'pase_con_canjear',    $q$select pg_temp.reemplazar('public.club_pase_datos(uuid)', 'and v_m.tipo <> ''equipo'' then v_base', 'then v_base')$q$, '{10}'),
  (9, 'ranking_sin_rol',     $q$select pg_temp.reemplazar('public.club_reporte_equipo(date,text)', 'v_rol is null or v_rol not in (''owner'',''manager'')', 'false')$q$, '{17}'),
  (10, 'portal_con_creditos', $q$select pg_temp.reemplazar('public.club_portal(text)', 'v_saldo := coalesce(public.club_saldo_canjeable(v_m.id), 0);', 'v_saldo := public.club_saldo_personas(v_m.id);')$q$, '{8,9b}');

select pg_temp.correr('base', null);
select pg_temp.correr(m.nombre, m.sql) from _m157 m order by m.orden;

select jsonb_build_object(
  'base_casos', (select count(*) from _r157 where ronda = 'base'),
  'base_fallan', (select coalesce(jsonb_agg(jsonb_build_object('caso', caso, 'detalle', detalle) order by n), '[]') from _r157 where ronda = 'base' and not ok),
  'base_detalle_00', (select detalle from _r157 where ronda = 'base' and caso like '00 %'),
  'mutaciones', (select jsonb_agg(jsonb_build_object('m', m.nombre, 'esperan', m.caen, 'caen', c.caen,
                                                     'muerde', m.caen <@ coalesce(c.caen, '{}')) order by m.orden)
                   from _m157 m
                   left join lateral (select array_agg(distinct split_part(r.caso, ' ', 1)) as caen from _r157 r
                                       where r.ronda = m.nombre and not r.ok) c on true)) as resultado;

rollback;
