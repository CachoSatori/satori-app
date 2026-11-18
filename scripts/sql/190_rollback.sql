-- Vuelta atrás de la 190 (pos_ventas_resumen). Borra la función y la fila 190 del ledger; no hay datos que volver.
-- La app (Ventas → Resumen) ante «la función no existe» vuelve sola a la lectura de la 067: no se rompe.
-- EN EL MISMO MOMENTO: un PR que saca supabase/migrations/190_pos_ventas_resumen.sql de main (regla 10).
begin;

drop function if exists public.pos_ventas_resumen(text, date, date);
delete from supabase_migrations.schema_migrations where version = '190';

do $$
begin
  if to_regprocedure('public.pos_ventas_resumen(text, date, date)') is not null then
    raise exception '190 rollback: quedó pos_ventas_resumen';
  end if;
end $$;

commit;
