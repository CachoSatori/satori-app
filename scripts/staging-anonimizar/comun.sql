-- comun.sql · FRAGMENTO (no se corre solo: lo arma scripts/staging-anonimizar/correr.py). SOLO STAGING.
-- Guarda, funciones puras y controles que usan anonimizar.sql, verificar.sql y la batería
-- (scripts/sql/anonimizar_staging_pruebas.sql). Todo vive en pg_temp: se va con la sesión.
-- Constantes (las mismas que scripts/staging-anonimizar/anon.ts; anon.test.ts las compara):
--   cédula ficticia del emisor 999999999999 · imagen ficticia anon/ficticia.png · nota «Nota de prueba»
--   teléfonos +506 8000 00NN (lista blanca de src/privacidadRepo.test.ts) · correos @staging-satori.test

-- ── Guarda (SPEC §3 y §5): ref de staging + base marcada como staging + usuarios de prueba ─────────────────────
-- El ref no se puede leer desde SQL: lo pone correr.py con set_config('anon.ref', …) tomado de la MISMA constante con
-- la que arma la URL de la Management API (solo staging). Prod (yiczgdtirrkdvohdquzf) no tiene club_entorno ni usuarios
-- de prueba: dos barreras más que no dependen del runner.
create or replace function pg_temp.anon_guarda() returns void language plpgsql as $$
declare v_n int;
begin
  if current_setting('anon.ref', true) is distinct from 'hwiatgicyyqyezqwldia' then
    raise exception 'ANON-ABORTA: la marca de ref no es la de staging (anon.ref = %). Se corre solo con correr.py.',
      coalesce(current_setting('anon.ref', true), '(vacía)');
  end if;
  if to_regclass('public.club_entorno') is null or not exists (select 1 from public.club_entorno where nombre = 'staging') then
    raise exception 'ANON-ABORTA: esta base NO está marcada como staging (club_entorno). No se toca nada.';
  end if;
  select count(*) into v_n from auth.users where email ~ '^prueba-[a-z]+@staging-satori\.test$';
  if v_n < 5 then
    raise exception 'ANON-ABORTA: faltan los usuarios de prueba (hay %; se esperan 5 o más). ¿Es staging? ¿Se corrió crear.sh?', v_n;
  end if;
end $$;

