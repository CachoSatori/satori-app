-- ============================================================
-- Satori App — Datos iniciales
-- ============================================================

-- Puntos por rol (valores operativos de Satori)
INSERT INTO public.role_tip_points (role, points) VALUES
  ('salonero', 10),
  ('barman',    5),
  ('barback',   4),
  ('runner',    3),
  ('cocina',    5),
  ('manager',   3),
  ('cajero',    0),
  ('owner',     0),
  ('contador',  0)
ON CONFLICT (role) DO UPDATE SET points = EXCLUDED.points;
