-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 047 — Notificación de pago a proveedores (Etapa 1). ADITIVA e IDEMPOTENTE.               ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NÚMERO 047 estaba RESERVADO para proveedores (hueco 046→048 intencional, ver ESTADO §(c)).
--   Esta es esa migración.
--
-- ⚠ NO MERGEAR A MAIN TODAVÍA. Aplicar SOLO a STAGING (ref hwiatgicyyqyezqwldia) por canal
--   manual/out-of-band (Management API), con firma. A PROD va en un pase aparte (requiere primero
--   la tarea de DNS del remitente propio de Resend). OJO: en `main`, la integración Supabase Branching
--   AUTO-APLICA las migraciones a la base de prod al pushear — por eso este .sql NO va a main aún.
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- Config por proveedor para avisarle el pago de un pendiente por transferencia:
--   · suppliers.email             — correo del proveedor (para el comprobante).
--   · suppliers.whatsapp          — número para el botón wa.me (envío manual desde la app).
--   · suppliers.notificar_pago    — 'no' (default) | 'email'. La app enseña el select No/Email.
--   · cash_movements.proveedor_notificado_at — timestamptz que setea la Edge Function al enviar OK
--     (fire-and-forget post-pago; si es NULL tras pagar = "no enviado" → reintento).
-- Todo null-safe: los campos nuevos arrancan NULL / 'no'; el flujo actual no cambia si no se configuran.

alter table public.suppliers add column if not exists email text;
alter table public.suppliers add column if not exists whatsapp text;
alter table public.suppliers add column if not exists notificar_pago text not null default 'no'; -- 'no' | 'email'

alter table public.cash_movements add column if not exists proveedor_notificado_at timestamptz;
