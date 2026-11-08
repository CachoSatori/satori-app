-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 087 — Auditoría de cambios de employees: pos_login, rol e is_active. ADITIVA.          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ PROPUESTA. NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL. Primero staging, después prod con su OK.
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- Hoy `employees` no deja rastro: si alguien cambia el «Login del PoS» de un empleado, su rol o lo
-- desactiva, no se sabe quién ni cuándo. El login del PoS decide a quién se le atribuyen las ventas
-- (ranking, Mi Rendimiento, ICP), así que un cambio silencioso mueve números entre personas.
--
-- ── DISEÑO (mismo patrón que movement_edits, mig 052) ──────────────────────────────────────
--   · Trigger AFTER UPDATE OF pos_login, role, is_active, con WHEN: solo dispara si alguna de las
--     tres cambió de verdad (no registra no-ops ni el toque de updated_at).
--   · `changed` = solo las columnas que cambiaron, con forma { campo: {old, new} }. No guarda la fila
--     entera: employees no tiene plata, y así la traza no copia datos que no hacen falta.
--   · edited_by = auth.uid(). Por el canal admin (Management API / service_role) queda NULL a
--     propósito: igual deja rastro, sin actor identificado.
--   · Append-only: RLS on, SOLO policy de SELECT para el owner. Sin INSERT/UPDATE/DELETE: ningún
--     cliente logueado puede forjar ni borrar trazas. El único escritor es el trigger (SECURITY DEFINER).
--   · employee_id es uuid plano (sin FK): la traza sobrevive si el empleado se borra.
--
-- ── NO TOCA ────────────────────────────────────────────────────────────────────────────────
--   · employees: ni columnas, ni índices, ni policies, ni el trigger BEFORE trg_employees_updated_at.
--   · Sagrados: cero. Código de la app: cero (la pantalla puede leer la tabla después, aparte).
--
-- Rollback: scripts/sql/087_rollback.sql (borra trigger, función y tabla; se pierden las trazas).

create table if not exists public.employee_edits (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        not null,                        -- uuid plano, sin FK (ver cabecera)
  edited_by   uuid        references public.profiles(id) on delete set null,  -- auth.uid(); NULL por canal admin
  edited_at   timestamptz not null default now(),
  changed     jsonb       not null                         -- { campo: {old, new} } de pos_login / role / is_active
);

create index if not exists employee_edits_employee_idx on public.employee_edits (employee_id, edited_at desc);

alter table public.employee_edits enable row level security;

drop policy if exists employee_edits_select on public.employee_edits;
create policy employee_edits_select on public.employee_edits for select
  to authenticated
  using (get_my_role() = 'owner');

create or replace function public.log_employee_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed jsonb := '{}'::jsonb;
begin
  if old.pos_login is distinct from new.pos_login then
    v_changed := v_changed || jsonb_build_object('pos_login', jsonb_build_object('old', old.pos_login, 'new', new.pos_login));
  end if;
  if old.role is distinct from new.role then
    v_changed := v_changed || jsonb_build_object('role', jsonb_build_object('old', old.role, 'new', new.role));
  end if;
  if old.is_active is distinct from new.is_active then
    v_changed := v_changed || jsonb_build_object('is_active', jsonb_build_object('old', old.is_active, 'new', new.is_active));
  end if;
  if v_changed <> '{}'::jsonb then
    insert into public.employee_edits (employee_id, edited_by, changed)
    values (new.id, auth.uid(), v_changed);
  end if;
  return null;   -- AFTER: el valor de retorno se ignora
end;
$$;

revoke all on function public.log_employee_edit() from public, anon, authenticated;

drop trigger if exists trg_employees_audit on public.employees;
create trigger trg_employees_audit
  after update of pos_login, role, is_active on public.employees
  for each row
  when (old.pos_login is distinct from new.pos_login
     or old.role      is distinct from new.role
     or old.is_active is distinct from new.is_active)
  execute function public.log_employee_edit();
