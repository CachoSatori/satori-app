-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ RE-ENGANCHE de marcas huérfanas: time_punches.employee_id que quedó en NULL             ║
-- ║ ⚠ NO EJECUTADO. Lo corre Ismael, después de que el asesor lo revise.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- No es una migración: no crea ni altera nada del esquema. Es una corrección de DATOS.
--
-- ── QUÉ PASA ───────────────────────────────────────────────────────────────────────────────
-- `ingest-punches` resuelve `employee_id` EN EL MOMENTO DE INSERTAR (por
-- `employees.biotime_emp_code`). Si el código se carga en la ficha DESPUÉS de que las marcas
-- entraron, esas marcas se quedan con `employee_id = null` para siempre:
--   · `derivar_work_days` las excluye (`f1d_scope` pide `employee_id is not null`),
--   · siguen apareciendo en la bandeja como excepción `sin_mapear`,
--   · y esas horas no se le pagan a nadie.
-- Recalcular NO alcanza: la RPC lee `employee_id`, no `emp_code`.
--
-- Desde 2026-09 la app avisa de esto: la bandeja de Horas muestra «ya es de <NOMBRE> — las
-- marcas viejas quedaron sin enganchar» cuando el código YA está en una ficha. Asignar el
-- código otra vez desde la app no arregla las viejas — arregla las que entren después.
--
-- ── POR QUÉ NO LO HACE LA APP ──────────────────────────────────────────────────────────────
-- `time_punches` NO tiene policy de escritura para ningún usuario de la app (mig 057, a
-- propósito): solo la escribe la Edge Function con service-role. Así que esto va por SQL.
--
-- ── LAS DOS OPCIONES, Y POR QUÉ ESTA ───────────────────────────────────────────────────────
-- (A) Este script: rellenar `employee_id` donde el `emp_code` ya corresponde a alguien.
-- (B) Cambiar `derivar_work_days` para que resuelva por `emp_code` al derivar, en vez de
--     depender de `employee_id`. Es más robusto (nunca más vuelve a pasar) pero es una
--     MIGRACIÓN (062) y este pase es de 0 migraciones. Va propuesta en el reporte.
-- Las dos son compatibles: (A) arregla lo que ya está, (B) evita que se repita.
--
-- ── CÓMO SE CORRE ──────────────────────────────────────────────────────────────────────────
--   1. Confirmar el proyecto:  cat supabase/.temp/project-ref   (staging = hwiatgicyyqyezqwldia)
--   2. Correrlo TAL CUAL: termina en ROLLBACK y no cambia nada. Leer los NOTICE — sobre todo
--      la lista de «a quién se le va a acreditar cuántas marcas».
--   3. Si cierra, cambiar el ROLLBACK final por COMMIT y repetir.
--   4. Después: recalcular las horas del período (Salarios → Horas → «Recalcular»), o
--        select public.derivar_work_days('2026-08-01','2026-08-31','santa-teresa');
--      Recién ahí esas marcas se convierten en horas.
--
-- ⚠ Si además hace falta la corrección del desfase de 1 hora, corré PRIMERO
--   CORRECCION-DESFASE-1H.sql: mover las marcas puede cambiarles la jornada, y conviene
--   recalcular una sola vez, al final.

\set ON_ERROR_STOP on

begin;

-- ── 1. Qué se va a enganchar, y a quién ────────────────────────────────────────────────────
-- El match es en FORMA CANÓNICA (sin espacios, sin ceros a la izquierda si es numérico): el
-- mismo criterio que `normalizarCodigoBiotime` en src/shared/api/salarios.ts y `normCode` en
-- supabase/functions/ingest-punches/index.ts. Los tres tienen que decir lo mismo.
create temp table _match on commit drop as
with cod as (
  select
    e.id,
    e.full_name,
    case when btrim(e.biotime_emp_code) ~ '^[0-9]+$'
         then ltrim(btrim(e.biotime_emp_code), '0')
         else lower(btrim(e.biotime_emp_code))
    end as canon
  from public.employees e
  where coalesce(btrim(e.biotime_emp_code), '') <> ''
),
-- `ltrim('0','0')` da '' — el usuario 0 del reloj existe y no puede colapsar a "sin código".
cod2 as (
  select id, full_name, case when canon = '' then '0' else canon end as canon from cod
),
huerfanas as (
  select
    tp.id as punch_id,
    tp.local,
    tp.emp_code,
    tp.punch_at,
    case when btrim(tp.emp_code) ~ '^[0-9]+$'
         then coalesce(nullif(ltrim(btrim(tp.emp_code), '0'), ''), '0')
         else lower(btrim(tp.emp_code))
    end as canon
  from public.time_punches tp
  where tp.employee_id is null
    and coalesce(btrim(tp.emp_code), '') <> ''
)
select h.punch_id, h.local, h.emp_code, h.punch_at, c.id as employee_id, c.full_name
from huerfanas h
join cod2 c on c.canon = h.canon;

