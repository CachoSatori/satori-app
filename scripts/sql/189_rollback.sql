-- Vuelta atrás de la 189 (cron del correo quincenal al contador). Baja SOLO la tarea `satori-ventas-dia-contador`
-- (cron.unschedule, R01) y la fila 189 del ledger. No toca los jobs 3, 4 ni 8 ni la Edge (apagar la Edge no hace
-- falta: sin la tarea nadie la llama; si se quiere, se borra aparte con firma).
-- EN EL MISMO MOMENTO: un PR que saca supabase/migrations/189_cron_ventas_dia_contador.sql de main (si queda,
-- Branching la vuelve a aplicar; regla 10). Si la 189 ya está en el ledger y hay que dejarla, la alternativa sin
-- tocar el ledger es solo el `cron.unschedule` de abajo + una migración nueva hacia adelante (R14).
begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador') then
    perform cron.unschedule('satori-ventas-dia-contador');
  end if;
end $$;

delete from supabase_migrations.schema_migrations where version = '189';

-- Verificación dentro de la transacción: la tarea ya no está y las otras siguen.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'satori-ventas-dia-contador') then
    raise exception 'PARAR: la tarea sigue programada';
  end if;
end $$;

commit;
