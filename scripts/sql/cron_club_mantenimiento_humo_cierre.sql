-- Paso 2 del PASE-cron-club-mantenimiento: >= 2 minutos después de cron_club_mantenimiento.sql.
-- Verifica que el planificador de pg_cron corrió la tarea de humo (o sea, que recargó su lista) y la borra.
-- Si el humo tiene 0 corridas, ABORTA y NO borra nada: criterio de parada (§7 del PASE).

begin;

do $$
declare
  v_ok int;
begin
  select count(*) into v_ok
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'club_cron_humo' and d.status = 'succeeded';
  if v_ok = 0 then
    raise exception 'PARAR: club_cron_humo no tiene corridas: el planificador no recargó. No seguir; ver §7 del PASE';
  end if;
  perform cron.unschedule('club_cron_humo');
  -- Las corridas del humo no sirven para nada más: se borran para no ensuciar el historial.
  delete from cron.job_run_details d
   where not exists (select 1 from cron.job j where j.jobid = d.jobid) and d.command = 'select 1';
  if exists (select 1 from cron.job where jobname = 'club_cron_humo') then
    raise exception 'PARAR: el humo sigue programado';
  end if;
  if (select count(*) from cron.job where jobname = 'club_socios_mantenimiento' and active) <> 1 then
    raise exception 'PARAR: la tarea diaria no está (o no está activa)';
  end if;
  raise notice 'OK: humo con % corridas, borrado; la tarea diaria sigue activa', v_ok;
end $$;

commit;
