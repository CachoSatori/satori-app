-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 059 — BioTime F1d: derivación de horas. `time_punches` → `work_days` + excepciones.    ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
-- ⚠ Número 059: verificado libre — el ledger de staging va 001–058 contiguo (058 = U0b) al 2026-08-23.
--
-- Cierra la Fase 1 del puente: F1a (057) creó las tablas, F1b la Edge Function, F1c el agente
-- (22.403 marcas de Santa Teresa ya en `time_punches`). Faltaba lo único que convierte marcas en
-- algo que sirva para pagar: emparejar in/out por jornada y escribir las HORAS.
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- UNA función: `derivar_work_days(p_desde, p_hasta, p_local)`. Sin tablas, sin columnas, sin RLS
-- nueva: `work_days` (056), `punch_exceptions` y `payroll_config` (057) YA EXISTEN.
--
-- ⚠ 2026-08-23: la función se EDITÓ en esta misma migración (regla de las 3 h del día sin par).
--   Es `create or replace` y la 059 ya estaba en el ledger de staging, así que se re-aplicó el
--   archivo por `db query --linked -f` sin tocar `schema_migrations`. Antes de llevarla a prod,
--   la 059 que viaja es ESTA (la de las 3 h), no la primera versión.
--
-- ── LO QUE NO HACE ─────────────────────────────────────────────────────────────────────────
-- NO calcula plata. Ni tarifas, ni 10% de servicio, ni propinas, ni netos (eso es la Fase 2).
-- Solo HORAS. No toca Caja · Tips · POS · Proveedores · los sagrados · `posFiscal` · realtime.
-- No toca `time_punches`: la marca cruda es evidencia y queda intacta (057).

-- ── EL EMPAREJAMIENTO, Y POR QUÉ ES SET-BASED ──────────────────────────────────────────────
-- El algoritmo firmado es un recorrido secuencial con un "in abierto":
--   · `in` con in abierto previo  → el PREVIO queda `solapado`, se abre el nuevo.
--   · `out` con in abierto        → par: suma (out − in), cierra.
--   · `out` sin in abierto        → `impar`.
--   · in abierto al final         → `impar`.
-- Ese autómata resulta ser PURAMENTE LOCAL dentro de la jornada: lo único que decide el destino de
-- una marca es su vecina inmediata en el orden temporal. Se puede probar caso por caso:
--   in,in,out  → el out empareja con el in2 (su anterior) y el in1 (seguido de otro in) es solapado.
--   in,out,in  → par + el último in (sin siguiente) es impar.
--   out,in,out → el out1 (sin anterior) es impar + par.
-- Por eso se implementa con `lag`/`lead` en vez de un LOOP: mismo resultado, una sola pasada, y sin
-- 300 `insert` fila por fila sobre 22.403 marcas. La equivalencia es la tabla de arriba, no una
-- optimización a ojo.
--
-- ── LA JORNADA (A1) ────────────────────────────────────────────────────────────────────────
-- `work_date = (punch_at AT TIME ZONE 'America/Costa_Rica' − corte)::date`, con el corte de
-- `payroll_config` del local (default 05:00). Una marca de las 02:00 CR pertenece a la jornada del
-- día ANTERIOR — así el turno que cierra de madrugada no se parte en dos días civiles y su `out`
-- cae en la MISMA jornada que su `in`, que es lo que hace que el par exista.
-- Costa Rica no tiene horario de verano (UTC−6 fijo), así que la conversión no tiene bordes.

