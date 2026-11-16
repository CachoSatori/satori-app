-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 177 (origen caja 097) — El repo declara los tipos numéricos como están en PROD (céntimos y escalas)             ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema (sin efecto en prod). Firmado por el dueño por el chat: «177 Mergea».
--
-- ── POR QUÉ ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- 001_initial_schema.sql declara, p. ej., cash_movements.amount_crc y tip_entries.tip_amount_crc como NUMERIC(12,0),
-- pero en PROD son numeric(12,2) y ninguna migración del repo explica el cambio (se hizo a mano antes del baseline).
-- Lo mismo pasa con las tablas que 0095_drift_baseline crea «if not exists» con `numeric` sin escala (en prod ya
-- existían con escala). Una base armada desde el repo REDONDEA céntimos (12,0) o guarda escalas distintas a prod.
-- Comparación completa (todas las columnas numéricas de public; lectura en prod 15-nov 23:38 -06:00 contra una base
-- Postgres 16 armada con scripts/sql/local_armar_base.sh): 39 columnas con otro tipo. Detalle en
-- docs/pases/PASE-177-esquema-centimos.md.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Para cada columna de la lista: si la tabla y la columna existen y su tipo actual (format_type con typmod) NO es el
-- de prod, la lleva al tipo de prod. Si ya es el de prod, NO ejecuta nada (ni ALTER, ni reescritura, ni lock).
--  · En PROD todas ya tienen el tipo de destino: la migración solo lee el catálogo. Cero ALTER.
--  · Es idempotente: correrla dos veces no falla ni hace nada la segunda vez.
--  · Nunca redondea datos en silencio: antes de cada ALTER verifica que ningún valor cambie con el tipo nuevo; si
--    alguno cambiaría (o no entra), aborta con «177: …» y no cambia nada (todo el DO es una sola transacción).
--  · Con ALTERs reales (una base nueva), lock_timeout 5 s para no quedar esperando un lock.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni datos ni funciones ni sagrados. Ninguna vista ni política depende de estas columnas (verificado en prod y en
--    la base local: un ALTER ... TYPE no queda bloqueado).
--  · NO agrega las 5 columnas que existen en prod y faltan en el repo (cash_movements.amount_usd,
--    cash_sessions.initial_cash_crc/_usd, final_cash_crc/_usd): eso es otro tema (decisión aparte en el PASE).
--  · No usa begin/commit propios: el DO ya es atómico, y así las pruebas la corren dentro de su transacción.
--
-- Pruebas: scripts/sql/177_pruebas.sql (con 177_pruebas.sh: corre la batería y sus mutaciones en Postgres local).
-- Rollback: scripts/sql/177_rollback.sql (en prod no hay nada que deshacer).

