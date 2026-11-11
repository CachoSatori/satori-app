-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 094 — anon sin MAINTAIN en las 20 tablas de la 089 (23 en staging). ENDURECE.           ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ SIN FIRMA. No se mergea ni se aplica en prod sin la firma del dueño. Orden: 089 → 090 → 091 → 092 → 093 → 094.
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- Hallazgo del pase de la 089 en prod (10-nov): Postgres 17 suma el privilegio MAINTAIN (la `m` del ACL:
-- VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW y LOCK TABLE). Los privilegios por defecto de Supabase se
-- lo dieron a anon en cada tabla (`anon=arwdDxtm`), y la 089 no lo saca: su lista de permisos no tenía MAINTAIN.
-- Hoy NO hay fuga ni riesgo práctico (PostgREST no ejecuta SQL suelto como anon); es defensa en profundidad, como la 089.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
--   · revoke maintain a anon en cada tabla de la lista de la 089 que EXISTA (prod no tiene time_punches,
--     punch_exceptions ni salary_periods);
--   · verifica al final (y si no, aborta todo), con el patrón de la 089 y MAINTAIN en la lista: en ninguna tabla de la
--     lista anon conserva MAINTAIN, TRUNCATE, REFERENCES ni TRIGGER, ni SELECT/INSERT/UPDATE/DELETE sin una policy que
--     lo justifique; y PUBLIC no tiene ningún permiso (aclexplode, grantee 0).
--   · No toca: authenticated (también tiene MAINTAIN: ver CLAUDE-HALL-05, decisión aparte), service_role, policies,
--     RLS, ni los privilegios por defecto (la 090 ya los sacó para anon: incluye MAINTAIN).
--
-- Pruebas: scripts/sql/094_pruebas.sh (solo staging, transacciones descartadas). Verificación de solo lectura:
-- scripts/sql/094_verificacion.sql. Rollback: scripts/sql/094_rollback.sql.

begin;

do $$
declare
  v_tablas text[] := array[
    'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits',
    'pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops',
    'supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist',
    'ventas_metas','salary_periods'];
  v_t text; v_resto text;
begin
  foreach v_t in array v_tablas loop
    continue when to_regclass('public.' || v_t) is null;
    execute format('revoke maintain on table public.%I from anon', v_t);
  end loop;

  -- Verificación (la de la 089 con MAINTAIN en la lista): si queda algo, se aborta TODO.
  select string_agg(r.t || ':' || r.p, ', ') into v_resto
    from (select t, p from unnest(v_tablas) t
            cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
           where to_regclass('public.' || t) is not null
             and has_table_privilege('anon', ('public.' || t)::regclass, p)
             and (p in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
                  or not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = t
                                   and pp.roles && array['anon','public']::name[] and pp.cmd in ('ALL', p)))) r;
  if v_resto is not null then
    raise exception '094: anon conserva permisos sin política (o MAINTAIN): %', v_resto;
  end if;
  select string_agg(c.relname || ':' || a.privilege_type, ', ') into v_resto
    from unnest(v_tablas) t
    join pg_class c on c.oid = to_regclass('public.' || t)
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where a.grantee = 0;
  if v_resto is not null then
    raise exception '094: PUBLIC conserva permisos (anon los heredaría): %', v_resto;
  end if;
end $$;

commit;
