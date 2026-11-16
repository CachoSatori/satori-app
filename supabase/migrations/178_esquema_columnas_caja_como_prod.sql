-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 178 (origen caja 098) — El repo declara las 5 columnas de Caja que existen en PROD y en ninguna migración       ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema (sin efecto en prod). Decisión del dueño por el chat (16-nov 06:45 -06:00): «177 firmo A».
--
-- ── POR QUÉ ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- El PASE-177 encontró 5 columnas que están en PROD (creadas a mano antes del baseline) y que ninguna migración del
-- repo crea: cash_movements.amount_usd y cash_sessions.initial_cash_crc / initial_cash_usd / final_cash_crc /
-- final_cash_usd. La app las usa todos los días (CashTurno abre y cierra el turno con ellas; los pagos guardan
-- amount_usd) y funciones del repo (071 y 074, cerrar_dia_completo; log_movement_edit) insertan o leen amount_usd. Una
-- base armada desde el repo no las tiene y esas funciones fallan.
--
-- Definición en PROD (yiczgdti…, pg_attribute/pg_attrdef, solo lectura, 16-nov-2026 -06:00):
--   columna                         tipo      null   default   comentario  constraints  índices
--   cash_movements.amount_usd       numeric   sí     0         —           —            —
--   cash_sessions.initial_cash_crc  numeric   sí     0         —           —            —
--   cash_sessions.initial_cash_usd  numeric   sí     0         —           —            —
--   cash_sessions.final_cash_crc    numeric   sí     (null)    —           —            —
--   cash_sessions.final_cash_usd    numeric   sí     (null)    —           —            —
-- Sin ACL por columna. Ninguna vista ni política las usa.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Para cada columna: si NO existe, `alter table … add column if not exists` con el tipo, el default y la nullability
-- EXACTOS de prod. Si ya existe, NO ejecuta nada (ni ALTER ni lock de tabla: un ALTER TABLE toma el lock exclusivo
-- aunque la columna ya exista, por eso se mira el catálogo antes). Al final verifica que las 5 quedaron como prod; si
-- alguna existe con otra definición, aborta con «178: …» y no cambia nada (todo el DO es una sola transacción).
--  · En PROD las 5 ya existen con esa definición: la migración solo lee el catálogo. Cero ALTER, cero locks de tabla.
--  · Idempotente: correrla dos veces no falla ni hace nada la segunda vez.
--  · Con ALTERs reales (una base nueva), lock_timeout 5 s.
--  · En una base nueva las columnas quedan al final de la tabla (en prod están en otra posición): no importa, nadie
--    depende del orden de las columnas.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
-- Ni datos, ni funciones, ni políticas, ni sagrados. No agrega comentarios (prod no los tiene). No usa begin/commit
-- propios: el DO ya es atómico, y así las pruebas la corren dentro de su transacción.
--
-- Pruebas: scripts/sql/178_pruebas.sql (con 178_pruebas.sh: corre la batería y sus mutaciones en Postgres local).
-- Rollback: scripts/sql/178_rollback.sql (en prod no hay nada que deshacer).

do $m178$
declare
  -- tabla, columna, tipo en PROD (format_type exacto), default en PROD (pg_get_expr; '' = sin default). Todas nullable.
  v_lista constant text[][] := array[
    ['cash_movements', 'amount_usd',       'numeric', '0'],
    ['cash_sessions',  'initial_cash_crc', 'numeric', '0'],
    ['cash_sessions',  'initial_cash_usd', 'numeric', '0'],
    ['cash_sessions',  'final_cash_crc',   'numeric', ''],
    ['cash_sessions',  'final_cash_usd',   'numeric', '']
  ];
  i int;
  v_tabla text; v_col text; v_tipo text; v_def text;
  v_rel regclass; v_existe boolean;
  v_actual text; v_nonull boolean; v_def_actual text;
  v_lock_puesto boolean := false;
  v_cambios int := 0;
begin
  for i in 1 .. array_length(v_lista, 1) loop
    v_tabla := v_lista[i][1]; v_col := v_lista[i][2]; v_tipo := v_lista[i][3]; v_def := v_lista[i][4];
    v_rel := to_regclass('public.' || quote_ident(v_tabla));
    if v_rel is null then
      raise exception '178: falta la tabla public.% (se aborta, nada cambia)', v_tabla;
    end if;

    select true into v_existe
      from pg_attribute a
     where a.attrelid = v_rel and a.attname = v_col and a.attnum > 0 and not a.attisdropped;

    if coalesce(v_existe, false) then
      v_existe := null;
      continue;                         -- ya existe: no se ejecuta nada (así en PROD, para las 5)
    end if;

    if not v_lock_puesto then
      perform set_config('lock_timeout', '5s', true);
      v_lock_puesto := true;
    end if;
    execute format('alter table public.%I add column if not exists %I %s%s',
                   v_tabla, v_col, v_tipo, case when v_def <> '' then ' default ' || v_def else '' end);
    v_cambios := v_cambios + 1;
    raise notice '178: public.%.% agregada (% default %)', v_tabla, v_col, v_tipo, coalesce(nullif(v_def, ''), 'null');
  end loop;

  -- verificación final: las 5 existen y son idénticas a prod (tipo, nullable, default, sin identity ni generada)
  for i in 1 .. array_length(v_lista, 1) loop
    v_tabla := v_lista[i][1]; v_col := v_lista[i][2]; v_tipo := v_lista[i][3]; v_def := v_lista[i][4];
    v_actual := null; v_nonull := null; v_def_actual := null;
    select format_type(a.atttypid, a.atttypmod), a.attnotnull or a.attidentity <> '' or a.attgenerated <> '',
           coalesce(pg_get_expr(d.adbin, d.adrelid), '')
      into v_actual, v_nonull, v_def_actual
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = to_regclass('public.' || quote_ident(v_tabla))
       and a.attname = v_col and a.attnum > 0 and not a.attisdropped;
    if v_actual is null then
      raise exception '178: public.%.% no quedó creada', v_tabla, v_col;
    end if;
    if v_actual <> v_tipo or v_nonull or v_def_actual <> v_def then
      raise exception '178: public.%.% existe distinta a prod: % %, default «%» (prod: % null, default «%»). Se aborta, nada cambia',
        v_tabla, v_col, v_actual, case when v_nonull then 'not null/identity/generada' else 'null' end, v_def_actual, v_tipo, v_def;
    end if;
  end loop;

  raise notice '178: % columnas agregadas (0 = ya estaban como prod)', v_cambios;
end
$m178$;
