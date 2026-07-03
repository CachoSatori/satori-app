-- 041 — Unificación Bandeja↔Caja: clasificación advisory en cash_movements. ADITIVA e IDEMPOTENTE.
--
-- ⚠ BORRADOR — NO MERGEAR / NO APLICAR SIN FIRMA DE LA DUEÑA.
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla (con firma): regenerar los tipos de Supabase.
--
-- FUENTE DE VERDAD: docs/SPEC-unificacion-bandeja-caja.md §6 (auto-clasificación advisory) y §13.
--
-- SOLO agrega 3 columnas nullable. Las filas existentes quedan en NULL. CERO UPDATE de datos,
-- CERO backfill, ningún ALTER que cambie o borre columnas existentes.

-- classification           = clasificación CONFIRMada por el humano ('mercaderia' | 'operativa')
-- suggested_classification = sugerencia de la IA (advisory; el humano confirma — RN-2)
-- suggested_confidence     = confianza [0..1] de la sugerencia
alter table public.cash_movements
  add column if not exists classification text;
alter table public.cash_movements
  add column if not exists suggested_classification text;
alter table public.cash_movements
  add column if not exists suggested_confidence numeric;

-- Check NULL-permisivo (no toca filas viejas: todas quedan NULL → pasan). Solo valida escrituras nuevas.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cash_movements_classification_chk'
  ) then
    alter table public.cash_movements
      add constraint cash_movements_classification_chk
      check (classification is null or classification in ('mercaderia','operativa'));
  end if;
end $$;

comment on column public.cash_movements.classification is
  'Unificación Bandeja↔Caja: vía del ítem confirmada por el humano (mercaderia=genera tarea de inventario; operativa=gasto directo). NULL en filas previas a la unificación.';