-- ── Catálogo ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.anon_columnas_texto()
returns table (tabla text, columna text, udt text, nulable boolean) language sql stable as $$
  select c.table_name::text, c.column_name::text, c.udt_name::text, c.is_nullable = 'YES'
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
     and (c.data_type in ('text', 'character varying', 'character', 'jsonb', 'json')
          or (c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar')))
$$;

-- Columnas de la base sin clase, o con una clase que no existe o que no va con su tipo.
create or replace function pg_temp.anon_problemas_clasificacion() returns table (problema text) language plpgsql as $$
begin
  return query
  select 'sin clasificar: ' || c.tabla || '.' || c.columna
    from pg_temp.anon_columnas_texto() c left join _anon_clases a on a.tabla = c.tabla and a.columna = c.columna
   where a.clase is null
  union all
  select 'clase desconocida: ' || a.tabla || '.' || a.columna || ' = ' || a.clase
    from _anon_clases a
   where a.clase not in ('mantener', 'alias_empleado', 'alias_proveedor', 'alias_socio', 'alias_cliente', 'correo',
                         'correo_auth', 'telefono', 'nota', 'descripcion_fact', 'nulo', 'seudonimo', 'token', 'clave_fe',
                         'json', 'json_mantener', 'adjuntos', 'ruta_storage', 'vaciar_tabla', 'especial')
  union all
  select 'clase que no va con el tipo: ' || c.tabla || '.' || c.columna || ' (' || c.udt || ') = ' || a.clase
    from pg_temp.anon_columnas_texto() c join _anon_clases a on a.tabla = c.tabla and a.columna = c.columna
   where (c.udt in ('text', 'varchar', 'bpchar')
          and a.clase in ('json', 'json_mantener', 'adjuntos'))
      or (c.udt in ('jsonb', 'json')
          and a.clase not in ('mantener', 'json', 'json_mantener', 'adjuntos', 'nulo', 'vaciar_tabla'))
      or (c.udt = 'json' and a.clase in ('json', 'adjuntos'))
      or (c.udt in ('_text', '_varchar')
          and a.clase not in ('mantener', 'seudonimo', 'nulo', 'vaciar_tabla', 'especial'));
end $$;

create or replace function pg_temp.anon_clasificacion_ok() returns void language plpgsql as $$
declare v text;
begin
  select string_agg(problema, '; ' order by problema) into v from pg_temp.anon_problemas_clasificacion();
  if v is not null then
    raise exception 'ANON-ABORTA: clasificación incompleta (corregir scripts/staging-anonimizar/clasificacion.sql): %', v;
  end if;
end $$;

-- ── Formas de lo ficticio ───────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.anon_es_prueba(v text) returns boolean language sql immutable as
$$ select coalesce(btrim(v) ~ '^(Prueba [[:alpha:]]+|Manager Prueba)$', false) $$;
create or replace function pg_temp.anon_es_alias(v text) returns boolean language sql immutable as
$$ select coalesce(btrim(v) ~ '^(Empleado|Proveedor|Socio|Cliente) [0-9]{2,}$', false) $$;
create or replace function pg_temp.anon_es_uuid(v text) returns boolean language sql immutable as
$$ select coalesce(btrim(v) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) $$;
create or replace function pg_temp.anon_clave(v text) returns text language sql immutable as
$$ select lower(btrim(v)) $$;
create or replace function pg_temp.anon_correo_ok(v text) returns boolean language sql immutable as
$$ select coalesce(lower(btrim(v)) ~ '@(staging-satori\.test|example\.com)$', false) $$;
-- Bloque ficticio: 80000000–80000099, con o sin +506, con o sin separadores.
create or replace function pg_temp.anon_tel_ok(v text) returns boolean language sql immutable as
$$ select coalesce(regexp_replace(v, '[^0-9]', '', 'g') ~ '^(506)?800000[0-9]{2}$', false) $$;
create or replace function pg_temp.anon_usuario_prueba(email text) returns boolean language sql immutable as
$$ select coalesce(email ~ '^prueba-[a-z]+@staging-satori\.test$' or lower(email) = 'manager.prueba@example.com', false) $$;

-- Clave FE (50 dígitos): 506 + DDMMAA (1–9) · cédula del emisor (10–21) · consecutivo (22–41) · situación (42) ·
-- código de seguridad (43–50). Solo cambia la cédula (D7); con otra forma la clave queda igual (verificar la cuenta).
create or replace function pg_temp.anon_clave_fe(v text) returns text language sql immutable as $$
  select case when v ~ '^[0-9]{50}$' then substr(v, 1, 9) || '999999999999' || substr(v, 22) else v end
$$;

-- Descripción de un movimiento de caja. Se conservan SOLO las que arma el sistema sin texto libre (el cierre y las
-- propinas las buscan por texto: 071/074, cash.ts, borrarDia.ts); el resto es «Nota de prueba» + «· fact AAAA-MM-DD»
-- si la tenía (regla 11; fechaFacturaDeDescripcion toma la última).
create or replace function pg_temp.anon_descripcion(v text) returns text language sql immutable as $$
  select case
    when v is null or btrim(v) = '' then v
    when v ~ '^(Ventas efectivo (Mediodía|Noche|Mañana|Tarde|AM|PM) |Ventas del día |Apertura pozo |Retiro dueños a banco )[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v
    when v ~ '^Propinas turno [0-9]{4}-[0-9]{2}-[0-9]{2} (Mediodía|Noche|Mañana|Tarde|AM|PM)$' then v
    when v ~ '^Ajuste de cierre [0-9]{4}-[0-9]{2}-[0-9]{2} · (Sobrante|Faltante)( · |$)' then
      substring(v from '^(Ajuste de cierre [0-9]{4}-[0-9]{2}-[0-9]{2} · (Sobrante|Faltante))') || ' · Nota de prueba'
    else 'Nota de prueba' || coalesce(' · fact ' || substring(v from '.*·\s*fact\s+([0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])'), '')
  end
$$;
-- La forma que verificar acepta (independiente de anon_descripcion: si alguien cambia una, la otra la frena).
create or replace function pg_temp.anon_descripcion_ok(v text) returns boolean language sql immutable as $$
  select v is null or btrim(v) = ''
      or v ~ '^Nota de prueba( · fact [0-9]{4}-[0-9]{2}-[0-9]{2})?$'
      or v ~ '^(Ventas efectivo (Mediodía|Noche|Mañana|Tarde|AM|PM) |Ventas del día |Apertura pozo |Retiro dueños a banco )[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or v ~ '^Propinas turno [0-9]{4}-[0-9]{2}-[0-9]{2} (Mediodía|Noche|Mañana|Tarde|AM|PM)$'
      or v ~ '^Ajuste de cierre [0-9]{4}-[0-9]{2}-[0-9]{2} · (Sobrante|Faltante) · Nota de prueba$'
$$;

-- Correos con forma real dentro de un texto cualquiera (dominio fuera de los ficticios).
create or replace function pg_temp.anon_tiene_correo_real(t text) returns boolean language sql immutable as $$
  select t is not null and strpos(t, '@') > 0 and exists (
    select 1 from regexp_matches(t, '[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', 'g') m
     where lower(m[1]) !~ '^(staging-satori\.test|example\.com)$')
$$;
-- Teléfonos con forma real dentro de un texto cualquiera: +506 y 8 dígitos (con o sin separadores) o un número
-- internacional con «+», fuera del bloque ficticio. Una clave FE (50 dígitos seguidos) no cuenta.
create or replace function pg_temp.anon_tiene_telefono_real(t text) returns boolean language sql immutable as $$
  select t is not null and strpos(t, '506') + strpos(t, '+') > 0 and (
    exists (select 1 from regexp_matches(t, '(^|[^0-9])(\+?506[ -]?[24-8][0-9]{3}[ -]?[0-9]{4})([^0-9]|$)', 'g') m
             where not pg_temp.anon_tel_ok(m[2]))
    or exists (select 1 from regexp_matches(t, '(\+[1-9][0-9 -]{7,17}[0-9])([^0-9]|$)', 'g') m
                where length(regexp_replace(m[1], '[^0-9]', '', 'g')) between 8 and 15 and not pg_temp.anon_tel_ok(m[1])))
$$;

-- ── Política de claves JSON (D4: lista blanca) ────────────────────────────────────────────────────────────────────
-- (1) las claves propias de JSON de clasificacion.sql; (2) los nombres de columna de texto con el trato de su clase (si
-- el nombre se repite en varias tablas, gana el más protector); (3) los nombres de columna que no son de texto (montos,
-- fechas, ids, booleanos): se mantienen. Una clave que no aparece en ninguna de las tres se BORRA del JSON.
-- Tratos: mantener (se recorre con la misma lista) · mantener_todo (el sub-árbol queda tal cual) · y los de las clases.
create or replace function pg_temp.anon_politica_json() returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  select coalesce(jsonb_object_agg(clave, trato), '{}'::jsonb) into v from _anon_json_extra;
  select v || coalesce(jsonb_object_agg(x.columna, x.trato), '{}'::jsonb) into v
    from (select distinct on (a.columna) a.columna, m.trato
            from _anon_clases a
            join (values ('nulo', 'nulo', 1), ('token', 'token', 2), ('correo', 'correo', 3),
                         ('correo_auth', 'correo', 3), ('telefono', 'telefono', 4), ('seudonimo', 'seudonimo', 5),
                         ('alias_empleado', 'alias', 6), ('alias_proveedor', 'alias', 6), ('alias_socio', 'alias', 6),
                         ('alias_cliente', 'alias', 6), ('nota', 'nota', 7), ('descripcion_fact', 'descripcion_fact', 8),
                         ('clave_fe', 'clave_fe', 9), ('adjuntos', 'adjuntos', 10), ('ruta_storage', 'ruta_storage', 11),
                         ('mantener', 'mantener', 12), ('json', 'mantener', 12), ('especial', 'mantener', 12),
                         ('json_mantener', 'mantener_todo', 13)) m(clase, trato, rango) on m.clase = a.clase
           where not (v ? a.columna) and a.clase <> 'vaciar_tabla'   -- una tabla que se vacía no define qué es su columna
           order by a.columna, m.rango) x;
  select v || coalesce(jsonb_object_agg(x.column_name, 'mantener'), '{}'::jsonb) into v
    from (select distinct c.column_name::text column_name
            from information_schema.columns c
            join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
             and not (c.data_type in ('text', 'character varying', 'character', 'jsonb', 'json')
                      or (c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar')))
             and not (v ? c.column_name::text)) x;
  return v;
end $$;
-- La política en una tabla con llave (las funciones JSON la leen por join: un jsonb grande se descomprimiría en cada clave).
-- perfil '*' = la política general; perfil '<tabla>.<columna>' = la lista propia de esa columna (_anon_json_perfil).
create or replace function pg_temp.anon_preparar_politica() returns void language plpgsql as $$
begin
  drop table if exists _anon_json_claves;
  create temp table _anon_json_claves (perfil text, clave text, trato text not null, primary key (perfil, clave)) on commit drop;
  insert into _anon_json_claves select '*', k, v from jsonb_each_text(pg_temp.anon_politica_json()) x(k, v);
  insert into _anon_json_claves select tabla || '.' || columna, clave, trato from _anon_json_perfil;
  analyze _anon_json_claves;
end $$;
create or replace function pg_temp.anon_perfil(p_tabla text, p_columna text) returns text language plpgsql stable as $$
begin
  return coalesce((select p_tabla || '.' || p_columna from _anon_json_perfil
                    where tabla = p_tabla and columna = p_columna limit 1), '*');
end $$;

-- ── Formas de mesas y de los JSON de productos (se cuentan ANTES de tocar nada) ──────────────────────────────────
-- Estas columnas quedan «mantener» / «json_mantener»: se supone que son catálogo (nombres de mesa y de producto del PoS).
-- Si aparece texto libre (p. ej. «mesa de <cliente>» o una nota dentro de un producto), anonimizar.sql ABORTA antes de
-- cambiar nada y `correr.py formas` muestra los conteos (nunca los valores) para clasificarlo.
create or replace function pg_temp.anon_preparar_catalogo() returns void language plpgsql as $$
declare r record;
begin
  drop table if exists _anon_catalogo;
  create temp table _anon_catalogo (v text primary key) on commit drop;
  for r in select x.t, x.c from (values ('pos_ndf_ticket_lines', 'nombre'), ('pos_ndf_ticket_lines', 'codigo_producto'),
                                        ('product_map', 'nombre'), ('pos_prices', 'product_name'), ('pos_order_items', 'product_name'),
                                        ('recipes', 'product_name'), ('modifiers', 'name'), ('club_cortesias', 'nombre'),
                                        ('club_cortesias', 'codigo_producto'), ('salon_tables', 'name'), ('pos_mesas_internas', 'mesa')) x(t, c)
            where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = x.t and column_name = x.c) loop
    execute format('insert into _anon_catalogo select distinct lower(btrim(%1$I)) from public.%2$I where %1$I is not null and btrim(%1$I) <> %3$L
                    on conflict do nothing', r.c, r.t, '');
  end loop;
  analyze _anon_catalogo;
end $$;

-- Forma de un texto. p_estricta: sin «código interno» (palabra suelta en minúscula), para mesas y claves de nombre.
create or replace function pg_temp.anon_forma_texto(v text, p_estricta boolean default true) returns text language plpgsql stable as $$
declare t text := btrim(coalesce(v, ''));
begin
  if t = '' then return 'vacía'; end if;
  if exists (select 1 from _anon_catalogo c where c.v = lower(t)) then return 'catálogo'; end if;
  if t ~ '^-?[0-9]+([.,][0-9]+)?$' then return 'número'; end if;
  if pg_temp.anon_es_uuid(t) then return 'uuid'; end if;
  if t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9:.+-]+)?$' then return 'fecha'; end if;
  if t ~ '^[[:alpha:]]{0,8}[ -]?[0-9]{1,4}[[:alpha:]]?$' then return 'código'; end if;
  if upper(t) in ('BARRA', 'DELIVERY', 'LLEVAR', 'PARA LLEVAR', 'EXPRESS', 'TERRAZA', 'SALON', 'SALÓN', 'PLAYA', 'JARDIN', 'JARDÍN')
    then return 'lugar conocido'; end if;
  if not p_estricta and t ~ '^[a-z_]{1,24}$' then return 'código interno'; end if;
  return 'texto libre';
end $$;

-- Hojas de un JSON con su clave (los elementos de un arreglo heredan la clave del padre).
create or replace function pg_temp.anon_hojas(j jsonb) returns table (k text, v jsonb) language sql immutable as $$
  with recursive h(k, v) as (
    select null::text, j
    union all
    select coalesce(e.key, h.k), e.value
      from h, lateral (select x.key, x.value from jsonb_each(case when jsonb_typeof(h.v) = 'object' then h.v else '{}'::jsonb end) x
                       union all
                       select null, y.value from jsonb_array_elements(case when jsonb_typeof(h.v) = 'array' then h.v else '[]'::jsonb end) y) e
  )
  select k, v from h where jsonb_typeof(v) not in ('object', 'array')
$$;

-- Conteos: «forma <x>» por columna de mesa; «clave <k>» y «forma <x>» por columna JSON de productos. Sin valores.
create or replace function pg_temp.anon_formas() returns table (columna text, forma text, n bigint) language plpgsql as $$
declare r record;
begin
  perform pg_temp.anon_preparar_catalogo();
  for r in select x.t, x.c from (values ('pos_ndf_tickets', 'mesa'), ('pos_ndf_tickets', 'mesa_factura'), ('pos_ndf_open', 'mesa'),
                                        ('pos_orders', 'table_name')) x(t, c)
            where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = x.t and column_name = x.c) loop
    return query execute format('select %1$L::text, %2$L || pg_temp.anon_forma_texto(%3$I), count(*) from public.%4$I group by 2',
                                r.t || '.' || r.c, 'forma ', r.c, r.t);
  end loop;
  for r in select x.t, x.c from (values ('pos_ndf_open', 'detalle_productos'), ('pos_checks', 'items_snapshot')) x(t, c)
            where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = x.t and column_name = x.c) loop
    return query execute format('select %1$L::text, %2$L || coalesce(h.k, %3$L), count(*) from public.%4$I t, pg_temp.anon_hojas(t.%5$I) h group by 2',
                                r.t || '.' || r.c, 'clave ', '(sin clave)', r.t, r.c);
    return query execute format($q$select %1$L::text, %2$L || case when jsonb_typeof(h.v) <> 'string' then jsonb_typeof(h.v)
                                       else pg_temp.anon_forma_texto(h.v #>> '{}', coalesce(lower(h.k), '') in
                                            ('nombre', 'name', 'label', 'nota', 'note', 'notes', 'product_name', 'cliente', 'customer',
                                             'comentario', 'observacion', 'descripcion', 'description', 'mesa', 'table_name')) end,
                                       count(*) from public.%3$I t, pg_temp.anon_hojas(t.%4$I) h group by 2$q$,
                                r.t || '.' || r.c, 'forma ', r.t, r.c);
  end loop;
