-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 056 — Empleados U0a: núcleo del ciclo de nómina. ADITIVA e IDEMPOTENTE.                ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
-- ⚠ Número 056: verificado libre contra el ledger REAL de staging (última aplicada = 055; el push deja
--   001–055 + 0090/0095 intactos y aplica solo esta) y libre en todas las ramas del remoto al 2026-08-20.
--
-- Base: prompt "Empleados U0a v2" (D1–D9) + `claude/SPEC-modulo-salarios.md` §2.3/§2.5/§2.6 + §9 A1/A2/A3.
-- Continúa la mig 055 (maestro de nómina en `employees`).
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- SOLO ESQUEMA: tablas + RLS + CHECKs + índices + timestamps + semilla de tarifas. Sin cálculo
-- automático, sin BioTime, sin RPC de cierre (el cálculo de `salary_lines` es U0b/U2 — acá nace vacía).
--   1. `employee_wage_rates`  — tarifas VERSIONADAS (la tarifa deja de ser un único valor mutable en
--                               `employees`: ahora hay historia y se puede pagar as-of una fecha).
--   2. `salary_periods`       — el período de pago y su ciclo abierto → en_revision → cerrado → pagado.
--   3. `work_days`            — horas por empleado/día/local (en U0 se llenan a mano).
--   4. `salary_lines`         — el snapshot que U0b/U2 congelará al cerrar el período. Nace VACÍA.
--   5. `employee_payments`    — el registro del pago (transferencia por homebanking).
--   6. `employees`            — `banco` + `cuenta_iban_alias` (opcionales) para el archivo del banco.
--
-- ── COORDINACIÓN CON FASE 1 (BioTime) ──────────────────────────────────────────────────────
-- `work_days` NACE ACÁ. La migración de F1a NO la vuelve a crear: solo agrega `time_punches` /
-- `punch_exceptions` y, si necesita más columnas acá, las suma con `add column if not exists`.
-- Por eso `source` ya admite 'biotime' y la PK ya contempla el local.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
-- `auth` / `profiles` (el maestro↔espejo es U0.5, aparte — las columnas `*_by` son uuid SIN FK a
-- profiles, justamente para no acoplar nada) · Caja · Tips · POS · Proveedores · sagrados
-- (`tipCalculations` · `cashUtils` · `posFiscal`) · el enum `user_role` · realtime.
-- Todo es `create table if not exists` / `add column if not exists` → re-ejecutable sin efecto.
--
-- ── EL PAGO NO ES CAJA ─────────────────────────────────────────────────────────────────────
-- `employee_payments` NO tiene vínculo con `cash_movements` y NO genera movimiento de caja: el pago
-- sale por transferencia desde el homebanking. Acá solo queda el REGISTRO (monto, referencia,
-- comprobante, quién y cuándo).
--
-- ── TARIFA VIGENTE (query de control) ──────────────────────────────────────────────────────
-- La tarifa vigente de un empleado a una fecha = la de mayor `efectivo_desde` ≤ esa fecha. El
-- `unique (employee_id, efectivo_desde)` garantiza que NO hay empate posible:
--
--   select distinct on (r.employee_id) r.*
--     from public.employee_wage_rates r
--    where r.efectivo_desde <= :fecha
--    order by r.employee_id, r.efectivo_desde desc;

-- ── 1. employee_wage_rates — tarifas versionadas ───────────────────────────────────────────
-- Una fila = "desde esta fecha, este empleado cobra así". `tipo` es la modalidad principal; las dos
-- columnas de monto conviven a propósito: el caso real del Excel (Rosaura) cobra fijo por quincena Y
-- tarifa por hora a la vez.
create table if not exists public.employee_wage_rates (
  id               uuid          primary key default gen_random_uuid(),
  employee_id      uuid          not null references public.employees(id) on delete cascade,
  tipo             text          not null check (tipo in ('hora','quincena','mes')),
  hourly_rate_crc  numeric(12,2) not null default 0 check (hourly_rate_crc  >= 0),
  fixed_salary_crc numeric(12,2) not null default 0 check (fixed_salary_crc >= 0),
  efectivo_desde   date          not null,
  nota             text,
  created_by       uuid,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  unique (employee_id, efectivo_desde)
);

