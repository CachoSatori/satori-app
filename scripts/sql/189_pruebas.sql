-- 189_pruebas · Cron del correo quincenal al contador. SOLO Postgres local (lo arma scripts/sql/189_pruebas.sh: base
-- nueva con un shim de pg_cron, pg_net y Vault que imita su API; nunca staging ni prod). Termina en ROLLBACK.
--
-- MARCADORES que llena el runner: «@@189@@» → cuerpo de supabase/migrations/189_cron_ventas_dia_contador.sql con el
-- chequeo de extensiones apuntando a 'plpgsql' (el shim no es una extensión); «@@189ORIG@@» → el cuerpo TAL CUAL
-- (camino sin pg_cron: no hace nada); «@@189R@@» → scripts/sql/189_rollback.sql sin begin/commit.
-- Cada caso deja su resultado en _r189; un caso caído = WARNING; al final RESUMEN y, si cae alguno, error (R15).
begin;

create temp table _r189 (n serial, caso text, ok boolean, detalle text) on commit drop;
create function pg_temp.caso(p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r189 (caso, ok, detalle) values (p_caso, coalesce(p_ok, false), p_det);
$f$;

-- Jobs 3 y 4 ficticios, con la forma de prod (sin ninguna clave: el Bearer sale del Vault por nombre).
select cron.schedule('satori-monthly-report', '0 8 1 * *',
  $c$SELECT net.http_post( url := 'https://ejemplo.supabase.co/functions/v1/monthly-report', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), body := '{}'::jsonb ) AS request_id$c$);
select cron.schedule('satori-quincenal-report', '0 8 15 * *',
  $c$SELECT net.http_post( url := 'https://ejemplo.supabase.co/functions/v1/monthly-report', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), body := '{"periodo":"quincena"}'::jsonb ) AS request_id$c$);
create temp table _antes on commit drop as select jobid, jobname, schedule, md5(command) as h from cron.job;

-- 01 · Sin pg_cron/pg_net (base de preview): no programa nada y no rompe.
-- @@189ORIG@@
select pg_temp.caso('01 sin pg_cron: no-op', not exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador'));

-- 02 · Aplicar la 189.
-- @@189@@
select pg_temp.caso('02 exactamente una tarea', (select count(*) from cron.job where jobname = 'satori-ventas-dia-contador') = 1);
select pg_temp.caso('03 horario 13:00 UTC (07:00 CR) los días 1 y 16',
  (select schedule from cron.job where jobname = 'satori-ventas-dia-contador') = '0 13 1,16 * *');
select pg_temp.caso('04 activa y de postgres',
  (select active and username = current_user from cron.job where jobname = 'satori-ventas-dia-contador'));
-- 05 · Misma autenticación que los jobs 3/4: el tramo de headers es IDÉNTICO al del job 3.
select pg_temp.caso('05 headers iguales a los del job 3',
  (select substring(command from 'headers := .*?\)\), body') from cron.job where jobname = 'satori-ventas-dia-contador')
  = (select substring(command from 'headers := .*?\)\), body') from cron.job where jobname = 'satori-monthly-report'));
select pg_temp.caso('06 sin claves escritas (ni JWT ni sb_/sk_)',
  (select command !~ '(eyJ[A-Za-z0-9_-]{10,}|sb_[a-z]+_[A-Za-z0-9]{10,}|sk_[A-Za-z0-9]{10,})' from cron.job where jobname = 'satori-ventas-dia-contador'));
select pg_temp.caso('07 los jobs 3 y 4 no cambiaron',
  (select count(*) from _antes a join cron.job j using (jobid) where j.jobname = a.jobname and j.schedule = a.schedule and md5(j.command) = a.h) = 2);

-- 08 · El comando corre: llama a la Edge nueva con el Bearer del Vault, el local y 120 s.
do $$ begin execute (select command from cron.job where jobname = 'satori-ventas-dia-contador'); end $$;
select pg_temp.caso('08 url de la Edge ventas-dia-contador',
  (select url from _llamadas order by n desc limit 1) like 'https://%.supabase.co/functions/v1/ventas-dia-contador');
select pg_temp.caso('09 Authorization = Bearer + secreto service_role_key del Vault',
  (select headers->>'Authorization' from _llamadas order by n desc limit 1) = 'Bearer valor-ficticio-de-prueba');
select pg_temp.caso('10 body {"local":"santa-teresa"} (la quincena la calcula la Edge)',
  (select body from _llamadas order by n desc limit 1) = '{"local":"santa-teresa"}'::jsonb);
select pg_temp.caso('11 timeout 120 s',
  (select timeout_milliseconds from _llamadas order by n desc limit 1) = 120000);

-- 12 · Re-ejecutable: aplicar otra vez deja UNA tarea (recreada).
create temp table _id on commit drop as select jobid from cron.job where jobname = 'satori-ventas-dia-contador';
-- @@189@@
select pg_temp.caso('12 re-ejecutable: sigue una sola',
  (select count(*) from cron.job where jobname = 'satori-ventas-dia-contador') = 1);

-- 13 · Si alguien la dejó con otro horario o apagada, la 189 la deja bien.
update cron.job set schedule = '0 7 1,16 * *', active = false where jobname = 'satori-ventas-dia-contador';
-- @@189@@
select pg_temp.caso('13 corrige horario y la reactiva',
  (select schedule = '0 13 1,16 * *' and active from cron.job where jobname = 'satori-ventas-dia-contador'));

-- 14 · Rollback: baja solo la tarea y la fila del ledger.
insert into supabase_migrations.schema_migrations (version, name) values ('189', 'cron_ventas_dia_contador');
-- @@189R@@
select pg_temp.caso('14 rollback: la tarea no está',
  not exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador'));
select pg_temp.caso('15 rollback: jobs 3 y 4 intactos',
  (select count(*) from _antes a join cron.job j using (jobid) where md5(j.command) = a.h) = 2);
select pg_temp.caso('16 rollback: sin fila 189 en el ledger',
  not exists (select 1 from supabase_migrations.schema_migrations where version = '189'));

do $$
declare v_ok int; v_mal int; v_tot int; v_esp constant int := 16; r record;
begin
  for r in select caso, detalle from _r189 where not ok order by n loop
    raise warning '189 FALLA % — %', r.caso, coalesce(r.detalle, '');
  end loop;
  select count(*) filter (where ok), count(*) filter (where not ok), count(*) into v_ok, v_mal, v_tot from _r189;
  raise notice '189 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_tot;
  if v_mal > 0 or v_tot <> v_esp then
    raise exception '189-FALLAN: % · pasaron % / fallaron %', case when v_tot <> v_esp then 'faltan casos' else 'casos caídos' end, v_ok, v_mal;
  end if;
end $$;

rollback;
