-- ============================================================
-- Propinas — Cobertura: rol cubierto por el empleado en un turno
-- ============================================================
-- Cuando un empleado trabaja un puesto distinto a su rol natural,
-- en la división le corresponden los PUNTOS de ese rol cubierto.
-- Guardamos el rol cubierto por entrada para que el reparto persista
-- y el Historial lo refleje correctamente (antes se recalculaba
-- siempre desde el rol natural y la cobertura se perdía).

ALTER TABLE public.tip_entries
  ADD COLUMN IF NOT EXISTS covered_role VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN public.tip_entries.covered_role IS
  'Rol que el empleado cubrió este turno (override del rol natural para el cálculo de puntos). NULL = trabajó en su propio rol.';
