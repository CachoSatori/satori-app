-- BLOQUE E · vuelta atrás de la tanda, AL REVÉS: 095 → 094 → 093 → 092. Cada bloque es UNA transacción y se corre solo
-- si su versión está en el ledger (ver la tabla de §7). La precondición exige exactamente 1 fila de esa versión, que sea la
-- ÚLTIMA del ledger y que el ledger tenga 61+n filas (Grok 175). Después de la última: el bloque D0 tiene que dar la tanda
-- vacía, y recién ahí el revert del merge (Grok 186).

-- ── E.095 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '095') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 095 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 095 y tiene que haber 65 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '095' then
    raise exception 'precondición: la última versión del ledger no es la 095: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 65 then
    raise exception 'precondición: el ledger no tiene 65 filas: no se toca nada';
  end if;
end $pre$;
drop policy if exists cash_movements_contador_select on public.cash_movements;
drop policy if exists cash_sessions_contador_select on public.cash_sessions;
drop policy if exists suppliers_contador_select on public.suppliers;
delete from supabase_migrations.schema_migrations where version = '095';
commit;

-- ── E.094 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '094') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 094 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 094 y tiene que haber 64 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '094' then
    raise exception 'precondición: la última versión del ledger no es la 094: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 64 then
    raise exception 'precondición: el ledger no tiene 64 filas: no se toca nada';
  end if;
end $pre$;
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits',
    'pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops',
    'supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist',
    'ventas_metas','salary_periods'] loop
    continue when to_regclass('public.' || v_t) is null;
    execute format('grant maintain on table public.%I to anon', v_t);
  end loop;
end $$;
delete from supabase_migrations.schema_migrations where version = '094';
commit;

-- ── E.093 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '093') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 093 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 093 y tiene que haber 63 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '093' then
    raise exception 'precondición: la última versión del ledger no es la 093: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 63 then
    raise exception 'precondición: el ledger no tiene 63 filas: no se toca nada';
  end if;
end $pre$;
alter policy ventas_dias_read  on public.ventas_dias  using (true);
alter policy ventas_hist_read  on public.ventas_hist  using (true);
alter policy ventas_metas_read on public.ventas_metas using (true);
alter policy ventas_comps_read on public.ventas_comps using (true);
alter policy product_map_read  on public.product_map  using (true);
delete from supabase_migrations.schema_migrations where version = '093';
commit;

-- ── E.092 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '092') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 092 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 092 y tiene que haber 62 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '092' then
    raise exception 'precondición: la última versión del ledger no es la 092: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 62 then
    raise exception 'precondición: el ledger no tiene 62 filas: no se toca nada';
  end if;
end $pre$;
do $$ begin
  if to_regclass('public.employee_bajas') is not null and exists (select 1 from public.employee_bajas) then
    raise exception '092 rollback: employee_bajas tiene filas: exportarlas antes; no se toca nada';
  end if;
end $$;
drop trigger if exists trg_employees_borrado_guardia on public.employees;
drop function if exists public.employees_borrado_guardia();
drop table if exists public.employee_bajas;
delete from supabase_migrations.schema_migrations where version = '092';
commit;
