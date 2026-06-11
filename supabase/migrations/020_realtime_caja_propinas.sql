-- 020: tiempo real multi-dispositivo — publicar caja y propinas en supabase_realtime
-- (postgres_changes respeta RLS: cada cliente solo recibe filas que puede leer).
-- Idempotente.

do $$
declare
  t text;
begin
  foreach t in array array['cash_movements', 'cash_sessions', 'cash_cierres_dia', 'tip_sessions', 'tip_entries']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
