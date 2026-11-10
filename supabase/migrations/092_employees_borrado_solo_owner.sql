-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 092 — R7-01: solo el owner borra un empleado con login del PoS, y cada baja deja rastro. ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ PROPUESTA. NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL: toca `employees`, que está en prod. Staging primero.
--
-- ── DIAGNÓSTICO (prod, solo lectura, 09-nov 07:32 CR) ──────────────────────────────────────
--   · La política «Owners y managers gestionan empleados» es FOR ALL (owner y manager): un manager puede BORRAR filas.
--   · La única FK hacia employees es tip_entries.employee_id, ON DELETE NO ACTION: un empleado con propinas no se
--     puede borrar (23503). Pero uno con login del PoS y sin propinas, sí: hoy son 2 de los 15 que tienen login.
--     Borrarlo pierde el vínculo login → persona (ventas, ranking, ICP) sin rastro.
--   · La sesión del Club agregó en su rama (075) un trigger para que solo el owner CAMBIE pos_login; el BORRADO no
--     lo cubre. Esta migración no depende de esa (la tabla de rastro es propia: en prod no existe la del Club).
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
--   · Trigger BEFORE DELETE en employees: si la fila tiene pos_login y quien borra es un usuario (hay auth.uid())
--     que NO es owner activo → 42501 «Solo el owner borra un empleado con login del PoS. Para sacarlo, desactivalo.»
--     (La baja lógica —is_active = false— sigue siendo el camino normal y no pasa por acá.)
--   · Cada borrado que SÍ pasa (owner, o el canal admin sin JWT) deja una fila en `employee_bajas` con lo MÍNIMO
--     (Grok 142): id, pos_login, nombre, sus fechas de alta y de última edición, quién (auth.uid(); NULL = canal admin)
--     y cuándo. No la ficha completa. Solo inserción: RLS con SELECT solo para el owner,
--     sin políticas de escritura; el único que escribe es el trigger (SECURITY DEFINER).
--   · No toca la política de employees, ni sus columnas, ni la FK de tip_entries.
--
-- Pruebas: scripts/sql/092_pruebas.sh (solo staging, transacciones descartadas, esperados por caso).
-- Rollback: scripts/sql/092_rollback.sql.

begin;

-- Grok 142, decisión del dueño (10-nov): se guarda SOLO lo mínimo (id, pos_login, nombre, fechas y quién lo borró),
-- no la ficha completa (nada de salario, banco, horarios ni otros datos de la persona).
create table if not exists public.employee_bajas (
  id                     uuid        primary key default gen_random_uuid(),
  employee_id            uuid        not null,                   -- uuid plano: el empleado ya no existe
  pos_login              text,
  full_name              text        not null,
  empleado_creado_en     timestamptz,                            -- employees.created_at
  empleado_actualizado_en timestamptz,                           -- employees.updated_at
  borrado_por            uuid        references public.profiles(id) on delete set null,   -- auth.uid(); NULL = canal admin
  borrado_en             timestamptz not null default now()
);
create index if not exists employee_bajas_employee_idx on public.employee_bajas (employee_id, borrado_en desc);

alter table public.employee_bajas enable row level security;
revoke all on table public.employee_bajas from anon, public;
drop policy if exists employee_bajas_select_owner on public.employee_bajas;
create policy employee_bajas_select_owner on public.employee_bajas for select to authenticated
  using (get_my_role() = 'owner');

create or replace function public.employees_borrado_guardia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.pos_login is not null and auth.uid() is not null and get_my_role() is distinct from 'owner' then
    raise exception 'Solo el owner borra un empleado con login del PoS. Para sacarlo, desactivalo.'
      using errcode = '42501';
  end if;
  insert into public.employee_bajas (employee_id, pos_login, full_name, empleado_creado_en, empleado_actualizado_en, borrado_por)
  values (old.id, old.pos_login, old.full_name, old.created_at, old.updated_at, auth.uid());
  return old;
end;
$$;
revoke all on function public.employees_borrado_guardia() from public, anon, authenticated;

drop trigger if exists trg_employees_borrado_guardia on public.employees;
create trigger trg_employees_borrado_guardia
  before delete on public.employees
  for each row execute function public.employees_borrado_guardia();

commit;
