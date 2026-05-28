-- ============================================================
-- Módulo Propinas v2 — Pool fields + shift_type + cajero pts
-- ============================================================

-- 1. Agregar campos de pool a tip_sessions
ALTER TABLE public.tip_sessions
  ADD COLUMN IF NOT EXISTS shift_type          VARCHAR(2)    NOT NULL DEFAULT 'PM',
  ADD COLUMN IF NOT EXISTS pool_efectivo_crc   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pool_efectivo_usd   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pool_barra_crc      NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Agregar cajero con 4 pts (mismo que la app original)
INSERT INTO public.role_tip_points (role, points) VALUES
  ('cajero', 4)
ON CONFLICT (role) DO UPDATE SET points = EXCLUDED.points;
