-- 018 · Caja Diaria de proveedores ÚNICA por día
-- Aditiva (no reescribe datos). Agrega el "visto" del check de mediodía a cash_sessions.
-- El código es defensivo: si estas columnas aún no existen, no rompe (la lectura da
-- undefined y el botón de check avisa que falta correr esta migración).

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS midday_check_by  UUID        REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS midday_check_at  TIMESTAMPTZ;
