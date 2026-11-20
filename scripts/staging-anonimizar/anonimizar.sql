-- anonimizar.sql · FRAGMENTO de UNA transacción (lo arma scripts/staging-anonimizar/correr.py después de
-- clasificacion.sql y comun.sql). SOLO STAGING (hwiatgicyyqyezqwldia). NUNCA en prod (yiczgdtirrkdvohdquzf).
-- Spec firmada: docs/specs/SPEC-anonimizar-staging.md (D1 montos quedan · D2 alias numerado · D3 Storage aparte
-- (storage.sh) · D4 JSON con lista blanca y ventas_dias vacía · D5 sueldos ficticios por tipo · D6 SOP quedan · D7 cédula
-- del emisor en la clave FE).
-- IDEMPOTENTE: una segunda corrida deja todo igual, salvo las llaves (clase token), que se vuelven a sortear.
-- No toca ningún id ni llave foránea: solo columnas de texto, JSON y los montos de sueldo (D5).
-- Si algún control del §2 cambia (sumas de caja, propinas y ventas, huellas, permisos, claves FE, filas) la
-- transacción ABORTA con «ANON-ABORTA» y no queda nada.

-- ── 0. Guarda (ref + club_entorno + usuarios de prueba), clasificación completa y formas de mesas/productos ─────
select pg_temp.anon_guarda();
select pg_temp.anon_clasificacion_ok();
select pg_temp.anon_formas_ok();   -- mesas y JSON de productos: solo catálogo, antes de tocar nada
do $$
begin
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where command ilike '%yiczgdtirrkdvohdquzf%') then
    raise exception 'ANON-ABORTA: hay un job de pg_cron que nombra el host de prod: revisarlo antes de seguir';
  end if;
end $$;

-- ── 1. Sin triggers (como el clonado): ni bitácora ni guardias de inmutabilidad. Vale porque no cambia roles ni
--       activaciones (control «permisos» abajo). Con réplica tampoco corren los ON DELETE CASCADE: los hijos se borran
--       a mano (paso 8).
set local session_replication_role = replica;
do $$
begin
  if current_setting('session_replication_role') <> 'replica' then
    raise exception 'ANON-ABORTA: no se pudo poner session_replication_role = replica';
  end if;
end $$;

-- ── 2. Sal al azar de esta corrida (se descarta con la transacción): seudónimos, correos y orden de los alias ────
drop table if exists _anon_sal;
create temp table _anon_sal on commit drop as select encode(extensions.gen_random_bytes(16), 'hex') as sal;
drop table if exists _anon_conteo;
create temp table _anon_conteo (orden serial, paso text, filas bigint, ms int, en timestamptz default clock_timestamp()) on commit drop;

create or replace function pg_temp.anon_seud(v text) returns text language plpgsql stable as $$
begin
  if v is null or btrim(v) = '' or v ~ '^S[0-9a-f]{16}$' then return v; end if;
  return 'S' || substr(md5((select sal from _anon_sal) || v), 1, 16);
end $$;
create or replace function pg_temp.anon_correo(v text) returns text language plpgsql stable as $$
begin
  if v is null or btrim(v) = '' or pg_temp.anon_correo_ok(v) then return v; end if;
  return 'anon-' || substr(md5((select sal from _anon_sal) || lower(btrim(v))), 1, 12) || '@staging-satori.test';
end $$;
create or replace function pg_temp.anon_azar(alfabeto text, n int) returns text language sql volatile as $$
  select string_agg(substr(alfabeto, 1 + get_byte(b, i) % length(alfabeto), 1), '' order by i)
    from (select extensions.gen_random_bytes(n) b) x, generate_series(0, n - 1) i
