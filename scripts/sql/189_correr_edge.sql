-- PASE-189: llamar a la Edge `ventas-dia-contador` DESDE LA BASE, con la misma autenticación que el cron (service_role
-- leída del Vault por nombre): nadie copia, pega ni ve una clave. NO es una migración. Editor SQL, rol postgres,
-- leyendo antes el ref en pantalla (PROD `yiczgdti…` / staging `hwiatgic…`; en staging, cambiar el ref de la URL).
--
-- Paso A (elegir UNO): pide la llamada; devuelve el id de la respuesta.
--   · dry_run (no manda nada): body {"local":"santa-teresa","dry_run":true}
--   · corrida real a la dirección del negocio (solo con firma, §6 del PASE): body {"local":"santa-teresa","quincena":"2026-11-1"}
select net.http_post(
  url := 'https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/ventas-dia-contador',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
  body := '{"local":"santa-teresa","dry_run":true}'::jsonb,
  timeout_milliseconds := 120000
) as request_id;

-- Paso B (unos 10–60 s después, con el id del paso A): la respuesta. Trae período, conteos, nombres de los adjuntos,
-- bytes y sha256; nunca montos.
-- select status_code, timed_out, error_msg, content::jsonb from net._http_response where id = <request_id>;
