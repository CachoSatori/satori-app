-- 075_pruebas_staging.sql — pruebas de la F1a (Club Satori). SOLO STAGING. Todo corre en UNA transacción
-- que termina en ROLLBACK: no deja datos. Reemplazar <CAJERO_UUID>, <OWNER_UUID> y <SALONERO_UUID> por
-- perfiles activos de staging (la prueba 6 los desactiva dentro de la transacción y el rollback lo deshace).
-- Devuelve un JSON con cada caso y ok=true/false. Correr por la Management API (un solo request).
begin;

create temp table _res (n serial, prueba text, caso text, ok boolean, detalle text);
create temp table _ids (k text primary key, v text);
grant select on _ids to anon, authenticated;

-- Cambio de rol simulado (como PostgREST): claims + role.
create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_rol)::text
         else json_build_object('role', p_rol, 'sub', p_uid)::text end, true);
  execute format('set local role %I', p_rol);
end $f$;

create function pg_temp.yo() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.r(p text, c text, ok boolean, d text) returns void language sql as $f$
  insert into pg_temp._res(prueba, caso, ok, detalle) values (p, c, ok, d);
$f$;

-- ── Datos de prueba (como postgres; todo se deshace al final) ──
do $$
declare v_neg uuid; v_ref uuid; v_m2 uuid; v_m3 uuid; v_old uuid;
begin
  insert into club_negocios(nombre, tipo) values ('Hotel Prueba F1a', 'hotel') returning id into v_neg;
  insert into club_miembros(tipo, nombre, negocio_id) values ('referente','Ref Prueba', v_neg) returning id into v_ref;
  insert into club_miembros(tipo, nombre) values ('referente','Canje Prueba') returning id into v_m2;
  insert into club_miembros(tipo, nombre) values ('referente','Poco Saldo') returning id into v_m3;
  insert into club_miembros(tipo, nombre, created_at) values ('referente','Viejo', now() - interval '2 years') returning id into v_old;
  -- saldo 9 personas para el canje de 1,5; 2 personas para el insuficiente
  insert into club_movimientos(miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen)
  values (v_m2, 'tarjeta', 9, 6, 18000, now(), 'migracion'),
         (v_m3, 'tarjeta', 2, 6, 18000, now(), 'migracion'),
         (v_old,'tarjeta', 13, 6, 18000, now() - interval '13 months', 'migracion');
  insert into club_miembros_contacto(miembro_id, telefono, email) values (v_ref, '+50688887777', 'x@ejemplo.com');
  insert into _ids values ('ref', v_ref), ('m2', v_m2), ('m3', v_m3), ('old', v_old),
    ('ref_cod', (select codigo from club_miembros where id = v_ref)),
    ('ref_tok', (select token_portal from club_miembros where id = v_ref));
end $$;

