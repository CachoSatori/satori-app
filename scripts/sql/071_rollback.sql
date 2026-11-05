-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 071_rollback · Deshace supabase/migrations/071_cierre_dia_atomico.sql                ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Antes de la 071 no existían estas funciones, la columna ni el índice: el rollback los borra.
-- ORDEN: primero revertir el CÓDIGO (revert del merge) para que el cliente vuelva a las 4
-- llamadas viejas; recién después correr esto. Si se corre con el cliente nuevo desplegado,
-- el cierre falla con «function not found» (sin escribir nada).
--
-- Datos: las filas que escribió la RPC tienen el mismo formato que las del guardado viejo →
-- no hace falta tocarlas. `close_op_id` se borra (solo lo usa la RPC).
-- NO toca el ledger: si se corre, borrar a mano la fila 071 de supabase_migrations.schema_migrations.

begin;

drop function if exists public.cerrar_dia_completo(date, uuid, jsonb, jsonb, numeric, jsonb, numeric);
drop function if exists public.deshacer_cierre_dia(date, text, text);
drop function if exists public.cierre_ajuste_op_id(date, text);
drop index if exists public.cash_cierres_dia_session_date_key;
alter table public.cash_cierres_dia drop column if exists close_op_id;

commit;
