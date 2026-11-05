-- staging_respaldos_cierre_anon.sql — SOLO STAGING (hwiatgicyyqyezqwldia). NO es una migración.
-- Los respaldos *_pre_migracion_2026_07 tenían RLS apagado: anon y authenticated podían
-- leerlos, modificarlos o borrarlos. Se cierran sin borrarlos (decidir aparte si se borran).
-- Idempotente.
begin;
alter table public.cash_movements_pre_migracion_2026_07 enable row level security;
alter table public.suppliers_pre_migracion_2026_07      enable row level security;
revoke all on public.cash_movements_pre_migracion_2026_07 from anon, authenticated;
revoke all on public.suppliers_pre_migracion_2026_07      from anon, authenticated;
commit;