-- ═══ 1. Anon: lectura o escritura directa en club_* → rechazada ═══
do $$
declare t text; v_ok boolean;
begin
  foreach t in array array['club_config','club_negocios','club_miembros','club_miembros_contacto','club_cupones',
                           'club_movimientos','club_pm_cargos','club_pm_pagos','club_visitas','club_saldos'] loop
    begin
      perform pg_temp.como('anon', null);
      execute format('select count(*) from public.%I', t);
      perform pg_temp.yo(); perform pg_temp.r('1', 'anon SELECT '||t, false, 'leyó');
    exception when insufficient_privilege then
      perform pg_temp.yo(); perform pg_temp.r('1', 'anon SELECT '||t, true, sqlerrm);
    end;
  end loop;
  begin
    perform pg_temp.como('anon', null);
    insert into public.club_movimientos(miembro_id, tipo, personas, personas_por_credito, valor_credito_crc)
      values ((select v::uuid from _ids where k='ref'), 'tarjeta', 99, 6, 18000);
    perform pg_temp.yo(); perform pg_temp.r('1', 'anon INSERT club_movimientos', false, 'insertó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('1', 'anon INSERT club_movimientos', true, sqlerrm);
  end;
  -- staff tampoco inserta directo (cajero)
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    insert into public.club_movimientos(miembro_id, tipo, personas, personas_por_credito, valor_credito_crc)
      values ((select v::uuid from _ids where k='ref'), 'tarjeta', 99, 6, 18000);
    perform pg_temp.yo(); perform pg_temp.r('1', 'cajero INSERT directo club_movimientos', false, 'insertó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('1', 'cajero INSERT directo club_movimientos', true, sqlerrm);
  end;
  -- anon no puede ejecutar funciones de staff
  begin
    perform pg_temp.como('anon', null);
    perform public.club_canje((select v::uuid from _ids where k='m2'), 1, 'F1', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('1', 'anon EXECUTE club_canje', false, 'ejecutó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('1', 'anon EXECUTE club_canje', true, sqlerrm);
  end;
end $$;

-- ═══ 2. Anon: club_cupon_crear ═══
do $$
declare v_cod text; v_vence timestamptz; i int; v_wa text;
begin
  perform pg_temp.como('anon', null);
  select c.codigo, c.vence_en into v_cod, v_vence
    from public.club_cupon_crear((select v from _ids where k='ref_cod'),
                                 '{"nombre":"Ana","whatsapp":"8888 1234","optin":true}'::jsonb) c;
  perform pg_temp.yo();
  insert into _ids values ('cupon1', v_cod);
  select contacto_whatsapp into v_wa from club_cupones where codigo = v_cod;
  perform pg_temp.r('2', 'código válido → cupón', v_cod ~ '^[A-HJ-NP-Z2-9]{10}$'
      and v_vence between now() + interval '4 days 23 hours' and now() + interval '5 days 1 hour',
      format('codigo=%s vence_en=+%s whatsapp normalizado=%s', v_cod, v_vence - now(), v_wa));

  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear('ZZZZZZZZ', null);
    perform pg_temp.yo(); perform pg_temp.r('2', 'código inexistente', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('2', 'código inexistente → error genérico', sqlerrm = 'Código no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear('mal-formato!', null);
    perform pg_temp.yo(); perform pg_temp.r('2', 'código mal formado', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('2', 'código mal formado → mismo error', sqlerrm = 'Código no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear((select v from _ids where k='ref_cod'), '{"email":"no-es-email"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('2', 'email inválido', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('2', 'email inválido → error', sqlerrm = 'Datos de contacto no válidos', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear((select v from _ids where k='ref_cod'), jsonb_build_object('nombre', repeat('x', 81)));
    perform pg_temp.yo(); perform pg_temp.r('2', 'nombre > 80', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('2', 'nombre > 80 → error', sqlerrm = 'Datos de contacto no válidos', sqlerrm);
  end;

  -- tope diario: se baja a 3 para la prueba (ya hay 1 cupón hoy)
  update club_config set cupones_max_dia_referente = 3 where location_id = 'santa-teresa';
  perform pg_temp.como('anon', null);
  perform public.club_cupon_crear((select v from _ids where k='ref_cod'), null);
  perform public.club_cupon_crear((select v from _ids where k='ref_cod'), null);
  perform pg_temp.yo();
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear((select v from _ids where k='ref_cod'), null);
    perform pg_temp.yo(); perform pg_temp.r('2', 'pasado el tope diario', false, 'creó el 4º');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('2', 'pasado el tope diario (3) → error', true, sqlerrm);
  end;
  update club_config set cupones_max_dia_referente = 30 where location_id = 'santa-teresa';
end $$;

-- ═══ 3. Cajero: club_cupon_usar ═══
do $$
declare v_op uuid := gen_random_uuid(); v_p1 int; v_p2 int; v_cr numeric; v_n int;
begin
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select u.personas, u.creditos into v_p1, v_cr from public.club_cupon_usar((select v from _ids where k='cupon1'), 4, 'FAC-001', v_op) u;
  perform pg_temp.yo();
  perform pg_temp.r('3', 'primer uso → tarjeta +4', v_p1 = 4, format('saldo=%s personas, %s créditos', v_p1, v_cr));

  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select u.personas into v_p2 from public.club_cupon_usar((select v from _ids where k='cupon1'), 4, 'FAC-001', v_op) u;
  perform pg_temp.yo();
  select count(*) into v_n from club_movimientos where cupon_id = (select id from club_cupones where codigo = (select v from _ids where k='cupon1'));
  perform pg_temp.r('3', 'mismo p_op → idempotente', v_p2 = v_p1 and v_n = 1, format('saldo=%s, movimientos del cupón=%s', v_p2, v_n));

  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_cupon_usar((select v from _ids where k='cupon1'), 4, 'FAC-002', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('3', 'segundo uso (otro p_op)', false, 'lo usó dos veces');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('3', 'segundo uso (otro p_op) → falla', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_cupon_usar('AAAAAAAAAA', 31, 'FAC-003', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('3', 'personas = 31', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('3', 'personas = 31 → falla', true, sqlerrm);
  end;
  -- salonero no puede usar cupones
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_cupon_usar('AAAAAAAAAA', 2, 'FAC-004', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('3', 'salonero usa cupón', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('3', 'salonero usa cupón → sin permiso', true, sqlerrm);
  end;
end $$;

-- ═══ 4. Canje ═══
do $$
declare v_p int; v_cr numeric;
begin
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m2'), 2.5, 'FAC-010', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', '2,5 créditos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', '2,5 créditos → error', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m2'), 1.25, 'FAC-010', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', '1,25 créditos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', '1,25 créditos → error', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m3'), 1, 'FAC-011', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', 'saldo insuficiente (2 personas, 1 crédito)', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', 'saldo insuficiente (2 personas) → error', sqlerrm = 'Saldo insuficiente', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.personas, c.creditos into v_p, v_cr from public.club_canje((select v::uuid from _ids where k='m2'), 1.5, 'FAC-012', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('4', '1,5 con saldo 9 → saldo 0', v_p = 0 and v_cr = 0,
    format('saldo=%s personas, %s créditos; movimiento=%s', v_p, v_cr,
      (select format('%s personas, %s créditos', personas, creditos) from club_movimientos
        where miembro_id = (select v::uuid from _ids where k='m2') and tipo='canje')));
end $$;

-- ═══ 5. Cajero no ve contactos ═══
do $$
declare v_n int; v_o int;
begin
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    select count(*) into v_n from public.club_miembros_contacto;
    perform pg_temp.yo();
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    select count(*) into v_o from public.club_miembros_contacto;
    perform pg_temp.yo();
    perform pg_temp.r('5', 'cajero lee contactos → 0 filas (owner ve 1)', v_n = 0 and v_o = 1, format('cajero=%s, owner=%s', v_n, v_o));
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero lee contactos → error', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    insert into public.club_miembros_contacto(miembro_id, telefono) values ((select v::uuid from _ids where k='m2'), '+50611112222');
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero escribe contacto', false, 'escribió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero escribe contacto → rechazado', true, sqlerrm);
  end;
end $$;

-- ═══ 7. Créditos derivados ═══
do $$
declare v text;
begin
  select string_agg(format('%s→%s', p, public.club_creditos(p, 6)), ' · ' order by p) into v
    from unnest(array[0,2,3,5,6,8,9,12]) p;
  perform pg_temp.r('7', '0,2,3,5,6,8,9,12 → 0,0,0.5,0.5,1,1,1.5,2',
    (select array_agg(public.club_creditos(p, 6) order by p) from unnest(array[0,2,3,5,6,8,9,12]) p)
      = array[0,0,0.5,0.5,1,1,1.5,2]::numeric[], v);
end $$;

-- ═══ 9. Unicidad de club_negocios ═══
do $$
begin
  insert into club_negocios(nombre) values ('Atrapasueños');
  begin
    insert into club_negocios(nombre) values (' atrapasuenos ');
    perform pg_temp.r('9', '« atrapasuenos » después de «Atrapasueños»', false, 'insertó');
  exception when unique_violation then
    perform pg_temp.r('9', '« atrapasuenos » después de «Atrapasueños» → falla', true, sqlerrm);
  end;
  begin
    insert into club_negocios(nombre) values ('ATRAPA   SUEÑOS');
    perform pg_temp.r('9', 'control: «ATRAPA SUEÑOS» es otro nombre → entra', true, 'insertó (distinto: tiene espacio)');
  exception when unique_violation then
    perform pg_temp.r('9', 'control: «ATRAPA SUEÑOS»', false, sqlerrm);
  end;
end $$;

-- ═══ Extras: portal, ajuste, vencimiento ═══
do $$
declare j jsonb; v_n int; v_s int;
begin
  perform pg_temp.como('anon', null);
  j := public.club_portal((select v from _ids where k='ref_tok'));
  perform pg_temp.yo();
  perform pg_temp.r('extra', 'portal por token (anon)', j ? 'nombre' and (j->>'personas')::int = 4 and not (j::text ~ 'FAC-|factura|registrado'),
    j::text);
  begin
    perform pg_temp.como('anon', null);
    perform public.club_portal(repeat('a', 64));
    perform pg_temp.yo(); perform pg_temp.r('extra', 'portal token falso', false, 'respondió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('extra', 'portal token falso → error genérico', sqlerrm = 'Enlace no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_ajuste((select v::uuid from _ids where k='m3'), 3, 'ajuste', 'prueba');
    perform pg_temp.yo(); perform pg_temp.r('extra', 'cajero hace ajuste', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('extra', 'cajero hace ajuste → sin permiso', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_ajuste((select v::uuid from _ids where k='m3'), 3, 'ajuste', '   ');
    perform pg_temp.yo(); perform pg_temp.r('extra', 'owner ajuste sin nota', false, 'pudo');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('extra', 'owner ajuste sin nota → error', true, sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_n := public.club_vencer((now() at time zone 'America/Costa_Rica')::date);
  perform pg_temp.yo();
  select personas into v_s from club_saldos where miembro_id = (select v::uuid from _ids where k='old');
  perform pg_temp.r('extra', 'owner club_vencer: «Viejo» (13 personas, 13 meses) → 0', v_s = 0 and v_n >= 1,
    format('vencidos=%s, saldo de «Viejo»=%s', v_n, v_s));
end $$;

-- ═══ 6. Cuenta inactiva → todas las funciones de staff rechazan ═══
update profiles set is_active = false where id in ('<CAJERO_UUID>', '<OWNER_UUID>');
do $$
declare f text; v_cnt int;
begin
  foreach f in array array[
    'select public.club_cupon_usar(''AAAAAAAAAA'', 2, ''F'', gen_random_uuid())',
    'select public.club_canje(''00000000-0000-0000-0000-000000000000'', 1, ''F'', gen_random_uuid())',
    'select public.club_ajuste(''00000000-0000-0000-0000-000000000000'', 1, ''ajuste'', ''x'')',
    'select public.club_vencer(current_date)'] loop
    begin
      if f ~ 'cupon_usar|canje' then
        perform pg_temp.como('authenticated', '<CAJERO_UUID>');   -- cajero inactivo
      else
        perform pg_temp.como('authenticated', '<OWNER_UUID>');   -- owner inactivo
      end if;
      execute f;
      perform pg_temp.yo(); perform pg_temp.r('6', 'inactivo: '||substring(f from 'club_[a-z_]+'), false, 'ejecutó');
    exception when insufficient_privilege then
      perform pg_temp.yo(); perform pg_temp.r('6', 'inactivo: '||substring(f from 'club_[a-z_]+')||' → sin permiso', true, sqlerrm);
    end;
  end loop;
  -- y no lee tablas del club
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_cnt from public.club_miembros;
  perform pg_temp.yo();
  perform pg_temp.r('6', 'inactivo lee club_miembros → 0 filas', v_cnt = 0, format('cajero inactivo ve %s', v_cnt));
end $$;

select json_agg(json_build_object('p', prueba, 'caso', caso, 'ok', ok, 'detalle', left(detalle, 200)) order by n) from _res;
rollback;
