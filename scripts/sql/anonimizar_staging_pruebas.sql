-- anonimizar_staging_pruebas.sql · Batería del script de anonimización de STAGING (scripts/staging-anonimizar/).
-- Corre la anonimización ENTERA dentro de una transacción, prueba y termina en ROLLBACK: no deja nada. Es el modo
-- «begin … rollback» que se corre ANTES de la corrida real (R15). La arma y la manda scripts/staging-anonimizar/correr.py:
--   python3 scripts/staging-anonimizar/correr.py ensayo            # staging (Management API, ref fijo) · ROLLBACK
--   python3 scripts/staging-anonimizar/correr.py ensayo --local    # Postgres 16 local de local_armar_base.sh
-- MARCADORES que llena el runner: «-- @@PREPARAR@@» (marcas anon.ref / anon.modo = ensayo / anon.fase y, con --local,
-- la semilla inventada) · «-- @@CLASIFICACION@@», «-- @@COMUN@@», «-- @@ANONIMIZAR@@», «-- @@VERIFICAR@@» (los
-- fragmentos de scripts/staging-anonimizar/) · «-- @@IDEMPOTENCIA@@» (con --idempotencia: una SEGUNDA pasada de
-- anonimizar.sql para el caso 03; sin la bandera queda vacío y el caso no corre) · «-- @@LOCAL@@» (con --local:
-- anonimizar_staging_casos_local.sql, casos sobre la semilla).
-- Cada caso que falla sale como WARNING («ANON FALLA <caso> — <detalle>»), después «ANON RESUMEN: pasaron X / fallaron Y
-- de N» y, si Y > 0 o faltan casos, ABORTA con «ANON-FALLAN: <casos> · pasaron X / fallaron Y».
-- Las mutaciones corren en subtransacciones que se deshacen solas (errcode XAN01). Datos sembrados: inventados.
begin;
-- @@PREPARAR@@
-- @@CLASIFICACION@@
-- @@COMUN@@
-- @@ANONIMIZAR@@
-- @@VERIFICAR@@
create temp table _rA (n serial, caso text, ok boolean, detalle text) on commit drop;

-- 01 · verificar.sql (fase transacción): todo lo exigido en 0
insert into _rA (caso, ok, detalle)
select '01 verificar: todo lo exigido da 0', count(*) filter (where exige and valor <> 0) = 0,
       string_agg(control || ' = ' || valor, '; ' order by orden) filter (where exige and valor <> 0)
  from _anon_verif;

-- 02 · controles del §2 idénticos antes y después (y están todos: caja, propinas, ventas, huellas, permisos, FE, filas)
insert into _rA (caso, ok, detalle)
select '02 controles del §2 iguales antes y después',
       count(*) filter (where a.valor is distinct from d.valor) = 0 and count(*) >= 20,
       format('controles=%s distintos=%s', count(*), count(*) filter (where a.valor is distinct from d.valor))
  from _anon_control_antes a full join _anon_control_despues d on d.control = a.control;

-- 03 · idempotencia: una segunda pasada no cambia nada (salvo las llaves, que se vuelven a sortear, y los JSON que
--      las llevan adentro). Solo con --idempotencia (es otra pasada entera).
create or replace function pg_temp.anon_huella_texto() returns text language plpgsql as $$
declare r record; v text; acc text := '';
begin
  for r in select a.tabla, a.columna from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase not in ('token', 'json', 'vaciar_tabla') order by a.tabla, a.columna loop
    execute format('select count(*) || %L || coalesce(sum(hashtextextended(%I::text, 0)), 0) from public.%I', ':', r.columna, r.tabla) into v;
    acc := acc || r.tabla || '.' || r.columna || '=' || v || '|';
  end loop;
  select acc || coalesce(sum(hashtextextended(row(email, encrypted_password, phone, raw_user_meta_data, banned_until)::text, 0)), 0)
    into acc from auth.users;
  return md5(acc);
end $$;
create temp table _rA_idem on commit drop as select pg_temp.anon_huella_texto() h;
-- @@IDEMPOTENCIA@@
insert into _rA (caso, ok, detalle)
select '03 idempotencia: la segunda pasada deja todo igual', (select h from _rA_idem) = pg_temp.anon_huella_texto(), null
 where current_setting('anon.idempotencia', true) = 'si';

-- 04–06 · MUTACIÓN del §3: un correo, un teléfono y un nombre inventados con forma de reales → verificar cae 3 veces
do $$
declare v0 bigint; v1 bigint; v_filas bigint;
  c_correo text := 'correos fuera de @staging-satori.test y @example.com (columnas de correo)';
  c_tel text := 'teléfonos fuera del bloque ficticio 8000 00NN (columnas de teléfono)';
  c_nom text := 'nombres que no son alias ni de prueba';
