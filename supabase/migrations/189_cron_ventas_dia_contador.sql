-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 189 (origen club/puente 133) · Cron del correo quincenal de ventas por día (contador)    ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Pedido del dueño (17-nov-2026 19:09 CR): los días 1 y 16 sale un correo aparte al correo del negocio con el
-- «Detalle por día» de la quincena cerrada (Excel + CSV) para el contador. Lo arma y lo manda la Edge
-- `ventas-dia-contador` (se despliega ANTES, a mano, con firma: docs/pases/PASE-189-correo-contador.md).
--
-- Qué hace (y nada más): programa UNA tarea de pg_cron, `satori-ventas-dia-contador`, `0 13 1,16 * *`
-- (pg_cron corre en GMT en prod: 13:00 UTC = 07:00 CR, sin horario de verano). Llama a la Edge con la MISMA forma
-- que los jobs 3 y 4 de los reportes (`net.http_post` + `Authorization: Bearer` con la service_role leída del Vault
-- por nombre, `service_role_key`): ninguna clave en este archivo. Body: el local; la quincena la calcula la Edge.
-- `timeout_milliseconds` 120 s (el de pg_net por defecto es 5 s; la Edge lee 15–16 días del PoS y arma 2 adjuntos).
--
-- Qué NO hace: no toca tablas, funciones ni permisos; no toca los jobs 3, 4 ni 8; no ejecuta la Edge.
-- R01: sin `select … for update` ni bloqueos sobre cron.job; solo cron.schedule / cron.unschedule.
-- R02: que exista la fila no prueba que corra: el PASE corre el humo de pg_cron (scripts/sql/189_humo_cron.sql) y
-- verifica la corrida real del día 1 o 16 siguiente en cron.job_run_details.
-- Re-ejecutable: si la tarea ya existe, se baja y se vuelve a crear (queda exactamente una).
-- Sin pg_cron o pg_net (p. ej. una base de preview): no hace nada y lo avisa con NOTICE (no rompe Branching).
-- Rollback: scripts/sql/189_rollback.sql. Pruebas: scripts/sql/189_pruebas.sh (Postgres local, con un shim de cron).

do $mig$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '189: sin pg_cron/pg_net en esta base, no se programa nada';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador') then
    perform cron.unschedule('satori-ventas-dia-contador');
  end if;

  perform cron.schedule(
    'satori-ventas-dia-contador',
    '0 13 1,16 * *',
    $cmd$SELECT net.http_post( url := 'https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/ventas-dia-contador', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')), body := '{"local":"santa-teresa"}'::jsonb, timeout_milliseconds := 120000 ) AS request_id$cmd$
  );
end
$mig$;
