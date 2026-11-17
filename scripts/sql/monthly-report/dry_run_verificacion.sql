-- PROD, después de desplegar la Edge (y del cambio del cron). NO manda correos: todas las llamadas llevan dry_run.
-- Reusa la URL y el Authorization del job 3 tal cual (Vault), así no se escribe el ref ni ninguna clave.
-- Cada bloque encola un net.http_post; el resultado se lee en las respuestas de pg_net y en los logs de la función.
do $$
declare
  base text;
  bodies text[] := array[
    '{"dry_run":true}',                                   -- mensual por defecto (en nov-2026 → 2026-10, 01–31)
    '{"periodo":"quincena","dry_run":true}',              -- quincena por defecto (desde el 15-nov → 2026-11, 01–14)
    '{"periodo":"quincena","month":"2026-10","dry_run":true}',  -- quincena explícita de un mes pasado
    '{"periodo":"quincenal","dry_run":true}'              -- inválido → 400 code periodo
  ];
  b text;
begin
  select command into base from cron.job where jobid = 3;
  if base not like '%body := ''{}''::jsonb%' then raise exception 'PARAR: el job 3 no tiene body ''{}'''; end if;
  foreach b in array bodies loop
    if b not like '%"dry_run":true%' then raise exception 'PARAR: llamada sin dry_run'; end if;
    execute replace(base, 'body := ''{}''::jsonb', 'body := ' || quote_literal(b) || '::jsonb');
  end loop;
end $$;

-- ~30 s después (solo lectura). Esperado, en este orden de ids:
--   200 {"ok":true,"month":"octubre de 2026","periodo":"mes","dry_run":true,"enviados":["ventas","propinas"],...}
--   200 {"ok":true,"month":"1.ª quincena de noviembre de 2026","periodo":"quincena","dry_run":true,"enviados":[...]}
--   200 {"ok":true,"month":"1.ª quincena de octubre de 2026","periodo":"quincena","dry_run":true,...}
--   400 {"ok":false,"code":"periodo",...}
-- La respuesta no trae montos ni nombres (SEC-02).
select id, status_code, left(content, 300) as respuesta, created
from net._http_response order by id desc limit 4;
-- En los logs de la función, la línea JSON con `periodo`, `desde`, `hasta` debe decir 2026-11-01 … 2026-11-14 para la
-- quincena por defecto, y en postgres_logs NO debe aparecer «out of range».