do $m177$
declare
  -- tabla, columna, tipo en PROD (format_type exacto). El comentario dice qué declaraba el repo antes de la 177.
  v_lista constant text[][] := array[
    -- 001_initial_schema: (12,0) → los céntimos de prod
    ['cash_movements',      'amount_crc',            'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'initial_service_crc',   'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'initial_suppliers_crc', 'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'final_service_crc',     'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'final_suppliers_crc',   'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'final_safe_crc',        'numeric(12,2)'],   -- numeric(12,0)
    ['cash_sessions',       'final_bank_crc',        'numeric(12,2)'],   -- numeric(12,0)
    ['tip_entries',         'tip_amount_crc',        'numeric(12,2)'],   -- numeric(12,0)
    ['tip_entries',         'payout_crc',            'numeric(12,2)'],   -- numeric(12,0)
    -- 001_initial_schema: otras escalas
    ['tip_entries',         'tip_amount_usd',        'numeric(10,2)'],   -- numeric(8,2)
    ['tip_entries',         'points',                'numeric(10,4)'],   -- numeric(8,2)
    ['tip_entries',         'hours_worked',          'numeric(4,2)'],    -- numeric(4,1)
    ['role_tip_points',     'points',                'numeric(4,1)'],    -- integer
    -- 0095_drift_baseline (create table if not exists con numeric sin escala)
    ['cash_cierres_dia',    'vm_crc',                'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'vm_usd',                'numeric(8,2)'],    -- numeric
    ['cash_cierres_dia',    'propinas_m_crc',        'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'otros_m_crc',           'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'ef_real_m_crc',         'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'vn_crc',                'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'vn_usd',                'numeric(8,2)'],    -- numeric
    ['cash_cierres_dia',    'propinas_n_crc',        'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'otros_n_crc',           'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'ef_real_n_crc',         'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'sep_diaria_crc',        'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'sep_diaria_usd',        'numeric(8,2)'],    -- numeric
    ['cash_cierres_dia',    'sep_registradora_crc',  'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'sep_registradora_usd',  'numeric(8,2)'],    -- numeric
    ['cash_cierres_dia',    'remanente_crc',         'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'remanente_usd',         'numeric(8,2)'],    -- numeric
    ['cash_cierres_dia',    'diferencia_crc',        'numeric(12,2)'],   -- numeric
    ['cash_cierres_dia',    'tipo_cambio',           'numeric(8,2)'],    -- numeric
    ['ingredients',         'cost_per_unit',         'numeric(12,2)'],   -- numeric
    ['ingredients',         'current_stock',         'numeric(12,3)'],   -- numeric
    ['ingredients',         'min_stock',             'numeric(12,3)'],   -- numeric
    ['inventory_movements', 'qty_delta',             'numeric(12,3)'],   -- numeric
    ['inventory_movements', 'unit_cost',             'numeric(12,2)'],   -- numeric
    ['recipes',             'yield_qty',             'numeric(10,3)'],   -- numeric
    ['recipe_ingredients',  'quantity',              'numeric(12,4)'],   -- numeric
    ['recipe_ingredients',  'waste_factor',          'numeric(5,4)']     -- numeric
  ];
  i int;
  v_tabla text; v_col text; v_tipo text; v_actual text; v_malos bigint;
  v_lock_puesto boolean := false;
  v_cambios int := 0;
begin
  for i in 1 .. array_length(v_lista, 1) loop
    v_tabla := v_lista[i][1]; v_col := v_lista[i][2]; v_tipo := v_lista[i][3];

    select format_type(a.atttypid, a.atttypmod) into v_actual
      from pg_attribute a
     where a.attrelid = to_regclass('public.' || quote_ident(v_tabla))
       and a.attname = v_col and a.attnum > 0 and not a.attisdropped;

    if v_actual is null then
      raise notice '177: public.%.% no existe: se salta', v_tabla, v_col;
      continue;
    end if;
    if v_actual = v_tipo then
      continue;                         -- ya es el tipo de prod: no se ejecuta nada (así en PROD, para las 39)
    end if;

    -- nunca redondear en silencio: si algún valor cambia (o no entra) con el tipo nuevo, se aborta
    begin
      execute format('select count(*) from public.%I where %I is not null and %I::%s <> %I',
                     v_tabla, v_col, v_col, v_tipo, v_col) into v_malos;
    exception when numeric_value_out_of_range then
      raise exception '177: public.%.% tiene valores que no entran en % (se aborta, nada cambia)', v_tabla, v_col, v_tipo;
    end;
    if v_malos > 0 then
      raise exception '177: public.%.% tiene % valores que se redondearían con % (se aborta, nada cambia)',
        v_tabla, v_col, v_malos, v_tipo;
    end if;

    if not v_lock_puesto then
      perform set_config('lock_timeout', '5s', true);
      v_lock_puesto := true;
    end if;
    execute format('alter table public.%I alter column %I type %s using %I::%s',
                   v_tabla, v_col, v_tipo, v_col, v_tipo);
    v_cambios := v_cambios + 1;
    raise notice '177: public.%.%: % → %', v_tabla, v_col, v_actual, v_tipo;
  end loop;

  -- verificación final: toda columna de la lista que existe quedó con el tipo de prod
  for i in 1 .. array_length(v_lista, 1) loop
    select format_type(a.atttypid, a.atttypmod) into v_actual
      from pg_attribute a
     where a.attrelid = to_regclass('public.' || quote_ident(v_lista[i][1]))
       and a.attname = v_lista[i][2] and a.attnum > 0 and not a.attisdropped;
    if v_actual is not null and v_actual <> v_lista[i][3] then
      raise exception '177: public.%.% quedó en % (se esperaba %)', v_lista[i][1], v_lista[i][2], v_actual, v_lista[i][3];
    end if;
  end loop;

  raise notice '177: % columnas cambiadas (0 = ya estaban como prod)', v_cambios;
end
$m177$;
