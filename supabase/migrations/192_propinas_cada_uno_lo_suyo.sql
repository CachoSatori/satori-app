-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 192 · Propinas: cada uno ve solo lo suyo (cierra la lectura de todo el equipo)        ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Número: 192 (origen 137). La 191 (#292) ya está en prod; esta es la próxima en entrar.
--
-- Decisión del dueño, 18-nov-2026 12:55 -06:00: «en propinas sí, cada uno tiene que poder ver solo lo que se llevaron
-- ellos, no lo del equipo». La firma final va sobre el SHA del PR.
--
-- Hallazgo (18-nov, staging, JWT de un salonero): la policy «Todos ven entradas de propinas» (073 → 085) deja leer
-- `tip_entries` a CUALQUIER rol activo (`get_my_role() is not null`): un salonero leía las filas de todo el equipo
-- (horas, puntos, lo cobrado `payout_crc` y la propina electrónica generada), con el `employee_id` que se cruza con
-- el nombre en `employees`. Lo usa `getAttendanceHistory` (Mi Rendimiento) y cualquiera lo puede pedir a la API.
--
-- Después de la 192 (solo LECTURA de `tip_entries`; no cambia nada más):
--   · owner, manager, cajero, contador activos → todas las filas, como hoy (reparto, pagos, Historial, Quincenal,
--     Estadísticas, Cocina, Resumen, Reporte mensual, ICP de Ventas, Admin → Horas).
--   · cualquier otro rol activo (salonero, barman, barback, runner, cocina, proveedor) → SOLO las filas de los
--     empleados atados a SU perfil (`employees.profile_id = auth.uid()`, activos o no, como la 191).
--   · inactivos / anon → nada (como hoy).
-- Escrituras: `tip_entries_op_write` (owner/manager/cajero) NO se toca. `tip_sessions` NO se toca: sus columnas son
-- del turno entero (pozos, tipo de cambio), sin desglose por persona.
--
-- Helper nuevo: `propinas_mis_empleados()` → uuid[] con los ids de empleado del usuario actual (vacío si su rol no
-- está activo). `security definer` para no depender de la RLS de `employees` (que solo muestra activos); devuelve
-- solo ids propios, nada de otros. EXECUTE solo para `authenticated` (la policy lo llama con los derechos del que lee).
--
-- Guarda (R13): exige que las policies vivas de `tip_entries` sean EXACTAMENTE las dos de hoy (md5 de
-- qual|with_check|cmd|permissive|roles, leído en prod y en staging el 18-nov) y que el helper no exista. Si algo no
-- coincide, aborta sin tocar nada. No es re-ejecutable.
-- Vuelta atrás: migración NUEVA hacia adelante (scripts/sql/192_rollback.sql, sin numerar; regla 10). Pruebas por rol:
-- scripts/sql/192_pruebas.sql (+ 192_pruebas.py; transacción que termina en ROLLBACK).
begin;

-- ── Guarda: las policies de tip_entries tienen que ser las de hoy ───────────────────────
do $guarda192$
declare
  r record;
  n integer;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'tip_entries';
  if n <> 2 then
    raise exception '192: tip_entries tiene % policies (se esperaban 2): se para sin tocar nada', n;
  end if;
  for r in select * from (values
    ('Todos ven entradas de propinas', 'a4d0a0e9aacc129de8d082c512aeeb3c'),
    ('tip_entries_op_write',           'da4dc6bf46cdceb8966878214e7405cd')
  ) as x(pol, esperado) loop
    if (select md5(coalesce(p.qual, '') || '|' || coalesce(p.with_check, '') || '|' || p.cmd || '|' || p.permissive
                   || '|' || p.roles::text)
        from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'tip_entries' and p.policyname = r.pol)
       is distinct from r.esperado then
      raise exception '192: la policy «%» de tip_entries no es la esperada: se para sin tocar nada', r.pol;
    end if;
  end loop;
  if to_regprocedure('public.propinas_mis_empleados()') is not null then
    raise exception '192: propinas_mis_empleados() ya existe: se para sin tocar nada';
  end if;
end
$guarda192$;

-- ── Helper: mis ids de empleado ─────────────────────────────────────────────────────────
create function public.propinas_mis_empleados()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(e.id), array[]::uuid[])
  from public.employees e
  where e.profile_id = auth.uid()
    and public.get_my_role() is not null
$$;

revoke all on function public.propinas_mis_empleados() from public;
revoke all on function public.propinas_mis_empleados() from anon;
grant execute on function public.propinas_mis_empleados() to authenticated;

comment on function public.propinas_mis_empleados() is
  '192: ids de empleado del usuario actual (activos o no); vacío si su rol no está activo. Lo usa la policy tip_entries_lee_lo_propio.';

-- ── Lectura de tip_entries: gestión ve todo; el resto, solo lo suyo ─────────────────────
drop policy "Todos ven entradas de propinas" on public.tip_entries;

create policy tip_entries_lee_gestion on public.tip_entries
  for select to authenticated
  using (public.get_my_role() = any (array['owner', 'manager', 'cajero', 'contador']::public.user_role[]));

create policy tip_entries_lee_lo_propio on public.tip_entries
  for select to authenticated
  using (employee_id in (select unnest(public.propinas_mis_empleados())));

commit;
