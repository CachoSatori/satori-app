-- 013 — Movimientos de caja a nivel día (sin turno)
-- Permite registrar movimientos administrativos que no pertenecen a un turno
-- de Caja Diaria: ventas en efectivo generadas por el Cierre del día, y a
-- futuro movimientos de banco / transferencias administrativas.
-- session_id pasa a ser opcional; los movimientos de turno lo siguen usando.

ALTER TABLE cash_movements ALTER COLUMN session_id DROP NOT NULL;