begin
  -- 04 correo
  v0 := null; v1 := null; v_filas := 0;
  begin
    select valor into v0 from pg_temp.anon_verificar('club_miembros_contacto') where control = c_correo;
    update public.club_miembros_contacto set email = 'persona.verdadera' || '@' || 'correo-real.cr'
     where ctid = (select ctid from public.club_miembros_contacto limit 1);
    get diagnostics v_filas = row_count;
    select valor into v1 from pg_temp.anon_verificar('club_miembros_contacto') where control = c_correo;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('04 mutación: un correo con forma real hace caer verificar',
    v_filas = 1 and v1 = v0 + 1, format('filas=%s antes=%s después=%s%s', v_filas, v0, v1,
      case when v_filas = 0 then ' (NO PROBADO: club_miembros_contacto vacía)' else '' end));
  -- 05 teléfono
  v0 := null; v1 := null; v_filas := 0;
  begin
    select valor into v0 from pg_temp.anon_verificar('club_miembros_contacto') where control = c_tel;
    update public.club_miembros_contacto set telefono = '+506' || '6000' || '0042'
     where ctid = (select ctid from public.club_miembros_contacto limit 1);
    get diagnostics v_filas = row_count;
    select valor into v1 from pg_temp.anon_verificar('club_miembros_contacto') where control = c_tel;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('05 mutación: un teléfono con forma real hace caer verificar',
    v_filas = 1 and v1 = v0 + 1, format('filas=%s antes=%s después=%s', v_filas, v0, v1));
  -- 06 nombre
  v0 := null; v1 := null; v_filas := 0;
  begin
    select valor into v0 from pg_temp.anon_verificar('employees') where control = c_nom;
    update public.employees set full_name = 'Ana ' || 'Verdadera Solano'
     where ctid = (select ctid from public.employees where not pg_temp.anon_es_prueba(full_name) limit 1);
    get diagnostics v_filas = row_count;
    select valor into v1 from pg_temp.anon_verificar('employees') where control = c_nom;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('06 mutación: un nombre real hace caer verificar',
    v_filas = 1 and v1 = v0 + 1, format('filas=%s antes=%s después=%s', v_filas, v0, v1));
end $$;

-- 07–09 · la guarda aborta: otro ref, base sin marca de staging, sin usuarios de prueba
do $$
declare v_ok boolean; v_msg text;
begin
  v_msg := null;
  begin
    perform set_config('anon.ref', 'otroref0000000000000', true);   -- cualquier ref que no sea el de staging (el de prod no se escribe en una prueba)
    perform pg_temp.anon_guarda();
  exception when others then v_msg := sqlerrm;
  end;
  perform set_config('anon.ref', 'hwiatgicyyqyezqwldia', true);
  insert into _rA (caso, ok, detalle) values ('07 guarda: con un ref que no es el de staging aborta', v_msg like 'ANON-ABORTA%', v_msg);

  v_msg := null;
  begin
    delete from public.club_entorno;
    perform pg_temp.anon_guarda();
  exception when others then v_msg := sqlerrm;
  end;
  insert into _rA (caso, ok, detalle) values ('08 guarda: sin club_entorno = staging aborta', v_msg like 'ANON-ABORTA%', v_msg);

  v_msg := null;
  begin
    update auth.users set email = 'x' || email where pg_temp.anon_usuario_prueba(email);
    perform pg_temp.anon_guarda();
  exception when others then v_msg := sqlerrm;
  end;
  insert into _rA (caso, ok, detalle) values ('09 guarda: sin los usuarios de prueba aborta', v_msg like 'ANON-ABORTA%', v_msg);
end $$;
-- la guarda sigue pasando (las subtransacciones se deshicieron)
select pg_temp.anon_guarda();

-- 10 · una columna de texto nueva sin clasificar: anonimizar aborta y verificar la cuenta
do $$
declare v_msg text; v_n bigint;
begin
  begin
    alter table public.cash_sessions add column texto_nuevo_sin_clase text;
    select valor into v_n from pg_temp.anon_verificar('cash_sessions') where control = 'columnas sin clasificar o mal clasificadas';
    perform pg_temp.anon_clasificacion_ok();
  exception when others then v_msg := sqlerrm;
  end;
  insert into _rA (caso, ok, detalle) values ('10 columna sin clasificar: anonimizar aborta y verificar la cuenta',
    v_msg like 'ANON-ABORTA: clasificación incompleta%texto_nuevo_sin_clase%' and v_n = 1, format('verificar=%s · %s', v_n, v_msg));
end $$;

