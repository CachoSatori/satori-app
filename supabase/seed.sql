-- ============================================================
-- Satori App — Datos iniciales
-- ============================================================

-- Puntos por rol (valores operativos de Satori)
-- Solo los roles que participan en el pool de propinas.
-- cajero, owner y contador no se incluyen (no participan del pool).
INSERT INTO public.role_tip_points (role, points) VALUES
  ('salonero', 10),
  ('barman',    5),
  ('barback',   4),
  ('runner',    3),
  ('cocina',    5),
  ('manager',   3)
ON CONFLICT (role) DO UPDATE SET points = EXCLUDED.points;
