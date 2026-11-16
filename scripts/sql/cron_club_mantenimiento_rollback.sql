-- Vuelta atrás del PASE-cron-club-mantenimiento (a mano, rol postgres, con firma).
-- No hay esquema que deshacer: solo tareas de pg_cron.
--   A. Quitar el humo si quedó programado (siempre seguro).
--   B. Solo si la tarea diaria hizo algo inesperado: APAGARLA (no borrarla), y avisar. Se reactiva con
--      `select cron.alter_job(<jobid>, active := true);` o volviendo a correr cron_club_mantenimiento.sql.
-- Lo que la función ya hizo (vencer una alta provisional, purgar una autoalta) no se deshace con esto: queda en
-- club_auditoria / club_miembro_roles y se corrige a mano con el owner (Club → Socios), caso por caso.

begin;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'club_cron_humo') then
    perform cron.unschedule('club_cron_humo');
  end if;
end $$;
commit;

-- B (descomentar solo con la decisión del dueño):
-- select cron.alter_job((select jobid from cron.job where jobname = 'club_socios_mantenimiento'), active := false);

select jobid, jobname, schedule, active from cron.job order by jobid;
