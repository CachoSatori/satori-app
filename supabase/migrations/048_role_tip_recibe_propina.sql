-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 048 — role_tip_points.recibe_propina: elegibilidad de propina por ROL (configuración).  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING. ⚠ Se escribe en la rama; se aplica QUIRÚRGICA a staging con el ritual
--    (ref hwiatgicyyqyezqwldia; cat supabase/.temp/project-ref → confirmar; si
--    `db query --linked` cuelga → curl a la Management API). `schema_migrations` NO se toca.
--    NUNCA a prod sin firma. Tras aplicarla: verificar la columna (select) y refrescar tipos.
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────
-- La "elegibilidad de propina" deja de ser hardcode y pasa a ser configuración por rol. Un
-- rol con recibe_propina=false NO aparece en el roster del turno ni entra al pool. El flag es
-- REVERSIBLE desde Admin → Puntos por rol (toggle "Recibe propina").
--
-- ── SIN CAMBIOS RETROACTIVOS ───────────────────────────────────────────────────────────
-- DEFAULT true: TODOS los roles siguen recibiendo como hasta hoy → cero cambio de
-- comportamiento tras aplicar la migración. El flip de MANAGER a false se hace por la UI de
-- Admin (NO en esta migración), y afecta solo turnos NUEVOS: los turnos ya cerrados se
-- reconstruyen desde sus entradas guardadas y no se re-tocan.
--
-- La matemática del reparto (tipCalculations: PROPINA_ROLES/NO_PROPINA_ROLES/BAR_ROLES,
-- calcTurno) NO se toca: el rol excluido simplemente no genera línea/entrada, así que nunca
-- recibe puntos. Aditiva e idempotente (IF NOT EXISTS). No toca RLS, realtime ni otra tabla.

alter table public.role_tip_points
  add column if not exists recibe_propina boolean not null default true;