-- 11 · los controles del §2 muerden: un colón de más en caja o en propinas cambia el control
do $$
declare v_caja text; v_prop text; v_f1 bigint := 0; v_f2 bigint := 0;
begin
  begin
    update public.cash_movements set amount_crc = amount_crc + 1 where ctid = (select ctid from public.cash_movements limit 1);
    get diagnostics v_f1 = row_count;
    select string_agg(d.control, ', ') into v_caja from _anon_control_despues a join pg_temp.anon_controles() d on d.control = a.control
     where a.valor is distinct from d.valor;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  begin
    update public.tip_entries set payout_crc = coalesce(payout_crc, 0) + 1 where ctid = (select ctid from public.tip_entries limit 1);
    get diagnostics v_f2 = row_count;
    select string_agg(d.control, ', ') into v_prop from _anon_control_despues a join pg_temp.anon_controles() d on d.control = a.control
     where a.valor is distinct from d.valor;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('11 controles del §2: un colón de más en caja y en propinas se detecta',
    v_f1 = 1 and v_f2 = 1 and v_caja like '%cash_movements por día%' and v_prop like '%payout_crc por sesión%',
    format('caja: %s · propinas: %s', coalesce(v_caja, '(nada)'), coalesce(v_prop, '(nada)')));
end $$;

-- 12 · clave FE: si una clave vuelve a tener una cédula real del emisor, verificar la cuenta
do $$
declare v0 bigint; v1 bigint; v_f bigint := 0;
  c text := 'claves FE de 50 dígitos con la cédula real del emisor';
begin
  begin
    select valor into v0 from pg_temp.anon_verificar('pos_ndf_tickets') where control = c;
    update public.pos_ndf_tickets set clave_fe = substr(clave_fe, 1, 9) || '003101' || '999993' || substr(clave_fe, 22)
     where ctid = (select ctid from public.pos_ndf_tickets where clave_fe ~ '^[0-9]{50}$' limit 1);
    get diagnostics v_f = row_count;
    select valor into v1 from pg_temp.anon_verificar('pos_ndf_tickets') where control = c;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('12 clave FE con la cédula real: verificar la cuenta',
    v_f = 1 and v1 = v0 + 1, format('filas=%s antes=%s después=%s', v_f, v0, v1));
end $$;

-- 13 · cadena de cierres del Club: un hash viejo se detecta y anon_cadena_club la recompone
do $$
declare v_rota bigint; v_arreglados bigint; v_despues bigint;
  c text := 'club · cierres con la cadena de hashes rota';
begin
  begin
    set local session_replication_role = replica;   -- la tabla es inmutable (CLUB-AUD-16); solo dentro de esta subtransacción
    insert into public.club_reportes_cerrados (location_id, mes, version, datos, sha256, sha256_prev)
    values ('santa-teresa', '1999-01-01', 99, '{"total": 1}', repeat('0', 64), null);
    select valor into v_rota from pg_temp.anon_verificar('club_reportes_cerrados') where control = c;
    v_arreglados := pg_temp.anon_cadena_club();
    select valor into v_despues from pg_temp.anon_verificar('club_reportes_cerrados') where control = c;
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('13 cadena de cierres: se detecta y se recompone',
    v_rota >= 1 and v_arreglados >= 1 and v_despues = 0, format('rota=%s arreglados=%s después=%s', v_rota, v_arreglados, v_despues));
end $$;

-- 14 · JSON (D4): lista blanca recursiva y tratos por clave (función pura)
do $$
declare j jsonb; r jsonb;
begin
  j := jsonb_build_object('nombre', 'Ana ' || 'Inventada Real', 'first_name', 'Ana', 'email', 'ana' || '@' || 'correo-real.cr',
         'total', 5, 'codigo', 'ABCDEFGH', 'proveedor_cedula', '3-101-000000',
         'items', jsonb_build_array(jsonb_build_object('descripcion', 'Arroz', 'cantidad', 2, 'apellido', 'X')),
         'changed', jsonb_build_object('description', jsonb_build_object('old', 'Pago a alguien', 'new', 'Pago · fact 2026-01-02'),
                                       'amount_crc', jsonb_build_object('old', 1, 'new', 2)),
         'pos_ref', jsonb_build_object('mesa', 'M1', 'cualquier', 'cosa'));
  r := pg_temp.anon_json(j);
  insert into _rA (caso, ok, detalle) values ('14 JSON: lista blanca recursiva y tratos por clave',
        not (r ? 'first_name') and not (r->'items'->0 ? 'apellido') and r->'items'->0->>'descripcion' = 'Arroz'
    and r->>'nombre' = 'Nota de prueba' and pg_temp.anon_correo_ok(r->>'email') and (r->>'total')::int = 5
    and r->>'codigo' ~ '^[A-HJ-NP-Z2-9]{8}$' and r->>'codigo' <> 'ABCDEFGH' and r->'proveedor_cedula' = 'null'::jsonb
    and r->'changed'->'description'->>'old' = 'Nota de prueba'
    and r->'changed'->'description'->>'new' = 'Nota de prueba · fact 2026-01-02'
    and r->'changed'->'amount_crc' = '{"old": 1, "new": 2}'::jsonb
    and r->'pos_ref' = '{"mesa": "M1", "cualquier": "cosa"}'::jsonb,   -- pos_ref es json_mantener: queda entero
    r::text);