end $$;

create or replace function pg_temp.anon_formas_ok() returns void language plpgsql as $$
declare v text;
begin
  select string_agg(f.columna || ' = ' || f.n, '; ' order by f.columna) into v from pg_temp.anon_formas() f where f.forma = 'forma texto libre';
  if v is not null then
    raise exception 'ANON-ABORTA: texto libre que no es de catálogo en mesas o productos (ver «correr.py formas»; clasificar antes de seguir): %', v;
  end if;
end $$;

-- ── Controles del §2 (antes = después, si no la transacción se descarta) ─────────────────────────────────────────
-- Huella de una tabla con TODAS sus columnas salvo las de texto que esta corrida cambia a propósito (clase ≠ mantener).
create or replace function pg_temp.anon_huella(p_tabla text) returns text language plpgsql as $$
declare v_cols text; v text;
begin
  if to_regclass('public.' || quote_ident(p_tabla)) is null then return '(no existe)'; end if;
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = ('public.' || quote_ident(p_tabla))::regclass and a.attnum > 0 and not a.attisdropped
     and not exists (select 1 from _anon_clases k where k.tabla = p_tabla and k.columna = a.attname and k.clase <> 'mantener');
  -- suma de hashes por fila: no depende del orden y no ordena (pos_ndf_ticket_lines tiene cientos de miles de filas)
  execute format('select count(*) || %L || coalesce(sum(hashtextextended(row(%s)::text, 0)), 0) from public.%I',
                 ':', v_cols, p_tabla) into v;
  return v;
