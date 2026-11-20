-- verificar.sql · FRAGMENTO (lo arma scripts/staging-anonimizar/correr.py después de clasificacion.sql y comun.sql).
-- SOLO STAGING. No escribe en ninguna tabla real: solo tablas y funciones temporales. Devuelve solo CONTEOS.
-- Exige 0 en (SPEC §3): correos fuera de @staging-satori.test y @example.com · teléfonos fuera del bloque ficticio ·
-- nombres que no son alias ni de prueba · datos de banco · tokens iguales a los de antes · objetos de Storage fuera de
-- sops/ y de la imagen ficticia · columnas sin clasificar · más los controles del §2.
-- Fase (anon.fase): «transaccion» = dentro de la transacción de anonimizar.sql (compara con los controles y llaves de
-- antes; Storage todavía no se borró: informativo). «final» (por defecto) = después de storage.sh, en una sesión aparte.
-- Si una exigencia no da 0, aborta con «ANON-VERIFICAR-FALLA» (salvo en la batería, anon.modo = ensayo, que lo cuenta
-- como caso).
select pg_temp.anon_guarda();

-- p_tabla: solo esa tabla (lo usan las mutaciones de la batería; los controles globales se saltan).
create or replace function pg_temp.anon_verificar(p_tabla text default null)
returns table (control text, valor bigint, exige boolean) language plpgsql as $$
declare
  r record; n bigint; v_fase text := coalesce(nullif(current_setting('anon.fase', true), ''), 'final');
  -- SOP y configuración se mantienen (SPEC §1): fuera del barrido de correos y teléfonos con forma real.
  v_exentas text[] := array['sops', 'club_config', 'club_config_global', 'club_config_historial', 'club_cumple_config'];
  c_correo bigint := 0; c_tel bigint := 0; c_nom bigint := 0; c_nota bigint := 0; c_desc bigint := 0; c_nulo bigint := 0;
  c_vaciar bigint := 0; c_seud bigint := 0; c_clave bigint := 0; c_clave_otra bigint := 0; c_ruta bigint := 0;
  c_json bigint := 0; c_gen_correo bigint := 0; c_gen_tel bigint := 0; c_tok bigint := 0; v_cols text;
