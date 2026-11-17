-- ⛔ PROD, con firma del dueño. NO es una migración (pg_cron no está versionado en supabase/migrations).
-- Reporte del día 15 → 1.ª quincena (decisión del dueño, 16-nov-2026).
-- Cambia SOLO el body del job 4 (`satori-quincenal-report`, `0 8 15 * *`): '{}' → '{"periodo":"quincena"}'.
-- URL y Authorization (service_role desde Vault) quedan exactamente como están: se hace replace sobre el comando vivo,
-- así este archivo no lleva el ref ni ninguna clave.
-- Orden: DESPUÉS de desplegar la Edge nueva (con la Edge vieja, `periodo` se ignora y manda el mes anterior: inocuo).
-- Antes de correrlo: leer el ref en pantalla (yiczgdti… = PROD).
begin;

do $$
declare
  j record;
  nuevo text;
begin
  select jobid, jobname, schedule, active, command into j from cron.job where jobid = 4 for update;
  if not found then raise exception 'PARAR: no existe el job 4'; end if;
  if j.jobname <> 'satori-quincenal-report' then raise exception 'PARAR: el job 4 es %', j.jobname; end if;
  if j.schedule <> '0 8 15 * *' then raise exception 'PARAR: horario inesperado %', j.schedule; end if;
  if j.command not like '%/functions/v1/monthly-report%' then raise exception 'PARAR: el job 4 no llama a monthly-report'; end if;
  if j.command like '%periodo%' then raise exception 'PARAR: el job 4 ya manda periodo (¿ya se aplicó?)'; end if;
  if (length(j.command) - length(replace(j.command, 'body := ''{}''::jsonb', ''))) / length('body := ''{}''::jsonb') <> 1 then
    raise exception 'PARAR: el body ''{}''::jsonb no aparece exactamente una vez';
  end if;

  nuevo := replace(j.command, 'body := ''{}''::jsonb', 'body := ''{"periodo":"quincena"}''::jsonb');
  perform cron.alter_job(job_id := 4, command := nuevo);
end $$;

-- Verificación dentro de la transacción: el 4 cambió, el 3 no.
do $$
begin
  if (select command from cron.job where jobid = 4) not like '%body := ''{"periodo":"quincena"}''::jsonb%' then
    raise exception 'PARAR: el job 4 no quedó con periodo quincena';
  end if;
  if (select command from cron.job where jobid = 3) not like '%body := ''{}''::jsonb%' then
    raise exception 'PARAR: el job 3 (día 1) cambió y no debía';
  end if;
  if (select schedule from cron.job where jobid = 4) <> '0 8 15 * *' then raise exception 'PARAR: cambió el horario del 4'; end if;
end $$;

commit;

-- Después (solo lectura; sin claves: el comando lee el secreto de Vault por nombre):
-- select jobid, jobname, schedule, active, command from cron.job where jobid in (3, 4) order by jobid;
