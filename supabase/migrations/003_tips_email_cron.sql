-- ============================================================================
-- 003_tips_email_cron.sql — Cron de emails automáticos de PROPINAS
-- ----------------------------------------------------------------------------
-- La Edge Function `monthly-report` (supabase/functions/monthly-report/index.ts)
-- ya construye y envía DOS emails con el mismo estilo de template:
--   • 📈 Reporte de Ventas
--   • 💰 Reporte de Propinas  (pool total, Q1/Q2 vía AM/PM, top earners, sectores)
-- Acepta body { "month": "YYYY-MM", "tipo": "ventas"|"propinas"|"ambos" }.
--
-- Esta migración programa los disparos automáticos replicando EXACTAMENTE el
-- mecanismo del reporte de ventas (pg_cron + pg_net → net.http_post):
--   • Día 1  08:00 CR (14:00 UTC): resumen del MES ANTERIOR (ventas + propinas)
--   • Día 15 08:00 CR (14:00 UTC): resumen QUINCENAL de PROPINAS del MES EN CURSO
--
-- Idempotente: re-ejecutable sin duplicar jobs.
-- ----------------------------------------------------------------------------
-- NOTA: el Authorization bearer y la URL del proyecto deben coincidir con los
-- del cron de ventas ya existente. El service_role key se lee desde Vault.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: URL de la función y key de servicio (ajustar si cambia el proyecto)
--   project ref: yiczgdtirrkdvohdquzf
--   La service_role key se guarda en Vault como 'service_role_key'.
--   (Mismo secreto que usa el cron de ventas.)

-- ── Limpiar jobs previos con estos nombres (evita duplicados) ──────────────
do $$
begin
  perform cron.unschedule('satori-report-dia-1');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('satori-report-dia-15-propinas');
exception when others then null;
end $$;

-- ── Día 1 · 14:00 UTC (08:00 CR) — mes anterior, ventas + propinas ─────────
select cron.schedule(
  'satori-report-dia-1',
  '0 14 1 * *',
  $$
  select net.http_post(
    url     := 'https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/monthly-report',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := jsonb_build_object('tipo', 'ambos')  -- month vacío → mes anterior
  );
  $$
);

-- ── Día 15 · 14:00 UTC (08:00 CR) — quincenal de PROPINAS, mes EN CURSO ─────
-- El mes en curso se calcula en runtime en zona horaria de Costa Rica y se
-- pasa explícitamente para que la función NO reste un mes (su default).
select cron.schedule(
  'satori-report-dia-15-propinas',
  '0 14 15 * *',
  $$
  select net.http_post(
    url     := 'https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/monthly-report',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := jsonb_build_object(
      'tipo',  'propinas',
      'month', to_char((now() at time zone 'America/Costa_Rica'), 'YYYY-MM')
    )
  );
  $$
);

-- ── Verificación ───────────────────────────────────────────────────────────
-- select jobname, schedule, active from cron.job where jobname like 'satori-report%';
