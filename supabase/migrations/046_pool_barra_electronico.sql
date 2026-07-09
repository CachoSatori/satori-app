-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 046 — pool_barra_electronico_crc: separa la propina de BARRA electrónica del efectivo.  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ FIRMADA (SPEC docs/SPEC-propinas-efectivo-electronico.md). ⚠ NO APLICADA TODAVÍA — este
--    archivo solo se escribe en la rama; se aplica después con el procedimiento de STAGING
--    (ref hwiatgicyyqyezqwldia; ritual: cat supabase/.temp/project-ref → confirmar; si
--    db query --linked cuelga → curl a la Management API), NUNCA directo en producción.
--    `db push` sigue FRENADO por la reconciliación del ledger — esta migración se aplica
--    quirúrgica y `schema_migrations` NO se toca. Tras aplicarla: regenerar/verificar tipos.
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────
-- La cuenta por pagar de propinas ("Propinas por pagar" en Caja) debe generarse SOLO por la
-- porción ELECTRÓNICA (datáfono/SINPE/tarjeta). El efectivo ya está en mano del equipo y NUNCA
-- genera movimiento ni pendiente. Para poder separar la propina de BARRA en su parte efectiva
-- (columna existente pool_barra_crc) y su parte electrónica, se agrega esta columna nueva.
--
-- ── SIN CAMBIOS RETROACTIVOS ───────────────────────────────────────────────────────────
-- DEFAULT 0: todo turno histórico queda con barra electrónica = 0, es decir su pool_barra_crc
-- se interpreta como efectivo. Nada se backfillea. El reparto (tipCalculations) NO se toca:
-- a calcTurno se le pasa la SUMA (barra efectivo + barra electrónica), idéntico al valor único
-- que recibía antes → el take_home por empleado no cambia.
--
-- Aditiva e idempotente (IF NOT EXISTS). No toca RLS, ni realtime, ni ninguna otra tabla.

alter table public.tip_sessions
  add column if not exists pool_barra_electronico_crc numeric not null default 0;
