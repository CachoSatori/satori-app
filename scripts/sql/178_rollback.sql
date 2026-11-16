-- Rollback de la 178 (origen caja 098): el repo declara las 5 columnas de Caja que existen en prod.
--
-- ══ EN PROD: NADA QUE DESHACER. NO CORRER LA PARTE B EN PROD. ══
-- Las 5 columnas existían en prod antes de la 178 (lectura del 16-nov-2026, docs/pases/PASE-178-columnas-caja.md): la
-- 178 solo leyó el catálogo y no ejecutó ningún ALTER. En prod esas columnas tienen datos reales de caja (montos en
-- dólares de los pagos, apertura y cierre del turno) y la app las usa todos los días: borrarlas rompe Caja y pierde datos.
-- Tampoco se borra la fila 178 del ledger ni se saca el .sql de main (regla 10). Cualquier ajuste: migración NUEVA.
--
-- ── Parte A (prod o cualquier base): solo lectura. Confirma que las 5 siguen como prod. Esperado: 0 filas. ──
begin read only;
select e.col, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as def
  from (values ('cash_movements','amount_usd','0'), ('cash_sessions','initial_cash_crc','0'),
               ('cash_sessions','initial_cash_usd','0'), ('cash_sessions','final_cash_crc',''),
               ('cash_sessions','final_cash_usd','')) e(tabla, col, def_prod)
  left join pg_attribute a on a.attrelid = ('public.' || e.tabla)::regclass and a.attname = e.col and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attname is null or format_type(a.atttypid, a.atttypmod) <> 'numeric' or a.attnotnull
    or coalesce(pg_get_expr(d.adbin, d.adrelid), '') <> e.def_prod;
rollback;

-- ── Parte B: SOLO en una base NUEVA armada desde el repo (local o de prueba), nunca en prod ni staging. ──
-- Deja la base como estaba antes de la 178 (sin las 5 columnas). Comentada a propósito: descomentar solo ahí.
-- begin;
-- do $$ begin
--   if exists (select 1 from public.cash_movements) or exists (select 1 from public.cash_sessions) then
--     raise exception '178_rollback: la base tiene turnos o movimientos de caja: no es una base nueva. Se aborta.';
--   end if;
-- end $$;
-- alter table public.cash_movements drop column if exists amount_usd;
-- alter table public.cash_sessions drop column if exists initial_cash_crc, drop column if exists initial_cash_usd,
--                                  drop column if exists final_cash_crc,   drop column if exists final_cash_usd;
-- delete from supabase_migrations.schema_migrations where version = '178';
-- commit;
