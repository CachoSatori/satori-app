-- 075_pruebas_staging.sql — pruebas de la F1a (Club Satori). SOLO STAGING. Todo corre en UNA transacción
-- que termina en ROLLBACK: no deja datos. Reemplazar <CAJERO_UUID>, <OWNER_UUID> y <SALONERO_UUID> por
-- perfiles activos de staging (la prueba 6 los desactiva dentro de la transacción y el rollback lo deshace).
-- Devuelve un JSON con cada caso y ok=true/false. Correr por la Management API (un solo request).
begin;

create temp table _res (n serial, prueba text, caso text, ok boolean, detalle text);
-- Libro de solo inserción: las pruebas backdatean registros (todo se deshace con el ROLLBACK).
set local club.libro_mantenimiento = 'pruebas';
-- CLUB-AUD-27: el modo pedido exige el puente al día; dentro de la prueba se da por fresco (ROLLBACK).
update pos_ndf_cursor set last_poll_at = now(), last_error = null where local = 'santa-teresa';
-- CLUB-AUD-26: la tarjeta física se prueba prendida (como en staging); la prueba 45 la apaga.
update club_config set tarjeta_manual_activa = true, tarjeta_manual_tope_dia = 30 where location_id = 'santa-teresa';
-- CLUB-AUD-06: las funciones públicas exigen el header x-club-web. Clave de PRUEBA cargada dentro de esta
-- transacción (el ROLLBACK la descarta) y enviada en el header, como lo hace club-web.
select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-0123456789abcdef"}', true);
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

