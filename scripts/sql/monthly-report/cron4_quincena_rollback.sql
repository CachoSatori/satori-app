-- ⛔ PROD — vuelta atrás de cron4_quincena.sql: el job 4 vuelve a mandar body '{}' (mes anterior completo, como v20).
-- Va JUNTO con redesplegar la Edge v20 (o solo, si se quiere el día 15 mensual otra vez). Leer el ref antes.
begin;

do $$
declare
  j record;
begin
  select jobid, jobname, command into j from cron.job where jobid = 4 for update;
  if not found or j.jobname <> 'satori-quincenal-report' then raise exception 'PARAR: job 4 inesperado'; end if;
  if j.command not like '%body := ''{"periodo":"quincena"}''::jsonb%' then
    raise exception 'PARAR: el job 4 no tiene el body de quincena (nada que revertir)';
  end if;
  perform cron.alter_job(job_id := 4,
    command := replace(j.command, 'body := ''{"periodo":"quincena"}''::jsonb', 'body := ''{}''::jsonb'));
end $$;

do $$
begin
  if (select command from cron.job where jobid = 4) not like '%body := ''{}''::jsonb%' then
    raise exception 'PARAR: el job 4 no volvió a ''{}''';
  end if;
end $$;

commit;
