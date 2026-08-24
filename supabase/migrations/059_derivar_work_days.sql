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
-- ⚠ 2026-08-23/24: la función se EDITÓ en esta misma migración (regla de las 3 h POR TRAMO, A8).
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
  v_h3h      numeric := 0;
  v_tramos   int := 0;
  -- La política de A8, en UN solo lugar del SQL. El test del puente TS↔SQL lee esta línea
  -- y la compara con HORAS_DEFAULT_IMPAR (src/shared/api/salarios.ts): mover una sola
  -- rompe el build. Si la política se estabiliza, su casa natural es `payroll_config`.
  v_default_h numeric := 3;
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
  -- Una fila por (empleado, jornada) con marcas.
  --
  -- ── LA REGLA DE LAS 3 HORAS, POR TRAMO (A8, firmada por Ismael el 2026-08-23) ────────────
  --
  --     hours = Σ(pares válidos in→out)  +  3 × (tramos sin cerrar)
  --     tramo sin cerrar = impar_in + impar_out + solapados
  --
  -- Se razona POR TRAMO, no por día. La diferencia no es cosmética: un turno CORTADO
  -- (mañana bien marcada, tarde sin salida) tiene un par válido Y un tramo abierto. Con la
  -- regla a nivel día —"si hay algún par, el impar suma 0"— ese día pagaba solo la mañana y
  -- la tarde se perdía entera. Que es el caso que más pasa: la gente se olvida de marcar la
  -- salida, no de marcar la entrada.
  --
  --   in-out              → 4 h medidas                          → 4 h
  --   in                  → 0 pares + 1 tramo abierto            → 3 h
  --   in-out-in           → 4 h (par) + 3 h (tramo)              → 7 h   ← el caso clave
  --   in-out-in-out       → 2 pares, nada abierto                → horas reales
  --   out                 → 0 pares + 1 tramo abierto            → 3 h
  --   in-in-out           → 1 par + 1 solapado (el in pisado)    → par + 3 h
  --
  -- Sin tope al número de defaults por día: los casos raros los ajusta el contador (A9).
  --
  -- Las 3 h son un DEFAULT CORREGIBLE, no una medición: `flags` guarda el desglose
  -- (`horas_pares` / `tramos_sin_cerrar` / `horas_default`) para que el contador —y el
  -- comprobante de la Fase 2— lean "X h reales + Y h default", también en los días MIXTOS.
  -- Quien tenga el dato real lo pisa desde la bandeja (override `source='manual'`), y las
  -- excepciones `impar`/`solapado` se siguen generando igual, para el aviso.
  -- ⚠ Es una POLÍTICA laboral, no una decisión técnica: Ismael la valida con su contador.
  --
  -- ⚠ DOS LÍMITES CONOCIDOS, que la bandeja tiene que seguir mostrando:
  --   1. Un turno que CRUZA el corte sin cerrar se parte en dos jornadas, cada una con su
  --      tramo abierto → 3 + 3 = 6 h. Pasa con cualquiera de las dos reglas; queda así.
  --   2. Una marca espuria en un día no trabajado también acredita 3 h (y en un día completo
  --      SUMA 3 h fantasma, que es el costo de razonar por tramo). Se corrige con el override
  --      de la bandeja, y el contador lo ve porque la pantalla de pago avisa las jornadas
  --      incompletas leyendo `flags` —que es permanente— en vez del estado de la excepción,
  --      que alguien puede resolver sin tocar las horas.
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
      -- El corazón de A8: cada marca que quedó sin su otra mitad es UN tramo abierto.
      -- El `in` solapado cuenta porque también es un tramo que nadie cerró.
      (a.impar_in + a.impar_out + a.solapados) as tramos_sin_cerrar
    from agg a
    left join hrs h on h.employee_id = a.employee_id and h.work_date = a.work_date
  ),
  ins as (
    insert into work_days (employee_id, work_date, local, hours, source, flags)
    select
      c.employee_id,
      c.work_date,
      p_local,
      c.horas_pares + (c.tramos_sin_cerrar * v_default_h),
      'biotime',
      jsonb_build_object(
        'marcas',            c.marcas,
        'pares',             c.pares,
        'horas_pares',       c.horas_pares,
        'tramos_sin_cerrar', c.tramos_sin_cerrar,
        'horas_default',     c.tramos_sin_cerrar * v_default_h,
        'total',             c.horas_pares + (c.tramos_sin_cerrar * v_default_h),
        'impares',           c.impar_in + c.impar_out,
        'solapados',         c.solapados,
        'turno_largo',       c.largos,
        -- De dónde salió el número, para que la pantalla no tenga que deducirlo:
        -- todo medido | mezcla de medido y default | todo default.
        'horas_origen', case
                          when c.tramos_sin_cerrar = 0 then 'biotime'
                          when c.pares = 0             then 'default'
                          else                              'mixto'
                        end
      )
    from calc c
    on conflict (employee_id, work_date, local) do nothing
    returning
      (flags->>'horas_default')::numeric     as hdef,
      (flags->>'tramos_sin_cerrar')::int     as tramos
  )
  select
    (select count(*) from ins),
    (select count(*) from agg) - (select count(*) from ins),
    (select count(*)          from ins where hdef > 0),
    (select coalesce(sum(hdef), 0)   from ins),
    (select coalesce(sum(tramos), 0) from ins)
    into v_dias, v_omitidos, v_3h, v_h3h, v_tramos;

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
    'dias_incompletos',     v_3h,
    'tramos_sin_cerrar',    v_tramos,
    'horas_default',        v_h3h,
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
  'Salarios F1d: empareja in/out de time_punches por jornada (corte de payroll_config) y escribe work_days source=biotime + punch_exceptions. A8: hours = suma de los pares + 3h por CADA TRAMO SIN CERRAR (impar_in+impar_out+solapados), asi un turno cortado no pierde el tramo bien marcado; el desglose queda en flags (horas_pares / tramos_sin_cerrar / horas_default). Idempotente por (local, rango): borra lo biotime y las excepciones ABIERTAS antes de recalcular; NUNCA toca work_days source=manual ni las excepciones ya resueltas. NO calcula plata.';

revoke all on function public.derivar_work_days(date, date, text) from public, anon;
grant  execute on function public.derivar_work_days(date, date, text) to authenticated;
