-- ⛔ PROD — vuelta atrás de cron4_quincena.sql: el job 4 vuelve EXACTAMENTE al comando anterior
-- (md5 95d77b5e87b3066ac3c199358966aac0, body '{}' = mes anterior completo, como v20).
-- Sin `for update` (postgres no tiene UPDATE sobre cron.job): solo cron.alter_job. Leer el ref antes.
begin;

do $$
declare
  j record;
  viejo text;
begin
  select jobid, jobname, command into j from cron.job where jobid = 4;
  if not found or j.jobname <> 'satori-quincenal-report' then raise exception 'PARAR: job 4 inesperado'; end if;
  if md5(j.command) <> '122fa7131bc0c51dacf00c18dca8dedf' then
    raise exception 'PARAR: el job 4 no tiene el comando de quincena (md5 %)', md5(j.command);
  end if;
  viejo := replace(j.command, 'body := ''{"periodo":"quincena"}''::jsonb', 'body := ''{}''::jsonb');
  if md5(viejo) <> '95d77b5e87b3066ac3c199358966aac0' then
    raise exception 'PARAR: la vuelta no reconstruye el comando original (md5 %)', md5(viejo);
  end if;
  perform cron.alter_job(job_id := 4, command := viejo);
end $$;

do $$
begin
  if (select md5(command) from cron.job where jobid = 4) <> '95d77b5e87b3066ac3c199358966aac0' then
    raise exception 'PARAR: el job 4 no volvió al comando original';
  end if;
end $$;

commit;
