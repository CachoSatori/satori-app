-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 095 — el contador LEE caja (solo SELECT). Decisión del dueño, 10-nov.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ SIN FIRMA. No se mergea ni se aplica en prod sin la firma del dueño. Orden: … → 093 → 094 → 095.
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- La ruta /caja deja entrar al contador (src/App.tsx), pero la pantalla le sale vacía: las lecturas de
-- cash_movements, cash_sessions y suppliers son solo para owner, manager y cajero. El resto de lo que lee la pantalla
-- (cash_cierres_dia, movement_edits, movement_deletions, supplier_credits, credit_applications, documents,
-- exchange_rates, tip_sessions, tip_entries, employees y las fotos del bucket facturas) el contador ya lo lee hoy
-- (verificado en staging el 10-nov: ve lo mismo que el owner, salvo employees, donde ve los activos, como el cajero).
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
--   · Una policy PERMISIVA de SELECT por tabla, para el contador ACTIVO: `(select get_my_role()) = 'contador'`
--     (get_my_role() es null con la cuenta inactiva, como en la 085 y la 093):
--       cash_movements, cash_sessions y suppliers.
--   · Nada de escritura: no agrega ninguna policy de INSERT, UPDATE ni DELETE. Las de escritura de hoy no cambian.
--   · Convive con la 091: las policies restrictivas por local siguen aplicando (AND); el contador ve los locales de
--     mis_locales(), que para él son todos (decisión 2 del plan multilocal).
--   · Verifica al final (y si no, aborta): las 3 policies existen, son SELECT y permisivas, y no hay ninguna policy de
--     escritura que nombre al contador en cash_sessions ni en suppliers.
--
-- ── LO QUE NO TOCA (y hay que saber) ─────────────────────────────────────────────────────────
--   · `cash_movements_contador_insert` (mig 038, bandeja): el contador ya puede CREAR movimientos que no son en efectivo,
--     pendientes o de Banco. Es de antes y esta migración no la cambia; decidir aparte si se mantiene.
--
-- Pruebas: scripts/sql/095_pruebas.sh (solo staging, transacciones descartadas). Rollback: scripts/sql/095_rollback.sql.

begin;

drop policy if exists cash_movements_contador_select on public.cash_movements;
create policy cash_movements_contador_select on public.cash_movements for select to authenticated
  using ((select public.get_my_role()) = 'contador');

drop policy if exists cash_sessions_contador_select on public.cash_sessions;
create policy cash_sessions_contador_select on public.cash_sessions for select to authenticated
  using ((select public.get_my_role()) = 'contador');

drop policy if exists suppliers_contador_select on public.suppliers;
create policy suppliers_contador_select on public.suppliers for select to authenticated
  using ((select public.get_my_role()) = 'contador');

do $$
declare v_n int; v_mal text;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
     and (tablename, policyname) in (('cash_movements', 'cash_movements_contador_select'),
                                     ('cash_sessions', 'cash_sessions_contador_select'),
                                     ('suppliers', 'suppliers_contador_select'));
  if v_n <> 3 then raise exception '095: se esperaban 3 policies de lectura del contador, hay %', v_n; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_mal from pg_policies
   where schemaname = 'public' and tablename in ('cash_sessions', 'suppliers') and cmd <> 'SELECT'
     and coalesce(qual, '') || coalesce(with_check, '') ~ 'contador';
  if v_mal is not null then raise exception '095: hay una policy de escritura con el contador: %', v_mal; end if;
end $$;

commit;
