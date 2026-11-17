-- Recrea la tarea diaria del Club (`club_socios_mantenimiento`) por la API de pg_cron y programa una tarea de humo.
-- Pase: docs/pases/PASE-cron-club-mantenimiento.md (hallazgo A02, auditoría del 16-nov).
--
-- Por qué: en PROD la fila de cron.job existe y está activa desde la 150 (merge del 11-nov), pero el planificador de
-- pg_cron nunca la corrió (0 filas en cron.job_run_details, 0 «cron job N starting» en el log), mientras los jobs de
-- reportes sí corren. El planificador trabaja con una lista en memoria que se recarga cuando algo escribe en cron.job
-- (trigger `cron_job_cache_invalidate`). Esta escritura nueva, hecha en su propia transacción, fuerza la recarga.
--
-- NO es una migración: cron.job es estado de ejecución, no esquema. Va a mano (editor SQL, rol postgres), con firma.
-- Idempotente: correrlo dos veces deja exactamente 1 tarea `club_socios_mantenimiento` y 1 `club_cron_humo`.
-- No ejecuta la función: la tarea corre sola a las 09:15 UTC (03:15 CR).
-- Después de >= 2 minutos: scripts/sql/cron_club_mantenimiento_humo_cierre.sql (verifica el humo y lo borra).

begin;

do $$
declare
  v_mant bigint;
  v_humo bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'PARAR: pg_cron no está instalado en esta base';
  end if;
  if current_user <> 'postgres' then
    raise exception 'PARAR: correr como postgres (es %), así la tarea queda con user=postgres', current_user;
  end if;
  if to_regprocedure('public.club_socios_mantenimiento()') is null then
    raise exception 'PARAR: falta public.club_socios_mantenimiento()';
  end if;

  -- 1. La tarea diaria: se borra (si está) y se vuelve a crear con la definición de la 150.
  if exists (select 1 from cron.job where jobname = 'club_socios_mantenimiento') then
    perform cron.unschedule('club_socios_mantenimiento');
  end if;
  v_mant := cron.schedule('club_socios_mantenimiento', '15 9 * * *', 'select public.club_socios_mantenimiento()');  -- 03:15 CR

  -- 2. Humo: una tarea sin efecto, cada minuto. Si en 2-3 minutos tiene corridas, el planificador recargó su lista.
  if exists (select 1 from cron.job where jobname = 'club_cron_humo') then
    perform cron.unschedule('club_cron_humo');
  end if;
  v_humo := cron.schedule('club_cron_humo', '* * * * *', 'select 1');

  -- 3. Comprobaciones (si alguna falla, aborta y no queda nada).
  if (select count(*) from cron.job where jobname = 'club_socios_mantenimiento') <> 1 then
    raise exception 'PARAR: no quedó exactamente 1 tarea club_socios_mantenimiento';
  end if;
  if not exists (select 1 from cron.job
                  where jobid = v_mant and schedule = '15 9 * * *' and active
                    and command = 'select public.club_socios_mantenimiento()'
                    and username = 'postgres' and database = current_database()) then
    raise exception 'PARAR: la tarea % no quedó como se espera', v_mant;
  end if;
  if (select count(*) from cron.job where jobname = 'club_cron_humo' and active) <> 1 then
    raise exception 'PARAR: no quedó exactamente 1 tarea de humo activa';
  end if;
  raise notice 'OK: club_socios_mantenimiento = jobid %, club_cron_humo = jobid %', v_mant, v_humo;
end $$;

commit;

-- Para anotar en el PASE (después del commit):
select jobid, jobname, schedule, active, username, database, command
  from cron.job where jobname in ('club_socios_mantenimiento', 'club_cron_humo') order by jobid;