-- ── 2. GUARDA: un código canónico no puede ser de dos personas ─────────────────────────────
-- Si dos empleados tienen '4' y '04', el join de arriba duplicaría filas y le acreditaría
-- las mismas marcas a los dos. Antes que adivinar, se aborta.
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select punch_id from _match group by punch_id having count(distinct employee_id) > 1
  ) x;
  if v_dup > 0 then
    raise exception
      'ABORTA: % marca(s) matchean con MÁS DE UN empleado. Hay códigos duplicados en forma canónica (p.ej. "4" y "04"). Arreglá las fichas primero.',
      v_dup;
  end if;
end $$;

-- ── 3. Conteos ANTES, y a quién se le acredita qué ─────────────────────────────────────────
do $$
declare r record; n bigint; n_sin bigint;
begin
  select count(*) into n from _match;
  select count(*) into n_sin
    from public.time_punches
   where employee_id is null and coalesce(btrim(emp_code), '') <> '';

  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'ANTES · marcas sin empleado (con emp_code): %', n_sin;
  raise notice '        de esas, con match en una ficha:     %', n;
  raise notice '        quedan sin match (código de nadie):  %', n_sin - n;
  raise notice '';
  raise notice 'A QUIÉN SE LE ACREDITA:';
  for r in
    select full_name, emp_code, local, count(*) as marcas,
           min(punch_at) as primera, max(punch_at) as ultima
      from _match group by full_name, emp_code, local order by full_name
  loop
    raise notice '  · % (cód %) · % · % marca(s) · % → %',
      r.full_name, r.emp_code, r.local, r.marcas,
      to_char(r.primera at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI'),
      to_char(r.ultima  at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI');
  end loop;

  if n = 0 then
    raise exception 'No hay ninguna marca huérfana que matchee una ficha. Nada que hacer.';
  end if;
end $$;

-- ── 4. Los códigos que NO matchean: hay que cargarlos en una ficha primero ─────────────────
do $$
declare r record; hay boolean := false;
begin
  raise notice '';
  raise notice 'SIN MATCH (ninguna ficha tiene ese código — asignalo en Salarios → Horas):';
  for r in
    select tp.emp_code, tp.local, count(*) as marcas
      from public.time_punches tp
     where tp.employee_id is null
       and coalesce(btrim(tp.emp_code), '') <> ''
       and not exists (select 1 from _match m where m.punch_id = tp.id)
     group by tp.emp_code, tp.local
     order by tp.emp_code
  loop
    hay := true;
    raise notice '  · código % · % · % marca(s)', r.emp_code, r.local, r.marcas;
  end loop;
  if not hay then raise notice '  (ninguno)'; end if;
end $$;

-- ── 5. EL UPDATE ───────────────────────────────────────────────────────────────────────────
-- Solo `employee_id`, y SOLO donde estaba en null: nunca se le cambia el dueño a una marca
-- que ya lo tiene. `punch_at`, `emp_code` y `raw` quedan intactos — la marca cruda es
-- evidencia (mig 057).
update public.time_punches tp
   set employee_id = m.employee_id
  from _match m
 where tp.id = m.punch_id
   and tp.employee_id is null;

-- ── 6. Conteos DESPUÉS ─────────────────────────────────────────────────────────────────────
do $$
declare n_sin bigint; n_ok bigint;
begin
  select count(*) into n_sin
    from public.time_punches
   where employee_id is null and coalesce(btrim(emp_code), '') <> '';
  select count(*) into n_ok from _match m
    join public.time_punches tp on tp.id = m.punch_id
   where tp.employee_id = m.employee_id;

  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'DESPUÉS · marcas enganchadas: %', n_ok;
  raise notice '          siguen sin empleado: %  (códigos que ninguna ficha tiene)', n_sin;
  raise notice '';
  raise notice 'Si cierra: cambiá el ROLLBACK final por COMMIT y volvé a correr.';
  raise notice 'Después: Salarios → Horas → Recalcular. Recién ahí son horas.';
  raise notice 'Las excepciones sin_mapear ya RESUELTAS no se reabren (la 059 las silencia);';
  raise notice 'las ABIERTAS se borran y se recalculan solas.';
  raise notice '───────────────────────────────────────────────────────────────';
end $$;

-- ⚠ TAL CUAL ESTÁ, NO CAMBIA NADA. Cambiar por `commit;` recién después de leer los NOTICE.
rollback;