create index if not exists employee_wage_rates_emp_desde_idx
  on public.employee_wage_rates (employee_id, efectivo_desde desc);

drop trigger if exists employee_wage_rates_updated_at on public.employee_wage_rates;
create trigger employee_wage_rates_updated_at
  before update on public.employee_wage_rates
  for each row execute function public.handle_updated_at();

comment on table public.employee_wage_rates is
  'Salarios U0a: historial de tarifas por empleado. La vigente a una fecha = mayor efectivo_desde <= fecha.';
comment on column public.employee_wage_rates.tipo is
  'Modalidad principal: hora | quincena | mes. No excluye la otra columna de monto (un empleado puede tener fijo + por hora).';
comment on column public.employee_wage_rates.efectivo_desde is
  'Desde cuándo rige esta tarifa. Único por empleado (no hay dos tarifas del mismo día → la vigente nunca empata).';

-- ── 2. salary_periods — el ciclo de pago ───────────────────────────────────────────────────
-- estado: abierto → en_revision → cerrado → pagado.
--   · `cerrado` congela las `salary_lines` (el comprobante sale de acá).
--   · `pagado` es evento de PLATA: solo owner/manager lo pueden poner (ver RLS §7.4).
--   · Reabrir = volver el estado atrás dejando rastro en reopened_by/at/motivo (A2: el motivo
--     obligatorio lo exige la UI; acá queda la columna para que el rastro exista).
-- `local` es NULLABLE y solo ETIQUETA: el pay run es global (un período cubre a todo el mundo).
create table if not exists public.salary_periods (
  id            uuid        primary key default gen_random_uuid(),
  tipo          text        not null check (tipo in ('quincena','adhoc')),
  fecha_ini     date        not null,
  fecha_fin     date        not null,
  estado        text        not null default 'abierto'
                            check (estado in ('abierto','en_revision','cerrado','pagado')),
  local         text,
  created_by    uuid,
  closed_by     uuid,
  closed_at     timestamptz,
  paid_by       uuid,
  paid_at       timestamptz,
  reopened_by   uuid,
  reopened_at   timestamptz,
  reopen_motivo text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (fecha_fin >= fecha_ini)
);

create index if not exists salary_periods_estado_fecha_idx on public.salary_periods (estado, fecha_ini);

drop trigger if exists salary_periods_updated_at on public.salary_periods;
create trigger salary_periods_updated_at
  before update on public.salary_periods
  for each row execute function public.handle_updated_at();

comment on table public.salary_periods is
  'Salarios U0a: período de pago (quincena estándar o rango ad-hoc). Ciclo abierto/en_revision/cerrado/pagado.';
comment on column public.salary_periods.local is
  'Solo etiquetado. El pay run es global; NO filtra empleados ni horas.';

-- ── 3. work_days — horas por empleado / día / local ────────────────────────────────────────
-- En U0 se llenan a mano (`source='manual'`). Fase 1 (BioTime) escribe las mismas filas con
-- `source='biotime'` y deriva `hours` de las marcas — por eso la PK ya contempla el local.
-- `hours` es numeric SIN escala fija: BioTime da horas exactas con minutos (7.3333…) y redondear acá
-- ensuciaría el reparto del 10%.
-- `local` es NOT NULL con default 'santa-teresa' porque forma parte de la PK (una PK no admite null): así
-- la carga manual de U0 nunca queda a medias. `salary_periods.local`, en cambio, SÍ es nullable (pay run global).
create table if not exists public.work_days (
  employee_id uuid        not null references public.employees(id) on delete cascade,
  work_date   date        not null,
  local       text        not null default 'santa-teresa',
  hours       numeric     not null default 0 check (hours >= 0),
  es_feriado  boolean     not null default false,
  source      text        not null default 'manual' check (source in ('manual','biotime')),
  flags       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, work_date, local)
);

create index if not exists work_days_fecha_idx on public.work_days (work_date);

