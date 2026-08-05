-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 051 — pool_total_crc: persiste el TOTAL REAL del pool por sesión (fuente de verdad).     ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NO APLICADA TODAVÍA — este archivo solo se escribe en la rama (fase BUILD). Se aplica
--    después con el procedimiento de STAGING (ref hwiatgicyyqyezqwldia; ritual:
--    cat supabase/.temp/project-ref → confirmar; si db query --linked cuelga → curl a la
--    Management API), NUNCA directo en producción. `db push` sigue FRENADO por la
--    reconciliación del ledger — esta migración se aplica quirúrgica y `schema_migrations`
--    NO se toca. Tras aplicarla: regenerar/verificar tipos (supabase.gen.ts).
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────
-- El total real del pool de un turno = calcTurno/calcHistory().totalPool (SAGRADO):
--     efectivo + propinaSala (tip_amount de las entries de SALA, por covered_role CANÓNICO)
--     + barra (efectivo + electrónica).
-- Las columnas pool_efectivo_*/pool_barra_* de la sesión NO alcanzan para reconstruirlo sin
-- releer tip_entries (les falta propinaSala) → hoy la fila colapsada de Historial subcuenta
-- (poolTotalOf) hasta que se expande y se corre el reparto. Esta columna guarda el número real
-- calculado al cerrar/editar el turno, para que Historial (y a futuro todos los reportes) lo
-- muestren SIEMPRE sin recomputar.
--
-- ── NULLABLE, SIN DEFAULT, SIN DATOS ───────────────────────────────────────────────────
-- La columna nace NULL en todas las filas (sin default, sin backfill acá). El backfill vive
-- aparte (scripts/pool-backfill), corre el SAGRADO calcHistory por sesión y ESCRIBE SOLO esta
-- columna; es re-ejecutable y tiene --dry-run. Mientras esté NULL, la lectura cae al fallback
-- actual (poolTotalOf) → cero cambio de comportamiento para turnos históricos.
--
-- El reparto (tipCalculations) NO se toca: pool_total_crc es un derivado persistido, no entra
-- a ningún cálculo. Aditiva e idempotente (IF NOT EXISTS). No toca RLS, ni realtime, ni
-- ninguna otra tabla.

alter table public.tip_sessions
  add column if not exists pool_total_crc numeric;

comment on column public.tip_sessions.pool_total_crc is
  'Total real del pool del turno = calcTurno/calcHistory().totalPool (efectivo + propinaSala por '
  'covered_role + barra ef+elec). NULL = sin calcular (cae al fallback poolTotalOf). Lo escribe '
  'el cierre/edición del turno y el backfill (scripts/pool-backfill); derivado, no entra al reparto.';
