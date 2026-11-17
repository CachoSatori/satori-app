-- Batería del PASE-cron-club-mantenimiento. SOLO STAGING (hwiatgicyyqyezqwldia), en UNA transacción que termina en
-- ROLLBACK: no deja nada (cron.schedule dentro de una transacción descartada no programa nada).
-- `pg_temp.recrear()` repite el bloque 1-3 de scripts/sql/cron_club_mantenimiento.sql (sin el chequeo de current_user,
-- que la batería hace aparte). Si se cambia uno, se cambia el otro.
-- Cada caso aborta con «FALLA …» si no da lo esperado; al final, «OK batería».

begin;

create function pg_temp.recrear() returns void language plpgsql as $f$
begin
  if exists (select 1 from cron.job where jobname = 'club_socios_mantenimiento') then
    perform cron.unschedule('club_socios_mantenimiento');
  end if;
  perform cron.schedule('club_socios_mantenimiento', '15 9 * * *', 'select public.club_socios_mantenimiento()');
  if exists (select 1 from cron.job where jobname = 'club_cron_humo') then
    perform cron.unschedule('club_cron_humo');
  end if;
  perform cron.schedule('club_cron_humo', '* * * * *', 'select 1');
end $f$;

create function pg_temp.bien() returns boolean language sql as $f$
  select (select count(*) from cron.job where jobname = 'club_socios_mantenimiento') = 1
     and exists (select 1 from cron.job where jobname = 'club_socios_mantenimiento' and schedule = '15 9 * * *' and active
                   and command = 'select public.club_socios_mantenimiento()' and username = 'postgres')
     and (select count(*) from cron.job where jobname = 'club_cron_humo' and active) = 1
$f$;

do $$
declare
  v_id_antes bigint := (select jobid from cron.job where jobname = 'club_socios_mantenimiento');
  r1 jsonb; r2 jsonb;
begin
  if current_user <> 'postgres' then raise exception 'FALLA 0: correr como postgres'; end if;

  -- Caso 1: con la tarea como está → queda 1, con jobid NUEVO (se escribió cron.job: el trigger de recarga corre).
  perform pg_temp.recrear();
  if not pg_temp.bien() then raise exception 'FALLA 1: no quedó como se espera'; end if;
  if v_id_antes is not null and exists (select 1 from cron.job where jobid = v_id_antes) then
    raise exception 'FALLA 1: la tarea vieja (jobid %) sigue', v_id_antes;
  end if;

  -- Caso 2: idempotente → correrlo otra vez deja 1 y 1.
  perform pg_temp.recrear();
  if not pg_temp.bien() then raise exception 'FALLA 2: la segunda corrida duplicó o rompió'; end if;

  -- Caso 3: la tarea apagada a mano → vuelve activa.
  perform cron.alter_job((select jobid from cron.job where jobname = 'club_socios_mantenimiento'), active := false);
  if pg_temp.bien() then raise exception 'FALLA 3: el chequeo no detecta la tarea apagada'; end if;   -- el assert muerde
  perform pg_temp.recrear();
  if not pg_temp.bien() then raise exception 'FALLA 3: no la volvió a activar'; end if;

  -- Caso 4: sin la tarea → la crea.
  perform cron.unschedule('club_socios_mantenimiento');
  if pg_temp.bien() then raise exception 'FALLA 4: el chequeo no detecta la falta'; end if;
  perform pg_temp.recrear();
  if not pg_temp.bien() then raise exception 'FALLA 4: no la creó'; end if;

  -- Caso 5: la tarea con otro horario → vuelve a 15 9 * * *.
  perform cron.alter_job((select jobid from cron.job where jobname = 'club_socios_mantenimiento'), schedule := '0 0 * * *');
  if pg_temp.bien() then raise exception 'FALLA 5: el chequeo no detecta el horario cambiado'; end if;
  perform pg_temp.recrear();
  if not pg_temp.bien() then raise exception 'FALLA 5: no volvió el horario'; end if;

  -- Caso 6: la función es segura de correr dos veces seguidas (lo que haría la primera corrida en prod «de golpe»):
  -- la segunda no vence, no purga ni genera premios otra vez.
  r1 := public.club_socios_mantenimiento();
  r2 := public.club_socios_mantenimiento();
  if (r2->>'provisionales_vencidas')::int <> 0 or (r2->>'autoaltas_purgadas')::int <> 0
     or (r2->>'premios')::int <> 0 or (r2->>'contactos_ofertas_borrados')::int <> 0 then
    raise exception 'FALLA 6: la segunda corrida volvió a hacer algo: % (la primera: %)', r2, r1;
  end if;
  raise notice 'OK batería (6 casos). Primera corrida de la función: %', r1;
end $$;

rollback;
