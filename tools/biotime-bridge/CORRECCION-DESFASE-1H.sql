-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ CORRECCIÓN DEL DESFASE DE 1 HORA en `public.time_punches` — PILOTO v3                  ║
-- ║ ⚠ NO EJECUTADO. Lo corre Ismael, después de que el asesor lo revise.                   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Esto NO es una migración: no crea, no altera ni borra nada del esquema. Es una corrección
-- de DATOS, puntual y acotada, sobre marcas que ya quedaron guardadas corridas.
--
-- ── QUÉ PASÓ ───────────────────────────────────────────────────────────────────────────────
-- `public.iclock_transaction.punch_time` de BioTime es un `timestamp` NAIVE (reloj de pared,
-- sin zona). El agente local lo dejaba parsear por `pg`, que lo convertía a `Date` usando la
-- zona del PROCESO — o sea, la que tenga configurada la PC del reloj. Con esa PC en una zona
-- UTC−5 (o en una zona CON horario de verano, que en agosto corre a UTC−5), cada marca se
-- guardó **1 hora antes** del instante real. Costa Rica es UTC−6 FIJO, sin horario de verano.
--
-- El código YA está arreglado (tools/biotime-bridge/src/db.ts + src/fetchPunches.ts): el
-- offset −06:00 ahora es explícito y no depende de la PC. Las marcas NUEVAS entran bien.
-- Este script es solo para las VIEJAS.
--
-- ── POR QUÉ NO ALCANZA CON RE-INGESTAR ─────────────────────────────────────────────────────
-- `ingest-punches` inserta con `on conflict (local, biotime_id) do nothing`: volver a correr
-- el agente desde `last_id = 0` NO pisa lo que ya está. Y `time_punches.raw` tampoco sirve de
-- rescate: el agente guardaba ahí el instante YA convertido, no el texto crudo de BioTime, así
-- que la hora original no quedó en la fila. Por eso la corrección es un corrimiento con
-- testigos, y no una relectura.
-- (La alternativa sería borrar el rango y re-ingestar desde el agente ya arreglado. Es más
--  destructiva y deja huecos si el agente falla a mitad; queda como plan B.)
--
-- ── CÓMO SE CORRE ──────────────────────────────────────────────────────────────────────────
--   1. Confirmar el proyecto:  cat supabase/.temp/project-ref     (staging = hwiatgicyyqyezqwldia)
--   2. Correrlo TAL CUAL: termina en ROLLBACK y no cambia nada. Leer los NOTICE.
--   3. Si los conteos y los testigos cierran, cambiar el ROLLBACK final por COMMIT y repetir.
--   4. Después del COMMIT, recalcular las horas del período desde la app
--      (Salarios → Horas → «Recalcular»), o:
--        select public.derivar_work_days('2026-08-01','2026-08-31','santa-teresa');
--      Ojo: `derivar_work_days` NO pisa `work_days` con `source='manual'`. Los días que alguien
--      corrigió a mano MIENTRAS la app mostraba la hora corrida hay que revisarlos uno por uno:
--      la consulta del paso 6 los lista.
--
-- ⚠ PROD va aparte y con firma. Este script no distingue: corre sobre la base a la que estés
--   conectado. Verificá el project-ref antes.

\set ON_ERROR_STOP on

begin;

-- ── Parámetros ─────────────────────────────────────────────────────────────────────────────
-- `hasta_synced_at` = el momento en que se desplegó el agente arreglado. TODO lo ingerido
-- ANTES está corrido; lo de después ya entra bien. Poner la fecha/hora real del despliegue:
-- si se deja muy tarde, se corren marcas que ya estaban bien (y quedan 1 h adelantadas).
create temp table _param on commit drop as
select
  'santa-teresa'::text                              as local,
  interval '1 hour'                                 as corrimiento,
  timestamptz '2026-09-01 00:00:00-06:00'           as hasta_synced_at;   -- ⚠ AJUSTAR

