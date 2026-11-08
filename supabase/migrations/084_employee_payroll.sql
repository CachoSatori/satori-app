-- ============================================================================
-- 084_employee_payroll.sql — SAL-AUD-01 (auditoría r5), PASO 1: la planilla sale de employees
-- ----------------------------------------------------------------------------
-- Problema: `employees` tiene una policy de lectura para todo usuario con sesión (filas activas,
-- TODAS las columnas), y desde la 055/056/058 guarda ahí la tarifa por hora, el salario fijo, el
-- nombre del beneficiario en el homebanking, el banco y la cuenta. Cualquier cuenta leía la
-- planilla de todos por la API, sin pasar por la app.
--
-- Decisiones de Ismael:
--   · 07/11, opción A: la planilla va a tablas propias, fuera de employees.
--   · 08/11: el manager SÍ puede VER las tarifas (solo lectura, sin guardarlas). Los datos bancarios
--     siguen solo para owner y contador.
-- Por eso son DOS tablas (la RLS es por fila, no por columna):
--
--   1. public.employee_payroll — TARIFAS (hourly_rate_crc, fixed_salary_crc), 1 a 1 con employees.
--      Leen owner, manager y contador ACTIVOS; escriben solo owner y contador.
--   2. public.employee_bank_info — DATOS BANCARIOS (nombre_homebanking, banco, cuenta_iban_alias),
--      1 a 1. Leen y escriben solo owner y contador ACTIVOS.
--      (get_my_role() exige is_active desde la 069.) Ninguna de las dos tiene permisos para anon.
--   3. Copia los datos de employees, los vacía ahí y agrega un CHECK que impide volver a escribirlos
--      en employees (un cliente viejo en caché recibe un error en vez de volver a exponerlos). Las
--      columnas se BORRAN en el paso 2, en un PR aparte: así este paso se deshace sin perder datos.
--   4. employee_wage_rates (tarifas versionadas, 056): lectura igual que antes (owner, manager,
--      contador); escritura solo owner y contador (antes también manager).
--
-- NO cambia (decisión pendiente de Ismael con el contador): salary_lines y employee_payments también
-- tienen montos y hoy los ve el manager (y employee_payments la escribe owner/manager).
--
-- Solo staging (Salarios 055–061 no está en prod): va a prod con el pase de Salarios, y ahí toma un
-- número del bloque de pase si queda ≤ al último de prod (ver «Numeración de migraciones», ESTADO).
-- Re-ejecutable. Rollback: scripts/sql/084_rollback.sql (devuelve los datos a employees).
-- ============================================================================

begin;

-- ── 1. Tarifas ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_payroll (
  employee_id        uuid          primary key references public.employees(id) on delete cascade,
  hourly_rate_crc    numeric       not null default 0 check (hourly_rate_crc  >= 0),
  fixed_salary_crc   numeric       not null default 0 check (fixed_salary_crc >= 0),
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
  using (public.get_my_role() in ('owner', 'manager', 'contador'));

drop policy if exists employee_payroll_write on public.employee_payroll;
drop policy if exists employee_payroll_insert on public.employee_payroll;
drop policy if exists employee_payroll_update on public.employee_payroll;
drop policy if exists employee_payroll_delete on public.employee_payroll;
create policy employee_payroll_insert on public.employee_payroll for insert to authenticated
  with check (public.get_my_role() in ('owner', 'contador'));
create policy employee_payroll_update on public.employee_payroll for update to authenticated
  using      (public.get_my_role() in ('owner', 'contador'))
  with check (public.get_my_role() in ('owner', 'contador'));
create policy employee_payroll_delete on public.employee_payroll for delete to authenticated
  using (public.get_my_role() in ('owner', 'contador'));

-- ── 2. Datos bancarios ─────────────────────────────────────────────────────────────────────
create table if not exists public.employee_bank_info (
  employee_id        uuid          primary key references public.employees(id) on delete cascade,
  nombre_homebanking text,
  banco              text,
  cuenta_iban_alias  text,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

drop trigger if exists employee_bank_info_updated_at on public.employee_bank_info;
create trigger employee_bank_info_updated_at
  before update on public.employee_bank_info
  for each row execute function public.handle_updated_at();

alter table public.employee_bank_info enable row level security;
revoke all on public.employee_bank_info from anon;
grant select, insert, update, delete on public.employee_bank_info to authenticated;

drop policy if exists employee_bank_info_all on public.employee_bank_info;
create policy employee_bank_info_all on public.employee_bank_info for all to authenticated
  using      (public.get_my_role() in ('owner', 'contador'))
  with check (public.get_my_role() in ('owner', 'contador'));

-- ── 3. Copia (re-ejecutable: después del paso 4 las columnas de employees están vacías) ──────
insert into public.employee_payroll (employee_id, hourly_rate_crc, fixed_salary_crc)
select id, hourly_rate_crc, fixed_salary_crc
  from public.employees
 where hourly_rate_crc <> 0 or fixed_salary_crc <> 0
on conflict (employee_id) do update set
  hourly_rate_crc  = excluded.hourly_rate_crc,
  fixed_salary_crc = excluded.fixed_salary_crc;

insert into public.employee_bank_info (employee_id, nombre_homebanking, banco, cuenta_iban_alias)
select id, nullif(btrim(nombre_homebanking), ''), nullif(btrim(banco), ''), nullif(btrim(cuenta_iban_alias), '')
  from public.employees
 where nullif(btrim(nombre_homebanking), '') is not null
    or nullif(btrim(banco), '') is not null
    or nullif(btrim(cuenta_iban_alias), '') is not null
on conflict (employee_id) do update set
  nombre_homebanking = excluded.nombre_homebanking,
  banco              = excluded.banco,
  cuenta_iban_alias  = excluded.cuenta_iban_alias;

-- ── 4. employees queda sin planilla ────────────────────────────────────────────────────────
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

-- ── 5. employee_wage_rates: el manager lee, solo owner/contador escriben ───────────────────
alter policy employee_wage_rates_select on public.employee_wage_rates
  using (public.get_my_role() in ('owner', 'manager', 'contador'));
alter policy employee_wage_rates_write on public.employee_wage_rates
  using      (public.get_my_role() in ('owner', 'contador'))
  with check (public.get_my_role() in ('owner', 'contador'));

commit;