drop trigger if exists work_days_updated_at on public.work_days;
create trigger work_days_updated_at
  before update on public.work_days
  for each row execute function public.handle_updated_at();

comment on table public.work_days is
  'Salarios U0a: horas por empleado/día/local. U0 = carga manual; Fase 1 la REUSA (source=biotime), no la recrea.';
comment on column public.work_days.local is
  'Slug del local, mismos valores que public.locations.id (santa-teresa | nosara) → cruza directo con el POS. Default santa-teresa. NOT NULL porque es parte del PK: la carga manual de U0 nunca deja el local en null y la UI de U0b obliga a elegirlo. Sin FK a propósito en U0a.';
comment on column public.work_days.work_date is
  'Fecha de la JORNADA operativa (corte ~05:00 CR, A1), no el día civil. Se alinea al session_date del POS/caja.';

-- ── 4. salary_lines — snapshot del cierre. NACE VACÍA ──────────────────────────────────────
-- El cálculo y el llenado son U0b/U2 (RPC de cierre): esta migración NO inserta nada acá.
-- `snapshot` guardará el desglose (diario del 10%, horas por día, tarifa usada).
-- `employee_id` con ON DELETE RESTRICT: el historial de plata no se borra por borrar un empleado.
create table if not exists public.salary_lines (
  id              uuid          primary key default gen_random_uuid(),
  period_id       uuid          not null references public.salary_periods(id) on delete cascade,
  employee_id     uuid          not null references public.employees(id)      on delete restrict,
  horas           numeric       not null default 0 check (horas >= 0),
  pago_horas      numeric(12,2) not null default 0,
  aporte_servicio numeric(12,2) not null default 0,
  salario_fijo    numeric(12,2) not null default 0,
  bono            numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  snapshot        jsonb,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists salary_lines_period_employee_idx on public.salary_lines (period_id, employee_id);

drop trigger if exists salary_lines_updated_at on public.salary_lines;
create trigger salary_lines_updated_at
  before update on public.salary_lines
  for each row execute function public.handle_updated_at();

comment on table public.salary_lines is
  'Salarios U0a: snapshot por empleado/período que U0b/U2 genera al cerrar (A2). U0a la crea VACÍA, sin RPC.';

-- ── 5. employee_payments — registro del pago (NO caja) ─────────────────────────────────────
-- El pago sale por transferencia (homebanking). Esta tabla NO toca `cash_movements` ni genera
-- movimiento: es el registro de que se pagó, con su referencia y comprobante.
create table if not exists public.employee_payments (
  id              uuid          primary key default gen_random_uuid(),
  period_id       uuid          not null references public.salary_periods(id) on delete restrict,
  employee_id     uuid          not null references public.employees(id)      on delete restrict,
  monto_neto      numeric(12,2) not null,
  metodo          text          not null default 'transferencia',
  referencia      text,
  comprobante_url text,
  estado          text          not null default 'registrado',
  paid_by         uuid,
  paid_at         timestamptz,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists employee_payments_period_employee_idx
  on public.employee_payments (period_id, employee_id);

drop trigger if exists employee_payments_updated_at on public.employee_payments;
create trigger employee_payments_updated_at
  before update on public.employee_payments
  for each row execute function public.handle_updated_at();

comment on table public.employee_payments is
  'Salarios U0a: registro del pago por transferencia. NO genera movimiento de caja ni se vincula a cash_movements.';

-- ── 6. employees — datos bancarios para el archivo del banco ───────────────────────────────
-- Nullables y opcionales: los empleados existentes quedan exactamente como están (null/null).
alter table public.employees
  add column if not exists banco              text,
  add column if not exists cuenta_iban_alias  text;

comment on column public.employees.banco is
  'Salarios: banco del empleado, para el archivo de transferencias del homebanking. null = pendiente.';
comment on column public.employees.cuenta_iban_alias is
  'Salarios: cuenta IBAN o alias SINPE del empleado. null = pendiente.';

-- ── 7. RLS ─────────────────────────────────────────────────────────────────────────────────
-- SELECT en todas: owner / manager / contador.
-- Escritura de tarifas, horas y líneas: owner / manager / contador (el contador arma la nómina).
-- `estado='pagado'` y `employee_payments`: SOLO owner / manager — el contador NO paga.
alter table public.employee_wage_rates enable row level security;
alter table public.salary_periods      enable row level security;
alter table public.work_days           enable row level security;
alter table public.salary_lines        enable row level security;
alter table public.employee_payments   enable row level security;

-- 7.1 employee_wage_rates
drop policy if exists employee_wage_rates_select on public.employee_wage_rates;
create policy employee_wage_rates_select on public.employee_wage_rates for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists employee_wage_rates_write on public.employee_wage_rates;
create policy employee_wage_rates_write on public.employee_wage_rates for all
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));