create or replace function public.derivar_work_days(
  p_desde date,
  p_hasta date,
  p_local text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_corte    interval;
  v_umbral   numeric;
  v_ini_ts   timestamptz;
  v_fin_ts   timestamptz;
  v_dias     int := 0;
  v_omitidos int := 0;
  v_3h       int := 0;
  v_horas    numeric := 0;
  v_marcas   int := 0;
  v_impar    int := 0;
  v_largo    int := 0;
  v_solap    int := 0;
  v_sinmap   int := 0;
begin
  -- Auth: mismo trío que la RLS de work_days/punch_exceptions (mig 056/057). El contador arma la
  -- nómina, así que también recalcula. SECURITY DEFINER porque `punch_exceptions` no tiene policy
  -- de insert a propósito (057): las genera esta función, no una pantalla.
  -- El `coalesce` no es adorno: `get_my_role()` devuelve NULL si el que llama no tiene fila en
  -- `profiles`, y `NULL not in (...)` es NULL → el `if` no dispara y el guard se abre solo. Con el
  -- coalesce, "sin rol" cae en el else y rebota. (Las RPC viejas —054— no lo tienen; acá sí.)
  if coalesce(get_my_role()::text, '') not in ('owner','manager','contador') then
    raise exception 'No autorizado para derivar horas';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'El rango de fechas es obligatorio';
  end if;
  if p_hasta < p_desde then
    raise exception 'Rango inválido: % → %', p_desde, p_hasta;
  end if;
  if coalesce(btrim(p_local), '') = '' then
    raise exception 'El local es obligatorio';
  end if;

  -- Config del local. Si el local no tiene fila, los defaults de A1 (05:00 / 12h).
  select corte_jornada::interval, umbral_turno_largo_h
    into v_corte, v_umbral
  from payroll_config
  where local = p_local;

  v_corte  := coalesce(v_corte, '05:00'::interval);
  v_umbral := coalesce(v_umbral, 12);

  -- Ventana en instantes, equivalente EXACTA al filtro por `work_date` pero apoyada en el índice de
  -- `punch_at`: la jornada D va de D+corte a (D+1)+corte, hora de Costa Rica.
  v_ini_ts := (p_desde::timestamp + v_corte)       at time zone 'America/Costa_Rica';
  v_fin_ts := ((p_hasta + 1)::timestamp + v_corte) at time zone 'America/Costa_Rica';

  -- ── Idempotencia ─────────────────────────────────────────────────────────────────────────
  -- Recalcular el mismo rango dos veces tiene que dar lo mismo, no el doble.
  --   · `work_days`: se borran SOLO las filas `source='biotime'` del local y rango. Las
  --     `source='manual'` (carga de U0b, overrides de la bandeja) NO SE TOCAN NUNCA.
  --   · `punch_exceptions`: se borran solo las ABIERTAS. Las `resuelta` quedan como rastro (057) y
  --     además actúan de silenciador: más abajo, una excepción ya resuelta para el mismo
  --     (tipo, empleado/código, jornada) impide que el recálculo la vuelva a abrir. Sin eso, cada
  --     recálculo resucitaría todo lo que alguien ya revisó a mano.
  delete from work_days
   where local = p_local
     and source = 'biotime'
     and work_date between p_desde and p_hasta;

  delete from punch_exceptions
   where local = p_local
     and estado = 'abierta'
     and work_date between p_desde and p_hasta;

  -- ── Alcance: las marcas del local en el rango, anotadas con su jornada y sus vecinas ─────
  drop table if exists pg_temp.f1d_scope;
  create temp table f1d_scope on commit drop as
  with j as (
    select
      tp.id,
      tp.employee_id,
      tp.emp_code,
      tp.punch_at,
      tp.punch_state,
      ((tp.punch_at at time zone 'America/Costa_Rica') - v_corte)::date as work_date
    from time_punches tp
    where tp.local = p_local
      and tp.punch_at >= v_ini_ts
      and tp.punch_at <  v_fin_ts
  )
  select
    j.*,
    lag(j.punch_state)  over w as prev_state,
    lag(j.punch_at)     over w as prev_at,
    lag(j.id)           over w as prev_id,
    lead(j.punch_state) over w as next_state
  from j
  where j.work_date between p_desde and p_hasta
    and j.employee_id is not null
  window w as (partition by j.employee_id, j.work_date order by j.punch_at, j.id);

  select count(*) into v_marcas from pg_temp.f1d_scope;

  -- ── Los pares cerrados (out con in inmediatamente anterior) ──────────────────────────────
  drop table if exists pg_temp.f1d_pares;
  create temp table f1d_pares on commit drop as
  select
    s.employee_id,
    s.work_date,
    s.prev_id as punch_in,
    s.id      as punch_out,
    s.prev_at as in_at,
    s.punch_at as out_at,
    round((extract(epoch from (s.punch_at - s.prev_at)) / 3600.0)::numeric, 2) as horas
  from pg_temp.f1d_scope s
  where s.punch_state = 'out' and s.prev_state = 'in';

  -- ── work_days ────────────────────────────────────────────────────────────────────────────
  -- Una fila por (empleado, jornada) con marcas. `hours` = Σ de los pares, en horas decimales.
  --
  -- ── LA REGLA DE LAS 3 HORAS (firmada por Ismael el 2026-08-23) ───────────────────────────
  -- Antes, un día sin ningún par cerrado valía 0 h: el que fichó la entrada y se olvidó de la
  -- salida trabajaba gratis hasta que alguien lo corrigiera a mano. Ahora:
  --   · día con AL MENOS UN par → `hours` = Σ pares. Un impar suelto NO baja el día: si hubo
  --     medición real, manda la medición.
  --   · día con marcas y NINGÚN par (una sola marca, dos `in` sin `out`, etc.) → `hours` = 3.
  -- Las 3 h son un DEFAULT CORREGIBLE, no una medición ni una sentencia: `flags.horas_origen`
  -- lo dice explícito (`3h_default_impar`) para que el contador —y el comprobante de la Fase 2—
  -- sepan que ese número hay que mirarlo, y la excepción `impar`/`solapado` se genera igual.
  -- Quien tenga el dato real lo pisa desde la bandeja (override `source='manual'`).
  -- ⚠ Es una POLÍTICA laboral, no una decisión técnica: puede quedar por debajo de lo realmente
  --   trabajado. Ismael la valida con su contador/abogado.
  --
  -- ⚠ DOS LÍMITES CONOCIDOS de la regla, que la bandeja tiene que seguir mostrando:
  --   1. Un turno que CRUZA el corte sin cerrar se parte en dos jornadas sin par y pasa a valer
  --      3 + 3 = 6 h. Antes valía 0 y frenaba el pago; ahora da un número plausible. Por eso las
  --      excepciones `impar` se siguen generando Y la pantalla de pago avisa las jornadas a 3 h
  --      leyendo `flags.horas_origen` (que es permanente) en vez del estado de la excepción
  --      (que alguien puede resolver sin tocar las horas).
  --   2. Una marca espuria en un día no trabajado también acredita 3 h. Se corrige con el
  --      override de la bandeja (que escribe 0 h manuales y el recálculo ya no pisa).
  -- El número vive hardcodeado acá y en `HORAS_DEFAULT_IMPAR` (src/shared/api/salarios.ts); un
  -- test los ATA leyendo este archivo, así que mover uno solo rompe el build. El lugar natural
  -- para cuando la política se estabilice es `payroll_config` (ya es por local, ya guarda
  -- corte_jornada y umbral_turno_largo_h) — se dejó fuera hasta que el contador la confirme.
  --
  -- `on conflict do nothing` es la otra mitad de "nunca tocar lo manual": si ya hay una fila
  -- MANUAL para ese (empleado, jornada, local) —el total del período que carga U0b, o un override
  -- de la bandeja— la derivación NO la pisa. Esas jornadas se cuentan aparte y vuelven en el
  -- resumen como `dias_omitidos_manual`, porque son exactamente los días donde el total del
  -- período podría contarse dos veces (manual + biotime) y alguien tiene que mirarlos.
  with agg as (
    select
      s.employee_id,
      s.work_date,
      count(*)                                                       as marcas,
      count(*) filter (where s.punch_state = 'in'  and s.next_state = 'in')                   as solapados,
      count(*) filter (where s.punch_state = 'in'  and s.next_state is null)                  as impar_in,
      count(*) filter (where s.punch_state = 'out' and (s.prev_state is null or s.prev_state = 'out')) as impar_out
    from pg_temp.f1d_scope s
    group by s.employee_id, s.work_date
  ),
  hrs as (
    select employee_id, work_date,
           count(*) as pares,
           sum(horas) as horas,
           count(*) filter (where horas > v_umbral) as largos
    from pg_temp.f1d_pares
    group by employee_id, work_date
  ),
  calc as (
    select
      a.*,
      coalesce(h.pares, 0)  as pares,
      coalesce(h.horas, 0)  as horas_pares,
      coalesce(h.largos, 0) as largos,
      coalesce(h.pares, 0) > 0 as tiene_par
    from agg a
    left join hrs h on h.employee_id = a.employee_id and h.work_date = a.work_date
  ),
  ins as (
    insert into work_days (employee_id, work_date, local, hours, source, flags)
    select
      c.employee_id,
      c.work_date,
      p_local,
      case when c.tiene_par then c.horas_pares else 3 end,
      'biotime',
      jsonb_build_object(
        'marcas',       c.marcas,
        'pares',        c.pares,
        'impares',      c.impar_in + c.impar_out,
        'solapados',    c.solapados,
        'turno_largo',  c.largos,
        -- El origen del número, explícito: medido o puesto por la regla.
        'horas_origen', case when c.tiene_par then 'biotime' else '3h_default_impar' end
      )
    from calc c
    on conflict (employee_id, work_date, local) do nothing
    returning (flags->>'horas_origen') as origen
  )
  select
    (select count(*) from ins),
    (select count(*) from agg) - (select count(*) from ins),
    (select count(*) from ins where origen = '3h_default_impar')
    into v_dias, v_omitidos, v_3h;

  select coalesce(sum(hours), 0) into v_horas
    from work_days
   where local = p_local and source = 'biotime'
     and work_date between p_desde and p_hasta;

  -- ── Excepciones ──────────────────────────────────────────────────────────────────────────
  -- El `not exists` es el silenciador: si alguien YA resolvió esa misma excepción para esa misma
  -- jornada, el recálculo no la vuelve a abrir.

  -- impar: un `out` sin entrada abierta, o un `in` que nunca cerró.
  with cand as (
    select s.employee_id, s.work_date, s.id, s.punch_at, s.punch_state
    from pg_temp.f1d_scope s
    where (s.punch_state = 'out' and (s.prev_state is null or s.prev_state = 'out'))
       or (s.punch_state = 'in'  and s.next_state is null)
  ),
  ins as (
    insert into punch_exceptions (employee_id, emp_code, work_date, local, tipo, detalle, estado)
    select
      c.employee_id,
      null,
      c.work_date,
      p_local,
      'impar',
      jsonb_build_object(
        'marcas', jsonb_agg(jsonb_build_object('id', c.id, 'punch_at', c.punch_at, 'punch_state', c.punch_state)
                            order by c.punch_at),
        'cuantas', count(*)
      ),
      'abierta'
    from cand c
    group by c.employee_id, c.work_date
    having not exists (
      select 1 from punch_exceptions e
       where e.estado = 'resuelta' and e.tipo = 'impar' and e.local = p_local
         and e.work_date = c.work_date and e.employee_id = c.employee_id
    )
    returning 1
  )
  select count(*) into v_impar from ins;

  -- turno_largo: el par cerró pero dura más que el umbral. COMPUTA IGUAL (ya está en `hours`):
  -- la excepción solo levanta la bandera para que alguien lo mire.
  with ins as (
    insert into punch_exceptions (employee_id, emp_code, work_date, local, tipo, detalle, estado)
    select
      p.employee_id,
      null,
      p.work_date,
      p_local,
      'turno_largo',
      jsonb_build_object(
        'umbral_h', v_umbral,
        'pares', jsonb_agg(jsonb_build_object(
                   'punch_in', p.punch_in, 'punch_out', p.punch_out,
                   'in_at', p.in_at, 'out_at', p.out_at, 'horas', p.horas) order by p.in_at)
      ),
      'abierta'
    from pg_temp.f1d_pares p
    where p.horas > v_umbral
    group by p.employee_id, p.work_date
    having not exists (
      select 1 from punch_exceptions e
       where e.estado = 'resuelta' and e.tipo = 'turno_largo' and e.local = p_local
         and e.work_date = p.work_date and e.employee_id = p.employee_id
    )
    returning 1
  )
  select count(*) into v_largo from ins;

  -- solapado: un `in` seguido de otro `in` — el primero nunca cerró porque lo pisó el siguiente.
  with cand as (
    select s.employee_id, s.work_date, s.id as punch_in_previo, s.punch_at
    from pg_temp.f1d_scope s
    where s.punch_state = 'in' and s.next_state = 'in'
  ),
  ins as (
    insert into punch_exceptions (employee_id, emp_code, work_date, local, tipo, detalle, estado)
    select
      c.employee_id,
      null,
      c.work_date,
      p_local,
      'solapado',
      jsonb_build_object(
        'marcas', jsonb_agg(jsonb_build_object('id', c.punch_in_previo, 'punch_at', c.punch_at) order by c.punch_at),
        'cuantas', count(*)
      ),
      'abierta'
    from cand c
    group by c.employee_id, c.work_date
    having not exists (
      select 1 from punch_exceptions e
       where e.estado = 'resuelta' and e.tipo = 'solapado' and e.local = p_local
         and e.work_date = c.work_date and e.employee_id = c.employee_id
    )
    returning 1
  )
  select count(*) into v_solap from ins;

  -- sin_mapear: el `emp_code` no corresponde a ningún empleado. NO generan work_days (no hay a
  -- quién acreditarle las horas) y por eso quedaron fuera de `f1d_scope`: se releen acá.
  with cand as (
    select
      tp.emp_code,
      ((tp.punch_at at time zone 'America/Costa_Rica') - v_corte)::date as work_date,
      tp.id,
      tp.punch_at
    from time_punches tp
    where tp.local = p_local
      and tp.employee_id is null
      and tp.punch_at >= v_ini_ts
      and tp.punch_at <  v_fin_ts
  ),
  ins as (
    insert into punch_exceptions (employee_id, emp_code, work_date, local, tipo, detalle, estado)
    select
      null,
      c.emp_code,
      c.work_date,
      p_local,
      'sin_mapear',
      jsonb_build_object(
        'cuantas', count(*),
        'primera', min(c.punch_at),
        'ultima',  max(c.punch_at),
        'marcas',  jsonb_agg(c.id order by c.punch_at)
      ),
      'abierta'
    from cand c
    where c.work_date between p_desde and p_hasta
    group by c.emp_code, c.work_date
    having not exists (
      select 1 from punch_exceptions e
       where e.estado = 'resuelta' and e.tipo = 'sin_mapear' and e.local = p_local
         and e.work_date = c.work_date and e.emp_code = c.emp_code
    )
    returning 1
  )
  select count(*) into v_sinmap from ins;

  drop table if exists pg_temp.f1d_scope;
  drop table if exists pg_temp.f1d_pares;

  return jsonb_build_object(
    'local',                p_local,
    'desde',                p_desde,
    'hasta',                p_hasta,
    'corte_jornada',        v_corte,
    'umbral_turno_largo_h', v_umbral,
    'marcas',               v_marcas,
    'dias',                 v_dias,
    'dias_3h_default',      v_3h,
    'dias_omitidos_manual', v_omitidos,
    'horas',                v_horas,
    'excepciones', jsonb_build_object(
      'impar',       v_impar,
      'turno_largo', v_largo,
      'solapado',    v_solap,
      'sin_mapear',  v_sinmap
    )
  );
end $$;

comment on function public.derivar_work_days(date, date, text) is
  'Salarios F1d: empareja in/out de time_punches por jornada (corte de payroll_config) y escribe work_days source=biotime + punch_exceptions. Un dia sin ningun par cerrado se cuenta a 3h (default corregible, flags.horas_origen=3h_default_impar); si hay al menos un par manda la medicion. Idempotente por (local, rango): borra lo biotime y las excepciones ABIERTAS antes de recalcular; NUNCA toca work_days source=manual ni las excepciones ya resueltas. NO calcula plata.';

revoke all on function public.derivar_work_days(date, date, text) from public, anon;
grant  execute on function public.derivar_work_days(date, date, text) to authenticated;