-- R-01: el canje exige un código de canje del miembro. Para las pruebas de la regla del canje (no del código)
-- se genera uno directo en la tabla, como lo haría club_canje_codigo_generar desde el portal.
create function pg_temp.k(p_m uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $f$
declare c text := public.club_gen_codigo(6);
begin
  update public.club_codigos_canje set invalidado_en = now() where miembro_id = p_m and usado_en is null and invalidado_en is null;
  insert into public.club_codigos_canje (miembro_id, codigo_hash, vence_en) values (p_m, public.club_codigo_hash(c), now() + interval '10 minutes');
  return c;
end $f$;

-- ── Datos de prueba (como postgres; todo se deshace al final) ──
do $$
declare v_neg uuid; v_ref uuid; v_m2 uuid; v_m3 uuid; v_old uuid; v_m4 uuid; v_m5 uuid;
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
  insert into club_miembros(tipo, nombre) values ('referente','Factura Prueba') returning id into v_m4;
  insert into club_miembros(tipo, nombre) values ('referente','Tope Dia Prueba') returning id into v_m5;
  insert into club_movimientos(miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen)
  values (v_m4, 'tarjeta', 18, 6, 18000, now(), 'migracion'), (v_m5, 'tarjeta', 18, 6, 18000, now(), 'migracion');
  insert into _ids values ('m4', v_m4), ('m5', v_m5);
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
    perform public.club_canje((select v::uuid from _ids where k='m2'), 'AAAAAA', 1, 'F1', gen_random_uuid());
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
  select k.whatsapp into v_wa from club_cupones c join club_cupones_contactos k on k.cupon_id = c.id where c.codigo = v_cod;
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
    perform pg_temp.yo(); perform pg_temp.r('2', 'pasado el tope diario (3) → error', sqlstate = 'P0001' and sqlerrm = 'No se pueden generar más cupones hoy', sqlerrm);
  end;
  update club_config set cupones_max_dia_referente = 30 where location_id = 'santa-teresa';
end $$;

-- ═══ 3. Cajero: club_cupon_usar ═══
do $$
declare v_op uuid := gen_random_uuid(); v_p1 int; v_p2 int; v_cr numeric; v_n int;
begin
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select u.personas, u.creditos into v_p1, v_cr from public.club_cupon_usar((select v from _ids where k='cupon1'), 4, ' fac - 001 ', v_op) u;
  perform pg_temp.yo();
  perform pg_temp.r('3', 'primer uso → tarjeta +4, factura « fac - 001 » guardada como FAC-001',
    v_p1 = 4 and (select factura_pos from club_cupones where codigo = (select v from _ids where k='cupon1')) = 'FAC-001'
             and (select factura_pos from club_movimientos where cupon_id = (select id from club_cupones where codigo = (select v from _ids where k='cupon1'))) = 'FAC-001',
    format('saldo=%s personas, %s créditos; factura=%s', v_p1, v_cr,
      (select factura_pos from club_cupones where codigo = (select v from _ids where k='cupon1'))));

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
    perform pg_temp.yo(); perform pg_temp.r('3', 'segundo uso (otro p_op) → falla', sqlstate = 'P0001' and sqlerrm like 'El cupón ya se usó o fue anulado: no suma personas%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_cupon_usar('AAAAAAAAAA', 31, 'FAC-003', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('3', 'personas = 31', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('3', 'personas = 31 → falla', sqlstate = 'P0001' and sqlerrm like 'Personas fuera de rango (1 a 30): corregí%', sqlerrm);
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
    perform public.club_canje((select v::uuid from _ids where k='m2'), pg_temp.k((select v::uuid from _ids where k='m2')), 2.5, 'FAC-010', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', '2,5 créditos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', '2,5 créditos → error', sqlstate = 'P0001' and sqlerrm like 'Créditos no válidos: de %', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m2'), pg_temp.k((select v::uuid from _ids where k='m2')), 1.25, 'FAC-010', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', '1,25 créditos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', '1,25 créditos → error', sqlstate = 'P0001' and sqlerrm like 'Créditos no válidos: de %', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m3'), pg_temp.k((select v::uuid from _ids where k='m3')), 1, 'FAC-011', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('4', 'saldo insuficiente (2 personas, 1 crédito)', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('4', 'saldo insuficiente (2 personas) → error', sqlerrm like 'Saldo insuficiente: elegí menos créditos%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.personas, c.creditos into v_p, v_cr from public.club_canje((select v::uuid from _ids where k='m2'), pg_temp.k((select v::uuid from _ids where k='m2')), 1.5, 'FAC-012', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('4', '1,5 con saldo 9 → saldo 0', v_p = 0 and v_cr = 0,
    format('saldo=%s personas, %s créditos; movimiento=%s', v_p, v_cr,
      (select format('%s personas, %s créditos', personas, creditos) from club_movimientos
        where miembro_id = (select v::uuid from _ids where k='m2') and tipo='canje')));
end $$;

-- ═══ 10. Factura obligatoria y normalizada; tope por día ═══
do $$
declare v_cnt int;
begin
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m4'), pg_temp.k((select v::uuid from _ids where k='m4')), 1, '   ', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('10', 'canje con factura vacía', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('10', 'canje con factura vacía → error', sqlerrm like 'Falta el pedido o la factura%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_cupon_usar('AAAAAAAAAA', 2, '', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('10', 'cupón con factura vacía', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('10', 'cupón con factura vacía → error', sqlerrm like 'Falta el pedido o la factura%', sqlerrm);
  end;
  -- «fe-123» y « FE-123 » son la misma visita: 1 + 1,5 supera el máximo por visita
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_canje((select v::uuid from _ids where k='m4'), pg_temp.k((select v::uuid from _ids where k='m4')), 1, 'fe-123', gen_random_uuid());
  perform pg_temp.yo();
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m4'), pg_temp.k((select v::uuid from _ids where k='m4')), 1.5, ' FE-123 ', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('10', '«fe-123» + « FE-123 » = misma visita', false, 'aceptó 2,5 en la misma factura');
  exception when others then
    perform pg_temp.yo();
    perform pg_temp.r('10', '«fe-123» + « FE-123 » = misma visita → falla por visita',
      sqlerrm like '%por visita%' and (select string_agg(distinct factura_pos, ',') from club_movimientos
                                       where miembro_id = (select v::uuid from _ids where k='m4') and tipo = 'canje') = 'FE-123',
      sqlerrm || ' · guardada como ' || (select string_agg(distinct factura_pos, ',') from club_movimientos
                                       where miembro_id = (select v::uuid from _ids where k='m4') and tipo = 'canje'));
  end;
  -- dos canjes de 1,5 el mismo día con facturas distintas → el segundo falla por día
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_canje((select v::uuid from _ids where k='m5'), pg_temp.k((select v::uuid from _ids where k='m5')), 1.5, 'FE-200', gen_random_uuid());
  perform pg_temp.yo();
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje((select v::uuid from _ids where k='m5'), pg_temp.k((select v::uuid from _ids where k='m5')), 1.5, 'FE-201', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('10', 'dos canjes de 1,5 el mismo día', false, 'aceptó el segundo');
  exception when others then
    perform pg_temp.yo();
    select count(*) into v_cnt from club_movimientos where miembro_id = (select v::uuid from _ids where k='m5') and tipo = 'canje';
    perform pg_temp.r('10', 'dos canjes de 1,5 el mismo día, facturas distintas → el segundo falla',
      sqlerrm like '%por día%' and v_cnt = 1, sqlerrm || format(' · canjes guardados=%s', v_cnt));
  end;
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
    select count(*) into v_o from public.club_miembros_contacto where miembro_id = (select i.v::uuid from _ids i where i.k = 'ref');
    perform pg_temp.yo();
    perform pg_temp.r('5', 'cajero lee contactos → 0 filas (owner ve el de la prueba)', v_n = 0 and v_o = 1, format('cajero=%s, owner=%s', v_n, v_o));
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero lee contactos → sin permiso', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    insert into public.club_miembros_contacto(miembro_id, telefono) values ((select v::uuid from _ids where k='m2'), '+50611112222');
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero escribe contacto', false, 'escribió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('5', 'cajero escribe contacto → rechazado por RLS', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
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

do $$
declare v text;
begin
  select string_agg(format('%s→%s', p, public.club_personas_proximo(p, 6)), ' · ' order by p) into v
    from unnest(array[0,2,3,4,5,6,8,9]) p;
  perform pg_temp.r('7b', 'próximo medio crédito: 0,2,3,4,5,6,8,9 → 3,1,3,2,1,3,1,3',
    (select array_agg(public.club_personas_proximo(p, 6) order by p) from unnest(array[0,2,3,4,5,6,8,9]) p)
      = array[3,1,3,2,1,3,1,3], v);
end $$;

-- ═══ 9. Unicidad de club_negocios ═══
do $$
begin
  insert into club_negocios(nombre) values ('Prueba Ñandú Único');
  begin
    insert into club_negocios(nombre) values (' prueba  nandu unico ');
    perform pg_temp.r('9', '« prueba  nandu unico » después de «Prueba Ñandú Único»', false, 'insertó');
  exception when unique_violation then
    perform pg_temp.r('9', '« prueba  nandu unico » después de «Prueba Ñandú Único» → falla', true, sqlerrm);
  end;
  begin
    insert into club_negocios(nombre) values ('PRUEBA ÑANDÚ ÚNICO DOS');
    perform pg_temp.r('9', 'control: «PRUEBA ÑANDÚ ÚNICO DOS» es otro nombre → entra', true, 'insertó (nombre distinto)');
  exception when unique_violation then
    perform pg_temp.r('9', 'control: «PRUEBA ÑANDÚ ÚNICO DOS»', false, sqlerrm);
  end;
end $$;

-- ═══ Extras: portal, ajuste, vencimiento ═══
do $$
declare j jsonb; v_n int; v_s int;
begin
  perform pg_temp.como('anon', null);
  j := public.club_portal((select v from _ids where k='ref_tok'));
  perform pg_temp.yo();
  perform pg_temp.r('extra', 'portal por token (anon)', j ? 'nombre' and (j->>'personas')::int = 4 and (j->>'personas_proximo_credito')::int = 2 and not (j::text ~ 'FAC-|factura|registrado'),
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
    perform public.club_ajuste((select v::uuid from _ids where k='m3'), 3, 'ajuste', 'prueba', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('extra', 'cajero hace ajuste', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('extra', 'cajero hace ajuste → sin permiso', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_ajuste((select v::uuid from _ids where k='m3'), 3, 'ajuste', '   ', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('extra', 'owner ajuste sin nota', false, 'pudo');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('extra', 'owner ajuste sin nota → error', sqlstate = 'P0001' and sqlerrm = 'La nota es obligatoria', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_n := public.club_vencer((now() at time zone 'America/Costa_Rica')::date, (select count(*)::int from public.club_vencer_simular((now() at time zone 'America/Costa_Rica')::date)));
  perform pg_temp.yo();
  select personas into v_s from club_saldos where miembro_id = (select v::uuid from _ids where k='old');
  perform pg_temp.r('extra', 'owner club_vencer: «Viejo» (13 personas, 13 meses) → 0', v_s = 0 and v_n >= 1,
    format('vencidos=%s, saldo de «Viejo»=%s', v_n, v_s));
end $$;

-- ═══ F1c · 11. club_buscar sin contactos ═══
do $$
declare j jsonb; v_n int;
begin
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select jsonb_agg(to_jsonb(b)) into j from public.club_buscar('ref pru') b;
  perform pg_temp.yo();
  perform pg_temp.r('11', 'cajero busca «ref pru» → sin teléfono ni email',
    jsonb_array_length(j) = 1 and not (j::text ~* 'telefono|email|\+506|8888'), j::text);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_n from public.club_buscar('7777') b where b.nombre = 'Ref Prueba';
  perform pg_temp.yo();
  perform pg_temp.r('11', 'cajero busca por últimos 4 dígitos (7777) → lo encuentra', v_n = 1, format('%s resultado(s)', v_n));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_buscar('ab');
    perform pg_temp.yo(); perform pg_temp.r('11', 'búsqueda de 2 letras', false, 'buscó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('11', 'búsqueda de 2 letras → error', sqlstate = 'P0001' and sqlerrm like 'Escribí al menos 3 letras%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_buscar('ref pru');
    perform pg_temp.yo(); perform pg_temp.r('11', 'salonero busca', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('11', 'salonero busca → sin permiso', true, sqlerrm);
  end;
end $$;

-- ═══ F1c · 12. Alta y edición: cajero no; manager sí ═══
do $$
declare v_neg uuid; v_m uuid; v_tel text;
begin
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_miembro_guardar(null, 'referente', 'Hackeo Cajero', null, null, null);
    perform pg_temp.yo(); perform pg_temp.r('12', 'cajero club_miembro_guardar', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('12', 'cajero club_miembro_guardar → sin permiso', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_negocio_guardar(null, 'Negocio Cajero', 'hotel', true);
    perform pg_temp.yo(); perform pg_temp.r('12', 'cajero club_negocio_guardar', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('12', 'cajero club_negocio_guardar → sin permiso', true, sqlerrm);
  end;
  -- manager simulado: el salonero de prueba pasa a manager dentro de la transacción
  update profiles set role = 'manager' where id = '<SALONERO_UUID>';
  perform pg_temp.como('authenticated', '<SALONERO_UUID>');
  v_neg := public.club_negocio_guardar(null, 'Casa Pruebas', 'host', true);
  v_m := public.club_miembro_guardar(null, 'referente', '  Manu   Alta ', v_neg, null,
          '{"telefono":"8888 9999","email":"Manu@Ejemplo.com","optin_whatsapp":true}'::jsonb);
  perform pg_temp.yo();
  select telefono into v_tel from club_miembros_contacto where miembro_id = v_m;
  insert into _ids values ('manu', v_m), ('manu_cod', (select codigo from club_miembros where id = v_m)),
                          ('manu_tok', (select token_portal from club_miembros where id = v_m));
  perform pg_temp.r('12', 'manager crea negocio + referente con contacto',
    v_tel = '+50688889999' and (select nombre from club_miembros where id = v_m) = 'Manu Alta'
      and (select email from club_miembros_contacto where miembro_id = v_m) = 'manu@ejemplo.com',
    format('nombre=%s tel=%s', (select nombre from club_miembros where id = v_m), v_tel));
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_miembro_guardar(v_m, 'referente', 'Manu Alta', v_neg, null, '{"email":"sin-arroba"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('12', 'email inválido', false, 'guardó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('12', 'email inválido → error', sqlerrm = 'Email no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_miembro_guardar(v_m, 'referente', 'Manu Alta', v_neg, null, '{"telefono":"12"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('12', 'teléfono inválido', false, 'guardó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('12', 'teléfono inválido → error', sqlerrm = 'Teléfono no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_negocio_guardar(null, 'casa  PRUEBAS', 'host', true);
    perform pg_temp.yo(); perform pg_temp.r('12', 'negocio duplicado', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('12', 'negocio duplicado (casa  PRUEBAS) → error claro', sqlerrm = 'Ya existe un negocio con ese nombre', sqlerrm);
  end;
end $$;

-- ═══ F1c · 13. Regenerar invalida el código y el token anteriores ═══
do $$
declare v_old text := (select v from _ids where k='manu_cod'); v_oldtok text := (select v from _ids where k='manu_tok');
        v_new text; v_newtok text; v_res jsonb;
begin
  perform pg_temp.como('authenticated', '<SALONERO_UUID>');
  select g.codigo, g.token_portal into v_new, v_newtok from public.club_miembro_regenerar_codigo((select v::uuid from _ids where k='manu')) g;
  v_res := public.club_resolver(v_old);
  perform pg_temp.yo();
  perform pg_temp.r('13', 'regenerar → código nuevo; el viejo resuelve «desconocido»',
    v_new <> v_old and v_newtok <> v_oldtok and v_res->>'tipo' = 'desconocido', format('%s → %s; viejo: %s', v_old, v_new, v_res->>'tipo'));
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear(v_old, null);
    perform pg_temp.yo(); perform pg_temp.r('13', 'cupón con el código viejo', false, 'creó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('13', 'cupón con el código viejo → «Código no válido»', sqlerrm = 'Código no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_portal(v_oldtok);
    perform pg_temp.yo(); perform pg_temp.r('13', 'portal con el token viejo', false, 'respondió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('13', 'portal con el token viejo → «Enlace no válido»', sqlerrm = 'Enlace no válido', sqlerrm);
  end;
  update _ids set v = v_new where k = 'manu_cod';
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_miembro_regenerar_codigo((select v::uuid from _ids where k='manu'));
    perform pg_temp.yo(); perform pg_temp.r('13', 'cajero regenera', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('13', 'cajero regenera → sin permiso', true, sqlerrm);
  end;
end $$;

-- ═══ F1c · 14. club_resolver: URL, código y basura ═══
do $$
declare v_cup text; a jsonb; b jsonb; c jsonb; d jsonb; e jsonb; f jsonb; g jsonb;
begin
  perform pg_temp.como('anon', null);
  select x.codigo into v_cup from public.club_cupon_crear((select v from _ids where k='manu_cod'), null) x;
  perform pg_temp.yo();
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  a := public.club_resolver('https://club.satoricostarica.com/c/' || v_cup);
  b := public.club_resolver('  ' || lower(v_cup) || ' ');
  c := public.club_resolver('https://club.satoricostarica.com/r/' || (select v from _ids where k='manu_cod'));
  d := public.club_resolver((select v from _ids where k='manu_cod'));
  e := public.club_resolver('<script>alert(1)</script>');
  f := public.club_resolver('https://otro-sitio.com/c/' || v_cup);
  g := public.club_resolver('');
  perform pg_temp.yo();
  perform pg_temp.r('14', 'URL de cupón → cupón vigente', a->>'tipo' = 'cupon' and a->'datos'->>'estado' = 'vigente' and a->'datos'->>'referente' = 'Manu Alta', a::text);
  perform pg_temp.r('14', 'código de cupón en minúsculas con espacios → cupón', b->>'tipo' = 'cupon', b->>'tipo');
  perform pg_temp.r('14', 'URL de referente → referente con saldo', c->>'tipo' = 'referente' and (c->'datos') ? 'personas' and (c->'datos') ? 'personas_proximo', c::text);
  perform pg_temp.r('14', 'código de referente solo → referente', d->>'tipo' = 'referente', d->>'tipo');
  perform pg_temp.r('14', 'basura / otro dominio / vacío → desconocido',
    e->>'tipo' = 'desconocido' and f->>'tipo' = 'desconocido' and g->>'tipo' = 'desconocido', concat_ws(' · ', e->>'tipo', f->>'tipo', g->>'tipo'));
  update club_cupones set vence_en = now() - interval '1 minute' where codigo = v_cup;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  a := public.club_resolver(v_cup);
  b := public.club_resolver((select v from _ids where k='cupon1'));
  perform pg_temp.yo();
  perform pg_temp.r('14', 'cupón vencido → «vencido»; cupón usado → «usado»', a->'datos'->>'estado' = 'vencido' and b->'datos'->>'estado' = 'usado',
    concat_ws(' · ', a->'datos'->>'estado', b->'datos'->>'estado'));
  begin
    perform pg_temp.como('anon', null);
    perform public.club_resolver(v_cup);
    perform pg_temp.yo(); perform pg_temp.r('14', 'anon club_resolver', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('14', 'anon club_resolver → sin permiso', true, sqlerrm);
  end;
end $$;

-- ═══ F1c · 15. Tarjeta manual ═══
do $$
declare v_op uuid := gen_random_uuid(); v_p int; v_p2 int; v_n int;
begin
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select t.personas into v_p from public.club_tarjeta_manual((select v::uuid from _ids where k='manu'), 3, ' fx 9 ', v_op) t;
  select t.personas into v_p2 from public.club_tarjeta_manual((select v::uuid from _ids where k='manu'), 3, ' fx 9 ', v_op) t;
  perform pg_temp.yo();
  select count(*) into v_n from club_movimientos where client_op_id = v_op;
  perform pg_temp.r('15', 'tarjeta manual 3 personas (nota «manual», factura FX9), idempotente',
    v_p = 3 and v_p2 = 3 and v_n = 1 and (select nota from club_movimientos where client_op_id = v_op) = 'manual'
      and (select factura_pos from club_movimientos where client_op_id = v_op) = 'FX9',
    format('saldo=%s / %s, movimientos=%s', v_p, v_p2, v_n));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual((select v::uuid from _ids where k='manu'), 0, 'FX10', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('15', 'tarjeta manual 0 personas', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('15', 'tarjeta manual 0 personas → error', sqlstate = 'P0001' and sqlerrm like 'Personas fuera de rango (1 a 30): corregí%', sqlerrm);
  end;
end $$;

-- ═══ F1c · 16. REFERENTE_INACTIVO ═══
do $$
declare v_cup text;
begin
  perform pg_temp.como('anon', null);
  select x.codigo into v_cup from public.club_cupon_crear((select v from _ids where k='manu_cod'), null) x;
  perform pg_temp.yo();
  update club_miembros set estado = 'baja' where id = (select v::uuid from _ids where k='manu');
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_cupon_usar(v_cup, 2, 'FX20', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('16', 'cupón de referente dado de baja', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('16', 'cupón de referente dado de baja → REFERENTE_INACTIVO', sqlerrm = 'REFERENTE_INACTIVO', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual((select v::uuid from _ids where k='manu'), 2, 'FX21', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('16', 'tarjeta manual de referente dado de baja', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('16', 'tarjeta manual de referente dado de baja → REFERENTE_INACTIVO', sqlerrm = 'REFERENTE_INACTIVO', sqlerrm);
  end;
  update club_miembros set estado = 'activo' where id = (select v::uuid from _ids where k='manu');
end $$;

-- ═══ F1c · 17. Historial de club_config ═══
do $$
declare v_n int; v_c int; v_upd int;
begin
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  update public.club_config set valor_credito_crc = 19000 where location_id = 'santa-teresa';
  select count(*) into v_n from public.club_config_historial
   where campo = 'valor_credito_crc' and valor_anterior = '18000' and valor_nuevo = '19000'
     and cambiado_por = '<OWNER_UUID>';
  perform pg_temp.yo();
  perform pg_temp.r('17', 'owner cambia valor_credito_crc 18000→19000 → historial (quién, campo, antes, después)', v_n = 1, format('%s fila(s)', v_n));
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_c from public.club_config_historial;
  update public.club_config set valor_credito_crc = 1 where location_id = 'santa-teresa';
  get diagnostics v_upd = row_count;
  perform pg_temp.yo();
  perform pg_temp.r('17', 'cajero: no lee el historial ni edita la config', v_c = 0 and v_upd = 0
      and (select valor_credito_crc from club_config where location_id = 'santa-teresa') = 19000,
    format('historial visible=%s, filas editadas=%s', v_c, v_upd));
end $$;

-- ═══ F1c · 18. Token del portal: la caja no lo ve ═══
do $$
declare v_tok text;
begin
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform token_portal from public.club_miembros limit 1;
    perform pg_temp.yo(); perform pg_temp.r('18', 'cajero lee token_portal', false, 'leyó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('18', 'cajero lee token_portal → sin permiso (columna)', true, sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<SALONERO_UUID>');
  v_tok := public.club_miembro_token((select i.v::uuid from _ids i where i.k='manu'));
  perform pg_temp.yo();
  perform pg_temp.r('18', 'manager obtiene el token por club_miembro_token', v_tok ~ '^[0-9a-f]{64}$', left(v_tok, 8) || '…');
  update profiles set role = 'salonero' where id = '<SALONERO_UUID>';
end $$;

-- ═══ F1d · 19. club_cupon_ver (anon): solo estado, vence_en y nombre de pila ═══
do $$
declare v_pm uuid; v_cod text; v_cup text; j jsonb; j2 jsonb;
begin
  insert into club_miembros(tipo, nombre) values ('concierge_pm', '07/ Lola Pruebita Apellido PM') returning id, codigo into v_pm, v_cod;
  perform pg_temp.como('anon', null);
  select x.codigo into v_cup from public.club_cupon_crear(v_cod, null) x;
  j := public.club_cupon_ver(v_cup);
  j2 := public.club_cupon_ver(lower(v_cup));
  perform pg_temp.yo();
  insert into _ids values ('cup_pm', v_cup);
  perform pg_temp.r('19', 'anon ve el cupón: solo {estado, vence_en, referente} y el referente es el nombre de pila',
    (select array_agg(x order by x) from jsonb_object_keys(j) x) = array['estado','referente','vence_en']
      and j->>'estado' = 'vigente' and j->>'referente' = 'Lola' and j2->>'estado' = 'vigente'
      and (j->>'referente') !~ 'Pruebita|Apellido|PM|07', j::text);
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_ver('ZZZZZZZZZZ');
    perform pg_temp.yo(); perform pg_temp.r('19', 'cupón inexistente', false, 'respondió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('19', 'cupón inexistente → error genérico', sqlerrm = 'Cupón no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_ver('<b>x</b>');
    perform pg_temp.yo(); perform pg_temp.r('19', 'código mal formado', false, 'respondió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('19', 'código mal formado → mismo error', sqlerrm = 'Cupón no válido', sqlerrm);
  end;
  -- usado → «usado»; vencido → «vencido»; referente de baja → «vencido»
  perform pg_temp.como('anon', null);
  j := public.club_cupon_ver((select i.v from _ids i where i.k = 'cupon1'));
  perform pg_temp.yo();
  update club_cupones set vence_en = now() - interval '1 minute' where codigo = v_cup;
  perform pg_temp.como('anon', null);
  j2 := public.club_cupon_ver(v_cup);
  perform pg_temp.yo();
  perform pg_temp.r('19', 'cupón usado → «usado»; vencido → «vencido»', j->>'estado' = 'usado' and j2->>'estado' = 'vencido',
    concat_ws(' · ', j->>'estado', j2->>'estado'));
end $$;

-- ═══ F1d · 20. club_cupon_contacto (anon): opt-in debajo del cupón ═══
do $$
declare v_cup text; v_wa text; v_ok boolean;
begin
  perform pg_temp.como('anon', null);
  select x.codigo into v_cup from public.club_cupon_crear((select v from _ids where k='ref_cod'), null) x;
  perform pg_temp.yo();
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_contacto(v_cup, '{"whatsapp":"8888 2222"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('20', 'opt-in sin consentimiento', false, 'guardó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('20', 'opt-in sin consentimiento → error', sqlerrm = 'Falta el consentimiento', sqlerrm);
  end;
  perform pg_temp.como('anon', null);
  v_ok := public.club_cupon_contacto(v_cup, '{"nombre":"Tina","whatsapp":"8888 2222","optin":true}'::jsonb);
  perform public.club_cupon_contacto(v_cup, '{"whatsapp":"8888 3333","optin":true}'::jsonb);
  perform pg_temp.yo();
  select k.whatsapp into v_wa from club_cupones c join club_cupones_contactos k on k.cupon_id = c.id where c.codigo = v_cup;
  perform pg_temp.r('20', 'opt-in con consentimiento → guardado normalizado; el segundo no lo pisa',
    v_ok and v_wa = '+50688882222' and (select k.optin from club_cupones c join club_cupones_contactos k on k.cupon_id = c.id where c.codigo = v_cup), v_wa);
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_contacto((select v from _ids where k='cupon1'), '{"whatsapp":"8888 4444","optin":true}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('20', 'opt-in sobre cupón usado', false, 'guardó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('20', 'opt-in sobre cupón usado → error genérico', sqlerrm = 'Datos no válidos', sqlerrm);
  end;
end $$;

-- ═══ F1d · 21. Barrido de funciones club_* ejecutables por anon ═══
do $$
declare v text;
begin
  select string_agg(p.proname, ',' order by p.proname) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'club\_%' and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.r('21', 'anon solo ejecuta las 8 puertas públicas (cupón, portal, canje, canje desde el pase, autoalta y baja del socio)',
    v = 'club_canje_codigo_generar,club_canje_codigo_generar_pase,club_cupon_contacto,club_cupon_crear,club_cupon_ver,club_portal,club_socio_autoalta,club_socio_baja_portal', v);
  -- CLUB-AUD-11 (S-12): barrido completo sobre anon y PUBLIC (grantee 0), con los ACL efectivos
  -- (acldefault cuando el objeto no tiene ACL propio: una función sin ACL la ejecuta PUBLIC).
  select string_agg(c.relname || '/' || c.relkind::text || ':' || a.privilege_type || '→' || coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'), ', ')
    into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind in ('r','v','m','S','p')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform pg_temp.r('21', 'tablas, vistas y secuencias club_%: nada para anon ni PUBLIC', v is null, coalesce(v, ''));
  select string_agg(c.relname || ':' || a.privilege_type, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('s'::"char", c.relowner))) a
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind = 'S' and a.grantee = 'authenticated'::regrole;
  perform pg_temp.r('21', 'secuencias club_%: nada para authenticated', v is null, coalesce(v, ''));
  select string_agg(c.relname || '.' || t.attname, ', ') into v
    from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(t.attacl) a
   where n.nspname = 'public' and c.relname like 'club\_%' and t.attacl is not null
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform pg_temp.r('21', 'columnas club_%: ningún grant por columna para anon ni PUBLIC', v is null, coalesce(v, ''));
  perform pg_temp.r('21', 'token_portal no se puede leer como authenticated (grant por columna)',
    not has_column_privilege('authenticated', 'public.club_miembros', 'token_portal', 'SELECT'), '');
  select string_agg(distinct p.proname, ',') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
   where n.nspname = 'public' and p.proname like 'club\_%' and a.grantee = 0;
  perform pg_temp.r('21', 'funciones club_%: ninguna ejecutable por PUBLIC', v is null, coalesce(v, ''));
end $$;

-- ═══ F1f · 22. Excepciones del puente (facturas sembradas; todo se deshace) ═══
do $$
declare v_ref uuid := (select i.v::uuid from _ids i where i.k = 'ref'); v_t5 uuid; v_t3 uuid; v_mv uuid;
begin
  update club_config set valor_credito_crc = 18000, promo_articulo_codigo = null where location_id = 'santa-teresa';
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, cxc_crc, total_crc)
  values ('990001', now() - interval '1 day', 'C', 'salon', 'cajero', true, 'ok', 18000, 25000),
         ('990002', now() - interval '1 day', 'C', 'salon', 'cajero', true, 'ok', 36000, 40000);
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values ('990003', now() - interval '1 day', 'C', 'salon', 'cajero', true, 'ok', 30000) returning id into v_t3;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values ('990005', now() - interval '1 day', 'C', 'salon', 'cajero', true, 'ok', 30000) returning id into v_t5;
  insert into pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto) values
    (v_t3, 'PRUEBA-PROMO', 'PROMO CLUB 10% (prueba)', 1, 0), (v_t5, 'PRUEBA-PROMO', 'PROMO CLUB 10% (prueba)', 1, 0);
  -- canje de 1,5 (₡27.000) sobre una factura con cxc ₡36.000
  insert into club_movimientos (miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen)
  values (v_ref, 'canje', -9, 1.5, 6, 18000, 'FE-990002', now() - interval '1 day', now() - interval '2 hours', 'app');
  -- tarjeta manual con factura inexistente (hace 2 h) y otra que sí existe con ceros/prefijo
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota)
  values (v_ref, 'tarjeta', 3, 6, 18000, '990099', now() - interval '1 day', now() - interval '2 hours', 'app', 'manual') returning id into v_mv;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota)
  values (v_ref, 'tarjeta', 2, 6, 18000, 'FE-0990003', now() - interval '1 day', now() - interval '2 hours', 'app', 'manual');
  insert into _ids values ('mv_sin_factura', v_mv);
end $$;
do $$
declare j jsonb; v_ab1 int; v_ab2 int;
begin
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(e)) into j from public.club_excepciones(current_date - 3, current_date) e where e.factura ~ '99000|990099';
  perform pg_temp.yo();
  perform pg_temp.r('22', 'CREDITOS_SIN_CANJE (probable): factura 990001 con cxc ₡18.000 y sin canje',
    exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'CREDITOS_SIN_CANJE' and x->>'ref' = 'factura:990001' and x->>'certeza' = 'probable'),
    (select string_agg(x->>'tipo' || ' ' || (x->>'ref'), ' · ') from jsonb_array_elements(j) x));
  perform pg_temp.r('22', 'CANJE_MONTO_DISTINTO: canje 1,5 (₡27.000) vs cxc ₡36.000 → diferencia −₡9.000; esa factura no cuenta como «sin canje»',
    exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'CANJE_MONTO_DISTINTO' and x->>'ref' = 'factura:990002' and (x->'detalle'->>'diferencia_crc')::numeric = -9000)
      and not exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'CREDITOS_SIN_CANJE' and x->>'ref' = 'factura:990002'), '');
  perform pg_temp.r('22', 'REGISTRO_SIN_FACTURA (exacta): 990099 no está en el puente; «FE-0990003» sí (solo dígitos, sin ceros)',
    exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'REGISTRO_SIN_FACTURA' and x->>'ref' = (select i.v from _ids i where i.k = 'mv_sin_factura'))
      and not exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'REGISTRO_SIN_FACTURA' and x->>'factura' = 'FE-0990003'), '');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform set_config('club.t22', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.club_excepciones(current_date - 3, current_date) e
                                   where e.tipo = 'PROMO_SIN_CUPON')::text, true);
  perform pg_temp.yo();
  perform pg_temp.r('22', 'R02: sin artículo marcador, PROMO_SIN_CUPON sale «pendiente de configuración» (una fila, nunca «ok»)',
    not exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'PROMO_SIN_CUPON')   -- ninguna por factura
      and jsonb_array_length(current_setting('club.t22')::jsonb) = 1
      and current_setting('club.t22')::jsonb->0->>'ref' = 'config:promo_articulo_codigo'
      and current_setting('club.t22')::jsonb->0->>'certeza' = 'pendiente_configuracion', current_setting('club.t22'));
  update club_config set promo_articulo_codigo = 'PRUEBA-PROMO' where location_id = 'santa-teresa';
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(e)) into j from public.club_excepciones(current_date - 3, current_date) e where e.tipo = 'PROMO_SIN_CUPON' and e.factura ~ '99000';
  v_ab1 := public.club_excepciones_abiertas(30);
  perform pg_temp.yo();
  perform pg_temp.r('22', 'con el artículo cargado en club_config, PROMO_SIN_CUPON se enciende: 990005 sí, 990003 no (tiene tarjeta)',
    jsonb_array_length(j) = 1 and j->0->>'ref' = 'factura:990005', coalesce(j::text, 'null'));
  -- ═══ 23. Resolver ═══
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_excepcion_resolver('CREDITOS_SIN_CANJE', 'factura:990001', '   ');
    perform pg_temp.yo(); perform pg_temp.r('23', 'resolver sin nota', false, 'resolvió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('23', 'resolver sin nota → error', sqlstate = 'P0001' and sqlerrm like 'La nota es obligatoria%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_excepcion_resolver('CREDITOS_SIN_CANJE', 'factura:990001', 'Era una cuenta de hotel, no créditos');
  v_ab2 := public.club_excepciones_abiertas(30);
  select jsonb_agg(to_jsonb(e)) into j from public.club_excepciones(current_date - 3, current_date) e where e.ref = 'factura:990001';
  perform pg_temp.yo();
  perform pg_temp.r('23', 'resolver con nota → queda resuelta (quién, cuándo, nota) y baja el contador',
    (j->0->>'resuelta')::boolean and j->0->>'nota' = 'Era una cuenta de hotel, no créditos' and v_ab2 = v_ab1 - 1
      and (select resuelto_por from club_excepciones_resueltas where ref = 'factura:990001') = '<OWNER_UUID>',
    format('abiertas %s → %s', v_ab1, v_ab2));
  perform pg_temp.r('23', 'resolver no modifica el libro', (select count(*) from club_movimientos where factura_pos = 'FE-990002') = 1, '');
end $$;

-- ═══ F1f · 24. El cajero no ve excepciones ni reportes ═══
do $$
declare f text; v_n int;
begin
  foreach f in array array[
    'select count(*) from public.club_excepciones(current_date - 3, current_date)',
    'select public.club_excepciones_abiertas(30)',
    'select public.club_excepcion_resolver(''CREDITOS_SIN_CANJE'', ''factura:990002'', ''x'')',
    'select public.club_reporte_mes(''2026-10-01'')'] loop
    begin
      perform pg_temp.como('authenticated', '<CAJERO_UUID>');
      execute f;
      perform pg_temp.yo(); perform pg_temp.r('24', 'cajero: ' || substring(f from 'club_[a-z_]+'), false, 'pudo');
    exception when insufficient_privilege then
      perform pg_temp.yo(); perform pg_temp.r('24', 'cajero: ' || substring(f from 'club_[a-z_]+') || ' → sin permiso', true, sqlerrm);
    end;
  end loop;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_n from public.club_excepciones_resueltas;
  perform pg_temp.yo();
  perform pg_temp.r('24', 'cajero lee club_excepciones_resueltas → 0 filas', v_n = 0, format('%s', v_n));
end $$;

-- ═══ F1f · 25. Reporte de oct-2026 = validacion.json de la F1b (hora CR) y sin contactos ═══
do $$
declare r jsonb;
begin
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  r := public.club_reporte_mes('2026-10-01');
  perform pg_temp.yo();
  perform pg_temp.r('25', 'oct-2026: tarjetas 0 personas y canjes 6 créditos, igual que validacion.json (por_mes_cr)',
    (r->'kpis'->>'personas')::int = 0 and (r->'kpis'->>'creditos_canjeados')::numeric = 6,
    format('personas=%s, créditos canjeados=%s, valor=₡%s', r->'kpis'->>'personas', r->'kpis'->>'creditos_canjeados', r->'kpis'->>'valor_canjeado_crc'));
  perform pg_temp.r('25', 'el reporte trae todas las secciones y ningún teléfono ni email',
    r ?& array['kpis','ranking','subiendo','bajando','dormidos','a_contactar','nuevos','equipo','antiguedad','pm','calidad']
      and r::text !~ '@|\+506|\+[1-9][0-9]{7,}', '');
end $$;

-- ═══ 26. Bajas: el saldo vence en la misma transacción; volver a activo no restituye;
--        un mes cerrado da siempre lo mismo ═══
do $$
declare v_m uuid; r1 jsonb; r2 jsonb; v_s int; v_venc int;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Baja Prueba Oct', 'app') returning id into v_m;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen)
  values (v_m, 'tarjeta', 10, 6, 18000, '990777', timestamptz '2026-10-15 20:00:00-06', timestamptz '2026-10-15 20:00:00-06', 'app');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  r1 := public.club_reporte_mes('2026-10-01');
  perform public.club_miembro_guardar(v_m, 'referente', 'Baja Prueba Oct', null, 'baja', null);
  r2 := public.club_reporte_mes('2026-10-01');
  perform pg_temp.yo();
  select public.club_saldo_personas(v_m) into v_s;
  select count(*) into v_venc from club_movimientos where miembro_id = v_m and tipo = 'vencimiento' and personas = -10 and nota = 'baja: saldo vencido';
  perform pg_temp.r('26', 'baja con saldo → vencimiento por el saldo («baja: saldo vencido»), saldo 0',
    v_s = 0 and v_venc = 1, format('saldo=%s, vencimientos=%s', v_s, v_venc));
  perform pg_temp.r('26', 'el reporte de octubre da lo mismo antes y después de la baja',
    r1->'kpis' = r2->'kpis' and r1->'antiguedad' = r2->'antiguedad' and r1->'dormidos'->'cuentas' = r2->'dormidos'->'cuentas',
    format('saldo al cierre: %s → %s · cuentas: %s → %s', r1->'kpis'->>'saldo_creditos_al_cierre', r2->'kpis'->>'saldo_creditos_al_cierre',
           r1->'kpis'->>'cuentas_con_saldo', r2->'kpis'->>'cuentas_con_saldo'));
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_miembro_guardar(v_m, 'referente', 'Baja Prueba Oct', null, 'activo', null);
  perform pg_temp.yo();
  perform pg_temp.r('26', 'volver a activo no restituye (saldo sigue en 0)', public.club_saldo_personas(v_m) = 0,
    format('saldo=%s', public.club_saldo_personas(v_m)));
  -- una segunda baja con saldo 0 no inserta nada
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_miembro_guardar(v_m, 'referente', 'Baja Prueba Oct', null, 'baja', null);
  perform pg_temp.yo();
  perform pg_temp.r('26', 'baja con saldo 0 → no inserta vencimiento',
    (select count(*) from club_movimientos where miembro_id = v_m and tipo = 'vencimiento') = 1, '');
  -- la restitución es solo del owner (club_ajuste)
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_ajuste(v_m, 10, 'restitucion', 'prueba: restituir lo vencido por la baja', gen_random_uuid());
  perform pg_temp.yo();
  perform pg_temp.r('26', 'owner restituye con club_ajuste (restitucion)', public.club_saldo_personas(v_m) = 10, '');
end $$;

-- ═══ 27. Pedido (piloto; ítem 11, firma de Ismael 07-nov): la caja elige el PEDIDO abierto; facturas =
--        la del pedido + las sin pedido de la misma mesa (cuenta dividida); SIN_CRUCE → el manager elige ═══
-- Números de pedido y de factura de prueba (90xx / 9909xx) para no chocar con los datos reales, salvo
-- 27h (el pedido 14 del 05-nov y la mesa 19 del 31-oct, que son reales en staging).
do $$
declare v_m uuid; v_c uuid; v_cod text; v_d date := (now() at time zone 'America/Costa_Rica')::date - 1;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Pedido Prueba', 'app') returning id, codigo into v_m, v_cod;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Canje Pedido Prueba', 'app') returning id into v_c;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen)
  values (v_c, 'tarjeta', 24, 6, 18000, now() - interval '3 days', 'migracion');
  insert into pos_ndf_open (local, clave, id_pedido, mesa, canal, pax, monto_estimado_crc, updated_at, pedido_abierto_en) values
    ('santa-teresa', 'pedido:9014', '9014', '20', 'salon', 4, 48500, now() - interval '50 minutes', now() - interval '50 minutes'),
    ('santa-teresa', 'pedido:9009', '9009', '5',  'salon', 2, 21000, now() - interval '20 minutes', now() - interval '20 minutes'),
    ('santa-teresa', 'pedido:9030', '9030', '51', 'salon', 3, 40000, now() - interval '40 minutes', now() - interval '40 minutes');
  insert into _ids values ('ped_m', v_m), ('ped_c', v_c), ('ped_cod', v_cod), ('ped_d', v_d);
end $$;
create function pg_temp.fac(p_ids uuid[]) returns text language sql as $f$
  select coalesce(string_agg(t.numero_factura, '+' order by o.n), '') from unnest(p_ids) with ordinality o(id, n)
    join pos_ndf_tickets t on t.id = o.id;
$f$;
create function pg_temp.cruce(p_mov uuid) returns text language sql as $f$
  select pg_temp.fac(public.club_cruce_facturas('santa-teresa', m.pos_ref, m.factura_pos)) from club_movimientos m where m.id = p_mov;
$f$;
do $$
declare j jsonb; v_cup text; v_mv uuid; v_hoy text := (now() at time zone 'America/Costa_Rica')::date::text;
        v_m uuid := (select i.v::uuid from _ids i where i.k = 'ped_m');
begin
  -- 27a. la caja ve la lista de pedidos abiertos; el salonero no
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select jsonb_agg(to_jsonb(x) order by x.pedido) into j from public.club_pedidos_abiertos() x where x.pedido in ('9014','9009','9030');
  perform pg_temp.yo();
  perform pg_temp.r('27', 'cajero ve los pedidos abiertos (pedido, mesa, total, salonero, hora)', jsonb_array_length(j) = 3
      and (j->1) ?& array['pedido','mesa','salonero','total_crc','actualizado'] and j->1->>'pedido' = '9014' and j->1->>'mesa' = '20', left(j::text, 160));
  begin
    perform pg_temp.como('authenticated', '<SALONERO_UUID>');
    perform public.club_pedidos_abiertos();
    perform pg_temp.yo(); perform pg_temp.r('27', 'salonero ve los pedidos', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('27', 'salonero ve los pedidos → sin permiso', true, sqlerrm);
  end;

  -- 27b. pedido normal: cupón con el pedido 9014 (la hora que manda el cliente se ignora: vale la del servidor)
  perform pg_temp.como('anon', null);
  select x.codigo into v_cup from public.club_cupon_crear((select i.v from _ids i where i.k = 'ped_cod'), null) x;
  perform pg_temp.yo();
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_cupon_usar(v_cup, 4, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9014","hora":"2020-01-01T00:00:00Z"}'::jsonb);
  perform pg_temp.yo();
  select id into v_mv from club_movimientos where miembro_id = v_m and pos_ref->>'pedido' = '9014';
  insert into _ids values ('mv_9014', v_mv);
  perform pg_temp.r('27', 'escaneo: guarda pedido, mesa, total, apertura del pedido y hora del escaneo (del servidor); sin factura tipeada',
    (select factura_pos is null and pos_ref->>'mesa' = '20' and (pos_ref->>'total')::numeric = 48500
            and (pos_ref->>'hora')::timestamptz = now() and (pos_ref->>'abierto_en')::timestamptz = now() - interval '50 minutes'
            and visita_clave = 'pedido:9014@' || to_char((now() - interval '50 minutes') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS')
       from club_movimientos where id = v_mv), (select pos_ref::text from club_movimientos where id = v_mv));
  perform pg_temp.r('27', 'pedido normal: sin factura todavía → no cruza', pg_temp.cruce(v_mv) = '', '');
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, total_crc) values
    ('990901', now() - interval '6 hours',    'C', 'salon', 'cajero', true, 'ok', '20', '20', '9014', 50000),  -- otro 9014, de antes de abrir
    ('990902', now() + interval '40 minutes', 'C', 'salon', 'cajero', true, 'ok', '20', '20', '9014', 30000),  -- la del pedido
    ('990913', now() + interval '45 minutes', 'C', 'salon', 'sin_pedido', true, 'ok', null, '20', null, 18500), -- dividida, misma mesa
    ('990914', now() + interval '50 minutes', 'C', 'salon', 'sin_pedido', true, 'ok', null, '21', null, 9000),  -- otra mesa
    ('990915', now() + interval '2 hours',    'C', 'salon', 'sin_pedido', true, 'ok', null, '20', null, 7000);  -- mesa 20 pero > principal + 30 min
  perform pg_temp.r('27', 'pedido normal: la factura del pedido + la sin pedido de la misma mesa (no otra mesa, no después de +30 min, no el 9014 de antes)',
    pg_temp.cruce(v_mv) = '990902+990913', pg_temp.cruce(v_mv));
  -- con la apertura del pedido en la factura (después del backfill) la clave es exacta: número + apertura
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, numero_pedido, pedido_abierto_en, total_crc)
  values ('990903', now() - interval '45 minutes', 'C', 'salon', 'cajero', true, 'ok', '20', '9014', now() - interval '5 days', 1000);
  perform pg_temp.r('27', 'una factura del mismo número con OTRA apertura no es la del pedido',
    split_part(pg_temp.cruce(v_mv), '+', 1) = '990902', pg_temp.cruce(v_mv));
  update pos_ndf_tickets set pedido_abierto_en = now() - interval '50 minutes' where numero_factura = '990902';
  perform pg_temp.r('27', 'con la apertura en la factura: cruce exacto número + apertura', split_part(pg_temp.cruce(v_mv), '+', 1) = '990902', pg_temp.cruce(v_mv));

  -- 27c. pedido ya cerrado (no está en la lista) → error que manda al plan B
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9099"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('27', 'pedido cerrado', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'pedido que ya no está abierto → error «elegí la factura de la lista»', sqlerrm like '%elegí la factura%', sqlerrm);
  end;
end $$;
do $$
declare v_m uuid := (select i.v::uuid from _ids i where i.k = 'ped_m'); v_d date := (select i.v::date from _ids i where i.k = 'ped_d');
        v_mn uuid; v_ma uuid; v_mb uuid; v_mc uuid; v_h timestamptz;
begin
  -- 27d. pedido que cruza la medianoche: abierto 23:40, escaneo 23:50, factura 00:20 del día siguiente,
  --      dividida de la misma mesa 00:35; otra de esa mesa a la 01:30 (fuera de +30 min) y un 9007 de ayer al mediodía
  v_h := (v_d + time '23:50') at time zone 'America/Costa_Rica';
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  values (v_m, 'tarjeta', 2, 6, 18000, v_h, v_h, 'app',
          jsonb_build_object('modo','pedido','pedido','9007','mesa','3','total',30000,'abierto_en',v_h - interval '10 minutes','hora',v_h), 'pedido:x:9007')
  returning id into v_mn;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, total_crc) values
    ('990904', (v_d + time '12:00') at time zone 'America/Costa_Rica',     'C', 'salon', 'cajero', true, 'ok', '9', '9', '9007', 12000),
    ('990905', (v_d + 1 + time '00:20') at time zone 'America/Costa_Rica', 'C', 'salon', 'cajero', true, 'ok', '3', '3', '9007', 30000),
    ('990916', (v_d + 1 + time '00:35') at time zone 'America/Costa_Rica', 'C', 'salon', 'sin_pedido', true, 'ok', null, '3', null, 8000),
    ('990917', (v_d + 1 + time '01:30') at time zone 'America/Costa_Rica', 'C', 'salon', 'sin_pedido', true, 'ok', null, '3', null, 6000);
  perform pg_temp.r('27', 'medianoche: escaneo 23:50 → factura 00:20 + dividida 00:35 (no la de la 01:30, no el 9007 del mediodía)',
    pg_temp.cruce(v_mn) = '990905+990916', pg_temp.cruce(v_mn));

  -- 27e. mismo número de pedido al día siguiente: A (ayer, 9009) y B (hoy, 9009) no se mezclan
  v_h := now() - interval '1 day';
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  values (v_m, 'tarjeta', 2, 6, 18000, v_h, v_h, 'app',
          jsonb_build_object('modo','pedido','pedido','9009','mesa','5','total',21000,'abierto_en',v_h - interval '10 minutes','hora',v_h), 'pedido:y:9009')
  returning id into v_ma;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, numero_pedido, total_crc)
  values ('990906', v_h + interval '1 hour', 'C', 'salon', 'cajero', true, 'ok', '5', '9009', 21000);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9009"}'::jsonb);
  perform pg_temp.yo();
  select id into v_mb from club_movimientos where miembro_id = v_m and pos_ref->>'pedido' = '9009' and (pos_ref->>'hora')::timestamptz = now();
  perform pg_temp.r('27', 'mismo pedido al día siguiente: el de hoy NO cruza con la factura de ayer', pg_temp.cruce(v_mb) = '', pg_temp.cruce(v_mb));
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, numero_pedido, total_crc)
  values ('990907', now() + interval '30 minutes', 'C', 'salon', 'cajero', true, 'ok', '5', '9009', 26000);
  perform pg_temp.r('27', 'mismo pedido al día siguiente: hoy → la de hoy; ayer → la de ayer',
    pg_temp.cruce(v_mb) = '990907' and pg_temp.cruce(v_ma) = '990906', pg_temp.cruce(v_mb) || ' / ' || pg_temp.cruce(v_ma));
  -- C: escaneo ayer del 9010 sin factura; la única 9010 es de 24 h después → no cruza (tope 18 h)
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  values (v_m, 'tarjeta', 2, 6, 18000, v_h, v_h, 'app',
          jsonb_build_object('modo','pedido','pedido','9010','mesa','6','total',15000,'abierto_en',v_h - interval '10 minutes','hora',v_h), 'pedido:y:9010')
  returning id into v_mc;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, numero_pedido, total_crc)
  values ('990908', now() + interval '10 minutes', 'C', 'salon', 'cajero', true, 'ok', '6', '9010', 15000);
  perform pg_temp.r('27', 'tope 18 h: la factura del mismo número 24 h después no cruza', pg_temp.cruce(v_mc) = '', pg_temp.cruce(v_mc));
  insert into _ids values ('ped_mc', v_mc);
end $$;
do $$
declare v_m uuid := (select i.v::uuid from _ids i where i.k = 'ped_m'); v_m14 uuid; v_m19 uuid;
begin
  -- 27h. DATOS REALES de staging.
  --  · pedido 14 del 05-nov (abierto 18:39:48, mesa 20) → factura 112430 (19:21:30).
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  values (v_m, 'tarjeta', 2, 6, 18000, timestamptz '2026-11-05 19:00:00-06', timestamptz '2026-11-05 19:00:00-06', 'app',
          jsonb_build_object('modo','pedido','pedido','14','mesa','20','abierto_en','2026-11-05T18:39:48-06:00','hora','2026-11-05T19:00:00-06:00'), 'pedido:2026-11-05:14')
  returning id into v_m14;
  perform pg_temp.r('27', 'real: pedido 14 del 05-nov → 112430 (número + apertura exacta)', pg_temp.cruce(v_m14) = '112430', pg_temp.cruce(v_m14));
  perform pg_temp.r('27', 'real (backfill): la 112430 trae la apertura 18:39:48 y la mesa 20 del PoS',
    (select pedido_abierto_en = timestamptz '2026-11-05 18:39:48-06' and mesa_factura = '20' from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '112430'), '');
  --  · mesa 19 del 31-oct, con los datos REALES del backfill del ítem 11 (07-nov): pedido 33, apertura y
  --    mesa tomadas de su factura 112313. Aceptado por Ismael (07-nov): es una cuenta partida en CINCO
  --    (mismo cajero, 10 minutos, consecutivos 16109–16115, pax 1+0+1+1+1 = 4). No entra la 112293
  --    (pedido 21 de esa mesa, cobrado a las 20:06).
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  select v_m, 'tarjeta', 2, 6, 18000, t.pedido_abierto_en + interval '10 minutes', t.pedido_abierto_en + interval '10 minutes', 'app',
         jsonb_build_object('modo','pedido','pedido','33','mesa', t.mesa_factura, 'abierto_en', t.pedido_abierto_en,
                            'hora', t.pedido_abierto_en + interval '10 minutes'), 'pedido:2026-10-31:33'
    from pos_ndf_tickets t where t.local = 'santa-teresa' and t.numero_factura = '112313'
  returning id into v_m19;
  perform pg_temp.r('27', 'real (backfill): mesa 19 del 31-oct → exactamente 112313 (principal) + 112306 + 112308 + 112310 + 112311',
    pg_temp.cruce(v_m19) = '112313+112306+112308+112310+112311', pg_temp.cruce(v_m19));
end $$;
do $$
declare j jsonb; v_c uuid := (select i.v::uuid from _ids i where i.k = 'ped_c'); v_mv uuid;
        v_mc text := (select i.v from _ids i where i.k = 'ped_mc');
        v_dia_ini date := (now() at time zone 'America/Costa_Rica')::date - 2; v_dia_fin date := (now() at time zone 'America/Costa_Rica')::date + 1;
begin
  -- 27f. sin la factura del pedido: canje con el pedido 9030; el PoS anula la del pedido y cobra en 2 sin pedido
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_canje(v_c, pg_temp.k(v_c), 1, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9030"}'::jsonb);
  begin
    perform public.club_canje(v_c, pg_temp.k(v_c), 1.5, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9030"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('27', 'segundo canje en el mismo pedido supera 2', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'mismo pedido = misma visita: 1 + 1,5 → falla por visita', sqlerrm like '%por visita%', sqlerrm);
  end;
  perform pg_temp.yo();
  select id into v_mv from club_movimientos where miembro_id = v_c and pos_ref->>'pedido' = '9030';
  update club_movimientos set registrado_en = now() - interval '2 hours' where id = v_mv;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones(v_dia_ini, v_dia_fin) e where e.ref = v_mv::text;
  perform pg_temp.yo();
  perform pg_temp.r('27', 'pedido todavía abierto en el puente → todavía no es excepción', jsonb_array_length(j) = 0, j::text);
  delete from pos_ndf_open where id_pedido = '9030';
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, total_crc, cxc_crc, consecutivo_fe) values
    ('990910', now() + interval '5 minutes', 'C', 'salon', 'sin_pedido', true, 'ok', null, '51', null,   25000, 18000, '00200001040000990910'),
    ('990911', now() + interval '6 minutes', 'C', 'salon', 'sin_pedido', true, 'ok', null, '52', null,   15000, 0,     '00200001040000990911'),
    ('990912', now() + interval '7 minutes', 'X', 'salon', 'cajero',     true, 'ok', '51', '51', '9030', 0,     0,     null);
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones(v_dia_ini, v_dia_fin) e where e.ref = v_mv::text;
  perform pg_temp.yo();
  perform pg_temp.r('27', 'sin la factura del pedido (anulada) → SIN_CRUCE «posible cuenta dividida»',
    jsonb_array_length(j) = 1 and j->0->>'tipo' = 'SIN_CRUCE' and j->0->'detalle'->>'motivo' = 'posible cuenta dividida'
      and j->0->>'factura' = 'pedido 9030 · mesa 51' and not (j->0->>'resuelta')::boolean, j::text);
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones(v_dia_ini, v_dia_fin) e where e.ref = v_mc and e.tipo <> 'TARJETA_MANUAL';
  perform pg_temp.yo();
  perform pg_temp.r('27', 'tope 18 h vencido sin factura → SIN_CRUCE', jsonb_array_length(j) = 1 and j->0->>'tipo' = 'SIN_CRUCE', j::text);
  -- lista para elegir: sin pedido de ese día, la misma mesa primero
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(x)) into j from public.club_sin_cruce_candidatas(v_mv) x where x.numero_factura in ('990910','990911','990912','990902');
  perform pg_temp.yo();
  perform pg_temp.r('27', 'candidatas: facturas sin pedido del día (la de la misma mesa primero), con hora, total y consecutivo',
    jsonb_array_length(j) = 2 and j->0->>'numero_factura' = '990910' and (j->0->>'misma_mesa')::boolean and j->1->>'numero_factura' = '990911'
      and (j->0) ?& array['hora','total_crc','mesa','consecutivo_fe','asignada_a_otro'], coalesce(j::text, 'null'));
  -- búsqueda por los últimos dígitos del consecutivo del tiquete
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(x)) into j from public.club_sin_cruce_candidatas(v_mv, '…0911') x;
  perform pg_temp.yo();
  perform pg_temp.r('27', 'búsqueda por los últimos dígitos del consecutivo («…0911») → esa factura',
    jsonb_array_length(j) = 1 and j->0->>'numero_factura' = '990911', coalesce(j::text, 'null'));
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_sin_cruce_candidatas(v_mv, '12');
    perform pg_temp.yo(); perform pg_temp.r('27', 'búsqueda con 2 dígitos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'búsqueda con menos de 3 dígitos → error', sqlerrm like '%entre 3 y 20%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_sin_cruce_elegir(v_mv, '990910', null);
    perform pg_temp.yo(); perform pg_temp.r('27', 'cajero elige la factura', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('27', 'cajero no puede elegir la factura → sin permiso', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_sin_cruce_elegir(v_mv, '112313', null);  -- del 31-oct
    perform pg_temp.yo(); perform pg_temp.r('27', 'elegir una factura de otro día', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'elegir una factura fuera de la fecha del registro → error', sqlerrm like '%no está en la lista%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_sin_cruce_elegir(v_mv, '990910', 'cuenta dividida en 2');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones(v_dia_ini, v_dia_fin) e where e.ref = v_mv::text or e.factura = '990910';
  perform pg_temp.yo();
  perform pg_temp.r('27', 'resolver: SIN_CRUCE resuelta con «Factura 990910 elegida» y quién la eligió; el canje (₡18.000) cuadra con su cxc',
    jsonb_array_length(j) = 1 and (j->0->>'resuelta')::boolean and j->0->>'nota' = 'Factura 990910 elegida · cuenta dividida en 2'
      and j->0->'detalle'->>'factura_elegida' = '990910' and j->0->'detalle'->>'elegida_por' is not null
      and j->0->'detalle'->>'resuelta_por' is not null, j::text);
  perform pg_temp.r('27', 'la elección queda anotada (quién y cuándo) y no toca el libro',
    exists (select 1 from club_cruces_manuales where movimiento_id = v_mv and numero_factura = '990910' and elegido_por = '<OWNER_UUID>')
      and (select count(*) from club_movimientos where id = v_mv) = 1, '');
end $$;
do $$
declare j jsonb; v_m uuid := (select i.v::uuid from _ids i where i.k = 'ped_m'); v_mv uuid;
begin
  -- 27g. plan B: el pedido ya se cerró → la caja elige la factura de las últimas 2 h
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, total_crc, consecutivo_fe) values
    ('990950', now() - interval '30 minutes', 'C', 'salon', 'cajero', true, 'ok', null, '12', '9050', 47000, '00200001040000990950'),
    ('990951', now() - interval '3 hours',    'C', 'salon', 'cajero', true, 'ok', '0',  null, '9051', 9000,  null);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select jsonb_agg(to_jsonb(x)) into j from public.club_facturas_recientes() x where x.numero_factura in ('990950','990951','990902','990903');
  perform pg_temp.yo();
  perform pg_temp.r('27', 'plan B: la lista trae las facturas de las últimas 2 h (hora, total, mesa de la factura, consecutivo), no las viejas ni las de hora futura',
    jsonb_array_length(j) = 2 and j->0->>'numero_factura' = '990950' and j->0->>'mesa' = '12' and j->0->>'consecutivo_fe' = '00200001040000990950'
      and j->1->>'numero_factura' = '990903', coalesce(j::text, 'null'));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"factura","numero_factura":"990951"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('27', 'plan B con factura de hace 3 h', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'plan B con factura de más de 2 h → error (la resuelve el manager)', sqlerrm like '%más de 2 horas%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"manual","mesa":"43","ultimos4":"6012"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('27', 'tipear los 4 dígitos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('27', 'tipear mesa + 4 dígitos ya no se acepta', sqlstate = 'P0001' and sqlerrm = 'Pedido no válido: elegilo de la lista', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"factura","numero_factura":"990950"}'::jsonb);
  perform pg_temp.yo();
  select id into v_mv from club_movimientos where miembro_id = v_m and pos_ref->>'numero_factura' = '990950';
  update club_movimientos set registrado_en = now() - interval '2 hours' where id = v_mv;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones((now() at time zone 'America/Costa_Rica')::date - 1, (now() at time zone 'America/Costa_Rica')::date) e
   where e.ref = v_mv::text and e.tipo <> 'TARJETA_MANUAL';
  perform pg_temp.yo();
  perform pg_temp.r('27', 'plan B: cruce exacto con la factura elegida (sin excepción)',
    pg_temp.cruce(v_mv) = '990950' and jsonb_array_length(j) = 0 and (select visita_clave from club_movimientos where id = v_mv) = 'factura:990950', j::text);
end $$;


-- ═══ 28. CLUB-AUD-01 (S-01, S-02): contactos de turistas solo para gerencia ═══
-- Perfiles sintéticos dentro de la transacción: un contador y un manager activos (perfiles inactivos
-- reutilizados; el rollback los deja como estaban).
update profiles set role = 'contador', is_active = true where id = '<CONTADOR_UUID>';
update profiles set role = 'manager',  is_active = true where id = '<MANAGER_UUID>';
do $$
declare v_n int; v_cod text; r text; v_uid text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD01', 'app') returning codigo into v_cod;
  perform pg_temp.como('anon', null);
  perform public.club_cupon_crear(v_cod, '{"whatsapp":"88880001","email":"ficticio@ejemplo.com","optin":true}'::jsonb);
  perform pg_temp.yo();
  perform pg_temp.r('28', 'club_cupones ya no tiene columnas de contacto',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_cupones'
                 and column_name like 'contacto\_%'), '');
  foreach r in array array['cajero', 'contador'] loop
    v_uid := case r when 'cajero' then '<CAJERO_UUID>' else '<CONTADOR_UUID>' end;
    perform pg_temp.como('authenticated', v_uid);
    select count(*) into v_n from public.club_cupones_contactos;
    perform pg_temp.yo();
    perform pg_temp.r('28', r || ' no ve ningún contacto de turista (club_cupones_contactos → 0 filas)', v_n = 0, format('%s filas', v_n));
    begin
      perform pg_temp.como('authenticated', v_uid);
      execute 'select count(contacto_whatsapp) from public.club_cupones';
      perform pg_temp.yo(); perform pg_temp.r('28', r || ' lee contacto_whatsapp de club_cupones', false, 'leyó');
    exception when others then
      perform pg_temp.yo(); perform pg_temp.r('28', r || ' pide contacto_* en club_cupones → la columna no existe', sqlstate = '42703', sqlstate || ' ' || sqlerrm);
    end;
  end loop;
  foreach r in array array['owner', 'manager'] loop
    perform pg_temp.como('authenticated', case r when 'owner' then '<OWNER_UUID>' else '<MANAGER_UUID>' end);
    select count(*) into v_n from public.club_cupones_contactos k join public.club_cupones c on c.id = k.cupon_id
      join public.club_miembros m on m.id = c.referente_id where m.nombre = 'Ref AUD01';
    perform pg_temp.yo();
    perform pg_temp.r('28', r || ' ve el contacto del cupón', v_n = 1, format('%s filas', v_n));
  end loop;
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    insert into public.club_cupones_contactos (cupon_id, whatsapp) select id, '+50688880002' from public.club_cupones limit 1;
    perform pg_temp.yo(); perform pg_temp.r('28', 'escritura directa en club_cupones_contactos', false, 'escribió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('28', 'nadie escribe directo en club_cupones_contactos (solo las funciones públicas)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end $$;

-- ═══ 29. CLUB-AUD-02 (S-15, S-16): una tarjeta por referente y visita; Σ personas ≤ pax ═══
do $$
declare v_a uuid; v_b uuid; v_cupa text; v_cupb text; v_cod text; v_ok boolean; j jsonb; v_e text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD02 A', 'app') returning id, codigo into v_a, v_cod;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD02 B', 'app') returning id into v_b;
  insert into pos_ndf_open (local, clave, id_pedido, mesa, canal, pax, updated_at, pedido_abierto_en) values
    ('santa-teresa', 'pedido:9201', '9201', '8', 'salon', 5, now(), now() - interval '20 minutes'),
    ('santa-teresa', 'pedido:9202', '9202', '9', 'salon', 0, now(), now() - interval '20 minutes');   -- pax desconocido
  perform pg_temp.como('anon', null);
  select c.codigo into v_cupa from public.club_cupon_crear(v_cod, null) c;
  select c.codigo into v_cupb from public.club_cupon_crear(v_cod, null) c;
  perform pg_temp.yo();
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  -- dos referentes en la misma visita: 3 + 2 = 5 = pax → OK
  perform public.club_cupon_usar(v_cupa, 3, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9201"}'::jsonb);
  perform public.club_tarjeta_manual(v_b, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9201"}'::jsonb);
  perform pg_temp.yo();
  perform pg_temp.r('29', 'dos referentes en la misma visita con Σ personas = pax (3 + 2 = 5) → OK',
    (select count(*) from club_movimientos where miembro_id in (v_a, v_b) and pos_ref->>'pedido' = '9201') = 2, '');
  -- el mismo referente, otra tarjeta en la misma visita → error
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_a, 1, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9201"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('29', 'mismo referente, misma visita', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('29', 'mismo referente, misma visita, otro p_op → «ya tiene una tarjeta en esta visita»',
      sqlstate = 'P0001' and sqlerrm like 'Este referente ya tiene una tarjeta en esta visita: vale una por mesa%', sqlerrm);
  end;
  -- un tercero que pasa el pax → error
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD02 C', 'app') returning id into v_a;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_a, 1, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9201"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('29', 'Σ personas > pax', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('29', 'tercer referente: 5 + 1 > 5 pax → «Supera las personas del pedido»',
      sqlstate = 'P0001' and sqlerrm = 'Supera las personas de la mesa (5 pax; ya registradas 5). Revisá cuántas personas vinieron con el referente o pedile al manager', sqlerrm);
  end;
  -- la reproducción de la auditoría (§9.02): misma factura real tipeada tres veces → la 2ª ya falla
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_b, 1, '112430', gen_random_uuid());
    perform public.club_tarjeta_manual(v_b, 1, '112430', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('29', 'factura real repetida (§9.02)', false, 'acreditó dos veces');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('29', '§9.02: la misma factura tipeada dos veces para el mismo referente → error',
      sqlstate = 'P0001' and sqlerrm like 'Este referente ya tiene una tarjeta en esta visita: vale una por mesa%', sqlerrm);
  end;
  -- el índice único es la red de seguridad aunque se saltee la función
  begin
    insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, origen, visita_clave)
    values (v_b, 'tarjeta', 1, 6, 18000, 'app', (select visita_clave from club_movimientos where miembro_id = v_b and pos_ref->>'pedido' = '9201'));
    perform pg_temp.r('29', 'índice único (miembro, visita)', false, 'insertó');
  exception when unique_violation then
    perform pg_temp.r('29', 'índice único (miembro, visita) para origen app → unique_violation', true, sqlerrm);
  end;
  -- pax desconocido al escanear (0): se registra; después la factura llega con pax 2 y 3 personas → PERSONAS_SOBRE_PAX
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_b, 3, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9202"}'::jsonb);
  perform pg_temp.yo();
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, total_crc, pax)
  values ('990920', now() + interval '20 minutes', 'C', 'salon', 'cajero', true, 'ok', '9', '9', '9202', 30000, 2);
  -- y el mismo referente vuelve a entrar a esa visita por el plan B (otra clave de visita) → VISITA_REPETIDA
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  values (v_b, 'tarjeta', 1, 6, 18000, now(), now(), 'app', '{"modo":"factura","numero_factura":"990920"}'::jsonb, 'factura:990920');
  update club_movimientos set registrado_en = now() - interval '2 hours' where miembro_id = v_b;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j
    from public.club_excepciones((now() at time zone 'America/Costa_Rica')::date - 1, (now() at time zone 'America/Costa_Rica')::date + 1) e
   where e.factura = '990920';
  perform pg_temp.yo();
  perform pg_temp.r('29', 'detectivas: PERSONAS_SOBRE_PAX (4 personas, pax 2) y VISITA_REPETIDA (mismo referente por pedido y por factura)',
    exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'PERSONAS_SOBRE_PAX' and (x->'detalle'->>'personas')::int = 4 and (x->'detalle'->>'pax')::int = 2)
    and exists (select 1 from jsonb_array_elements(j) x where x->>'tipo' = 'VISITA_REPETIDA' and (x->'detalle'->>'tarjetas')::int = 2), j::text);
end $$;

-- ═══ 30. CLUB-AUD-12: precondición de la 069 ═══
do $$ begin
  perform pg_temp.r('30', 'get_my_role mira is_active (la 075 frena si no)',
    position('is_active' in pg_get_functiondef('public.get_my_role()'::regprocedure)) > 0, '');
end $$;


-- ═══ 31. CLUB-AUD-09 (S-13 en el ajuste): mismo p_op → replay, una fila ═══
do $$
declare v_m uuid; v_op uuid := gen_random_uuid(); v_p1 int; v_p2 int;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ajuste AUD09', 'app') returning id into v_m;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select t.personas into v_p1 from public.club_ajuste(v_m, 3, 'ajuste', 'x', v_op) t;
  select t.personas into v_p2 from public.club_ajuste(v_m, 3, 'ajuste', 'x', v_op) t;
  perform pg_temp.yo();
  perform pg_temp.r('31', 'ajuste con el mismo p_op dos veces → mismo saldo y una sola fila',
    v_p1 = 3 and v_p2 = 3 and (select count(*) from club_movimientos where miembro_id = v_m) = 1, format('%s / %s', v_p1, v_p2));
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_ajuste(v_m, 5, 'ajuste', 'x', v_op);
    perform pg_temp.yo(); perform pg_temp.r('31', 'mismo p_op con otros datos', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('31', 'mismo p_op con otros datos → error', sqlstate = 'P0001' and sqlerrm = 'El id de operación ya se usó para otra cosa', sqlerrm);
  end;
end $$;

-- ═══ 32. CLUB-AUD-10: la restitución reinicia el plazo de vencimiento ═══
do $$
declare v_m uuid; v_n int;
begin
  insert into club_miembros (tipo, nombre, origen, created_at) values ('referente', 'Restit AUD10', 'app', now() - interval '2 years') returning id into v_m;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen) values
    (v_m, 'tarjeta', 6, 6, 18000, now() - interval '13 months', 'migracion'),
    (v_m, 'vencimiento', -6, 6, 18000, now() - interval '1 month', 'migracion');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_ajuste(v_m, 6, 'restitucion', 'restitución de prueba', gen_random_uuid());
  perform public.club_vencer((now() at time zone 'America/Costa_Rica')::date, (select count(*)::int from public.club_vencer_simular((now() at time zone 'America/Costa_Rica')::date)));
  perform pg_temp.yo();
  perform pg_temp.r('32', 'restitución hoy en una cuenta vieja → la próxima corrida de vencer NO la vence',
    public.club_saldo_personas(v_m) = 6, format('saldo %s', public.club_saldo_personas(v_m)));
end $$;

-- ═══ 33. CLUB-AUD-05 (S-21): la tasa no se cambia con saldos vivos ═══
do $$
begin
  begin
    update club_config set personas_por_credito = personas_por_credito + 2 where location_id = 'santa-teresa';
    perform pg_temp.r('33', 'cambiar la tasa con saldos vivos', false, 'cambió');
  exception when others then
    perform pg_temp.r('33', 'cambiar personas_por_credito con saldos vivos → error', sqlstate = 'P0001' and sqlerrm like 'No se puede cambiar la tasa%', sqlerrm);
  end;
  update club_config set cupon_dias = cupon_dias where location_id = 'santa-teresa';
  perform pg_temp.r('33', 'los otros campos de la config se siguen pudiendo cambiar', true, '');
end $$;

-- ═══ 34. CLUB-AUD-04 (S-20): el reporte de un mes cerrado no cambia ═══
do $$
declare v_m uuid; v_a jsonb; v_b jsonb; v_c jsonb; v_mes date := (date_trunc('month', now() at time zone 'America/Costa_Rica') - interval '1 month')::date;
        v_pago uuid;
begin
  insert into club_miembros (tipo, nombre, origen) values ('concierge_pm', 'PM AUD04', 'app') returning id into v_m;
  insert into club_pm_cargos (miembro_id, monto_crc, estado, created_at) values (v_m, 10000, 'pendiente', v_mes + interval '9 days 12 hours');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_a := public.club_reporte_cerrar(v_mes, null);
  perform pg_temp.yo();
  -- después del cierre: se paga el cargo, el miembro cambia de tipo, se resuelve una excepción
  insert into club_pm_pagos (miembro_id, monto_crc, pagado_en) values (v_m, 10000, now()) returning id into v_pago;
  update club_pm_cargos set estado = 'pagado', pagado_en = now(), pago_id = v_pago where miembro_id = v_m;
  update club_miembros set tipo = 'referente' where id = v_m;
  insert into club_excepciones_resueltas (tipo, ref, nota) values ('CREDITOS_SIN_CANJE', 'factura:aud04', 'prueba');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_b := public.club_reporte_mes(v_mes);
  v_c := public.club_reporte_mes(v_mes, 'santa-teresa', true);
  perform pg_temp.yo();
  perform pg_temp.r('34', 'mes cerrado: el reporte devuelve lo congelado (mismo sha256 y mismo pendiente PM) aunque después se pague, cambie el tipo y se resuelva una excepción',
    (v_b->>'cerrado')::boolean and v_b->>'sha256' = v_a->>'sha256' and v_b->'pm' = v_a->'pm'
      and v_b->>'sha256' = encode(extensions.digest(coalesce(v_b->>'sha256_prev', '')
            || (v_b - 'cerrado' - 'version' - 'sha256' - 'sha256_prev' - 'cerrado_en' - 'motivo' - 'generado_en')::text, 'sha256'), 'hex'),
    format('hash %s', left(v_b->>'sha256', 12)));
  perform pg_temp.r('34', 'PM as-of: aun recalculado en vivo, el cargo pagado DESPUÉS del cierre sigue pendiente al cierre',
    (v_c->'pm'->>'pendiente_crc')::numeric = (v_a->'pm'->>'pendiente_crc')::numeric, format('%s vs %s', v_c->'pm'->>'pendiente_crc', v_a->'pm'->>'pendiente_crc'));
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_reporte_cerrar(v_mes, null);
    perform pg_temp.yo(); perform pg_temp.r('34', 'recerrar sin motivo', false, 'cerró');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('34', 'recerrar sin motivo → error', sqlstate = 'P0001' and sqlerrm like 'El mes ya está cerrado%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_b := public.club_reporte_cerrar(v_mes, 'corrección de prueba');
  perform pg_temp.yo();
  perform pg_temp.r('34', 'recerrar con motivo → versión 2', (v_b->>'version')::int = 2, '');
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_reporte_cerrar(date_trunc('month', now() at time zone 'America/Costa_Rica')::date, null);
    perform pg_temp.yo(); perform pg_temp.r('34', 'cerrar el mes en curso', false, 'cerró');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('34', 'el mes en curso no se puede cerrar', sqlerrm = 'Solo se cierran meses terminados', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_reporte_cerrar(v_mes, 'x');
    perform pg_temp.yo(); perform pg_temp.r('34', 'manager cierra', false, 'cerró');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('34', 'solo el owner cierra meses (manager → sin permiso)', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    update public.club_reportes_cerrados set sha256 = repeat('0', 64);
    perform pg_temp.yo(); perform pg_temp.r('34', 'editar un cierre', false, 'editó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('34', 'nadie edita un cierre desde la app', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end $$;


-- ═══ 35. Cuenta dividida AMBIGUA (decisión de Ismael 07-nov): dos pedidos de la misma mesa ═══
-- P1 (9301, mesa 4): abierto −60 min, factura +0. P2 (9302, mesa 4): abierto −30 min, factura +20 min.
-- Sin pedido de la mesa 4: +10 min (cae en las dos ventanas → AMBIGUA) y +40 min (solo en la de P2).
do $$
declare v_m uuid; v_m2 uuid; v_1 uuid; v_2 uuid; j jsonb; t0 timestamptz := now() + interval '5 minutes';
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Ambigua 1', 'app') returning id into v_m;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Ambigua 2', 'app') returning id into v_m2;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave) values
    (v_m, 'tarjeta', 2, 6, 18000, now() - interval '50 minutes', now() - interval '2 hours', 'app',
     jsonb_build_object('modo','pedido','pedido','9301','mesa','4','abierto_en', t0 - interval '60 minutes','hora', now() - interval '50 minutes'), 'pedido:z:9301')
    returning id into v_1;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave) values
    (v_m2, 'tarjeta', 2, 6, 18000, now() - interval '20 minutes', now() - interval '2 hours', 'app',
     jsonb_build_object('modo','pedido','pedido','9302','mesa','4','abierto_en', t0 - interval '30 minutes','hora', now() - interval '20 minutes'), 'pedido:z:9302')
    returning id into v_2;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, pedido_abierto_en, total_crc) values
    ('990931', t0,                          'C', 'salon', 'cajero',     true, 'ok', '4', '4', '9301', t0 - interval '60 minutes', 20000),
    ('990932', t0 + interval '20 minutes',  'C', 'salon', 'cajero',     true, 'ok', '4', '4', '9302', t0 - interval '30 minutes', 22000),
    ('990933', t0 + interval '10 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', null, '4', null, null, 9000),
    ('990934', t0 + interval '40 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', null, '4', null, null, 7000);
  perform pg_temp.r('35', 'la sin pedido que cae en las ventanas de los dos pedidos no se asigna a ninguno',
    pg_temp.cruce(v_1) = '990931' and pg_temp.cruce(v_2) = '990932+990934', pg_temp.cruce(v_1) || ' / ' || pg_temp.cruce(v_2));
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j
    from public.club_excepciones((now() at time zone 'America/Costa_Rica')::date - 1, (now() at time zone 'America/Costa_Rica')::date + 1) e
   where e.tipo = 'AMBIGUA' and e.factura like '9909%';
  perform pg_temp.yo();
  perform pg_temp.r('35', 'AMBIGUA en Excepciones: una sola fila para la 990933, con los dos pedidos',
    jsonb_array_length(j) = 1 and j->0->>'factura' = '990933' and (j->0->'detalle'->'pedidos') @> '["9301","9302"]'::jsonb, j::text);
end $$;


-- ═══ 36. club_vencer seguro: simular no escribe; confirmar con otro número falla ═══
-- (Todo dentro de la transacción de la batería, que termina en ROLLBACK: club_vencer nunca se corre fuera.)
do $$
declare v_m uuid; v_n0 bigint; v_n1 bigint; v_sim int; v_lista jsonb; v_hoy date := (now() at time zone 'America/Costa_Rica')::date; v_venc int;
begin
  insert into club_miembros (tipo, nombre, origen, created_at) values ('referente', 'Vencer Simular', 'app', now() - interval '2 years') returning id into v_m;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen)
  values (v_m, 'tarjeta', 9, 6, 18000, now() - interval '14 months', 'migracion');
  select count(*) into v_n0 from club_movimientos;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select count(*)::int, jsonb_agg(to_jsonb(x)) filter (where x.miembro_id = v_m) into v_sim, v_lista from public.club_vencer_simular(v_hoy) x;
  perform pg_temp.yo();
  select count(*) into v_n1 from club_movimientos;
  perform pg_temp.r('36', 'simular devuelve la lista (miembro, personas, créditos, última actividad) y no escribe nada',
    v_n1 = v_n0 and jsonb_array_length(v_lista) = 1 and (v_lista->0->>'personas')::int = 9 and (v_lista->0->>'creditos')::numeric = 1.5
      and (v_lista->0) ?& array['nombre','ultima_actividad'], format('%s cuentas; movimientos %s → %s', v_sim, v_n0, v_n1));
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_vencer(v_hoy, v_sim + 1);
    perform pg_temp.yo(); perform pg_temp.r('36', 'confirmar con un número equivocado', false, 'venció');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('36', 'confirmar con un número equivocado → error y no vence nada',
      sqlstate = 'P0001' and sqlerrm = format('La simulación da %s cuentas y confirmaste %s: volvé a simular', v_sim, v_sim + 1)
        and (select count(*) from club_movimientos) = v_n0, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_vencer_simular(v_hoy);
    perform pg_temp.yo(); perform pg_temp.r('36', 'manager simula', false, 'pudo');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('36', 'simular es solo del owner (manager → sin permiso)', true, sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v_venc := public.club_vencer(v_hoy, v_sim);
  perform pg_temp.yo();
  perform pg_temp.r('36', 'confirmar con el número de la simulación → vence (y el miembro queda en 0)',
    v_venc = v_sim and public.club_saldo_personas(v_m) = 0, format('vencidas %s de %s', v_venc, v_sim));
end $$;


-- ═══ 37. CLUB-AUD-16: cierres inmutables y encadenados ═══
do $$
declare v_mes date := (date_trunc('month', now() at time zone 'America/Costa_Rica') - interval '2 months')::date; v1 jsonb; v2 jsonb; n int;
begin
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  v1 := public.club_reporte_cerrar(v_mes, null);
  v2 := public.club_reporte_cerrar(v_mes, 'recierre de prueba');
  perform pg_temp.yo();
  perform pg_temp.r('37', 'encadenado: el cierre nuevo guarda el sha256 del anterior y el hash se recomputa desde la fila (sin generado_en)',
    v2->>'sha256_prev' = v1->>'sha256' and not (v1 ? 'generado_en')
      and (select bool_and(sha256 = encode(extensions.digest(coalesce(sha256_prev, '') || datos::text, 'sha256'), 'hex')) from club_reportes_cerrados), '');
  begin
    update club_reportes_cerrados set datos = datos || '{"x":1}'::jsonb;   -- como postgres, dueño de la tabla
    perform pg_temp.r('37', 'UPDATE de un cierre como dueño', false, 'editó');
  exception when others then
    perform pg_temp.r('37', 'UPDATE de un cierre, aun como dueño de la tabla → rechazado', sqlstate = 'P0001' and sqlerrm like 'Los cierres de mes son inmutables%', sqlerrm);
  end;
  begin
    delete from club_reportes_cerrados;
    perform pg_temp.r('37', 'DELETE de un cierre como dueño', false, 'borró');
  exception when others then
    perform pg_temp.r('37', 'DELETE de un cierre → rechazado', sqlstate = 'P0001' and sqlerrm like 'Los cierres de mes son inmutables%', sqlerrm);
  end;
  begin
    truncate club_reportes_cerrados;
    perform pg_temp.r('37', 'TRUNCATE de los cierres', false, 'vació');
  exception when others then
    perform pg_temp.r('37', 'TRUNCATE de los cierres → rechazado', sqlstate = 'P0001' and sqlerrm like 'Los cierres de mes son inmutables%', sqlerrm);
  end;
end $$;

-- ═══ 38. CLUB-AUD-15: la misma visita tiene una sola clave por cualquier camino ═══
-- Pedido 9401 (mesa 7, abierto hace 30 min) con su factura cerrada que ya trae la apertura.
do $$
declare v_a uuid; v_b uuid; v_ab timestamptz := now() - interval '30 minutes'; v_k1 text; v_k2 text; v_k3 text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD15 A', 'app') returning id into v_a;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD15 B', 'app') returning id into v_b;
  insert into pos_ndf_open (local, clave, id_pedido, mesa, canal, pax, updated_at, pedido_abierto_en)
  values ('santa-teresa', 'pedido:9401', '9401', '7', 'salon', 4, v_ab, v_ab);
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, pedido_abierto_en, total_crc, pax)
  values ('990941', now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', '7', '7', '9401', v_ab, 40000, 4);
  v_k1 := public.club_visita_canonica('santa-teresa', public.club_pos_ref('{"modo":"pedido","pedido":"9401"}'::jsonb, 'santa-teresa'), null);
  v_k2 := public.club_visita_canonica('santa-teresa', '{"modo":"factura","numero_factura":"990941"}'::jsonb, null);
  v_k3 := public.club_visita_canonica('santa-teresa', null, ' FE-0990941 ');
  perform pg_temp.r('38', 'pedido, factura del plan B y factura tipeada dan la MISMA clave de visita',
    v_k1 = v_k2 and v_k2 = v_k3 and v_k1 like 'pedido:9401@%', format('%s | %s | %s', v_k1, v_k2, v_k3));
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_a, 3, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9401"}'::jsonb);
  begin
    perform public.club_tarjeta_manual(v_a, 1, null, gen_random_uuid(), '{"modo":"factura","numero_factura":"990941"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('38', 'mismo referente por otro camino', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('38', 'el mismo referente por el plan B (factura del mismo pedido) → «ya tiene una tarjeta en esta visita»',
      sqlstate = 'P0001' and sqlerrm like 'Este referente ya tiene una tarjeta en esta visita: vale una por mesa%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_a, 1, '0990941', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('38', 'mismo referente con la factura tipeada', false, 'acreditó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('38', 'el mismo referente con la factura tipeada → rechazado',
      sqlstate = 'P0001' and sqlerrm like 'Este referente ya tiene una tarjeta en esta visita: vale una por mesa%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_b, 2, null, gen_random_uuid(), '{"modo":"factura","numero_factura":"990941"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('38', 'Σ personas entre caminos', false, 'acreditó 3 + 2 > 4');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('38', 'otro referente por el plan B: Σ personas se suma entre caminos (3 + 2 > 4 pax) → rechazado',
      sqlstate = 'P0001' and sqlerrm like 'Supera las personas de la mesa (4 pax; ya registradas 3). Revisá cuántas personas%', sqlerrm);
  end;
end $$;

-- ═══ 39. CLUB-AUD-18: el local lo pone el miembro, no el cliente ═══
do $$
declare v_m uuid;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD18', 'app') returning id into v_m;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9401","local":"nosara"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('39', 'pos_ref con el local de otro', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('39', 'pos_ref que dice otro local que el del miembro → «Pedido no válido»',
      sqlstate = 'P0001' and sqlerrm = 'Pedido no válido: elegilo de la lista', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_m, 1, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9401","local":"santa-teresa"}'::jsonb);
  perform pg_temp.yo();
  perform pg_temp.r('39', 'con el local del miembro (o sin local) se acepta y guarda el local del miembro',
    (select pos_ref->>'local' from club_movimientos where miembro_id = v_m) = 'santa-teresa', '');
end $$;


-- ═══ 40. CLUB-AUD-06: una sola puerta pública (header x-club-web) + tope global por minuto ═══
do $$
declare v_cod text; v_cup text; v_ok text; i int;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref AUD06', 'app') returning codigo into v_cod;
  -- sin header (llamada directa con la anon key): el mismo error de siempre, en las 4
  perform set_config('request.headers', '{}', true);
  foreach v_ok in array array['crear','ver','contacto','portal','canje'] loop
    begin
      perform pg_temp.como('anon', null);
      case v_ok
        when 'crear' then perform public.club_cupon_crear(v_cod, null);
        when 'ver' then perform public.club_cupon_ver('AAAAAAAAAA');
        when 'contacto' then perform public.club_cupon_contacto('AAAAAAAAAA', '{"whatsapp":"60000001","optin":true}'::jsonb);
        when 'canje' then perform public.club_canje_codigo_generar(repeat('a', 64));
        else perform public.club_portal(repeat('a', 64));
      end case;
      perform pg_temp.yo(); perform pg_temp.r('40', v_ok || ' sin header', false, 'respondió');
    exception when others then
      perform pg_temp.yo(); perform pg_temp.r('40', v_ok || ' sin el header de club-web → el mismo error de siempre',
        sqlstate = 'P0001' and sqlerrm in ('Código no válido', 'Cupón no válido', 'Datos no válidos', 'Enlace no válido'), sqlerrm);
    end;
  end loop;
  -- con el header correcto: funciona
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-0123456789abcdef"}', true);
  perform pg_temp.como('anon', null);
  select c.codigo into v_cup from public.club_cupon_crear(v_cod, null) c;
  perform pg_temp.yo();
  perform pg_temp.r('40', 'con el header correcto → crea el cupón', v_cup ~ '^[A-HJ-NP-Z2-9]{10}$', coalesce(v_cup, ''));
  -- rotación: la clave vieja deja de valer
  perform public.club_web_clave_cargar(encode(extensions.digest('clave-nueva-del-club-rotada-fedcba9876543210', 'sha256'), 'hex'));
  begin
    perform pg_temp.como('anon', null);
    perform public.club_cupon_crear(v_cod, null);
    perform pg_temp.yo(); perform pg_temp.r('40', 'clave rotada', false, 'creó con la vieja');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('40', 'después de rotar, la clave vieja → «Código no válido»', sqlerrm = 'Código no válido', sqlerrm);
  end;
  perform set_config('request.headers', '{"x-club-web":"clave-nueva-del-club-rotada-fedcba9876543210"}', true);
  perform pg_temp.como('anon', null);
  select c.codigo into v_cup from public.club_cupon_crear(v_cod, null) c;
  perform pg_temp.yo();
  perform pg_temp.r('40', 'con la clave nueva → funciona', v_cup is not null, '');
  begin
    perform public.club_web_clave_cargar('la-clave-en-texto');
    perform pg_temp.r('40', 'cargar la clave en texto', false, 'aceptó');
  exception when others then
    perform pg_temp.r('40', 'club_web_clave_cargar solo acepta el sha256, nunca la clave', sqlerrm like 'Tiene que ser el sha256%', sqlerrm);
  end;
  perform pg_temp.r('40', 'club_web_clave: nadie de la app la lee ni la escribe',
    not has_table_privilege('anon', 'public.club_web_clave', 'SELECT') and not has_table_privilege('authenticated', 'public.club_web_clave', 'SELECT')
      and not has_function_privilege('anon', 'public.club_web_clave_cargar(text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.club_web_clave_cargar(text)', 'EXECUTE'), '');
  -- tope global por local y por minuto
  update club_config set cupones_max_minuto_local = 3, cupones_max_dia_referente = 100 where location_id = 'santa-teresa';
  begin
    perform pg_temp.como('anon', null);
    for i in 1 .. 5 loop perform public.club_cupon_crear(v_cod, null); end loop;
    perform pg_temp.yo(); perform pg_temp.r('40', 'tope global por minuto', false, 'creó 5 más');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('40', 'tope global por local y por minuto → «Demasiados cupones en este momento»',
      sqlerrm = 'Demasiados cupones en este momento', sqlerrm);
  end;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-0123456789abcdef"}', true);
end $$;


-- ═══ 41. PERSONAS_SOBRE_PAX usa el pax DEL PEDIDO, no el de cada factura (cuentas divididas con pax 0) ═══
-- Pedido 9411 (mesa 8): principal con pax 1 por artículo; 3 divididas sin pedido: pax 0, 2 y 1 → pax del pedido 4.
-- Pedido 9412 (mesa 9): Personas del pedido = 5 (pax_nativo) y ningún artículo de pax → pax del pedido 5.
do $$
declare v_m uuid; v_n uuid; j jsonb; t0 timestamptz := now() - interval '20 minutes';
        d0 date := (now() at time zone 'America/Costa_Rica')::date - 1; d1 date := (now() at time zone 'America/Costa_Rica')::date + 1;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Pax A', 'app') returning id into v_m;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Pax B', 'app') returning id into v_n;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, pedido_abierto_en, total_crc, pax, pax_nativo) values
    ('990961', t0,                         'C', 'salon', 'cajero',     true, 'ok', '8', '8', '9411', t0 - interval '60 minutes', 10000, 1, 0),
    ('990962', t0 - interval '3 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', null, '8', null, null, 10000, 0, 0),
    ('990963', t0 - interval '2 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', null, '8', null, null, 10000, 2, 0),
    ('990964', t0 - interval '1 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', null, '8', null, null, 10000, 1, 0),
    ('990965', t0,                         'C', 'salon', 'cajero',     true, 'ok', '9', '9', '9412', t0 - interval '60 minutes', 50000, 0, 5);
  -- 4 personas en un pedido de pax 4 repartido en 4 facturas (una con pax 0): NO es excepción
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave) values
    (v_m, 'tarjeta', 4, 6, 18000, t0 - interval '30 minutes', now() - interval '2 hours', 'app',
     jsonb_build_object('modo','pedido','pedido','9411','mesa','8','abierto_en', t0 - interval '60 minutes','hora', t0 - interval '30 minutes'), 'pax:a'),
    (v_n, 'tarjeta', 5, 6, 18000, t0 - interval '30 minutes', now() - interval '2 hours', 'app',
     jsonb_build_object('modo','pedido','pedido','9412','mesa','9','abierto_en', t0 - interval '60 minutes','hora', t0 - interval '30 minutes'), 'pax:b');
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into j from public.club_excepciones(d0, d1) e where e.tipo = 'PERSONAS_SOBRE_PAX' and e.factura in ('990961', '990965');
  perform pg_temp.yo();
  perform pg_temp.r('41', 'cuenta dividida con facturas de pax 0: 4 personas con pax del pedido 4 → sin excepción; Personas del pedido 5 → sin excepción',
    jsonb_array_length(j) = 0, j::text);
  -- una persona más en cada pedido → sí es excepción, con el pax del pedido (no el de la factura principal)
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Pax 9411', 'app'), ('referente', 'Ref Pax 9412', 'app');
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, pos_ref, visita_clave)
  select m.id, 'tarjeta', 1, 6, 18000, t0 - interval '25 minutes', now() - interval '2 hours', 'app',
         jsonb_build_object('modo','pedido','pedido', x.p,'mesa', x.me,'abierto_en', t0 - interval '60 minutes','hora', t0 - interval '25 minutes'), 'pax:c' || x.p
    from (values ('9411', '8'), ('9412', '9')) x(p, me) join club_miembros m on m.nombre = 'Ref Pax ' || x.p;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select coalesce(jsonb_agg(to_jsonb(e) order by e.factura), '[]') into j from public.club_excepciones(d0, d1) e where e.tipo = 'PERSONAS_SOBRE_PAX' and e.factura in ('990961', '990965');
  perform pg_temp.yo();
  perform pg_temp.r('41', 'con una persona más: PERSONAS_SOBRE_PAX con pax del pedido 4 (Σ facturas) y 5 (Personas del pedido)',
    jsonb_array_length(j) = 2 and (j->0->'detalle'->>'pax')::int = 4 and (j->0->'detalle'->>'personas')::int = 5
      and (j->1->'detalle'->>'pax')::int = 5 and (j->1->'detalle'->>'personas')::int = 6, j::text);
end $$;


-- ═══ 42. La mesa es (área, mesa): la mesa 3 del área 'M' no es la mesa 3 del área '3' (Ismael, 07-nov) ═══
-- Dos pedidos abiertos con la misma mesa 3, uno por área; cada uno cobra su factura principal y, a la misma
-- hora, cada mesa tiene una factura sin pedido. Cada pedido cruza SOLO con la de su área.
do $$
declare v_m uuid; v_n uuid; j jsonb; t0 timestamptz := now() - interval '15 minutes'; v_k uuid; v_l uuid;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Area M', 'app') returning id into v_m;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Area 3', 'app') returning id into v_n;
  insert into pos_ndf_open (local, clave, id_pedido, area, mesa, canal, pax, updated_at, pedido_abierto_en) values
    ('santa-teresa', 'pedido:9421', '9421', 'M', '3', 'salon', 2, t0 - interval '40 minutes', t0 - interval '40 minutes'),
    ('santa-teresa', 'pedido:9422', '9422', '3', '3', 'salon', 2, t0 - interval '40 minutes', t0 - interval '40 minutes');
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select jsonb_agg(to_jsonb(x) order by x.pedido) into j from public.club_pedidos_abiertos() x where x.pedido in ('9421', '9422');
  perform pg_temp.yo();
  perform pg_temp.r('42', 'la lista de pedidos abiertos trae el área («Área 3 · Mesa 3»)',
    j->0->>'area' = 'M' and j->1->>'area' = '3' and j->0->>'mesa' = '3' and j->1->>'mesa' = '3', coalesce(j::text, 'null'));
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9421"}'::jsonb);
  perform public.club_tarjeta_manual(v_n, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9422"}'::jsonb);
  perform pg_temp.yo();
  select id into v_k from club_movimientos where miembro_id = v_m and pos_ref->>'pedido' = '9421';
  select id into v_l from club_movimientos where miembro_id = v_n and pos_ref->>'pedido' = '9422';
  perform pg_temp.r('42', 'el escaneo guarda el área del pedido', (select pos_ref->>'area' from club_movimientos where id = v_k) = 'M'
      and (select pos_ref->>'area' from club_movimientos where id = v_l) = '3', '');
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, area, area_factura, mesa, mesa_factura, numero_pedido, pedido_abierto_en, total_crc) values
    ('990971', t0 + interval '10 minutes', 'C', 'salon', 'cajero',     true, 'ok', 'M', 'M', '3', '3', '9421', t0 - interval '40 minutes', 20000),
    ('990972', t0 + interval '11 minutes', 'C', 'salon', 'cajero',     true, 'ok', '3', '3', '3', '3', '9422', t0 - interval '40 minutes', 20000),
    ('990973', t0 + interval '5 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', 'M', 'M', null, '3', null, null, 8000),
    ('990974', t0 + interval '5 minutes',  'C', 'salon', 'sin_pedido', true, 'ok', '3', '3', null, '3', null, null, 9000);
  perform pg_temp.r('42', 'misma hora, mesa 3 en dos áreas: cada pedido cruza solo con la sin pedido de su área (y no hay AMBIGUA)',
    pg_temp.cruce(v_k) = '990971+990973' and pg_temp.cruce(v_l) = '990972+990974'
      and not exists (select 1 from public.club_cruce_detalle('santa-teresa', (select pos_ref from club_movimientos where id = v_k), null) d where d.rol = 'ambigua')
      and not exists (select 1 from public.club_cruce_detalle('santa-teresa', (select pos_ref from club_movimientos where id = v_l), null) d where d.rol = 'ambigua'),
    pg_temp.cruce(v_k) || ' / ' || pg_temp.cruce(v_l));
  -- sin el área en el escaneo (agente viejo): se toma la de la factura del pedido
  perform pg_temp.r('42', 'sin área en el escaneo, se usa la de la factura del pedido',
    pg_temp.fac(public.club_cruce_facturas('santa-teresa', (select pos_ref - 'area' from club_movimientos where id = v_l), null)) = '990972+990974', '');
end $$;

-- ═══ 43. R-01 (ronda 3, §3): el QR público no canjea; código de un solo uso, solo hash, TTL 10 min ═══
do $$
declare v_a uuid; v_b uuid; v_c uuid; v_baja uuid; v_ta text; v_tb text; v_tc text; v_tbaja text; v_ra text;
        k1 text; k2 text; k3 text; kb text; j jsonb; j0 jsonb; j1 jsonb; v_op uuid := gen_random_uuid(); v_p int; v_n int;
        v_err text; v_mov uuid; i int; r record;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Canje A', 'app') returning id, token_portal, codigo into v_a, v_ta, v_ra;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Canje B', 'app') returning id, token_portal into v_b, v_tb;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Canje Sin Saldo', 'app') returning id, token_portal into v_c, v_tc;
  insert into club_miembros (tipo, nombre, origen, estado) values ('referente', 'Ref Canje Baja', 'app', 'baja') returning id, token_portal into v_baja, v_tbaja;
  insert into club_miembros_contacto (miembro_id, telefono) values (v_a, '+50660000009');
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen) values
    (v_a, 'tarjeta', 30, 6, 18000, now() - interval '3 days', 'migracion'),
    (v_b, 'tarjeta', 18, 6, 18000, now() - interval '3 days', 'migracion'),
    (v_c, 'tarjeta', 2, 6, 18000, now() - interval '3 days', 'migracion'),
    (v_baja, 'tarjeta', 18, 6, 18000, now() - interval '3 days', 'migracion');

  perform set_config('request.headers', '{}', true);
  begin
    perform pg_temp.como('anon', null);
    perform public.club_canje_codigo_generar(v_ta);
    perform pg_temp.yo(); perform pg_temp.r('43', 'generar sin header', false, 'generó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'generar sin el header de club-web → «Enlace no válido»', sqlerrm = 'Enlace no válido', sqlerrm);
  end;
  perform set_config('request.headers', '{"x-club-web":"clave-nueva-del-club-rotada-fedcba9876543210"}', true);   -- la 40 rotó la clave

  perform pg_temp.como('anon', null);
  select to_jsonb(g) into j from public.club_canje_codigo_generar(v_ta) g;
  perform pg_temp.yo();
  k1 := j->>'codigo';
  perform pg_temp.r('43', 'el portal genera un código de 6 que vence en 10 min, con el QR /k/{codigo}',
    k1 ~ '^[A-HJ-NP-Z2-9]{6}$' and j->>'url' = 'https://club.satoricostarica.com/k/' || k1
      and (j->>'vence_en')::timestamptz between now() + interval '9 minutes' and now() + interval '10 minutes', j::text);
  perform pg_temp.r('43', 'en la base queda SOLO el hash (sha256), nunca el código',
    exists (select 1 from club_codigos_canje where miembro_id = v_a and codigo_hash = public.club_codigo_hash(k1))
      and not exists (select 1 from information_schema.columns where table_name = 'club_codigos_canje' and column_name = 'codigo')
      and not exists (select 1 from club_codigos_canje k where to_jsonb(k)::text like '%' || k1 || '%'), '');
  begin
    insert into club_codigos_canje (miembro_id, codigo_hash, vence_en) values (v_b, repeat('a', 64), now() + interval '30 minutes');
    perform pg_temp.r('43', 'TTL de 30 min', false, 'aceptó');
  exception when check_violation then
    perform pg_temp.r('43', 'la tabla no acepta un vencimiento de más de 10 minutos', true, sqlerrm);
  end;

  begin
    perform pg_temp.como('anon', null);
    perform public.club_canje_codigo_generar(v_tbaja);
    perform pg_temp.yo(); perform pg_temp.r('43', 'baja genera código', false, 'generó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'cuenta dada de baja → «Enlace no válido»', sqlerrm = 'Enlace no válido', sqlerrm);
  end;
  begin
    perform pg_temp.como('anon', null);
    perform public.club_canje_codigo_generar(v_tc);
    perform pg_temp.yo(); perform pg_temp.r('43', 'sin saldo genera código', false, 'generó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'sin saldo para el mínimo → «Todavía no te alcanza para canjear»', sqlerrm = 'Todavía no te alcanza para canjear', sqlerrm);
  end;

  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  j := public.club_resolver('https://club.satoricostarica.com/r/' || v_ra);
  j0 := public.club_resolver('https://club.satoricostarica.com/k/' || k1);
  j1 := public.club_resolver_miembro(v_a);
  perform pg_temp.yo();
  perform pg_temp.r('43', '/r/ → tipo referente, con saldo y sin código de canje',
    j->>'tipo' = 'referente' and (j->'datos'->>'personas')::int = 30 and j->'datos'->>'codigo_canje' is null, j::text);
  perform pg_temp.r('43', '/k/{codigo} → tipo canje, vigente, del referente A',
    j0->>'tipo' = 'canje' and j0->'datos'->>'codigo_estado' = 'vigente' and (j0->'datos'->>'id')::uuid = v_a, j0::text);
  perform pg_temp.r('43', '«buscar» (club_resolver_miembro) → la ficha sin canje, igual que el /r/',
    j1->>'tipo' = 'referente' and j1->'datos'->>'codigo_canje' is null, j1->>'tipo');

  -- canje con el código del /r/, sin código, de otro miembro: error devuelto (y el intento queda anotado)
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, v_ra, 1, 'FK-001', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'canje con el código del QR público (/r/) → rechazado', v_err like 'Falta el código de canje%', v_err);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, null, 1, 'FK-001', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'canje sin código → rechazado', v_err like 'Falta el código de canje%', v_err);
  perform pg_temp.como('anon', null);
  select g.codigo into kb from public.club_canje_codigo_generar(v_tb) g;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, kb, 1, 'FK-002', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'código de otro miembro → «Código de canje no válido»', v_err like 'Código de canje no válido: pedile%', v_err);
  perform pg_temp.r('43', 'los intentos fallidos quedan anotados (actor y miembro)',
    (select count(*) from club_canje_intentos where actor = '<CAJERO_UUID>'::uuid and miembro_id = v_a) = 3, '');

  -- generar otro invalida el anterior
  perform pg_temp.como('anon', null);
  select g.codigo into k2 from public.club_canje_codigo_generar(v_ta) g;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, k1, 1, 'FK-003', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'generar otro invalida el anterior → «reemplazado»', v_err like '%reemplazado%'
    and (select count(*) from club_codigos_canje where miembro_id = v_a and usado_en is null and invalidado_en is null) = 1, v_err);
  -- vencido
  update club_codigos_canje set creado_en = now() - interval '20 minutes', vence_en = now() - interval '11 minutes'
   where codigo_hash = public.club_codigo_hash(k2);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, k2, 1, 'FK-004', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'código vencido (10 min) → «venció»', v_err like 'El código de canje venció%', v_err);

  -- tope de intentos fallidos: con 5 en 15 min, el cajero queda bloqueado (aun con un código bueno)
  perform pg_temp.como('anon', null);
  select g.codigo into k3 from public.club_canje_codigo_generar(v_ta) g;
  -- (ya van 5 intentos fallidos con el miembro A: /r/, sin código, de otro miembro, reemplazado y vencido)
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje(v_a, k3, 1, 'FK-010', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('43', 'tope de intentos', false, 'canjeó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'tope de intentos fallidos (5 en 15 min) → bloqueado, aun con un código bueno', sqlerrm like 'Demasiados códigos equivocados%', sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_resolver('ZZZZZZ');
    perform pg_temp.yo(); perform pg_temp.r('43', 'Escanear con el usuario bloqueado', false, 'resolvió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'Escanear también respeta el tope (no sirve para probar códigos)', sqlerrm like 'Demasiados códigos equivocados%', sqlerrm);
  end;
  delete from club_canje_intentos;   -- (dentro de la prueba) se limpia el tope para seguir

  -- bien: canje de 1 con el código vigente; consumo atómico; aviso al referente
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.personas, c.movimiento, c.error into v_p, v_mov, v_err from public.club_canje(v_a, k3, 1, 'FK-005', v_op) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'canje de 1 con el código vigente → saldo 24; el código queda usado con el movimiento y quién',
    v_err is null and v_p = 24 and exists (select 1 from club_codigos_canje k where k.codigo_hash = public.club_codigo_hash(k3)
                          and k.usado_en is not null and k.usado_por = '<CAJERO_UUID>'::uuid and k.movimiento_id = v_mov),
    format('saldo=%s error=%s', v_p, v_err));
  perform pg_temp.r('43', 'aviso al referente: queda el evento en club_alertas (para el pase de Wallet)',
    exists (select 1 from club_alertas where movimiento_id = v_mov and tipo = 'canje' and miembro_id = v_a and enviado_en is null), '');
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  j := public.club_canje_aviso(v_mov);
  perform pg_temp.yo();
  perform pg_temp.r('43', 'link wa.me para quien hizo el canje: teléfono del referente y texto con créditos y saldo',
    j->>'tel' = '50660000009' and j->>'texto' like '%se canjearon 1 crédito%' and j->>'texto' like '%Te quedan 4%', j::text);
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>'); perform pg_temp.yo();
    perform pg_temp.como('authenticated', '<CONTADOR_UUID>');
    perform public.club_canje_aviso(v_mov);
    perform pg_temp.yo(); perform pg_temp.r('43', 'contador pide el aviso', false, 'devolvió');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('43', 'el aviso (con el teléfono) no lo pide cualquiera → sin permiso', true, sqlerrm);
  end;
  -- reintento de la red (mismo p_op): no duplica
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.personas into v_p from public.club_canje(v_a, k3, 1, 'FK-005', v_op) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'reintento con el mismo p_op → el mismo canje, uno solo',
    v_p = 24 and (select count(*) from club_movimientos where miembro_id = v_a and tipo = 'canje') = 1, format('saldo=%s', v_p));
  -- otro p_op con el mismo código → «ya se usó»
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select c.error into v_err from public.club_canje(v_a, k3, 1, 'FK-006', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'dos canjes con el mismo código → el segundo falla («ya se usó»)',
    v_err like 'Este código de canje ya se usó%' and (select count(*) from club_movimientos where miembro_id = v_a and tipo = 'canje') = 1, v_err);

  -- tope de generación: 5 por hora por miembro (ya van 4 de A)
  v_n := 0; v_err := null;
  for i in 1 .. 3 loop
    begin
      perform pg_temp.como('anon', null);
      perform public.club_canje_codigo_generar(v_ta);
      perform pg_temp.yo(); v_n := v_n + 1;
    exception when others then
      perform pg_temp.yo(); v_err := sqlerrm; exit;
    end;
  end loop;
  perform pg_temp.r('43', 'tope de 5 códigos por hora por miembro → «Demasiados códigos de canje»',
    v_n = 2 and v_err = 'Demasiados códigos de canje', format('generó %s más · %s', v_n, v_err));

  -- respaldo sin celular
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_canje_aprobado(v_b, 1, 'FK-007', gen_random_uuid(), null, 'Sin celular, lo conozco');
    perform pg_temp.yo(); perform pg_temp.r('43', 'cajero usa el respaldo', false, 'aceptó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('43', 'el cajero no puede usar el canje sin celular → sin permiso', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_canje_aprobado(v_b, 1, 'FK-007', gen_random_uuid(), null, '  ');
    perform pg_temp.yo(); perform pg_temp.r('43', 'respaldo sin nota', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'respaldo sin nota → error', sqlerrm like 'La nota es obligatoria%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  select c.personas into v_p from public.club_canje_aprobado(v_b, 1.5, 'FK-008', gen_random_uuid(), null, 'Se le murió el celular') c;
  perform pg_temp.yo();
  perform pg_temp.r('43', 'manager: canje sin celular, con nota, registrado por el manager',
    v_p = 9 and exists (select 1 from club_movimientos where miembro_id = v_b and tipo = 'canje'
                         and registrado_por = '<MANAGER_UUID>'::uuid and nota = 'Canje aprobado sin código: Se le murió el celular'),
    format('saldo=%s', v_p));
  perform pg_temp.r('43', 'el respaldo no consume el código vigente', (select usado_en is null from club_codigos_canje where codigo_hash = public.club_codigo_hash(kb)), '');
  -- CANJE_SIN_CODIGO: siempre visible; no la resuelve quien lo aprobó (ni el owner, si fuera él)
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select to_jsonb(e) into j from public.club_excepciones(current_date - 1, current_date + 1) e
   where e.tipo = 'CANJE_SIN_CODIGO' and e.detalle->>'miembro' like '%Canje B%';
  perform pg_temp.yo();
  perform pg_temp.r('43', 'el canje sin celular aparece como excepción CANJE_SIN_CODIGO, con el motivo y quién lo aprobó',
    j->>'certeza' = 'exacta' and j->'detalle'->>'motivo' = 'Se le murió el celular' and j->'detalle'->>'aprobado_por' is not null, coalesce(j::text, 'null'));
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_excepcion_resolver('CANJE_SIN_CODIGO', j->>'ref', 'lo resuelvo yo');
    perform pg_temp.yo(); perform pg_temp.r('43', 'el manager resuelve su propio canje sin código', false, 'resolvió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('43', 'quien aprobó el canje sin código no puede resolverlo', sqlerrm like 'No podés resolver%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_excepcion_resolver('CANJE_SIN_CODIGO', j->>'ref', 'Revisado: el referente lo confirma');
  perform pg_temp.yo();
  perform pg_temp.r('43', 'otra persona (el owner) sí lo resuelve', true, '');

  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform count(*) from public.club_codigos_canje;
    perform pg_temp.yo(); perform pg_temp.r('43', 'owner lee club_codigos_canje', false, 'leyó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('43', 'club_codigos_canje y club_canje_intentos: nadie los lee directo', true, sqlerrm);
  end;
end $$;

-- ═══ 44. R-02: CUPON_SIN_PROMO — cupón usado sin el artículo de la promo en las facturas de la visita ═══
do $$
declare v_r uuid; c1 text; c2 text; t2 uuid; j jsonb; j0 jsonb; t0 timestamptz := now() - interval '30 minutes';
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Promo', 'app') returning id into v_r;
  insert into club_cupones (referente_id, vence_en) values (v_r, now() + interval '1 day') returning codigo into c1;
  insert into club_cupones (referente_id, vence_en) values (v_r, now() + interval '1 day') returning codigo into c2;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values ('990981', t0, 'C', 'salon', 'cajero', true, 'ok', 30000);
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values ('990982', t0, 'C', 'salon', 'cajero', true, 'ok', 30000) returning id into t2;
  insert into pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto) values (t2, 'PRUEBA-PROMO', 'PROMO CLUB 10% (prueba)', 1, 0);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_cupon_usar(c1, 2, '990981', gen_random_uuid());
  perform public.club_cupon_usar(c2, 2, '990982', gen_random_uuid());
  perform pg_temp.yo();
  update club_config set promo_articulo_codigo = 'PRUEBA-PROMO' where location_id = 'santa-teresa';
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(e)) into j0 from public.club_excepciones(current_date - 1, current_date) e
   where e.tipo = 'CUPON_SIN_PROMO' and e.factura in ('990981', '990982');
  perform pg_temp.yo();
  perform pg_temp.r('44', 'recién registrado (antes de la latencia del puente) → todavía no es excepción', j0 is null, coalesce(j0::text, ''));
  update club_movimientos set registrado_en = now() - interval '2 hours'
   where cupon_id in (select id from club_cupones where codigo in (c1, c2));

  update club_config set promo_articulo_codigo = null where location_id = 'santa-teresa';
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(e)) into j0 from public.club_excepciones(current_date - 1, current_date) e where e.tipo = 'CUPON_SIN_PROMO';
  perform pg_temp.yo();
  perform pg_temp.r('44', 'R02: sin artículo marcador, CUPON_SIN_PROMO sale «pendiente de configuración» (no las de 990981/2)',
    jsonb_array_length(j0) = 1 and j0->0->>'ref' = 'config:promo_articulo_codigo' and j0->0->>'certeza' = 'pendiente_configuracion',
    coalesce(j0::text, ''));
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_excepcion_resolver('CUPON_SIN_PROMO', 'config:promo_articulo_codigo', 'la doy por buena');
    perform pg_temp.yo(); perform pg_temp.r('44', 'R02: pendiente de configuración no se resuelve con nota', false, 'resolvió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('44', 'R02: «pendiente de configuración» no se resuelve con nota (negativa)', sqlerrm like 'Pendiente de configuración%', sqlerrm);
  end;

  update club_config set promo_articulo_codigo = 'PRUEBA-PROMO' where location_id = 'santa-teresa';
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select jsonb_agg(to_jsonb(e)) into j from public.club_excepciones(current_date - 1, current_date) e
   where e.tipo = 'CUPON_SIN_PROMO' and e.factura in ('990981', '990982');
  perform pg_temp.yo();
  perform pg_temp.r('44', 'con el artículo: el cupón de 990981 (sin la promo) sí, exacta; el de 990982 (con la promo) no',
    jsonb_array_length(j) = 1 and j->0->>'factura' = '990981' and j->0->>'certeza' = 'exacta' and j->0->'detalle'->>'cupon' = c1,
    coalesce(j::text, 'null'));
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_excepcion_resolver('CUPON_SIN_PROMO', j->0->>'ref', 'Se olvidó marcar la promo; descuento hecho a mano');
  select jsonb_agg(to_jsonb(e)) into j from public.club_excepciones(current_date - 1, current_date) e
   where e.tipo = 'CUPON_SIN_PROMO' and e.factura = '990981';
  perform pg_temp.yo();
  perform pg_temp.r('44', 'el manager la resuelve con nota', (j->0->>'resuelta')::boolean, coalesce(j->0->>'nota', ''));
  update club_config set promo_articulo_codigo = null where location_id = 'santa-teresa';
end $$;

-- ═══ 45. CLUB-AUD-26: tarjeta física con flag por entorno, tope diario y TARJETA_MANUAL ═══
do $$
declare v_m uuid; j jsonb; v_err text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Tarjeta Fisica', 'app') returning id into v_m;
  -- apagada (como en prod): nadie la usa
  update club_config set tarjeta_manual_activa = false where location_id = 'santa-teresa';
  foreach v_err in array array['<CAJERO_UUID>', '<MANAGER_UUID>', '<OWNER_UUID>'] loop
    begin
      perform pg_temp.como('authenticated', v_err);
      perform public.club_tarjeta_manual(v_m, 2, 'FT-001', gen_random_uuid());
      perform pg_temp.yo(); perform pg_temp.r('45', 'tarjeta física apagada', false, 'aceptó');
    exception when others then
      perform pg_temp.yo(); perform pg_temp.r('45', 'apagada (prod): rechaza a todos los roles', sqlerrm like 'La tarjeta física está desactivada en este local: registrá%', sqlerrm);
    end;
  end loop;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  j := public.club_resolver_miembro(v_m);
  perform pg_temp.yo();
  perform pg_temp.r('45', 'la caja recibe el flag (la UI esconde el botón)', (j->'datos'->>'tarjeta_manual_activa')::boolean = false, '');
  -- prendida (staging, piloto en paralelo) con tope diario de 5 personas por miembro
  update club_config set tarjeta_manual_activa = true, tarjeta_manual_tope_dia = 5 where location_id = 'santa-teresa';
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_m, 3, 'FT-002', gen_random_uuid());
  perform pg_temp.yo();
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_tarjeta_manual(v_m, 3, 'FT-003', gen_random_uuid());
    perform pg_temp.yo(); perform pg_temp.r('45', 'tope diario', false, 'aceptó 6');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('45', 'prendida: tope diario por miembro (3 + 3 > 5) → rechazado', sqlerrm like 'Supera el tope diario de tarjeta física (5%', sqlerrm);
  end;
  update club_config set tarjeta_manual_tope_dia = 30 where location_id = 'santa-teresa';
  -- TARJETA_MANUAL: siempre visible; no la resuelve quien la cargó (ni siendo owner)
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select to_jsonb(e) into j from public.club_excepciones(current_date - 1, current_date + 1) e
   where e.tipo = 'TARJETA_MANUAL' and e.detalle->>'miembro' like '%Tarjeta Fisica%';
  perform pg_temp.yo();
  perform pg_temp.r('45', 'cada tarjeta física es una excepción TARJETA_MANUAL (exacta), con quién la cargó',
    j->>'certeza' = 'exacta' and (j->'detalle'->>'personas')::int = 3 and j->'detalle'->>'cargada_por' is not null, coalesce(j::text, 'null'));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_excepcion_resolver('TARJETA_MANUAL', j->>'ref', 'la cargué yo');
    perform pg_temp.yo(); perform pg_temp.r('45', 'cajero resuelve', false, 'resolvió');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('45', 'el cajero no resuelve excepciones', true, sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_excepcion_resolver('TARJETA_MANUAL', j->>'ref', 'Tarjeta física del comercio, revisada');
  perform pg_temp.yo();
  perform pg_temp.r('45', 'la resuelve otra persona (el manager)', true, '');
end $$;

-- ═══ 46. CLUB-AUD-30: el staff no lee los códigos (QR público ni cupones) ═══
do $$
declare v_n int; v_ok boolean;
begin
  foreach v_ok in array array[true, false] loop
    begin
      perform pg_temp.como('authenticated', case when v_ok then '<CAJERO_UUID>' else '<CONTADOR_UUID>' end);
      perform (select codigo from public.club_miembros limit 1);
      perform pg_temp.yo(); perform pg_temp.r('46', 'staff lee club_miembros.codigo', false, 'leyó');
    exception when insufficient_privilege then
      perform pg_temp.yo(); perform pg_temp.r('46', case when v_ok then 'cajero' else 'contador' end || ': sin acceso a club_miembros.codigo', true, sqlerrm);
    end;
    begin
      perform pg_temp.como('authenticated', case when v_ok then '<CAJERO_UUID>' else '<CONTADOR_UUID>' end);
      perform (select codigo from public.club_cupones limit 1);
      perform pg_temp.yo(); perform pg_temp.r('46', 'staff lee club_cupones.codigo', false, 'leyó');
    exception when insufficient_privilege then
      perform pg_temp.yo(); perform pg_temp.r('46', case when v_ok then 'cajero' else 'contador' end || ': sin acceso a club_cupones.codigo', true, sqlerrm);
    end;
    perform pg_temp.como('authenticated', case when v_ok then '<CAJERO_UUID>' else '<CONTADOR_UUID>' end);
    select count(*) into v_n from public.club_cupones;
    perform pg_temp.yo();
    perform pg_temp.r('46', case when v_ok then 'cajero' else 'contador' end || ': no ve filas de club_cupones', v_n = 0, format('%s filas', v_n));
  end loop;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_n from public.club_miembros;
  perform pg_temp.yo();
  perform pg_temp.r('46', 'el cajero sigue leyendo los miembros (sin el código)', v_n > 0, format('%s', v_n));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_miembro_codigo((select id from club_miembros limit 1));
    perform pg_temp.yo(); perform pg_temp.r('46', 'cajero pide el código', false, 'devolvió');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('46', 'club_miembro_codigo: solo owner y manager', true, sqlerrm);
  end;
end $$;

-- ═══ 47. CLUB-AUD-25: auditoría de solo inserción, resoluciones como historial y segregación ═══
do $$
declare v_id uuid; v_n int; j jsonb; v_mv uuid;
begin
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  v_id := public.club_miembro_guardar(null, 'referente', 'Ref Auditoria', null, 'activo', '{"telefono":"88880042"}'::jsonb);
  perform public.club_miembro_guardar(v_id, 'referente', 'Ref Auditoria Dos', null, 'activo', null);
  perform public.club_miembro_guardar(v_id, 'referente', 'Ref Auditoria Dos', null, 'baja', null);
  perform public.club_miembro_guardar(v_id, 'referente', 'Ref Auditoria Dos', null, 'activo', null);
  perform public.club_miembro_regenerar_codigo(v_id);
  perform public.club_miembro_token(v_id);
  perform pg_temp.yo();
  select jsonb_agg(a.accion order by a.id) into j from club_auditoria a where a.objeto_id = v_id;
  perform pg_temp.r('47', 'quedan anotados: alta, contacto, edición, baja, reactivación, regenerar el código y ver el link del portal',
    j @> '["alta","contacto_insert","edicion","baja","reactivacion","regenerar_codigo","ver_link_portal"]'::jsonb, j::text);
  perform pg_temp.r('47', 'con actor y rol, el antes y el después, y sin código, token ni teléfono',
    not exists (select 1 from club_auditoria a where a.objeto_id = v_id
                 and (a.actor is distinct from '<MANAGER_UUID>'::uuid or a.rol <> 'manager'
                      or coalesce(a.antes, '{}') ? 'token_portal' or coalesce(a.despues, '{}') ? 'codigo'
                      or coalesce(a.despues::text, '') like '%88880042%'))
      and exists (select 1 from club_auditoria a where a.objeto_id = v_id and a.accion = 'edicion'
                   and a.antes->>'nombre' = 'Ref Auditoria' and a.despues->>'nombre' = 'Ref Auditoria Dos'), '');
  begin
    set local club.libro_mantenimiento = '';
    update club_auditoria set accion = 'x' where objeto_id = v_id;
    perform pg_temp.r('47', 'UPDATE de la auditoría', false, 'editó');
  exception when others then
    perform pg_temp.r('47', 'club_auditoria: solo inserción (aun como dueño)', sqlerrm like '%solo inserción%', sqlerrm);
  end;
  set local club.libro_mantenimiento = 'pruebas';
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    select count(*) into v_n from public.club_auditoria;
    perform pg_temp.yo();
    perform pg_temp.r('47', 'la auditoría la ve solo el owner (el manager ve 0 filas)', v_n = 0, format('%s', v_n));
  exception when insufficient_privilege then perform pg_temp.yo();
  end;

  -- resoluciones como historial: dos resoluciones → dos filas; vale la última
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota, registrado_por)
  values (v_id, 'tarjeta', 2, 6, 18000, '990991', now() - interval '2 hours', now() - interval '2 hours', 'app', 'manual', '<CAJERO_UUID>'::uuid)
  returning id into v_mv;
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'nota A');
  perform pg_temp.yo();
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'nota B');
  select to_jsonb(e) into j from public.club_excepciones(current_date - 1, current_date + 1) e where e.ref = v_mv::text and e.tipo = 'REGISTRO_SIN_FACTURA';
  perform pg_temp.yo();
  perform pg_temp.r('47', 're-resolver no pisa: quedan las dos (historial) y se muestra la última',
    (select count(*) from club_excepciones_resueltas where ref = v_mv::text) = 2 and j->>'nota' = 'nota B', coalesce(j->>'nota', 'null'));
  -- segregación: el movimiento lo registró el CAJERO; un manager que lo registró no puede resolverlo
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota, registrado_por)
  values (v_id, 'tarjeta', 1, 6, 18000, '990992', now() - interval '2 hours', now() - interval '2 hours', 'app', 'manual', '<MANAGER_UUID>'::uuid)
  returning id into v_mv;
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'la resuelvo yo');
    perform pg_temp.yo(); perform pg_temp.r('47', 'manager resuelve su propio registro', false, 'resolvió');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('47', 'segregación: quien registró el movimiento no resuelve su excepción (va al owner)', sqlerrm like '%la resuelve el owner%', sqlerrm);
  end;
end $$;

-- ═══ 48. Libro de solo inserción en club_movimientos (también para el dueño), compatible con el migrador ═══
do $$
declare v_mv uuid; v_mig uuid;
begin
  select id into v_mv from club_movimientos where origen = 'app' limit 1;
  select id into v_mig from club_movimientos where origen = 'migracion' limit 1;
  set local club.libro_mantenimiento = '';
  begin
    update club_movimientos set personas = personas where id = v_mv;
    perform pg_temp.r('48', 'UPDATE como dueño', false, 'editó');
  exception when others then
    perform pg_temp.r('48', 'UPDATE del libro, aun como dueño de la tabla → rechazado', sqlerrm like 'club_movimientos es de solo inserción%', sqlerrm);
  end;
  begin
    delete from club_movimientos where id = v_mv;
    perform pg_temp.r('48', 'DELETE como dueño', false, 'borró');
  exception when others then
    perform pg_temp.r('48', 'DELETE del libro → rechazado', sqlerrm like 'club_movimientos es de solo inserción%', sqlerrm);
  end;
  set local club.libro_mantenimiento = 'migracion';
  begin
    delete from club_movimientos where id = v_mv;
    perform pg_temp.r('48', 'modo migración borra una fila de la app', false, 'borró');
  exception when others then
    perform pg_temp.r('48', 'modo migración: no borra filas de la app', sqlerrm like 'club_movimientos es de solo inserción%', sqlerrm);
  end;
  begin
    delete from club_movimientos where id = v_mig;
    perform pg_temp.r('48', 'modo migración: borra filas origen=migracion (volver a migrar)', not exists (select 1 from club_movimientos where id = v_mig), '');
  exception when others then
    perform pg_temp.r('48', 'modo migración borra migracion', false, sqlerrm);
  end;
  set local club.libro_mantenimiento = 'pruebas';
end $$;

-- ═══ 49. CLUB-AUD-27: sin puente fresco, el modo pedido se rechaza (plan B) ═══
do $$
declare v_m uuid;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Puente', 'app') returning id into v_m;
  insert into pos_ndf_open (local, clave, id_pedido, area, mesa, canal, pax, updated_at, pedido_abierto_en)
  values ('santa-teresa', 'pedido:2026-11-07:9491', '9491', 'M', '9', 'salon', 4, now(), now() - interval '20 minutes');
  update pos_ndf_cursor set last_poll_at = now() - interval '6 minutes', last_error = null where local = 'santa-teresa';
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9491"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('49', 'puente viejo', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('49', 'último ciclo hace 6 min → «Puente sin datos: elegí la factura»', sqlerrm = 'Puente sin datos: elegí la factura', sqlerrm);
  end;
  update pos_ndf_cursor set last_poll_at = now(), last_error = 'timeout leyendo el PoS' where local = 'santa-teresa';
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform count(*) from public.club_pedidos_abiertos();
    perform pg_temp.yo(); perform pg_temp.r('49', 'latido con error', false, 'listó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('49', 'latido reciente pero con error → la lista de pedidos tampoco (plan B)', sqlerrm = 'Puente sin datos: elegí la factura', sqlerrm);
  end;
  update pos_ndf_cursor set last_poll_at = now(), last_error = null where local = 'santa-teresa';
end $$;

-- ═══ 50. CLUB-AUD-31: clave del pedido abierto con fecha; un número repetido no se adivina ═══
do $$
declare v_m uuid; v_n uuid; j jsonb;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Clave A', 'app') returning id into v_m;
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Clave B', 'app') returning id into v_n;
  -- ayer quedó abierto el 9502 (en R) y hoy se abrió otro 9502
  insert into pos_ndf_open (local, clave, id_pedido, area, mesa, canal, pax, updated_at, pedido_abierto_en) values
    ('santa-teresa', 'pedido:2026-11-06:9502', '9502', 'M', '4', 'salon', 2, now() - interval '20 hours', now() - interval '20 hours'),
    ('santa-teresa', 'pedido:2026-11-07:9502', '9502', 'M', '11', 'salon', 4, now(), now() - interval '30 minutes');
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select jsonb_agg(x.clave order by x.clave) into j from public.club_pedidos_abiertos() x where x.pedido = '9502';
  perform pg_temp.yo();
  perform pg_temp.r('50', 'la lista trae los dos 9502, cada uno con su clave', j = '["pedido:2026-11-06:9502", "pedido:2026-11-07:9502"]'::jsonb, j::text);
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_tarjeta_manual(v_m, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9502"}'::jsonb);
    perform pg_temp.yo(); perform pg_temp.r('50', 'número ambiguo', false, 'aceptó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('50', 'sin clave y con el número repetido → rechazado («elegilo de la lista»)', sqlerrm like 'Hay más de un pedido abierto con el número 9502%', sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_tarjeta_manual(v_n, 2, null, gen_random_uuid(), '{"modo":"pedido","pedido":"9502","clave":"pedido:2026-11-07:9502"}'::jsonb);
  perform pg_temp.yo();
  perform pg_temp.r('50', 'con la clave: toma el pedido de hoy (mesa 11, su apertura)',
    (select pos_ref->>'mesa' from club_movimientos where miembro_id = v_n) = '11', (select pos_ref::text from club_movimientos where miembro_id = v_n));
end $$;

-- ═══ 51. Comparación con la página vieja (piloto en paralelo) ═══
do $$
declare v_m uuid; j jsonb; v_lunes date := (date_trunc('week', now() at time zone 'America/Costa_Rica'))::date;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Comparacion', 'app') returning id into v_m;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, origen, nota)
  values (v_m, 'tarjeta', 5, 6, 18000, 'FC-1', now(), 'app', 'manual');
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  j := public.club_comparacion_cargar(jsonb_build_array(
         jsonb_build_object('referente', 'ref comparación', 'semana', to_char(v_lunes + 2, 'YYYY-MM-DD'), 'personas', 7),
         jsonb_build_object('referente', 'Nadie Con Este Nombre', 'semana', to_char(v_lunes, 'YYYY-MM-DD'), 'personas', 3)));
  perform pg_temp.yo();
  perform pg_temp.r('51', 'carga de la página vieja: por nombre (sin tildes ni mayúsculas); los que no existen vuelven aparte',
    (j->>'cargadas')::int = 1 and j->'no_encontrados'->0->>'motivo' = 'no existe', j::text);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  select to_jsonb(c) into j from public.club_comparacion(v_lunes, v_lunes + 6) c where c.miembro_id = v_m;
  perform pg_temp.yo();
  perform pg_temp.r('51', 'lado a lado por semana: staging 5, página vieja 7, diferencia −2',
    (j->>'semana')::date = v_lunes and (j->>'personas_staging')::int = 5 and (j->>'personas_vieja')::int = 7 and (j->>'diferencia')::int = -2, coalesce(j::text, 'null'));
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform count(*) from public.club_comparacion(v_lunes, v_lunes + 6);
    perform pg_temp.yo(); perform pg_temp.r('51', 'cajero ve la comparación', false, 'vio');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('51', 'la comparación es de owner y manager', true, sqlerrm);
  end;
end $$;

-- ═══ 52. UX de caja: todo rechazo que puede ver Escanear dice qué hacer ═══
do $$
declare v_mal text;
begin
  with fns as (
    select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('club_cupon_usar','club_canje_aplicar','club_canje','club_canje_aprobado',
           'club_tarjeta_manual','club_pos_ref','club_visita_control','club_resolver','club_resolver_miembro',
           'club_pedidos_abiertos','club_facturas_recientes','club_buscar')),
  msgs as (
    select f.proname, m[1] as msg from fns f, regexp_matches(f.d, 'raise exception ''([^'']*)''', 'g') m
    union all
    select f.proname, m[1] from fns f, regexp_matches(f.d, 'then ''([^'']*)''', 'g') m   -- motivos devueltos (canje)
     where f.proname = 'club_canje_aplicar' and m[1] not like 'Canje aprobado sin código:%')
  select string_agg(distinct proname || ': ' || msg, ' | ') into v_mal from msgs
   where msg not in ('Sin permiso', 'REFERENTE_INACTIVO')   -- la app los traduce a un mensaje con acción
     and msg !~* '[:.] .*(elegí|elegilo|elegila|revisá|pedile|seguí|escaneá|corregí|cobrá|cargá|registrá|avisale|esperá|tocá|buscalo|cerrá|el resto|la resuelve|vale una|escribí)'
     and msg !~* '^(escribí)';
  perform pg_temp.r('52', 'todo rechazo de las funciones de la caja dice qué hacer (elegí, revisá, pedile al manager…)', v_mal is null, coalesce(v_mal, ''));
end $$;

-- ═══ 53. LC-A1: roles (una persona, un pase); tipo queda como espejo del rol de anfitrión ═══
do $$
declare v_m uuid; v_n int;
begin
  perform pg_temp.r('53', 'cada miembro tiene el rol de su tipo (los que ya existían)',
    not exists (select 1 from club_miembros m where m.tipo in ('referente','concierge_pm','equipo','socio')
                 and not exists (select 1 from club_miembro_roles r where r.miembro_id = m.id and r.rol = m.tipo)), '');
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Roles', 'app') returning id into v_m;
  perform pg_temp.r('53', 'alta de un referente → rol referente activo', public.club_tiene_rol(v_m, array['referente']), '');
  update club_miembros set tipo = 'equipo' where id = v_m;
  perform pg_temp.r('53', 'cambiar el tipo de anfitrión cambia el rol (uno solo)',
    (select array_agg(rol) from club_miembro_roles where miembro_id = v_m) = array['equipo'], '');
  update club_miembros set estado = 'baja' where id = v_m;
  perform pg_temp.r('53', 'la baja de la persona alcanza a sus roles', (select estado from club_miembro_roles where miembro_id = v_m) = 'baja', '');
  begin
    insert into club_miembro_roles (miembro_id, rol) values (v_m, 'referente');
    perform pg_temp.r('53', 'dos roles de anfitrión', false, 'aceptó');
  exception when unique_violation then
    perform pg_temp.r('53', 'un solo rol de anfitrión por persona', true, sqlerrm);
  end;
  begin
    insert into club_miembro_roles (miembro_id, rol, estado) values (v_m, 'equipo', 'pendiente');
    perform pg_temp.r('53', 'anfitrión pendiente', false, 'aceptó');
  exception when others then
    perform pg_temp.r('53', 'solo el socio puede estar pendiente', true, sqlerrm);
  end;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  select count(*) into v_n from public.club_miembro_roles;
  perform pg_temp.yo();
  perform pg_temp.r('53', 'la caja lee los roles (sin datos sensibles)', v_n > 0, format('%s', v_n));
end $$;

-- ═══ 54. LC-A1: QR fijo del socio (/s/): identifica, nunca da créditos ═══
do $$
declare v_s uuid; v_cod text; j jsonb; j2 jsonb; v_err text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('socio', 'Socio Prueba', 'app') returning id, codigo_socio into v_s, v_cod;
  select codigo_socio into v_cod from club_miembros where id = v_s;
  perform pg_temp.r('54', 'un socio recibe su QR fijo de 9 caracteres', v_cod ~ '^[A-HJ-NP-Z2-9]{9}$' and public.club_tiene_rol(v_s, array['socio']), coalesce(v_cod, 'null'));
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen)
  values (v_s, 'ajuste', 18, 6, 18000, now() - interval '1 day', 'migracion');
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  j := public.club_resolver('https://club.satoricostarica.com/s/' || v_cod);
  j2 := public.club_resolver(lower(v_cod));
  select c.error into v_err from public.club_canje(v_s, v_cod, 1, 'FS-1', gen_random_uuid()) c;
  perform pg_temp.yo();
  perform pg_temp.r('54', 'Escanear reconoce /s/ y los 9 caracteres a mano → «socio», con su estado',
    j->>'tipo' = 'socio' and j->'datos'->>'estado' = 'activo' and (j->'datos'->>'id')::uuid = v_s and j2->>'tipo' = 'socio', j::text);
  perform pg_temp.r('54', 'el QR del socio NO sirve para canjear créditos', v_err like 'Falta el código de canje%', v_err);
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform (select codigo_socio from public.club_miembros limit 1);
    perform pg_temp.yo(); perform pg_temp.r('54', 'cajero lee codigo_socio', false, 'leyó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('54', 'el staff no lee el código del socio (como el del QR de cupones)', true, sqlerrm);
  end;
end $$;

-- ═══ 55. LC-A1: activar a un socio como anfitrión (owner o manager, con nota y auditoría) ═══
do $$
declare v_s uuid; v_ev bigint;
begin
  insert into club_miembros (tipo, nombre, origen) values ('socio', 'Socio Anfitrion', 'app') returning id into v_s;
  begin
    perform pg_temp.como('authenticated', '<CAJERO_UUID>');
    perform public.club_rol_activar_anfitrion(v_s, 'referente', 'quiere compartir cupones');
    perform pg_temp.yo(); perform pg_temp.r('55', 'cajero activa anfitrión', false, 'activó');
  exception when insufficient_privilege then
    perform pg_temp.yo(); perform pg_temp.r('55', 'el cajero no activa anfitriones', true, sqlerrm);
  end;
  begin
    perform pg_temp.como('authenticated', '<MANAGER_UUID>');
    perform public.club_rol_activar_anfitrion(v_s, 'referente', ' ');
    perform pg_temp.yo(); perform pg_temp.r('55', 'sin nota', false, 'activó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('55', 'sin nota → error que dice qué hacer', sqlerrm like 'La nota es obligatoria%escribí%', sqlerrm);
  end;
  select coalesce(max(id), 0) into v_ev from club_pase_eventos;
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_rol_activar_anfitrion(v_s, 'referente', 'Trae amigos turistas: activo como anfitrión');
  perform pg_temp.yo();
  perform pg_temp.r('55', 'manager: queda socio Y anfitrión; tipo pasa a referente; auditoría con quién y la nota',
    public.club_tiene_rol(v_s, array['socio']) and public.club_tiene_rol(v_s, array['referente'])
      and (select tipo from club_miembros where id = v_s) = 'referente'
      and exists (select 1 from club_auditoria where objeto_id = v_s and accion = 'activar_anfitrion'
                   and actor = '<MANAGER_UUID>'::uuid and despues->>'nota' like 'Trae amigos%'), '');
  perform pg_temp.r('55', 'el cambio de rol avisa al pase (evento «rol»)',
    exists (select 1 from club_pase_eventos where id > v_ev and miembro_id = v_s and motivo = 'rol'), '');
  begin
    perform pg_temp.como('authenticated', '<OWNER_UUID>');
    perform public.club_rol_activar_anfitrion(v_s, 'equipo', 'de nuevo, para probar');
    perform pg_temp.yo(); perform pg_temp.r('55', 'activar dos veces', false, 'activó');
  exception when others then
    perform pg_temp.yo(); perform pg_temp.r('55', 'ya es anfitrión → error que dice qué hacer', sqlerrm like 'Ya es anfitrión:%', sqlerrm);
  end;
end $$;

-- ═══ 56. LC-A1: contrato del pase (solo service_role) ═══
do $$
declare v_r uuid; v_s uuid; v_tok text; j jsonb; j2 jsonb; v_v1 bigint; v_v2 bigint; v_n int; v_ok boolean := true; f text;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ana Pase Ficticia', 'app') returning id, token_portal into v_r, v_tok;
  insert into club_miembros_contacto (miembro_id, telefono, email) values (v_r, '+50660000077', 'ana.pase@ejemplo.com');
  insert into club_miembros (tipo, nombre, origen) values ('socio', 'Beto Pase Ficticio', 'app') returning id into v_s;
  update club_miembros set tipo = 'referente' where id = v_s;   -- socio y anfitrión
  insert into club_miembro_roles (miembro_id, rol) values (v_s, 'referente') on conflict do nothing;
  foreach f in array array['public.club_pase_datos(uuid)', 'public.club_pase_eventos_leer(bigint, int)', 'public.club_pase_por_token(text)', 'public.club_alertas_pendientes(int)'] loop
    v_ok := v_ok and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
                 and has_function_privilege('service_role', f, 'EXECUTE');
  end loop;
  perform pg_temp.r('56', 'las funciones del pase: solo service_role (ni anon ni la app)', v_ok, '');
  set local role service_role;
  j := public.club_pase_datos(v_r);
  j2 := public.club_pase_datos(v_s);
  reset role;
  perform pg_temp.r('56', 'solo anfitrión: una pestaña, código de barras = QR de cupones, Canjear con token de pase (no el del portal)',
    j->'pestanas' = '["anfitrion"]'::jsonb and j->'codigo_barras'->>'tipo' = 'cupones'
      and j->'codigo_barras'->>'valor' like 'https://club.satoricostarica.com/r/%' and j->>'canjear_url' like 'https://club.satoricostarica.com/w/%'
      and j->>'canjear_url' not like '%' || v_tok || '%' and not (j ? 'portal_url')
      and j->'socio' = 'null'::jsonb and j->>'nombre_pila' = 'Ana', j::text);
  perform pg_temp.r('56', 'socio y anfitrión: dos pestañas; código de barras = QR del socio; cupones en la pestaña Anfitrión',
    j2->'pestanas' = '["mi_club", "anfitrion"]'::jsonb and j2->'codigo_barras'->>'tipo' = 'socio'
      and j2->'codigo_barras'->>'valor' like 'https://club.satoricostarica.com/s/%'
      and j2->'anfitrion'->>'qr_url' like 'https://club.satoricostarica.com/r/%', j2::text);
  perform pg_temp.r('56', 'el pase no lleva contactos', j::text not like '%@%' and j::text not like '%+506%', '');
  v_v1 := (j->>'version')::bigint;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, origen, nota)
  values (v_r, 'tarjeta', 3, 6, 18000, 'FP-1', now(), 'app', 'manual');
  set local role service_role;
  v_v2 := (public.club_pase_datos(v_r)->>'version')::bigint;
  select count(*) into v_n from public.club_pase_eventos_leer(v_v1) e where e.miembro_id = v_r and e.motivo = 'movimiento';
  perform public.club_pase_cursor_guardar('google', v_v2);
  perform public.club_pase_cursor_guardar('google', v_v1);   -- nunca retrocede
  v_ok := public.club_pase_cursor_leer('google') = v_v2;
  f := public.club_pase_por_token(v_tok)::text;
  reset role;
  perform pg_temp.r('56', 'un movimiento sube la versión, deja el evento y el cursor no retrocede',
    v_v2 > v_v1 and v_n = 1 and v_ok, format('%s → %s', v_v1, v_v2));
  perform pg_temp.r('56', 'el token del portal resuelve al miembro (para «Agregar a Google Wallet»)', f = v_r::text, '');
end $$;

-- ═══ 57. LC-A2: socios (alta en caja provisional, confirmación por otra persona, autoalta, purga), token de pase, cursor ═══
do $$
declare v_id uuid; v_id2 uuid; v_a uuid; v_ok boolean; e text; j jsonb; v_tp text; v_cod text; v_n int; v_cur bigint; v_ver text; v_x text; v_g uuid;
begin
  -- alta en caja: faltan datos → rechaza diciendo qué falta
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  begin perform public.club_socio_alta_caja('Carla Socia Ficticia', '60001234', null, false); e := 'ok';
  exception when others then e := sqlerrm; end;
  perform pg_temp.yo(); perform pg_temp.r('57', 'alta en caja sin «verifiqué residencia» → rechaza', e like 'Falta «verifiqué residencia»%', e);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  begin perform public.club_socio_alta_caja('Carla Socia Ficticia', '12', null, true); e := 'ok';
  exception when others then e := sqlerrm; end;
  perform pg_temp.yo(); perform pg_temp.r('57', 'alta en caja con WhatsApp inválido → rechaza', e like 'WhatsApp no válido%', e);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  j := public.club_socio_alta_caja('Carla Socia Ficticia', '6000-1234', null, true);
  v_id := (j->>'miembro_id')::uuid;
  begin perform public.club_socio_alta_caja('Carla Otra', '+506 6000 1234', null, true); e := 'ok';
  exception when others then e := sqlerrm; end;
  perform pg_temp.yo(); perform pg_temp.r('57', 'mismo WhatsApp dos veces → «Ya es socio»', e like 'Ya es socio%', e);
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  -- LC-DES-01: el cajero que la cargó no confirma (ni puede: no es manager)
  begin perform public.club_socio_confirmar(v_id, null); e := 'ok';
  exception when insufficient_privilege then e := 'sin permiso'; when others then e := sqlerrm; end;
  perform pg_temp.yo();
  select (estado = 'activo' and provisional_hasta > now() + interval '6 days' and verifico_residencia and registrado_por = '<CAJERO_UUID>'
          and alta_por = 'caja') into v_ok from club_miembro_roles where miembro_id = v_id and rol = 'socio';
  perform pg_temp.r('57', 'alta en caja → socio activo provisional 7 días; el cajero no la confirma', v_ok and e = 'sin permiso', e);
  perform pg_temp.r('57', 'no se guardan documentos: el rol solo tiene «verifiqué residencia»',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'club\_%'
                 and column_name ~* 'cedula|dimex|pasaporte|documento'), '');
  -- manager que la cargó no puede confirmarla; otro sí
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  j := public.club_socio_alta_caja('Dani Socio Ficticio', '60001235', null, true);
  v_id2 := (j->>'miembro_id')::uuid;
  begin perform public.club_socio_confirmar(v_id2, null); e := 'ok';
  exception when others then e := sqlerrm; end;
  perform pg_temp.yo(); perform pg_temp.r('57', 'quien cargó el alta no la confirma (negativa)', e like 'La cargaste vos%', e);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  v_ok := public.club_socio_confirmar(v_id, 'vista en caja');
  perform pg_temp.yo();
  select (provisional_hasta is null and confirmado_por = '<MANAGER_UUID>') into v_ok from club_miembro_roles where miembro_id = v_id and rol = 'socio';
  perform pg_temp.r('57', 'otro manager confirma: deja de ser provisional', v_ok, '');
  -- vencimiento del provisional → pendiente
  perform pg_temp.yo();
  update club_miembro_roles set provisional_hasta = now() - interval '1 minute' where miembro_id = v_id2 and rol = 'socio';
  j := public.club_socios_mantenimiento();
  perform pg_temp.r('57', 'provisional sin confirmar a los 7 días → vuelve a pendiente',
    (select estado from club_miembro_roles where miembro_id = v_id2 and rol = 'socio') = 'pendiente'
      and (j->>'provisionales_vencidas')::int >= 1, j::text);
  -- CLUB-AUD-71: vencido → mantenimiento → la caja NO lo renueva otros 7 días (negativa)
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  begin perform public.club_socio_validar(v_id2, true); e := 'ok'; exception when others then e := sqlerrm; end;
  perform pg_temp.yo();
  perform pg_temp.r('57', 'AUD-71: provisional vencido sin confirmar → el cajero no lo revalida (negativa)',
    e like 'Este socio ya tuvo un alta provisional%'
      and (select estado from club_miembro_roles where miembro_id = v_id2 and rol = 'socio') = 'pendiente', e);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');   -- el manager que lo cargó tampoco
  begin perform public.club_socio_validar(v_id2, true); e := 'ok'; exception when others then e := sqlerrm; end;
  perform pg_temp.yo();
  perform pg_temp.r('57', 'AUD-71: quien lo cargó tampoco lo revalida, aunque sea manager (negativa)', e like 'Este socio ya tuvo un alta provisional%', e);
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  j := public.club_socio_validar(v_id2, true);
  begin perform public.club_socio_validar(v_id2, true); e := 'ok'; exception when others then e := sqlerrm; end;
  perform pg_temp.yo();
  perform pg_temp.r('57', 'AUD-71: gerencia distinta lo valida y queda confirmado (no provisional); validar de nuevo → «no está pendiente»',
    (select estado = 'activo' and provisional_hasta is null and confirmado_por = '<OWNER_UUID>'
       from club_miembro_roles where miembro_id = v_id2 and rol = 'socio')
      and e like 'El socio no está pendiente%', e);

  -- autoalta pública: sin header → no; con aviso viejo → no; bien → pendiente, pareja si repite
  select aviso_privacidad_version into v_ver from club_config where location_id = 'santa-teresa';
  perform set_config('request.headers', '{}', true);
  set local role anon;
  begin perform public.club_socio_autoalta(jsonb_build_object('nombre', 'Eva Ficticia', 'whatsapp', '60001236', 'acepto', v_ver)); e := 'ok';
  exception when others then e := sqlerrm; end;
  reset role;
  perform set_config('request.headers', '{"x-club-web":"clave-nueva-del-club-rotada-fedcba9876543210"}', true);
  perform pg_temp.r('57', 'autoalta sin x-club-web → rechaza', e = 'Datos no válidos', e);
  select codigo into v_x from club_miembros where id = v_id;
  set local role anon;
  begin perform public.club_socio_autoalta(jsonb_build_object('nombre', 'Eva Ficticia', 'whatsapp', '60001236', 'acepto', 'v-viejo')); e := 'ok';
  exception when others then e := sqlerrm; end;
  j := public.club_socio_autoalta(jsonb_build_object('nombre', 'Eva Ficticia', 'whatsapp', '60001236', 'acepto', v_ver,
                                                     'ref', v_x));
  reset role;
  perform pg_temp.r('57', 'autoalta sin aceptar el aviso vigente → rechaza', e = 'Datos no válidos', e);
  select r.miembro_id into v_a from club_miembro_roles r join club_miembros_contacto c on c.miembro_id = r.miembro_id
   where c.telefono = '+50660001236' and r.rol = 'socio';
  perform pg_temp.r('57', 'autoalta → socio pendiente, con aviso versionado, link del portal y referido',
    (select estado = 'pendiente' and alta_por = 'autoalta' and aviso_version = v_ver and referido_por = v_id
       from club_miembro_roles where miembro_id = v_a and rol = 'socio') and j->>'portal' like 'https://club.satoricostarica.com/p/%', j::text);
  set local role anon;
  j := public.club_socio_autoalta(jsonb_build_object('nombre', 'Otra', 'whatsapp', '60001234', 'acepto', v_ver));
  reset role;
  perform pg_temp.r('57', 'autoalta con un WhatsApp que ya es socio → respuesta pareja, sin link ni cambios',
    j = '{"ok": true}'::jsonb and (select alta_por from club_miembro_roles where miembro_id = v_id and rol = 'socio') = 'caja', j::text);
  -- un socio en baja que vuelve por autoalta: queda pendiente, pero NO se devuelve su portal (negativa)
  -- CLUB-AUD-72: con un WhatsApp que ya existe, la autoalta NO cambia nada; deja una solicitud (negativa)
  update club_miembro_roles set estado = 'baja', aviso_version = 'v-anterior' where miembro_id = v_id and rol = 'socio';
  set local role anon;
  j := public.club_socio_autoalta(jsonb_build_object('nombre', 'Otro Nombre', 'whatsapp', '60001234', 'acepto', v_ver));
  reset role;
  perform pg_temp.r('57', 'AUD-72: autoalta con un WhatsApp existente → misma respuesta, no toca rol/estado/aviso/nombre, deja solicitud',
    j = '{"ok": true}'::jsonb
      and (select estado = 'baja' and aviso_version = 'v-anterior' and alta_por = 'caja' from club_miembro_roles where miembro_id = v_id and rol = 'socio')
      and (select nombre from club_miembros where id = v_id) = 'Carla Socia Ficticia'
      and (select count(*) from club_socio_solicitudes where miembro_id = v_id and atendida_en is null) = 1, j::text);
  set local role anon;
  j := public.club_socio_autoalta(jsonb_build_object('nombre', 'Otro Nombre', 'whatsapp', '60001234', 'acepto', v_ver));
  reset role;
  perform pg_temp.r('57', 'AUD-72: repetir no duplica la solicitud abierta', (select count(*) from club_socio_solicitudes where miembro_id = v_id) = 1, '');
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  select count(*) into v_n from public.club_socio_solicitudes_abiertas() x where x.miembro_id = v_id and x.estado_socio = 'baja';
  perform pg_temp.yo();
  perform pg_temp.r('57', 'AUD-72: gerencia ve la solicitud abierta', v_n = 1, format('%s', v_n));
  -- la caja la atiende en persona: alta en caja (estaba de baja) → provisional y solicitud atendida
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  perform public.club_socio_alta_caja('Carla Socia Ficticia', '60001234', null, true);
  perform pg_temp.yo();
  perform pg_temp.r('57', 'AUD-72: la caja la valida en persona → activo provisional y solicitud atendida',
    (select estado = 'activo' and provisional_hasta is not null from club_miembro_roles where miembro_id = v_id and rol = 'socio')
      and not exists (select 1 from club_socio_solicitudes where miembro_id = v_id and atendida_en is null), '');
  -- altas por confirmar: solo gerencia
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  v_g := (public.club_socio_alta_caja('Gabi Ficticia', '60001238', null, true)->>'miembro_id')::uuid;
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  select count(*) into v_n from public.club_socios_por_confirmar() x where x.miembro_id = v_g and x.puedo_confirmar;
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  begin perform public.club_socios_por_confirmar(); e := 'ok'; exception when insufficient_privilege then e := 'sin permiso'; end;
  perform pg_temp.yo();
  perform pg_temp.r('57', 'altas por confirmar: el manager las ve; el cajero no', v_n = 1 and e = 'sin permiso', format('%s %s', v_n, e));
  -- tope global por día
  update club_config set socio_autoalta_max_dia = 1 where location_id = 'santa-teresa';
  set local role anon;
  begin perform public.club_socio_autoalta(jsonb_build_object('nombre', 'Fede Ficticio', 'whatsapp', '60001237', 'acepto', v_ver)); e := 'ok';
  exception when others then e := sqlerrm; end;
  reset role;
  update club_config set socio_autoalta_max_dia = 60 where location_id = 'santa-teresa';
  perform pg_temp.r('57', 'tope global de autoaltas por día', e = 'Demasiadas altas hoy', e);
  -- purga: autoalta sin validar a los 30 días → datos borrados
  update club_miembro_roles set desde = now() - interval '31 days' where miembro_id = v_a and rol = 'socio';
  j := public.club_socios_mantenimiento();
  perform pg_temp.r('57', 'autoalta sin validar a los 30 días → purga (sin contacto, sin rol, nombre borrado)',
    not exists (select 1 from club_miembros_contacto where miembro_id = v_a) and not exists (select 1 from club_miembro_roles where miembro_id = v_a)
      and (select estado = 'baja' and nombre not like '%Eva%' from club_miembros where id = v_a), j::text);
  -- baja desde el portal (link del aviso)
  select token_portal into v_x from club_miembros where id = v_id2;
  set local role anon;
  v_ok := public.club_socio_baja_portal(v_x);
  reset role;
  perform pg_temp.r('57', 'baja desde el portal → rol de socio en baja y sin opt-in',
    (select estado from club_miembro_roles where miembro_id = v_id2 and rol = 'socio') = 'baja'
      and not (select optin_whatsapp from club_miembros_contacto where miembro_id = v_id2), '');

  -- CLUB-AUD-69: token de pase propio; revocado no genera código
  update club_miembros set tipo = 'referente' where id = v_id;
  insert into club_miembro_roles (miembro_id, rol) values (v_id, 'referente') on conflict do nothing;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, origen, nota)
  values (v_id, 'tarjeta', 12, 6, 18000, 'FP-57', now(), 'app', 'manual');
  select token_pase, token_portal into v_tp, v_x from club_miembros where id = v_id;
  set local role anon;
  select codigo into v_cod from public.club_canje_codigo_generar_pase(v_tp);
  begin perform public.club_canje_codigo_generar_pase(v_x); e := 'ok';
  exception when others then e := sqlerrm; end;
  reset role;
  perform pg_temp.r('57', 'el token de pase genera código de canje; el del portal no sirve en /w/', v_cod ~ '^[0-9A-Z]{6}$' and e = 'Enlace no válido', e);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_pase_token(v_id, 'revocar');
  perform pg_temp.yo();
  set local role anon;
  begin perform public.club_canje_codigo_generar_pase(v_tp); e := 'ok'; exception when others then e := sqlerrm; end;
  reset role;
  set local role service_role;
  j := public.club_pase_datos(v_id);
  reset role;
  perform pg_temp.r('57', 'token de pase revocado → no genera código y el pase pierde el botón Canjear (negativa)',
    e = 'Enlace no válido' and j->>'canjear_url' is null, e);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  perform public.club_pase_token(v_id, 'regenerar');
  perform pg_temp.yo();
  perform pg_temp.r('57', 'regenerar → token nuevo, distinto del revocado',
    (select token_pase is not null and token_pase <> v_tp from club_miembros where id = v_id), '');
  perform pg_temp.como('authenticated', '<CAJERO_UUID>');
  begin perform public.club_pase_token(v_id, 'revocar'); e := 'ok';
  exception when insufficient_privilege then e := 'sin permiso'; end;
  perform pg_temp.yo();
  perform pg_temp.r('57', 'el cajero no revoca ni regenera el token de pase', e = 'sin permiso', e);

  -- CLUB-AUD-70: guardar solo avanza; rebobinar es aparte, con motivo y auditoría
  set local role service_role;
  perform public.club_pase_cursor_guardar('apple', 500);
  perform public.club_pase_cursor_guardar('apple', 100);
  v_cur := public.club_pase_cursor_leer('apple');
  begin perform public.club_pase_cursor_rebobinar('apple', 50, ''); e := 'ok'; exception when others then e := sqlerrm; end;
  perform public.club_pase_cursor_rebobinar('apple', 50, 'reprocesar prueba');
  v_ok := public.club_pase_cursor_leer('apple') = 50;
  reset role;
  perform pg_temp.r('57', 'cursor: guardar no retrocede; rebobinar exige motivo, retrocede y queda auditado',
    v_cur = 500 and e = 'El motivo es obligatorio' and v_ok
      and exists (select 1 from club_auditoria where accion = 'pase_cursor_rebobinar' and despues->>'motivo' = 'reprocesar prueba'), e);
  perform pg_temp.r('57', 'rebobinar: solo service_role',
    not has_function_privilege('authenticated', 'public.club_pase_cursor_rebobinar(text, bigint, text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.club_pase_cursor_rebobinar(text, bigint, text)', 'EXECUTE'), '');
end $$;

-- ═══ 58. CLUB-AUD-36: solo se resuelve lo que figura HOY; segregación por el registrante ═══
do $$
declare v_id uuid; v_mv uuid := gen_random_uuid(); e1 text; e2 text; v_res boolean;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Segregacion Ficticia', 'app') returning id into v_id;
  -- pre-resolver: el (tipo, ref) todavía no existe
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  begin perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'la dejo resuelta antes'); e1 := 'ok';
  exception when others then e1 := sqlerrm; end;
  perform pg_temp.yo();
  -- ahora aparece: la registró el mismo manager
  insert into club_movimientos (id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota, registrado_por)
  values (v_mv, v_id, 'tarjeta', 1, 6, 18000, '990993', now() - interval '2 hours', now() - interval '2 hours', 'app', 'manual', '<MANAGER_UUID>'::uuid);
  perform pg_temp.como('authenticated', '<MANAGER_UUID>');
  begin perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'la resuelvo yo'); e2 := 'ok';
  exception when others then e2 := sqlerrm; end;
  select e.resuelta into v_res from public.club_excepciones(current_date - 1, current_date + 1) e
   where e.tipo = 'REGISTRO_SIN_FACTURA' and e.ref = v_mv::text;
  perform pg_temp.yo();
  perform pg_temp.r('58', 'pre-resolver una excepción que no figura hoy → rechaza (negativa)', e1 like 'Esa excepción no figura hoy%', e1);
  perform pg_temp.r('58', 'quien registró el movimiento no la resuelve después (negativa) y sigue abierta',
    e2 like '%la resuelve el owner%' and v_res = false
      and not exists (select 1 from club_excepciones_resueltas where ref = v_mv::text), coalesce(e2, '') || ' ' || coalesce(v_res::text, 'null'));
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  begin perform public.club_excepcion_resolver('CREDITOS_SIN_CANJE', 'factura:no-existe-0000', 'inventada'); e1 := 'ok';
  exception when others then e1 := sqlerrm; end;
  perform public.club_excepcion_resolver('REGISTRO_SIN_FACTURA', v_mv::text, 'Revisada por el owner');
  perform pg_temp.yo();
  perform pg_temp.r('58', 'ni el owner resuelve un ref inventado; la real la resuelve el owner',
    e1 like 'Esa excepción no figura hoy%' and exists (select 1 from club_excepciones_resueltas where ref = v_mv::text), e1);
end $$;

-- ═══ 59. CLUB-AUD-68: el cruce legacy por número tipeado exige factura cerrada (estado 'C') ═══
do $$
declare v_id uuid; v_mv uuid; v_t uuid; c1 text; c2 text; v_ex boolean;
begin
  insert into club_miembros (tipo, nombre, origen) values ('referente', 'Ref Legacy Ficticia', 'app') returning id into v_id;
  insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values ('990995', now() - interval '3 hours', 'X', 'salon', 'cajero', true, 'ok', 30000) returning id into v_t;
  insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, factura_pos, fecha_visita, registrado_en, origen, nota, registrado_por)
  values (v_id, 'tarjeta', 2, 6, 18000, '990995', now() - interval '2 hours', now() - interval '2 hours', 'app', 'manual', '<CAJERO_UUID>'::uuid)
  returning id into v_mv;
  c1 := pg_temp.cruce(v_mv);
  perform pg_temp.como('authenticated', '<OWNER_UUID>');
  select exists (select 1 from public.club_excepciones(current_date - 1, current_date + 1) e
                  where e.tipo = 'REGISTRO_SIN_FACTURA' and e.ref = v_mv::text) into v_ex;
  perform pg_temp.yo();
  perform pg_temp.r('59', 'factura anulada (X) tipeada → no cruza y queda REGISTRO_SIN_FACTURA (negativa)', c1 = '' and v_ex, c1);
  update pos_ndf_tickets set estado = 'C' where id = v_t;
  c2 := pg_temp.cruce(v_mv);
  perform pg_temp.r('59', 'la misma factura cerrada (C) → cruza', c2 = '990995', c2);
end $$;

-- ═══ 6. Cuenta inactiva → todas las funciones de staff rechazan ═══
update profiles set is_active = false where id in ('<CAJERO_UUID>', '<OWNER_UUID>');
do $$
declare f text; v_cnt int;
begin
  foreach f in array array[
    'select public.club_cupon_usar(''AAAAAAAAAA'', 2, ''F'', gen_random_uuid())',
    'select public.club_canje(''00000000-0000-0000-0000-000000000000'', ''AAAAAA'', 1, ''F'', gen_random_uuid())',
    'select public.club_ajuste(''00000000-0000-0000-0000-000000000000'', 1, ''ajuste'', ''x'', gen_random_uuid())',
    'select public.club_vencer(current_date, 0)',
    'select public.club_vencer_simular(current_date)'] loop
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