end $$;

-- 15 · descripción de caja: el sistema queda, el texto libre no, el sufijo de la factura sí (función pura)
insert into _rA (caso, ok, detalle)
select '15 descripción: patrones del sistema intactos, texto libre fuera, «· fact» conservado',
       pg_temp.anon_descripcion('Ventas efectivo Noche 2026-11-01') = 'Ventas efectivo Noche 2026-11-01'
   and pg_temp.anon_descripcion('Retiro dueños a banco 2026-11-01') = 'Retiro dueños a banco 2026-11-01'
   and pg_temp.anon_descripcion('Propinas turno 2026-11-01 Mediodía') = 'Propinas turno 2026-11-01 Mediodía'
   and pg_temp.anon_descripcion('Ajuste de cierre 2026-11-01 · Sobrante · lo contó alguien') = 'Ajuste de cierre 2026-11-01 · Sobrante · Nota de prueba'
   and pg_temp.anon_descripcion('Pago a alguien · fact 2026-10-30 · fact 2026-11-02') = 'Nota de prueba · fact 2026-11-02'
   and pg_temp.anon_descripcion('Propinas turno 2026-11-01 Alguien') = 'Nota de prueba'
   and pg_temp.anon_descripcion('Ventas efectivo Noche 2026-11-01 de alguien') = 'Nota de prueba'
   and pg_temp.anon_descripcion('Nota de prueba · fact 2026-11-02') = 'Nota de prueba · fact 2026-11-02'
   and pg_temp.anon_descripcion_ok(pg_temp.anon_descripcion('Compra a alguien · fact 2026-11-02x'))
   and not pg_temp.anon_descripcion_ok('Pago a alguien'),
       null;

-- 16 · clave FE (D7): solo cambian las posiciones 10–21; largo 50, consecutivo y código de seguridad intactos (pura)
insert into _rA (caso, ok, detalle)
select '16 clave FE: cédula del emisor reemplazada, el resto intacto', x.ok, x.d
  from (select c, pg_temp.anon_clave_fe(c) a from (select '506' || '011126' || '003101999992' || '00100001040000000123' || '1' || '12345678' c) s) t,
       lateral (select length(t.a) = 50 and substr(t.a, 10, 12) = '999999999999' and substr(t.a, 1, 9) = substr(t.c, 1, 9)
                   and substr(t.a, 22) = substr(t.c, 22) and pg_temp.anon_clave_fe(t.a) = t.a
                   and pg_temp.anon_clave_fe('50601112600') = '50601112600' ok, t.a d) x;

-- 17 · el barrido general encuentra un correo y un teléfono con forma real en una columna «mantener»
do $$
declare v0c bigint; v0t bigint; v1c bigint; v1t bigint; v_f bigint := 0;
begin
  begin
    select max(valor) filter (where control like 'correos con forma real%'), max(valor) filter (where control like 'teléfonos con forma real%')
      into v0c, v0t from pg_temp.anon_verificar('locations');
    update public.locations set name = name || ' · escribir a jefe' || '@' || 'dominio-real.cr' || ' o al +506 ' || '6111' || '-0003'
     where ctid = (select ctid from public.locations limit 1);
    get diagnostics v_f = row_count;
    select max(valor) filter (where control like 'correos con forma real%'), max(valor) filter (where control like 'teléfonos con forma real%')
      into v1c, v1t from pg_temp.anon_verificar('locations');
    raise exception using errcode = 'XAN01';
  exception when sqlstate 'XAN01' then null;
  end;
  insert into _rA (caso, ok, detalle) values ('17 barrido general: correo y teléfono reales en una columna «mantener»',
    v_f = 1 and v1c = v0c + 1 and v1t = v0t + 1, format('correo %s→%s · teléfono %s→%s', v0c, v1c, v0t, v1t));
end $$;

-- @@LOCAL@@

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _rA;

-- ASSERT: cada caso que falla sale como WARNING, después el resumen y, si hay fallas o faltan casos, ABORTA con
-- «ANON-FALLAN». Esperados: 16 de base (01, 02, 04–17) + 1 con --idempotencia (03) + los locales con --local
-- (anon.casos_locales). Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp int := 16 + case when current_setting('anon.idempotencia', true) = 'si' then 1 else 0 end
                  + coalesce(nullif(current_setting('anon.casos_locales', true), ''), '0')::int;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _rA where ok is not true order by n loop   -- null = falla
    raise warning 'ANON FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _rA;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning 'ANON FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice 'ANON RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception 'ANON-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
