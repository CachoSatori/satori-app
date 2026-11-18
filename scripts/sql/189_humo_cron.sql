-- PASE-189, paso de humo (R01, R02): DESPUÉS del merge de la 189 (Branching la aplica). NO es una migración.
-- Una tarea creada por Branching no prueba que corra (jobid 7 del Club: 0 corridas). Esto (1) verifica la tarea de la
-- 189 contra lo firmado (md5 del comando, horario, activa, usuario postgres) y (2) programa una tarea de humo sin
-- efecto, cada minuto: escribir en cron.job hace que el planificador recargue su lista (incluida la 189).
-- Editor SQL de PROD (rol postgres), leyendo antes el ref en pantalla. Solo cron.schedule; nada de «for update».
-- >= 2 minutos después: scripts/sql/189_humo_cierre.sql.
begin;

do $$
begin
  if current_user <> 'postgres' then raise exception 'PARAR: correr como postgres (es %)', current_user; end if;
  if (select count(*) from cron.job where jobname = 'satori-ventas-dia-contador') <> 1 then
    raise exception 'PARAR: no hay exactamente 1 tarea satori-ventas-dia-contador (¿se aplicó la 189?)';
  end if;
  if not exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador'
                  and schedule = '0 13 1,16 * *' and active and username = 'postgres'
                  and md5(command) = 'bd40913a82322ef9c7dfa940133118f2') then
    raise exception 'PARAR: la tarea de la 189 no es la firmada (horario, activa, usuario o md5 del comando)';
  end if;
  if exists (select 1 from cron.job where jobname = 'contador_cron_humo') then
    perform cron.unschedule('contador_cron_humo');
  end if;
  perform cron.schedule('contador_cron_humo', '* * * * *', 'select 1');
end $$;

commit;

select jobid, jobname, schedule, active, username, md5(command) from cron.job order by jobid;