-- 7.2 work_days
drop policy if exists work_days_select on public.work_days;
create policy work_days_select on public.work_days for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists work_days_write on public.work_days;
create policy work_days_write on public.work_days for all
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));

-- 7.3 salary_lines
drop policy if exists salary_lines_select on public.salary_lines;
create policy salary_lines_select on public.salary_lines for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists salary_lines_write on public.salary_lines;
create policy salary_lines_write on public.salary_lines for all
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));

-- 7.4 salary_periods — el contador llega hasta `cerrado`; `pagado` es de owner/manager.
--     El WITH CHECK mira la fila NUEVA (el contador no puede DEJARLA en 'pagado') y el USING la fila
--     VIEJA (tampoco puede tocar una fila que YA está 'pagado').
drop policy if exists salary_periods_select on public.salary_periods;
create policy salary_periods_select on public.salary_periods for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists salary_periods_insert on public.salary_periods;
create policy salary_periods_insert on public.salary_periods for insert
  with check (
    get_my_role() in ('owner','manager')
    or (get_my_role() = 'contador' and estado <> 'pagado')
  );

drop policy if exists salary_periods_update on public.salary_periods;
create policy salary_periods_update on public.salary_periods for update
  using (
    get_my_role() in ('owner','manager')
    or (get_my_role() = 'contador' and estado <> 'pagado')
  )
  with check (
    get_my_role() in ('owner','manager')
    or (get_my_role() = 'contador' and estado <> 'pagado')
  );

drop policy if exists salary_periods_delete on public.salary_periods;
create policy salary_periods_delete on public.salary_periods for delete
  using (get_my_role() in ('owner','manager'));

-- 7.5 employee_payments — el contador LEE, no escribe.
drop policy if exists employee_payments_select on public.employee_payments;
create policy employee_payments_select on public.employee_payments for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists employee_payments_write on public.employee_payments;
create policy employee_payments_write on public.employee_payments for all
  using      (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

-- ── 8. Semilla — la tarifa de F0 (mig 055) pasa a ser la primera tarifa vigente ─────────────
-- Una fila por empleado con tarifa > 0 (hora o fijo), `efectivo_desde = current_date`.
-- Nombres de columna LEÍDOS del schema real de `employees` (mig 055), no inventados:
-- `hourly_rate_crc` y `fixed_salary_crc`, ambas numeric default 0.
-- Los de 0/0 no generan fila: todavía no hay tarifa que versionar.
-- Idempotente por partida doble: no inserta si el empleado YA tiene alguna tarifa, y el
-- `on conflict` cubre la re-ejecución en el mismo día.
insert into public.employee_wage_rates
  (employee_id, tipo, hourly_rate_crc, fixed_salary_crc, efectivo_desde, nota)
select
  e.id,
  case when coalesce(e.hourly_rate_crc, 0) > 0 then 'hora' else 'quincena' end,
  coalesce(e.hourly_rate_crc, 0),
  coalesce(e.fixed_salary_crc, 0),
  current_date,
  'Semilla U0a: tarifa migrada desde employees (Fase 0 / mig 055)'
from public.employees e
where (coalesce(e.hourly_rate_crc, 0) > 0 or coalesce(e.fixed_salary_crc, 0) > 0)
  and not exists (
    select 1 from public.employee_wage_rates r where r.employee_id = e.id
  )
on conflict (employee_id, efectivo_desde) do nothing;
