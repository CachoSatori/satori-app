-- ⛔ PROD, con firma del dueño. NO es una migración (pg_cron no está versionado en supabase/migrations).
-- Reporte del día 15 → 1.ª quincena (decisión del dueño, 16-nov-2026).
-- Cambia SOLO el body del job 4 (`satori-quincenal-report`, `0 8 15 * *`): '{}' → '{"periodo":"quincena"}'.
-- URL y Authorization (service_role desde Vault) quedan exactamente como están: se hace replace sobre el comando vivo
-- y se ata por md5, así este archivo no lleva el ref ni ninguna clave.
-- Sin `select … for update`: postgres no tiene UPDATE sobre cron.job (falló así el 17-nov, sin aplicar nada).
-- Los cambios van solo por cron.alter_job.
-- md5 leídos en prod (solo lectura, 17-nov): comando actual de los jobs 3 y 4 = 95d77b5e87b3066ac3c199358966aac0;
-- comando nuevo del job 4 = 122fa7131bc0c51dacf00c18dca8dedf.
-- Orden: DESPUÉS de desplegar la Edge nueva (con la Edge vieja, `periodo` se ignora y manda el mes anterior: inocuo).
-- Antes de correrlo: leer el ref en pantalla y confirmar que es PROD.
begin;

do $$
declare
  j record;
  nuevo text;
begin
  select jobid, jobname, schedule, active, command into j from cron.job where jobid = 4;
  if not found then raise exception 'PARAR: no existe el job 4'; end if;
  if j.jobname <> 'satori-quincenal-report' then raise exception 'PARAR: el job 4 es %', j.jobname; end if;
  if j.schedule <> '0 8 15 * *' then raise exception 'PARAR: horario inesperado %', j.schedule; end if;
  if (length(j.command) - length(replace(j.command, 'body := ''{}''::jsonb', ''))) / length('body := ''{}''::jsonb') <> 1 then
    raise exception 'PARAR: el body ''{}''::jsonb no aparece exactamente una vez';
  end if;
  if md5(j.command) <> '95d77b5e87b3066ac3c199358966aac0' then
    raise exception 'PARAR: el comando del job 4 no es el esperado (md5 %)', md5(j.command);
  end if;

  nuevo := replace(j.command, 'body := ''{}''::jsonb', 'body := ''{"periodo":"quincena"}''::jsonb');
  if md5(nuevo) <> '122fa7131bc0c51dacf00c18dca8dedf' then
    raise exception 'PARAR: el comando nuevo no es el esperado (md5 %)', md5(nuevo);
  end if;
  perform cron.alter_job(job_id := 4, command := nuevo);
end $$;

-- Verificación dentro de la transacción: el 4 cambió (md5 nuevo), el 3 no.
do $$
begin
  if (select md5(command) from cron.job where jobid = 4) <> '122fa7131bc0c51dacf00c18dca8dedf' then
    raise exception 'PARAR: el job 4 no quedó con el comando esperado';
  end if;
  if (select md5(command) from cron.job where jobid = 3) <> '95d77b5e87b3066ac3c199358966aac0' then
    raise exception 'PARAR: el job 3 (día 1) cambió y no debía';
  end if;
  if (select schedule from cron.job where jobid = 4) <> '0 8 15 * *' then raise exception 'PARAR: cambió el horario del 4'; end if;
  if not (select active from cron.job where jobid = 4) then raise exception 'PARAR: el job 4 quedó inactivo'; end if;
end $$;

commit;

-- Después (solo lectura):
-- select jobid, jobname, schedule, active, md5(command) from cron.job where jobid in (3, 4) order by jobid;
-- Esperado: 3 → 95d77b5e…, 4 → 122fa713…
