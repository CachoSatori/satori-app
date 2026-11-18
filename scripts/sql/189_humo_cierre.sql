-- PASE-189, cierre del humo: >= 2 minutos después de 189_humo_cron.sql. Si el humo tiene 0 corridas, ABORTA y no
-- borra nada (criterio de parada del PASE). Si corrió, lo baja y deja solo la tarea de la 189.
begin;

do $$
declare v_ok int;
begin
  select count(*) into v_ok
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'contador_cron_humo' and d.status = 'succeeded';
  if v_ok = 0 then
    raise exception 'PARAR: contador_cron_humo sin corridas: el planificador no recargó. Ver criterios de parada del PASE-189';
  end if;
  perform cron.unschedule('contador_cron_humo');
  delete from cron.job_run_details d
   where not exists (select 1 from cron.job j where j.jobid = d.jobid) and d.command = 'select 1';
  if exists (select 1 from cron.job where jobname = 'contador_cron_humo') then raise exception 'PARAR: el humo sigue'; end if;
  if (select count(*) from cron.job where jobname = 'satori-ventas-dia-contador' and active) <> 1 then
    raise exception 'PARAR: la tarea de la 189 no está activa';
  end if;
  raise notice 'OK: humo con % corridas, borrado; satori-ventas-dia-contador sigue activa', v_ok;
end $$;

commit;