begin
  return query select 'columnas sin clasificar o mal clasificadas'::text, count(*)::bigint, true
    from pg_temp.anon_problemas_clasificacion() pr where p_tabla is null or pr.problema like '%' || p_tabla || '.%';

  perform pg_temp.anon_preparar_politica();

  for r in select a.tabla, a.columna, a.clase, c.udt from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where p_tabla is null or a.tabla = p_tabla
            order by a.tabla, a.columna loop
    n := 0;
    case
      when r.clase in ('correo', 'correo_auth') then
        execute format('select count(*) from public.%1$I where %1$I.%2$I is not null and btrim(%2$I) <> %3$L and not pg_temp.anon_correo_ok(%2$I)',
                       r.tabla, r.columna, '') into n;
        c_correo := c_correo + n;
      when r.clase = 'telefono' then
        execute format('select count(*) from public.%1$I where %2$I is not null and btrim(%2$I) <> %3$L and not pg_temp.anon_tel_ok(%2$I)',
                       r.tabla, r.columna, '') into n;
        c_tel := c_tel + n;
      when r.clase like 'alias\_%' then
        execute format('select count(*) from public.%1$I where %2$I is not null and btrim(%2$I) <> %3$L
                          and not (pg_temp.anon_es_alias(%2$I) or pg_temp.anon_es_prueba(%2$I) or pg_temp.anon_es_uuid(%2$I))',
                       r.tabla, r.columna, '') into n;
        c_nom := c_nom + n;
      when r.clase = 'nota' then
        execute format('select count(*) from public.%1$I where %2$I is not null and btrim(%2$I) <> %3$L and %2$I <> %4$L',
                       r.tabla, r.columna, '', 'Nota de prueba') into n;
        c_nota := c_nota + n;
      when r.clase = 'descripcion_fact' then
        execute format('select count(*) from public.%1$I where not pg_temp.anon_descripcion_ok(%2$I)', r.tabla, r.columna) into n;
        c_desc := c_desc + n;
      when r.clase = 'nulo' then
        if r.udt in ('text', 'varchar', 'bpchar') then
          execute format('select count(*) from public.%1$I where %2$I is not null and %2$I <> %3$L', r.tabla, r.columna, '') into n;
        else
          execute format('select count(*) from public.%1$I where %2$I is not null', r.tabla, r.columna) into n;
        end if;
        c_nulo := c_nulo + n;
      when r.clase = 'seudonimo' then
        if r.udt in ('_text', '_varchar') then
          execute format('select count(*) from public.%1$I where exists (select 1 from unnest(%2$I) x where x is not null and x !~ %3$L)',
                         r.tabla, r.columna, '^S[0-9a-f]{16}$') into n;
        else
          execute format('select count(*) from public.%1$I where %2$I is not null and btrim(%2$I) <> %3$L and %2$I !~ %4$L',
                         r.tabla, r.columna, '', '^S[0-9a-f]{16}$') into n;
        end if;
        c_seud := c_seud + n;
      when r.clase = 'clave_fe' then
        execute format('select count(*) filter (where %1$I ~ %2$L and substr(%1$I, 10, 12) <> %3$L),
                               count(*) filter (where %1$I is not null and btrim(%1$I) <> %4$L and %1$I !~ %2$L)
                          from public.%5$I', r.columna, '^[0-9]{50}$', '999999999999', '', r.tabla) into n, c_tok;
        c_clave := c_clave + n; c_clave_otra := c_clave_otra + c_tok; c_tok := 0;
      when r.clase = 'ruta_storage' then
        execute format('select count(*) from public.%1$I where %2$I is not null and btrim(%2$I) <> %3$L and %2$I <> %4$L',
                       r.tabla, r.columna, '', 'anon/ficticia.png') into n;
        c_ruta := c_ruta + n;
      when r.clase = 'adjuntos' then
        execute format($q$select count(*) from public.%1$I where %2$I is not null and %2$I <> '[]'::jsonb
                            and (jsonb_typeof(%2$I) <> 'array'
                                 or exists (select 1 from jsonb_array_elements(%2$I) e where e <> to_jsonb('anon/ficticia.png'::text)))$q$,
                       r.tabla, r.columna) into n;
        c_ruta := c_ruta + n;
      when r.clase = 'json' then
        execute format('select count(*) from public.%1$I where %2$I is not null and pg_temp.anon_json_fuera(%2$I, %3$L) > 0',
                       r.tabla, r.columna, pg_temp.anon_perfil(r.tabla, r.columna)) into n;
        c_json := c_json + n;
      when r.clase = 'vaciar_tabla' then
        null;   -- se cuenta por tabla abajo
      else
        null;   -- mantener, json_mantener, token, especial: solo el barrido de abajo (y los controles propios)
    end case;
  end loop;

  for r in select distinct a.tabla from _anon_clases a where a.clase = 'vaciar_tabla'
              and (p_tabla is null or a.tabla = p_tabla)
              and to_regclass('public.' || quote_ident(a.tabla)) is not null loop
    execute format('select count(*) from public.%I', r.tabla) into n;
    c_vaciar := c_vaciar + n;
  end loop;

  -- Barrido de TODAS las columnas de texto y JSON (también las «mantener»), una expresión por fila y tabla:
  -- correos y teléfonos con forma real que hayan quedado en cualquier lado (SOP y configuración, exentas).
  for r in select c.tabla, string_agg(format('coalesce(%I::text, %L)', c.columna, ''), ' || '' '' || ' order by c.columna) cols
             from pg_temp.anon_columnas_texto() c
            where c.tabla <> all (v_exentas) and (p_tabla is null or c.tabla = p_tabla)
              and not exists (select 1 from _anon_clases k where k.tabla = c.tabla and k.columna = c.columna and k.clase = 'vaciar_tabla')
            group by c.tabla order by c.tabla loop
    execute format('select count(*) filter (where strpos(x, %L) > 0 and pg_temp.anon_tiene_correo_real(x)),
                           count(*) filter (where (strpos(x, %L) > 0 or strpos(x, %L) > 0) and pg_temp.anon_tiene_telefono_real(x))
                      from (select %s as x from public.%I) s', '@', '506', '+', r.cols, r.tabla) into n, c_tok;
    c_gen_correo := c_gen_correo + n; c_gen_tel := c_gen_tel + c_tok;
  end loop;
  c_tok := 0;

  return query values
    ('correos fuera de @staging-satori.test y @example.com (columnas de correo)', c_correo, true),
    ('correos con forma real en cualquier columna de texto o JSON (salvo SOP y configuración)', c_gen_correo, true),
    ('teléfonos fuera del bloque ficticio 8000 00NN (columnas de teléfono)', c_tel, true),
    ('teléfonos con forma real en cualquier columna de texto o JSON (salvo SOP y configuración)', c_gen_tel, true),
    ('nombres que no son alias ni de prueba', c_nom, true),
    ('notas con texto libre', c_nota, true),
    ('descripciones de caja con texto libre', c_desc, true),
    ('banco, IBAN, cédula, contacto y comprobantes con valor (columnas nulo)', c_nulo, true),
    ('filas en tablas que se vacían (ventas_dias, banco, pases, *_pre_migracion)', c_vaciar, true),
    ('seudónimos con otra forma (legacy)', c_seud, true),
    ('claves FE de 50 dígitos con la cédula real del emisor', c_clave, true),
    ('claves FE con otra forma (informativo: no se tocan)', c_clave_otra, false),
    ('rutas de Storage que no son la imagen ficticia', c_ruta, true),
    ('JSON con claves fuera de la lista blanca', c_json, true);
  -- Club: la cadena de cierres sigue verificando (sha256 = sha256(prev || datos))
  if to_regclass('public.club_reportes_cerrados') is not null and (p_tabla is null or p_tabla = 'club_reportes_cerrados') then
    return query select 'club · cierres con la cadena de hashes rota'::text, count(*)::bigint, true from (
      select rc.sha256, rc.sha256_prev, rc.datos,
             lag(rc.sha256) over (partition by rc.location_id order by rc.id) prev
        from public.club_reportes_cerrados rc) x
     where x.sha256_prev is distinct from x.prev
        or x.sha256 <> encode(extensions.digest(coalesce(x.prev, '') || x.datos::text, 'sha256'), 'hex');
  end if;

  if p_tabla is not null then return; end if;

  -- Sueldos (D5)
  n := 0;
  if to_regclass('public.employee_wage_rates') is not null then
    n := n + (select count(*) from public.employee_wage_rates
               where hourly_rate_crc not in (0, 2500) or fixed_salary_crc not in (0, 100000, 250000, 500000));
  end if;
  if to_regclass('public.employee_payroll') is not null then
    n := n + (select count(*) from public.employee_payroll where hourly_rate_crc not in (0, 2500) or fixed_salary_crc not in (0, 500000));
  end if;
  if to_regclass('public.salary_lines') is not null then
    n := n + (select count(*) from public.salary_lines
               where pago_horas <> round(horas * 2500, 2) or salario_fijo not in (0, 250000) or bono not in (0, 10000)
                  or total <> pago_horas + aporte_servicio + salario_fijo + bono);
  end if;
  return query select 'sueldos que no son los ficticios (D5)'::text, n, true;
  return query select 'cumpleaños de clientes con año (queda día y mes)'::text,
    (select count(*) from public.customers where birth_date is not null and extract(year from birth_date) <> 2000), true;

  -- Auth
  return query select 'auth · correos fuera de @staging-satori.test y @example.com'::text,
    (select count(*) from auth.users where not pg_temp.anon_correo_ok(email)), true;
  return query select 'auth · usuarios que no son de prueba con contraseña, token o teléfono'::text,
    (select count(*) from auth.users where not pg_temp.anon_usuario_prueba(email)
        and (coalesce(encrypted_password, '') <> '' or coalesce(recovery_token, '') <> '' or coalesce(confirmation_token, '') <> ''
             or phone is not null or coalesce(raw_user_meta_data, '{}'::jsonb) <> '{}'::jsonb)), true;
  return query select 'auth · usuarios que no son de prueba sin ban'::text,
    (select count(*) from auth.users where not pg_temp.anon_usuario_prueba(email) and coalesce(banned_until, '-infinity') <= now()), true;
  return query select 'auth · sesiones de usuarios que no son de prueba'::text,
    (select count(*) from auth.sessions s join auth.users u on u.id = s.user_id where not pg_temp.anon_usuario_prueba(u.email)), true;
  return query select 'auth · identidades con un correo real'::text,
    (select count(*) from auth.identities where pg_temp.anon_tiene_correo_real(identity_data::text)), true;
  if to_regclass('auth.audit_log_entries') is not null then
    return query execute $q$select 'auth · bitácora de Auth con correos reales'::text, count(*)::bigint, true
                              from auth.audit_log_entries where pg_temp.anon_tiene_correo_real(payload::text)$q$;
  end if;
  return query select 'perfiles con un correo distinto del de Auth'::text,
    (select count(*) from public.profiles p join auth.users u on u.id = p.id where p.email is distinct from u.email), true;

  -- Fuera de public
  if to_regclass('cron.job') is not null then
    return query select 'cron · jobs que nombran el host de prod'::text,
      (select count(*) from cron.job where command ilike '%yiczgdtirrkdvohdquzf%'), true;
  end if;
  -- pg_net, pg_cron y Realtime: en 0 dentro de la transacción; después pueden volver a llenarse solos (informativo)
  for r in select x.t, x.d from (values ('net._http_response', 'net · respuestas HTTP guardadas'), ('net.http_request_queue', 'net · cola de pedidos HTTP'),
                                        ('cron.job_run_details', 'cron · historial de corridas'), ('realtime.messages', 'realtime · mensajes')) x(t, d)
            where to_regclass(x.t) is not null loop
    execute format('select count(*) from %s', r.t) into n;
    return query select r.d::text, n, v_fase = 'transaccion';
  end loop;
  if to_regclass('storage.objects') is not null then
    return query select 'storage · objetos fuera de documents/sops/ y de la imagen ficticia'::text,
      (select count(*) from storage.objects o
        where not (o.bucket_id = 'documents' and o.name like 'sops/%') and o.name <> 'anon/ficticia.png'),
      v_fase = 'final';
  end if;

  -- Solo dentro de la transacción de anonimizar.sql: llaves de antes y controles del §2
  if v_fase = 'transaccion' then
    for r in select a.tabla, a.columna from _anon_clases a join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
              where a.clase = 'token' loop
      execute format('select count(*) from public.%I t join _anon_tokens_antes b on b.tabla = %L and b.columna = %L and b.h = md5(t.%I)',
                     r.tabla, r.tabla, r.columna, r.columna) into n;
      c_tok := c_tok + n;
    end loop;
    return query select 'llaves del Club y hashes iguales a los de antes'::text, c_tok, true;
    return query select 'controles del §2 distintos de antes (caja, propinas, ventas, permisos, claves FE, filas)'::text,
      (select count(*) from _anon_control_antes a full join pg_temp.anon_controles() d on d.control = a.control
        where a.valor is distinct from d.valor), true;
  end if;
end $$;

-- Claves de un JSON fuera de la lista blanca (recorre como anon_json: lo «mantener_todo» y lo transformado no se mira).
create or replace function pg_temp.anon_json_fuera(j jsonb, p_perfil text default '*') returns int language plpgsql as $$
begin
  case jsonb_typeof(j)
    when 'object' then
      return (select coalesce(sum(case when p.trato is null then 1
                                       when p.trato = 'mantener' and jsonb_typeof(e.v) in ('object', 'array')
                                         then pg_temp.anon_json_fuera(e.v, p_perfil)
                                       else 0 end), 0)::int
                from jsonb_each(j) e(k, v) left join _anon_json_claves p on p.perfil = p_perfil and p.clave = e.k);
    when 'array' then
      return (select coalesce(sum(pg_temp.anon_json_fuera(x, p_perfil)), 0)::int from jsonb_array_elements(j) x
               where jsonb_typeof(x) in ('object', 'array'));
    else return 0;
  end case;
end $$;

drop table if exists _anon_verif;
create temp table _anon_verif (orden serial, control text, valor bigint, exige boolean) on commit drop;
insert into _anon_verif (control, valor, exige) select * from pg_temp.anon_verificar();
do $$
declare v text;
begin
  select string_agg(control || ' = ' || valor, '; ' order by orden) into v from _anon_verif where exige and valor <> 0;
  if v is not null and current_setting('anon.modo', true) is distinct from 'ensayo' then
    raise exception 'ANON-VERIFICAR-FALLA: %', v;
  end if;
end $$;
select control, valor, exige from _anon_verif order by orden;