end $$;

create or replace function pg_temp.anon_controles() returns table (control text, valor text) language plpgsql as $$
declare t text; v text; v_filas text := '';
begin
  -- Sumas que pide la spec, legibles
  return query select 'caja · cash_movements por día (n, ₡, $)'::text, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (select format('%s:%s:%s:%s', (created_at at time zone 'America/Costa_Rica')::date, count(*), sum(amount_crc), sum(amount_usd)) x
            from public.cash_movements group by (created_at at time zone 'America/Costa_Rica')::date) d;
  return query select 'propinas · tip_entries.payout_crc por sesión'::text, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (select format('%s:%s:%s', session_id, count(*), sum(payout_crc)) x from public.tip_entries group by session_id) d;
  return query select 'caja · cash_cierres_dia por día'::text, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (select row(c.session_date, c.location_id, c.tipo, c.vm_crc, c.vm_usd, c.vn_crc, c.vn_usd, c.propinas_m_crc,
                     c.propinas_n_crc, c.ef_real_m_crc, c.ef_real_n_crc, c.diferencia_crc, c.remanente_crc, c.remanente_usd)::text x
            from public.cash_cierres_dia c) d;
  return query select 'ventas · pos_ndf_tickets por local y día'::text, md5(coalesce(string_agg(x, '|' order by x), ''))
    from (select format('%s:%s:%s:%s:%s:%s', local, (fecha_registra at time zone 'America/Costa_Rica')::date, count(*),
                        sum(total_crc), sum(servicio_crc), sum(iva_crc)) x
            from public.pos_ndf_tickets group by local, (fecha_registra at time zone 'America/Costa_Rica')::date) d;
  -- Huellas completas (montos, puntos, horas, estados, llaves)
  foreach t in array array['cash_movements', 'cash_sessions', 'cash_cierres_dia', 'tip_sessions', 'tip_entries',
                           'pos_ndf_tickets', 'pos_ndf_ticket_lines', 'pos_orders', 'pos_payments', 'club_movimientos',
                           'credit_applications', 'supplier_credits', 'accounting_entries', 'inventory_movements'] loop
    return query select 'huella · ' || t, pg_temp.anon_huella(t);
  end loop;
  -- Permisos y RLS: rol, activo y locales (md5 antes = después) y la bitácora con el mismo conteo
  return query select 'permisos · profiles (rol, activo) y profile_locations'::text,
    md5((select coalesce(string_agg(format('%s:%s:%s', id, role, is_active), '|' order by id), '') from public.profiles)
        || '#' || (select coalesce(string_agg(row(pl.*)::text, '|' order by row(pl.*)::text), '') from public.profile_locations pl));
  return query select 'permisos · filas de bitacora_permisos'::text, (select count(*)::text from public.bitacora_permisos);
  -- Claves FE: largo 50, consecutivo = el de la fila y misma cantidad de claves distintas
  return query select 'clave FE · pos_ndf_tickets (largo 50, consecutivo igual, distintas)'::text,
    (select format('%s:%s:%s', count(*) filter (where length(clave_fe) = 50),
                   count(*) filter (where substr(clave_fe, 22, 20) = consecutivo_fe), count(distinct clave_fe))
       from public.pos_ndf_tickets);
  return query select 'clave FE · documents (largo 50, distintas)'::text,
    (select format('%s:%s', count(*) filter (where length(clave_fe) = 50), count(distinct clave_fe)) from public.documents);
  if to_regclass('public.fe_documentos') is not null then
    return query execute $q$select 'clave FE · fe_documentos (largo 50, consecutivo igual, distintas)'::text,
      format('%s:%s:%s', count(*) filter (where length(clave) = 50),
             count(*) filter (where substr(clave, 22, 20) = consecutivo), count(distinct clave)) from public.fe_documentos$q$;
  end if;
  -- Filas por tabla (ninguna fila se borra salvo las tablas que se vacían a propósito)
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and not exists (select 1 from _anon_clases k where k.tabla = c.relname and k.clase = 'vaciar_tabla')
            order by c.relname loop
    execute format('select count(*)::text from public.%I', t) into v;
    v_filas := v_filas || t || ':' || v || '|';
  end loop;
  return query select 'filas por tabla de public'::text, md5(v_filas);
end $$;
