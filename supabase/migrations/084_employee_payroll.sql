-- ============================================================================
-- 084_employee_payroll.sql — SAL-AUD-01 (auditoría r5), PASO 1: la planilla sale de employees
-- ----------------------------------------------------------------------------
-- Problema: `employees` tiene una policy de lectura para todo usuario con sesión (filas activas,
-- TODAS las columnas), y desde la 055/056/058 guarda ahí la tarifa por hora, el salario fijo, el
-- nombre del beneficiario en el homebanking, el banco y la cuenta. Cualquier cuenta leía la
-- planilla de todos por la API, sin pasar por la app.
--
-- Decisión de Ismael (07/11, opción A): la planilla va a una tabla propia que SOLO leen y escriben
-- owner y contador ACTIVOS (el manager NO ve salarios). Lo mismo para employee_wage_rates.
--
--   1. public.employee_payroll (1 a 1 con employees): hourly_rate_crc, fixed_salary_crc,
--      nombre_homebanking, banco, cuenta_iban_alias. RLS: owner/contador activos (get_my_role(),
--      que desde la 069 exige is_active). Sin EXECUTE/SELECT para anon.
--   2. Copia los datos de employees (solo las filas con algún dato de planilla).
--   3. Vacía esas columnas en employees (0 / null) y agrega un CHECK que impide volver a
--      escribirlas ahí (un cliente viejo en caché que intente guardar una tarifa en employees
--      recibe un error en vez de volver a exponerla). Las columnas se BORRAN en el paso 2, en un
--      PR aparte, cuando nada las use: así este paso se puede deshacer sin perder datos.
--   4. employee_wage_rates: lectura y escritura solo owner/contador (antes también manager).
--
-- NO cambia (decisión pendiente de Ismael, ver el plan r5): salary_lines y employee_payments
-- también tienen montos y hoy los ve el manager (y employee_payments la escribe owner/manager).
--
-- Solo staging (Salarios 055–061 no está en prod): va a prod con el pase de Salarios.
-- Re-ejecutable. Rollback: scripts/sql/084_rollback.sql (devuelve los datos a employees).
-- ============================================================================

begin;

-- ── 1. Tabla ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_payroll (
  employee_id        uuid          primary key references public.employees(id) on delete cascade,
  hourly_rate_crc    numeric       not null default 0 check (hourly_rate_crc  >= 0),
  fixed_salary_crc   numeric       not null default 0 check (fixed_salary_crc >= 0),
  nombre_homebanking text,
  banco              text,
  cuenta_iban_alias  text,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

drop trigger if exists employee_payroll_updated_at on public.employee_payroll;
create trigger employee_payroll_updated_at
  before update on public.employee_payroll
  for each row execute function public.handle_updated_at();

alter table public.employee_payroll enable row level security;
revoke all on public.employee_payroll from anon;
grant select, insert, update, delete on public.employee_payroll to authenticated;

drop policy if exists employee_payroll_select on public.employee_payroll;
create policy employee_payroll_select on public.employee_payroll for select to authenticated
  using (public.get_my_role() in ('owner', 'contador'));

drop policy if exists employee_payroll_write on public.employee_payroll;
create policy employee_payroll_write on public.employee_payroll for all to authenticated
  using      (public.get_my_role() in ('owner', 'contador'))
  with check (public.get_my_role() in ('owner', 'contador'));

-- ── 2. Copia (re-ejecutable: después del paso 3 las columnas de employees están vacías) ─────────
insert into public.employee_payroll
  (employee_id, hourly_rate_crc, fixed_salary_crc, nombre_homebanking, banco, cuenta_iban_alias)
select id, hourly_rate_crc, fixed_salary_crc,
       nullif(btrim(nombre_homebanking), ''), nullif(btrim(banco), ''), nullif(btrim(cuenta_iban_alias), '')
  from public.employees
 where hourly_rate_crc <> 0 or fixed_salary_crc <> 0
    or nullif(btrim(nombre_homebanking), '') is not null
    or nullif(btrim(banco), '') is not null
    or nullif(btrim(cuenta_iban_alias), '') is not null
on conflict (employee_id) do update set
  hourly_rate_crc    = excluded.hourly_rate_crc,
  fixed_salary_crc   = excluded.fixed_salary_crc,
  nombre_homebanking = excluded.nombre_homebanking,
  banco              = excluded.banco,
  cuenta_iban_alias  = excluded.cuenta_iban_alias;

-- ── 3. employees queda sin planilla ────────────────────────────────────────────────────────
update public.employees
   set hourly_rate_crc = 0, fixed_salary_crc = 0,
       nombre_homebanking = null, banco = null, cuenta_iban_alias = null
 where hourly_rate_crc <> 0 or fixed_salary_crc <> 0
    or nombre_homebanking is not null or banco is not null or cuenta_iban_alias is not null;

alter table public.employees drop constraint if exists employees_planilla_en_employee_payroll;
alter table public.employees add constraint employees_planilla_en_employee_payroll check (
  hourly_rate_crc = 0 and fixed_salary_crc = 0
  and nombre_homebanking is null and banco is null and cuenta_iban_alias is null
);

-- ── 4. employee_wage_rates: sin manager ────────────────────────────────────────────────────
alter policy employee_wage_rates_select on public.employee_wage_rates
  using (public.get_my_role() in ('owner', 'contador'));
alter policy employee_wage_rates_write on public.employee_wage_rates
  using      (public.get_my_role() in ('owner', 'contador'))
  with check (public.get_my_role() in ('owner', 'contador'));

commit;