$$;
-- Llave nueva al azar con la MISMA forma: así respeta los check (^[0-9a-f]{64}$, alfabeto del Club) y el largo.
create or replace function pg_temp.anon_token(v text) returns text language sql volatile as $$
  select case
    when v is null or v = '' then v
    when v ~ '^[2-9]+$' then pg_temp.anon_azar('234' || '56789', length(v))   -- por partes: la guarda del repo lo leería como teléfono
    when v ~ '^[0-9a-f]+$' then pg_temp.anon_azar('0123456789abcdef', length(v))
    when v ~ '^[A-HJ-NP-Z2-9]+$' then pg_temp.anon_azar('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length(v))
    else 'T' || pg_temp.anon_azar('0123456789abcdef', 31)
  end
$$;

-- ── 3. Controles ANTES (§2) y llaves de antes (para «tokens iguales a los de antes» = 0) ─────────────────────────
drop table if exists _anon_control_antes;
create temp table _anon_control_antes on commit drop as select * from pg_temp.anon_controles();
drop table if exists _anon_tokens_antes;
create temp table _anon_tokens_antes (tabla text, columna text, h text) on commit drop;
do $$
declare r record;
begin
  for r in select a.tabla, a.columna from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase = 'token' loop
    execute format('insert into _anon_tokens_antes select %L, %L, md5(%I) from public.%I where %I is not null and %I <> %L',
                   r.tabla, r.columna, r.columna, r.tabla, r.columna, r.columna, '');
  end loop;
end $$;

-- ── 4. Alias numerados (D2): un mapa por tipo armado con la UNIÓN de todas las columnas de ese tipo ───────────────
-- Clave = minúsculas y sin espacios de los bordes: el mismo nombre queda igual en todas las columnas (los cruces por
-- nombre siguen cuadrando). Los alias ya puestos y los nombres de prueba se mapean a sí mismos (idempotencia).
drop table if exists _anon_alias;
create temp table _anon_alias (tipo text, clave text, alias text not null, primary key (tipo, clave)) on commit drop;
drop table if exists _anon_cont;
create temp table _anon_cont (tipo text primary key, prefijo text not null, n int not null default 0) on commit drop;
insert into _anon_cont (tipo, prefijo) values
  ('empleado', 'Empleado'), ('proveedor', 'Proveedor'), ('socio', 'Socio'), ('cliente', 'Cliente');
drop table if exists _anon_valores;
create temp table _anon_valores (tipo text, valor text, primary key (tipo, valor)) on commit drop;

create or replace function pg_temp.anon_alias_nuevo(p_tipo text) returns text language plpgsql as $$
declare v_n int; v_pref text;
begin
  update _anon_cont set n = n + 1 where tipo = p_tipo returning n, prefijo into v_n, v_pref;
  return v_pref || ' ' || lpad(v_n::text, greatest(2, length(v_n::text)), '0');
end $$;
-- Un alias para TODOS los valores del grupo (p. ej. el nombre del empleado, su nombre del PoS y el de su perfil).
create or replace function pg_temp.anon_alias_grupo(p_tipo text, p_valores text[]) returns text language plpgsql as $$
declare v text; v_alias text;
begin
  -- si alguno ya tiene alias (o ya es alias o de prueba), el grupo usa ese
  select a.alias into v_alias from unnest(p_valores) u(x) join _anon_alias a on a.tipo = p_tipo and a.clave = pg_temp.anon_clave(u.x)
   limit 1;
  if v_alias is null then
    foreach v in array p_valores loop
      if pg_temp.anon_es_alias(v) or pg_temp.anon_es_prueba(v) then v_alias := btrim(v); exit; end if;
    end loop;
  end if;
  foreach v in array p_valores loop
    continue when v is null or btrim(v) = '' or pg_temp.anon_es_uuid(v);
    continue when exists (select 1 from _anon_alias a where a.tipo = p_tipo and a.clave = pg_temp.anon_clave(v));
    if pg_temp.anon_es_alias(v) or pg_temp.anon_es_prueba(v) then
      insert into _anon_alias values (p_tipo, pg_temp.anon_clave(v), btrim(v));   -- se mapea a sí mismo
    else
      if v_alias is null then v_alias := pg_temp.anon_alias_nuevo(p_tipo); end if;
      insert into _anon_alias values (p_tipo, pg_temp.anon_clave(v), v_alias);
    end if;
  end loop;
  return v_alias;
end $$;

do $$
declare r record; v int; s text := (select sal from _anon_sal);
begin
  -- 4a. el contador arranca después del alias más alto que ya exista (una segunda corrida no repite números)
  for r in select a.tabla, a.columna, substr(a.clase, 7) tipo from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase like 'alias\_%' loop
    execute format('select max((substring(btrim(%I) from %L))::int) from public.%I', r.columna,
                   '^' || (select prefijo from _anon_cont where tipo = r.tipo) || ' ([0-9]+)$', r.tabla) into v;
    update _anon_cont set n = greatest(n, coalesce(v, 0)) where tipo = r.tipo;
  end loop;
  -- 4b. empleados: un alias por empleado para su nombre, su nombre del PoS y el nombre de su perfil
  for r in select array[e.full_name, e.pos_name, p.full_name] vals
             from public.employees e left join public.profiles p on p.id = e.profile_id
            order by md5(s || e.id::text) loop
    perform pg_temp.anon_alias_grupo('empleado', r.vals);
  end loop;
  for r in select array[p.full_name] vals from public.profiles p
            where not exists (select 1 from public.employees e where e.profile_id = p.id)
            order by md5(s || p.id::text) loop
    perform pg_temp.anon_alias_grupo('empleado', r.vals);
  end loop;
  -- 4c. proveedores: el nombre y todos sus alias (aliases) van al mismo «Proveedor NN»
  for r in select array[x.name] || coalesce(x.aliases, '{}'::text[]) vals from public.suppliers x order by md5(s || x.id::text) loop
    perform pg_temp.anon_alias_grupo('proveedor', r.vals);
  end loop;
  -- 4d. el resto: la unión de todas las columnas de cada tipo (+ el proveedor que leyó la IA en la Bandeja)
  for r in select a.tabla, a.columna, substr(a.clase, 7) tipo from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase like 'alias\_%' loop
    execute format('insert into _anon_valores select distinct %L, btrim(%I) from public.%I where %I is not null and btrim(%I) <> %L
                    on conflict do nothing', r.tipo, r.columna, r.tabla, r.columna, r.columna, '');
  end loop;
  insert into _anon_valores select distinct 'proveedor', btrim(raw_json->>'proveedor') from public.documents
   where jsonb_typeof(raw_json) = 'object' and btrim(coalesce(raw_json->>'proveedor', '')) <> '' on conflict do nothing;
  for r in select tipo, valor from _anon_valores order by tipo, md5(s || pg_temp.anon_clave(valor)) loop
    perform pg_temp.anon_alias_grupo(r.tipo, array[r.valor]);
  end loop;
end $$;

-- 4e. aplicar el mapa
do $$
declare r record; n bigint;
begin
  for r in select a.tabla, a.columna, substr(a.clase, 7) tipo from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase like 'alias\_%' order by a.tabla, a.columna loop
    execute format('update public.%1$I t set %2$I = a.alias from _anon_alias a
                     where a.tipo = %3$L and a.clave = pg_temp.anon_clave(t.%2$I) and t.%2$I is distinct from a.alias',
                   r.tabla, r.columna, r.tipo);
    get diagnostics n = row_count;
    insert into _anon_conteo (paso, filas) values ('alias · ' || r.tabla || '.' || r.columna, n);
  end loop;
  -- suppliers.aliases = {su alias} (especial)
  update public.suppliers set aliases = array[name] where aliases is not null and aliases is distinct from array[name];
  get diagnostics n = row_count;
  insert into _anon_conteo (paso, filas) values ('especial · suppliers.aliases', n);
end $$;

-- ── 5. JSON (D4): política de claves = lista blanca (comun.sql, anon_politica_json). Una clave que no está, se borra.
select pg_temp.anon_preparar_politica();

-- Texto suelto según su trato (dentro de JSON).
create or replace function pg_temp.anon_texto(s text, trato text) returns text language plpgsql as $$
declare v text;
begin
  if s is null then return null; end if;
  if trato = 'nulo' then return null; end if;
  if btrim(s) = '' then return s; end if;
  case trato
    when 'nota' then return 'Nota de prueba';
    when 'alias' then
      if pg_temp.anon_es_alias(s) or pg_temp.anon_es_prueba(s) or pg_temp.anon_es_uuid(s) or s = 'Nota de prueba' then return s; end if;
      select a.alias into v from _anon_alias a
        join (values ('empleado', 1), ('proveedor', 2), ('socio', 3), ('cliente', 4)) o(tipo, k) on o.tipo = a.tipo
       where a.clave = pg_temp.anon_clave(s) order by o.k limit 1;
      return coalesce(v, 'Nota de prueba');
    when 'correo' then return pg_temp.anon_correo(s);
    when 'telefono' then
      if pg_temp.anon_tel_ok(s) then return s; end if;
      return '+506800000' || lpad((abs(hashtext((select sal from _anon_sal) || s)) % 100)::text, 2, '0');
    when 'token' then return pg_temp.anon_token(s);
    when 'seudonimo' then return pg_temp.anon_seud(s);
    when 'descripcion_fact' then return pg_temp.anon_descripcion(s);
    when 'clave_fe' then return pg_temp.anon_clave_fe(s);
    when 'adjuntos', 'ruta_storage' then return 'anon/ficticia.png';
    else return s;
  end case;
end $$;

-- Todas las hojas de un sub-árbol con el mismo trato (las claves internas, p. ej. old/new, quedan).
create or replace function pg_temp.anon_json_valor(v jsonb, trato text) returns jsonb language plpgsql as $$
declare k text; e jsonb; r jsonb;
begin
  if trato = 'nulo' then return 'null'::jsonb; end if;
  case jsonb_typeof(v)
    when 'string' then return coalesce(to_jsonb(pg_temp.anon_texto(v #>> '{}', trato)), 'null'::jsonb);
    when 'number' then
      if trato in ('telefono', 'token', 'seudonimo') then return to_jsonb(pg_temp.anon_texto(v #>> '{}', trato)); end if;
      return v;
    when 'object' then
      r := '{}'::jsonb;
      for k, e in select * from jsonb_each(v) loop r := r || jsonb_build_object(k, pg_temp.anon_json_valor(e, trato)); end loop;
      return r;
    when 'array' then
      return (select coalesce(jsonb_agg(pg_temp.anon_json_valor(x, trato) order by o), '[]'::jsonb)
                from jsonb_array_elements(v) with ordinality a(x, o));
    else return v;
  end case;
end $$;

-- Lista blanca recursiva (D4): una consulta por objeto (plan cacheado de plpgsql), la política por join contra su tabla
-- y recursión solo en lo anidado, para que las ~24 mil marcas de BioTime entren holgadas en el tiempo de la API.
create or replace function pg_temp.anon_json(j jsonb, p_perfil text default '*') returns jsonb language plpgsql as $$
begin
  case jsonb_typeof(j)
    when 'object' then
      return (select coalesce(jsonb_object_agg(e.k, case
                when p.trato = 'mantener_todo' then e.v
                when p.trato = 'mantener' then
                  case when jsonb_typeof(e.v) in ('object', 'array') then pg_temp.anon_json(e.v, p_perfil) else e.v end
                else pg_temp.anon_json_valor(e.v, p.trato) end), '{}'::jsonb)
                from jsonb_each(j) e(k, v)
                join _anon_json_claves p on p.perfil = p_perfil and p.clave = e.k);   -- lo que no está, se borra
    when 'array' then
      return (select coalesce(jsonb_agg(case when jsonb_typeof(a.x) in ('object', 'array') then pg_temp.anon_json(a.x, p_perfil)
                                             else a.x end order by a.o), '[]'::jsonb)
                from jsonb_array_elements(j) with ordinality a(x, o));
    else return j;
  end case;
end $$;

-- ── 6. Una pasada por clase sobre cada columna clasificada que existe en esta base ───────────────────────────────
do $$
declare r record; n bigint; v_unico boolean; v_dup boolean; v_t0 timestamptz; s text := (select sal from _anon_sal);
begin
  for r in select a.tabla, a.columna, a.clase, c.udt, c.nulable from _anon_clases a
             join pg_temp.anon_columnas_texto() c on c.tabla = a.tabla and c.columna = a.columna
            where a.clase in ('correo', 'telefono', 'nota', 'descripcion_fact', 'nulo', 'seudonimo', 'token', 'clave_fe',
                              'json', 'adjuntos', 'ruta_storage')
            order by a.tabla, a.columna loop
    n := null; v_t0 := clock_timestamp();
    case r.clase
      when 'correo' then
        execute format('update public.%1$I set %2$I = pg_temp.anon_correo(%2$I)
                         where %2$I is not null and btrim(%2$I) <> %3$L and not pg_temp.anon_correo_ok(%2$I)', r.tabla, r.columna, '');
      when 'telefono' then
        -- Bloque ficticio de 100 números. Los distintos se reparten en orden al azar (sal) entre los que la columna
        -- todavía no usa; si la columna es UNIQUE y no alcanzan, se aborta (ampliar la lista blanca es otro cambio).
        select exists (select 1 from pg_index i join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
                        where i.indrelid = ('public.' || quote_ident(r.tabla))::regclass and i.indisunique and i.indnatts = 1
                          and at.attname = r.columna) into v_unico;
        drop table if exists _anon_tel;
        create temp table _anon_tel (val text primary key, nuevo text not null) on commit drop;
        execute format($q$
          insert into _anon_tel (val, nuevo)
          with vals as (select val, row_number() over (order by md5(%3$L || val)) rn
                          from (select distinct %1$I val from public.%2$I
                                 where %1$I is not null and btrim(%1$I) <> '' and not pg_temp.anon_tel_ok(%1$I)) d),
               usados as (select distinct right(regexp_replace(%1$I, '[^0-9]', '', 'g'), 2) d from public.%2$I
                           where pg_temp.anon_tel_ok(%1$I)),
               libres as (select g n, row_number() over (order by g) k from generate_series(0, 99) g
                           where lpad(g::text, 2, '0') not in (select d from usados)),
               nl as (select count(*)::int c from libres)
          select v.val, '+506800000' || lpad(coalesce(l.n, (v.rn - 1) %% 100)::text, 2, '0')
            from vals v cross join nl left join libres l on nl.c > 0 and l.k = 1 + (v.rn - 1) %% nl.c$q$,
          r.columna, r.tabla, s);
        if v_unico then
          execute format('select (select count(*) from _anon_tel) <> (select count(distinct nuevo) from _anon_tel)
                            or exists (select 1 from _anon_tel m join public.%I t on t.%I <> m.val
                                        and regexp_replace(t.%I, %L, %L, %L) = regexp_replace(m.nuevo, %L, %L, %L))',
                         r.tabla, r.columna, r.columna, '[^0-9]', '', 'g', '[^0-9]', '', 'g') into v_dup;
          if v_dup then
            raise exception 'ANON-ABORTA: no alcanzan los 100 teléfonos ficticios para %.% (UNIQUE). Ampliar la lista blanca es un cambio aparte, con firma.',
              r.tabla, r.columna;
          end if;
        end if;
        execute format('update public.%1$I t set %2$I = m.nuevo from _anon_tel m where t.%2$I = m.val', r.tabla, r.columna);
      when 'nota' then
        execute format('update public.%1$I set %2$I = %3$L where %2$I is not null and btrim(%2$I) <> %4$L and %2$I <> %3$L',
                       r.tabla, r.columna, 'Nota de prueba', '');
      when 'descripcion_fact' then
        execute format('update public.%1$I set %2$I = pg_temp.anon_descripcion(%2$I)
                         where %2$I is distinct from pg_temp.anon_descripcion(%2$I)', r.tabla, r.columna);
      when 'nulo' then
        if r.nulable then
          execute format('update public.%1$I set %2$I = null where %2$I is not null', r.tabla, r.columna);
        elsif r.udt in ('text', 'varchar', 'bpchar') then
          execute format('update public.%1$I set %2$I = %3$L where %2$I <> %3$L', r.tabla, r.columna, '');
        else
          raise exception 'ANON-ABORTA: %.% es NOT NULL y de tipo %: no se puede vaciar', r.tabla, r.columna, r.udt;
        end if;
      when 'seudonimo' then
        if r.udt in ('_text', '_varchar') then
          execute format('update public.%1$I set %2$I = (select array_agg(pg_temp.anon_seud(x) order by o) from unnest(%2$I) with ordinality u(x, o))
                           where %2$I is not null and cardinality(%2$I) > 0
                             and exists (select 1 from unnest(%2$I) x where x is distinct from pg_temp.anon_seud(x))', r.tabla, r.columna);
        else
          execute format('update public.%1$I set %2$I = pg_temp.anon_seud(%2$I)
                           where %2$I is not null and btrim(%2$I) <> %3$L and %2$I !~ %4$L', r.tabla, r.columna, '', '^S[0-9a-f]{16}$');
        end if;
      when 'token' then
        execute format('update public.%1$I set %2$I = pg_temp.anon_token(%2$I) where %2$I is not null and %2$I <> %3$L',
                       r.tabla, r.columna, '');
      when 'clave_fe' then
        execute format('update public.%1$I set %2$I = pg_temp.anon_clave_fe(%2$I)
                         where %2$I ~ %3$L and substr(%2$I, 10, 12) <> %4$L', r.tabla, r.columna, '^[0-9]{50}$', '999999999999');
      when 'json' then
        execute format('update public.%1$I set %2$I = pg_temp.anon_json(%2$I, %3$L) where %2$I is not null',
                       r.tabla, r.columna, pg_temp.anon_perfil(r.tabla, r.columna));
      when 'adjuntos' then
        execute format($q$update public.%1$I set %2$I = case when jsonb_typeof(%2$I) = 'array'
                              then (select coalesce(jsonb_agg(to_jsonb('anon/ficticia.png'::text)), '[]'::jsonb) from jsonb_array_elements(%2$I))
                              else '[]'::jsonb end
                         where %2$I is not null and %2$I <> '[]'::jsonb
                           and (jsonb_typeof(%2$I) <> 'array'
                                or exists (select 1 from jsonb_array_elements(%2$I) e where e <> to_jsonb('anon/ficticia.png'::text)))$q$,
                       r.tabla, r.columna);
      when 'ruta_storage' then
        execute format('update public.%1$I set %2$I = %3$L where %2$I is not null and btrim(%2$I) <> %4$L and %2$I <> %3$L',
                       r.tabla, r.columna, 'anon/ficticia.png', '');
    end case;
    get diagnostics n = row_count;
    insert into _anon_conteo (paso, filas, ms) values (r.clase || ' · ' || r.tabla || '.' || r.columna, n,
      extract(milliseconds from clock_timestamp() - v_t0)::int);
  end loop;

  -- tablas que se vacían enteras (TRUNCATE, no DROP: no agrega drift)
  for r in select distinct a.tabla from _anon_clases a where a.clase = 'vaciar_tabla'
              and to_regclass('public.' || quote_ident(a.tabla)) is not null order by a.tabla loop
    execute format('select count(*) from public.%I', r.tabla) into n;
    execute format('truncate public.%I', r.tabla);
    insert into _anon_conteo (paso, filas) values ('vaciar · ' || r.tabla, n);
  end loop;
end $$;

-- ── 7. Especiales ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 7a. Cadena de cierres del Club: sha256 = sha256(sha256_prev || datos) por local, en orden de id (CLUB-AUD-16). Los
--     datos cambiaron en el paso 6: se recalcula para que la verificación de la cadena siga dando.
create or replace function pg_temp.anon_cadena_club() returns bigint language plpgsql as $$
declare r record; v_prev text; v_loc text; v_nuevo text; n bigint := 0;
begin
  if to_regclass('public.club_reportes_cerrados') is null then return 0; end if;
  for r in select id, location_id, datos, sha256, sha256_prev from public.club_reportes_cerrados order by location_id, id loop
    if v_loc is distinct from r.location_id then v_prev := null; v_loc := r.location_id; end if;
    v_nuevo := encode(extensions.digest(coalesce(v_prev, '') || r.datos::text, 'sha256'), 'hex');
    if r.sha256 is distinct from v_nuevo or r.sha256_prev is distinct from v_prev then
      update public.club_reportes_cerrados set sha256 = v_nuevo, sha256_prev = v_prev where id = r.id;
      n := n + 1;
    end if;
    v_prev := v_nuevo;
  end loop;
  return n;
end $$;
insert into _anon_conteo (paso, filas) select 'especial · cadena de club_reportes_cerrados', pg_temp.anon_cadena_club();

-- 7b. Sueldos (D5): valor ficticio por tipo. Ningún monto de caja, propinas ni ventas cambia (D1).
--     hora: ₡2 500/h · quincena: ₡250 000 · mes: ₡500 000 · otro: ₡100 000 · bono: ₡10 000 (0 sigue siendo 0).
do $$
declare n bigint;
begin
  if to_regclass('public.employee_wage_rates') is not null then
    update public.employee_wage_rates
       set hourly_rate_crc = case when hourly_rate_crc > 0 then 2500 else 0 end,
           fixed_salary_crc = case when fixed_salary_crc > 0
                                   then case tipo when 'quincena' then 250000 when 'mes' then 500000 else 100000 end else 0 end
     where hourly_rate_crc not in (0, 2500) or fixed_salary_crc not in (0, 100000, 250000, 500000);
    get diagnostics n = row_count; insert into _anon_conteo (paso, filas) values ('sueldos · employee_wage_rates', n);
  end if;
  if to_regclass('public.employee_payroll') is not null then
    update public.employee_payroll
       set hourly_rate_crc = case when hourly_rate_crc > 0 then 2500 else 0 end,
           fixed_salary_crc = case when fixed_salary_crc > 0 then 500000 else 0 end
     where hourly_rate_crc not in (0, 2500) or fixed_salary_crc not in (0, 500000);
    get diagnostics n = row_count; insert into _anon_conteo (paso, filas) values ('sueldos · employee_payroll', n);
  end if;
  if to_regclass('public.salary_lines') is not null then
    update public.salary_lines l
       set pago_horas = round(l.horas * 2500, 2),
           salario_fijo = case when l.salario_fijo > 0 then 250000 else 0 end,
           bono = case when l.bono > 0 then 10000 else 0 end,
           total = round(l.horas * 2500, 2) + l.aporte_servicio + case when l.salario_fijo > 0 then 250000 else 0 end
                   + case when l.bono > 0 then 10000 else 0 end
     where l.pago_horas <> round(l.horas * 2500, 2) or l.salario_fijo not in (0, 250000) or l.bono not in (0, 10000)
        or l.total <> l.pago_horas + l.aporte_servicio + l.salario_fijo + l.bono;
    get diagnostics n = row_count; insert into _anon_conteo (paso, filas) values ('sueldos · salary_lines', n);
  end if;
  if to_regclass('public.employee_payments') is not null then
    update public.employee_payments p
       set monto_neto = coalesce((select l.total from public.salary_lines l
                                   where l.period_id = p.period_id and l.employee_id = p.employee_id limit 1), 100000)
     where p.monto_neto is distinct from coalesce((select l.total from public.salary_lines l
                                                    where l.period_id = p.period_id and l.employee_id = p.employee_id limit 1), 100000);
    get diagnostics n = row_count; insert into _anon_conteo (paso, filas) values ('sueldos · employee_payments', n);
  end if;
end $$;

-- 7c. Cumpleaños de clientes: queda el día y el mes (como en el Club), el año pasa a 2000.
update public.customers set birth_date = make_date(2000, extract(month from birth_date)::int, extract(day from birth_date)::int)
 where birth_date is not null and extract(year from birth_date) <> 2000;

-- ── 8. Auth: el saneo del clonado (correo .test; sin hash, tokens, teléfono, metadatos ni sesiones) ───────────────
-- Los usuarios de prueba (prueba-<rol>@staging-satori.test y manager.prueba@example.com) no se tocan.
update auth.users u
   set email = 'prod-' || substr(md5(u.id::text), 1, 12) || '@staging-satori.test',
       encrypted_password = '', confirmation_token = '', recovery_token = '', email_change_token_new = '',
       email_change_token_current = '', phone_change_token = '', reauthentication_token = '', email_change = '',
       phone_change = '', phone = null, raw_user_meta_data = '{}'::jsonb,
       banned_until = case when u.banned_until > now() + interval '50 years' then u.banned_until
                           else now() + interval '100 years' end
 where not pg_temp.anon_usuario_prueba(u.email)
   and (u.email is distinct from 'prod-' || substr(md5(u.id::text), 1, 12) || '@staging-satori.test'
        or coalesce(u.encrypted_password, '') <> '' or u.phone is not null or u.raw_user_meta_data <> '{}'::jsonb
        or coalesce(u.banned_until, '-infinity') <= now() + interval '50 years'
        or coalesce(u.confirmation_token, '') <> '' or coalesce(u.recovery_token, '') <> ''
        or coalesce(u.email_change_token_new, '') <> '' or coalesce(u.email_change_token_current, '') <> ''
        or coalesce(u.phone_change_token, '') <> '' or coalesce(u.reauthentication_token, '') <> ''
        or coalesce(u.email_change, '') <> '' or coalesce(u.phone_change, '') <> '');
update auth.identities i
   set identity_data = jsonb_build_object('sub', i.user_id::text, 'email', u.email, 'email_verified', true),
       provider_id = case when i.provider = 'email' then i.user_id::text
                          when i.provider_id ~ '^[0-9a-f]{32}$' then i.provider_id else md5(i.provider_id) end,
       last_sign_in_at = null
  from auth.users u
 where u.id = i.user_id and not pg_temp.anon_usuario_prueba(u.email)
   and (i.identity_data is distinct from jsonb_build_object('sub', i.user_id::text, 'email', u.email, 'email_verified', true)
        or i.last_sign_in_at is not null);

-- Sesiones, tokens y factores de los que no son de prueba; hijos primero (con réplica no hay cascada). Las tablas que
-- esta versión de Auth no tenga se saltan. flow_state, saml_relay_states y audit_log_entries se vacían enteras (traen
-- correos e IP).
create or replace function pg_temp.anon_borrar_auth(p_tabla text) returns bigint language plpgsql as $$
declare v_filtro text; n bigint;
begin
  if to_regclass('auth.' || p_tabla) is null then return null; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = p_tabla and column_name = 'user_id') then
    v_filtro := 'user_id::text in (select id::text from auth.users where not pg_temp.anon_usuario_prueba(email))';
  elsif exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = p_tabla and column_name = 'session_id') then
    v_filtro := 'session_id::text in (select s.id::text from auth.sessions s join auth.users u on u.id = s.user_id where not pg_temp.anon_usuario_prueba(u.email))';
  elsif exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = p_tabla and column_name = 'factor_id') then
    v_filtro := 'factor_id::text in (select f.id::text from auth.mfa_factors f join auth.users u on u.id = f.user_id where not pg_temp.anon_usuario_prueba(u.email))';
  else
    return null;
  end if;
  execute format('delete from auth.%I where %s', p_tabla, v_filtro);
  get diagnostics n = row_count;
  return n;
end $$;
do $$
declare t text; n bigint;
begin
  foreach t in array array['mfa_amr_claims', 'refresh_tokens', 'mfa_challenges', 'mfa_recovery_codes', 'mfa_recovery_code_sets',
                           'webauthn_challenges', 'webauthn_credentials', 'one_time_tokens', 'oauth_authorizations',
                           'oauth_consents', 'mfa_factors', 'sessions'] loop
    n := pg_temp.anon_borrar_auth(t);
    if n is not null then insert into _anon_conteo (paso, filas) values ('auth · ' || t, n); end if;
  end loop;
  foreach t in array array['saml_relay_states', 'flow_state', 'audit_log_entries'] loop
    if to_regclass('auth.' || t) is not null then
      execute format('delete from auth.%I where true', t);   -- where true: por si pg_safeupdate está activo
      get diagnostics n = row_count;
      insert into _anon_conteo (paso, filas) values ('auth · ' || t || ' (entera)', n);
    end if;
  end loop;
end $$;

-- 8b. profiles.email = el de Auth (ya saneado); un perfil sin usuario de Auth recibe un correo .test
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is distinct from u.email;
update public.profiles p set email = pg_temp.anon_correo(p.email)
 where p.email is not null and not pg_temp.anon_correo_ok(p.email) and not exists (select 1 from auth.users u where u.id = p.id);

-- ── 9. Fuera de public: lo que guardan pg_net, pg_cron y Realtime (cuerpos de las Edge, salidas de los jobs, mensajes)
-- pg_stat_statements se reinicia DESPUÉS del commit (correr.py, modo real): no es transaccional. Los logs de la
-- plataforma (API, Postgres, Auth, Edge) no se pueden limpiar desde acá: STAGING.md, «no limpia».
do $$
declare t text; n bigint;
begin
  foreach t in array array['net._http_response', 'net.http_request_queue', 'cron.job_run_details', 'realtime.messages'] loop
    if to_regclass(t) is not null then
      execute format('delete from %s where true', t);   -- where true: por si pg_safeupdate está activo
      get diagnostics n = row_count;
      insert into _anon_conteo (paso, filas) values ('fuera de public · ' || t, n);
    end if;
  end loop;
end $$;

-- ── 10. Controles DESPUÉS: idénticos a los de antes o se aborta todo ─────────────────────────────────────────────
drop table if exists _anon_control_despues;
create temp table _anon_control_despues on commit drop as select * from pg_temp.anon_controles();
do $$
declare v text;
begin
  select string_agg(coalesce(a.control, d.control), '; ' order by coalesce(a.control, d.control)) into v
    from _anon_control_antes a full join _anon_control_despues d on d.control = a.control
   where a.valor is distinct from d.valor;
  if v is not null then
    raise exception 'ANON-ABORTA: cambió un control del §2 (se descarta todo): %', v;
  end if;
end $$;

-- Solo conteos (ningún valor).
select paso, filas, ms from _anon_conteo order by orden;