-- ── 1. Conteos ANTES ───────────────────────────────────────────────────────────────────────
do $$
declare p record; n_total bigint; n_afect bigint; v_min timestamptz; v_max timestamptz;
begin
  select * into p from _param;

  select count(*) into n_total from public.time_punches where local = p.local;

  select count(*), min(punch_at), max(punch_at) into n_afect, v_min, v_max
    from public.time_punches
   where local = p.local and synced_at < p.hasta_synced_at;

  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'ANTES · local=%  ·  corrimiento=+%', p.local, p.corrimiento;
  raise notice '  marcas del local (todas):        %', n_total;
  raise notice '  marcas a corregir (synced_at <): %', n_afect;
  raise notice '  rango actual de punch_at:        % → %', v_min, v_max;
  raise notice '  (en hora CR: % → %)',
    to_char(v_min at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI'),
    to_char(v_max at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI');

  if n_afect = 0 then
    raise exception 'No hay marcas para corregir. ¿`hasta_synced_at` está bien? Nada que hacer.';
  end if;
end $$;

-- ── 2. LA GUARDA DE TESTIGOS ───────────────────────────────────────────────────────────────
-- Cinco marcas que Ismael verificó A MANO contra la pantalla de BioTime (BioTime = correcto).
-- Si HOY están exactamente 1 hora antes de esa hora, el diagnóstico está confirmado y el
-- corrimiento es el correcto. Si aunque sea UNA no cuadra, se aborta: puede que el desfase sea
-- otro, que alguien ya haya corrido esto, o que estas marcas no sean las que creemos.
create temp table _testigos (emp_code text, hora_biotime timestamp, estado text) on commit drop;
insert into _testigos values
  ('4',  timestamp '2026-08-16 11:05:00', 'in'),    -- Fran   · entrada
  ('4',  timestamp '2026-08-16 16:08:00', 'out'),   -- Fran   · salida
  ('10', timestamp '2026-08-20 16:01:00', 'in'),    -- Lester · entrada
  ('10', timestamp '2026-08-20 22:03:00', 'out'),   -- Lester · salida
  ('25', timestamp '2026-08-16 19:04:00', 'in');    -- Ampi   · entrada

do $$
declare p record; t record; v_ok int := 0; v_mal int := 0; v_hay int; v_ya int;
begin
  select * into p from _param;

  for t in select * from _testigos loop
    -- ¿Existe la marca en la posición CORRIDA (hora de BioTime − 1 h)? Tolerancia ±2 min
    -- porque el minuto que muestra BioTime puede redondear los segundos.
    select count(*) into v_hay
      from public.time_punches tp
     where tp.local = p.local
       and tp.emp_code = t.emp_code
       and tp.punch_state = t.estado
       and tp.punch_at between
             ((t.hora_biotime at time zone 'America/Costa_Rica') - p.corrimiento - interval '2 min')
         and ((t.hora_biotime at time zone 'America/Costa_Rica') - p.corrimiento + interval '2 min');

    -- ¿Y ya existe en la posición CORRECTA? Si sí, esto ya se corrió: NO correrlo de nuevo.
    select count(*) into v_ya
      from public.time_punches tp
     where tp.local = p.local
       and tp.emp_code = t.emp_code
       and tp.punch_state = t.estado
       and tp.punch_at between
             ((t.hora_biotime at time zone 'America/Costa_Rica') - interval '2 min')
         and ((t.hora_biotime at time zone 'America/Costa_Rica') + interval '2 min');

    if v_ya > 0 then
      raise exception
        'TESTIGO % (%) YA está en la hora correcta (% CR). Esta corrección parece haberse aplicado. ABORTA.',
        t.emp_code, t.estado, to_char(t.hora_biotime, 'YYYY-MM-DD HH24:MI');
    end if;

    if v_hay > 0 then
      v_ok := v_ok + 1;
      raise notice '  ✓ testigo emp_code=% % · BioTime % · guardada 1 h antes, como se esperaba',
        t.emp_code, t.estado, to_char(t.hora_biotime, 'YYYY-MM-DD HH24:MI');
    else
      v_mal := v_mal + 1;
      raise warning '  ✗ testigo emp_code=% % · BioTime % · NO aparece 1 h antes',
        t.emp_code, t.estado, to_char(t.hora_biotime, 'YYYY-MM-DD HH24:MI');
    end if;
  end loop;

  raise notice 'TESTIGOS · % de % confirman el corrimiento de 1 hora', v_ok, v_ok + v_mal;

  -- Todos o ninguno: un desfase SISTEMÁTICO tiene que verse en las cinco.
  if v_mal > 0 then
    raise exception
      'ABORTA: % testigo(s) no confirman el desfase. NO se corrige nada hasta entender por qué.', v_mal;
  end if;
end $$;

-- ── 3. Fotografía de lo que se va a mover (para poder comparar después) ────────────────────
create temp table _antes on commit drop as
select tp.id, tp.emp_code, tp.punch_at, tp.punch_state,
       (tp.punch_at at time zone 'America/Costa_Rica')::date as dia_civil_cr,
       ((tp.punch_at at time zone 'America/Costa_Rica')
         - coalesce((select corte_jornada::interval from public.payroll_config pc
                      where pc.local = tp.local), interval '05:00'))::date as jornada
  from public.time_punches tp, _param p
 where tp.local = p.local and tp.synced_at < p.hasta_synced_at;

-- ── 4. EL UPDATE ───────────────────────────────────────────────────────────────────────────
-- Solo `punch_at`. `raw` se deja intacto a propósito: es la evidencia de lo que se recibió, aun
-- estando mal. No se toca `work_days`, ni `punch_exceptions`, ni ninguna otra tabla.
update public.time_punches tp
   set punch_at = tp.punch_at + p.corrimiento
  from _param p
 where tp.local = p.local
   and tp.synced_at < p.hasta_synced_at;

-- ── 5. Conteos DESPUÉS + re-verificación de los testigos ──────────────────────────────────
do $$
declare p record; t record; n bigint; v_min timestamptz; v_max timestamptz; v_hay int; v_mal int := 0;
begin
  select * into p from _param;

  select count(*), min(punch_at), max(punch_at) into n, v_min, v_max
    from public.time_punches
   where local = p.local and synced_at < p.hasta_synced_at;

  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'DESPUÉS · marcas movidas: %', n;
  raise notice '  rango nuevo (hora CR): % → %',
    to_char(v_min at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI'),
    to_char(v_max at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI');

  for t in select * from _testigos loop
    select count(*) into v_hay
      from public.time_punches tp
     where tp.local = p.local and tp.emp_code = t.emp_code and tp.punch_state = t.estado
       and tp.punch_at between
             ((t.hora_biotime at time zone 'America/Costa_Rica') - interval '2 min')
         and ((t.hora_biotime at time zone 'America/Costa_Rica') + interval '2 min');
    if v_hay > 0 then
      raise notice '  ✓ emp_code=% % ahora coincide con BioTime (% CR)',
        t.emp_code, t.estado, to_char(t.hora_biotime, 'YYYY-MM-DD HH24:MI');
    else
      v_mal := v_mal + 1;
      raise warning '  ✗ emp_code=% % NO quedó en % CR', t.emp_code, t.estado,
        to_char(t.hora_biotime, 'YYYY-MM-DD HH24:MI');
    end if;
  end loop;

  if v_mal > 0 then
    raise exception 'ABORTA: el corrimiento no dejó a los testigos en la hora de BioTime.';
  end if;
end $$;

-- ── 6. Qué jornadas se movieron de día (lo que hay que recalcular / revisar) ───────────────
-- Correr 1 hora puede cambiar la JORNADA de una marca de madrugada (corte 05:00). Esta lista
-- son los días cuyas horas cambian sí o sí al recalcular.
do $$
declare v_cambia bigint; v_manual bigint; p record;
begin
  select * into p from _param;

  select count(*) into v_cambia
    from _antes a
    join public.time_punches tp on tp.id = a.id
   where ((tp.punch_at at time zone 'America/Costa_Rica')
           - coalesce((select corte_jornada::interval from public.payroll_config pc
                        where pc.local = p.local), interval '05:00'))::date <> a.jornada;

  -- Días con override MANUAL: `derivar_work_days` no los pisa, así que la corrección NO los
  -- alcanza. Son los que hay que mirar a mano, porque se cargaron viendo la hora corrida.
  select count(*) into v_manual
    from public.work_days wd
   where wd.local = p.local
     and wd.source = 'manual'
     and wd.work_date in (select distinct jornada from _antes);

  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'IMPACTO · marcas que cambian de JORNADA por el corrimiento: %', v_cambia;
  raise notice 'IMPACTO · work_days source=manual en jornadas afectadas:    %  ← REVISAR A MANO', v_manual;
  raise notice '  (el recálculo NO pisa lo manual: esos días quedan con el número que se cargó';
  raise notice '   mientras la app mostraba la hora corrida.)';
  raise notice '───────────────────────────────────────────────────────────────';
  raise notice 'Si todo cierra: cambiá el ROLLBACK final por COMMIT y volvé a correr.';
  raise notice 'Después: Salarios → Horas → Recalcular (o derivar_work_days del período).';
end $$;

-- ⚠ TAL CUAL ESTÁ, NO CAMBIA NADA. Cambiar por `commit;` recién después de leer los NOTICE.
rollback;
