-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 057 — BioTime F1a: marcas crudas + excepciones de fichaje. ADITIVA e IDEMPOTENTE.      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
-- ⚠ Número 057: verificado libre contra el ledger REAL de staging (`supabase migration list --linked`
--   = 001–056 contiguo + 0090/0095) y libre en TODAS las ramas del remoto al 2026-08-20.
--
-- Base: prompt "BioTime F1a" + `claude/SPEC-modulo-salarios.md` §2.2 / §3.1 / §4 / §9 A1.
-- Continúa la mig 056 (núcleo del ciclo de nómina, U0a).
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- SOLO ESQUEMA: 3 tablas + RLS + CHECKs + índices + timestamps + semilla de config. Sin Edge
-- Function, sin agente, sin derivación de horas — eso es F1b / F1c / F1d.
--   1. `time_punches`      — la marca cruda de BioTime, tal cual llega. Nadie la edita.
--   2. `punch_exceptions`  — lo que el emparejamiento no pudo resolver solo (§2.7 SPEC empleados).
--   3. `payroll_config`    — el corte de jornada y el umbral de turno largo, POR LOCAL.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
-- `work_days` YA EXISTE (mig 056) y esta migración NO la recrea ni le agrega columnas: la definición
-- de 056 (`local` / `source in ('manual','biotime')` / `flags` / `es_feriado`) ya alcanza para F1d.
-- Tampoco toca `auth` / `profiles` · Caja · Tips · POS · Proveedores · el enum `user_role` · los
-- sagrados (`tipCalculations` · `cashUtils` · `posFiscal`) · realtime.
-- Todo es `create table/index if not exists` + `drop policy/trigger if exists` → re-ejecutable sin efecto.
--
-- ── POR QUÉ LA IDEMPOTENCIA ES `(local, biotime_id)` Y NO `biotime_id` SOLO ─────────────────
-- El SPEC §2.2 anotaba `biotime_txn_id unique` global, pero §4.1 confirma que puede haber UN BioTime
-- POR LOCAL (Santa Teresa + Nosara) y cada instancia lleva SU PROPIA secuencia de `iclock_transaction.id`.
-- Un unique global haría que la marca #500 de Nosara se comiera silenciosamente a la #500 de Santa
-- Teresa (`on conflict do nothing` → marca PERDIDA, no error). La clave de idempotencia real es el par.

-- ── 1. time_punches — la marca cruda de BioTime ────────────────────────────────────────────
-- Una fila = un `iclock_transaction` de un BioTime. Se guarda TAL CUAL llega (más `raw` con la fila
-- original) y NUNCA se edita: si el emparejamiento sale mal, se corrige en `work_days` (override
-- `source='manual'`, auditado) o se abre una `punch_exception` — la marca cruda queda intacta como
-- evidencia contra el reporte de BioTime (criterio de aceptación de la Fase 1 en el SPEC §7).
--
-- `employee_id` se resuelve por `employees.biotime_emp_code = emp_code` (mig 055, unique parcial).
-- NUNCA por nombre (SPEC §9: casar por nombre ya produjo drift real en el Excel). `on delete set null`
-- y no `cascade`: borrar un empleado no puede borrar la evidencia de que fichó.
-- `emp_code` se persiste SIEMPRE aunque `employee_id` sea null → así la marca sin mapear se puede
-- reconciliar después sin volver a BioTime (F1c reconcilia los 31 `emp_code`).
create table if not exists public.time_punches (
  id          uuid        primary key default gen_random_uuid(),
  local       text        not null,
  biotime_id  integer     not null,
  emp_code    text        not null,
  employee_id uuid        references public.employees(id) on delete set null,
  punch_at    timestamptz not null,
  punch_state text        not null check (punch_state in ('in','out')),
  terminal    text,
  raw         jsonb,
  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (local, biotime_id)
);

-- El `unique (local, biotime_id)` de arriba YA crea el índice btree sobre exactamente esas dos
-- columnas: sirve tanto el `on conflict` del ingest como el `max(biotime_id) where local = ?` con
-- que F1b arranca el SELECT incremental. Un segundo índice idéntico solo costaría escrituras, así
-- que acá va únicamente el que el unique NO cubre.
create index if not exists time_punches_employee_at_idx
  on public.time_punches (employee_id, punch_at);

drop trigger if exists time_punches_updated_at on public.time_punches;
create trigger time_punches_updated_at
  before update on public.time_punches
  for each row execute function public.handle_updated_at();

comment on table public.time_punches is
  'Salarios F1a: marca cruda de BioTime (iclock_transaction). Solo la escribe la Edge Function (service-role). Inmutable: las correcciones van a work_days o a punch_exceptions.';
comment on column public.time_punches.local is
  'Slug del local, mismos valores que public.locations.id (santa-teresa | nosara). Parte de la clave de idempotencia porque cada local tiene su propio BioTime con su propia secuencia de id.';
comment on column public.time_punches.biotime_id is
  'iclock_transaction.id EN EL BioTime DE ESE LOCAL. Único junto con local (no global) → reimportar nunca duplica ni pisa la marca del otro local.';
comment on column public.time_punches.employee_id is
  'Resuelto por employees.biotime_emp_code = emp_code. null = marca SIN MAPEAR (va a la bandeja, excepcion tipo sin_mapear). Nunca se casa por nombre.';
comment on column public.time_punches.punch_state is
  'Normalizado a in|out desde el codigo nativo de BioTime (0/1). La normalizacion la hace la Edge Function (F1b), no la base.';
comment on column public.time_punches.punch_at is
  'Instante de la marca. La JORNADA a la que pertenece NO es su dia civil: se deriva con payroll_config.corte_jornada (A1). Esa derivacion es F1d.';
comment on column public.time_punches.raw is
  'Fila original de BioTime completa, para auditoria y para reprocesar sin volver a consultar el reloj.';

-- ── 2. punch_exceptions — lo que el emparejamiento no resolvió solo ────────────────────────
-- F1d empareja in/out por jornada; cuando no puede, en vez de inventar horas abre una excepción y
-- la manda a la bandeja. Los cuatro tipos son los del SPEC empleados §2.7:
--   · `impar`       — la jornada quedó con un número impar de marcas (fichó entrada y no salida).
--   · `turno_largo` — el par cerró, pero dura más que `payroll_config.umbral_turno_largo_h`
--                     (probable "se olvidó de marcar la salida y marcó al otro día").
--   · `sin_mapear`  — el `emp_code` no corresponde a ningún `employees.biotime_emp_code`.
--   · `solapado`    — dos pares del mismo empleado se pisan en el tiempo (doble reloj, o dos locales).
--
-- `employee_id` es NULLABLE a propósito: `sin_mapear` es EXACTAMENTE el caso en que todavía no hay
-- empleado, y es el tipo que más se va a usar el primer día. Por eso `emp_code`/`local`/`work_date`
-- se guardan sueltos: la excepción tiene que poder describirse sin un empleado resuelto.
-- `detalle` lleva el contexto (ids de las marcas involucradas, horas calculadas) para que la bandeja
-- muestre el problema sin recalcular nada.
create table if not exists public.punch_exceptions (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        references public.employees(id) on delete cascade,
  emp_code    text,
  work_date   date,
  local       text,
  tipo        text        not null check (tipo in ('impar','turno_largo','sin_mapear','solapado')),
  detalle     jsonb,
  estado      text        not null default 'abierta' check (estado in ('abierta','resuelta')),
  resuelto_by uuid,
  resuelto_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- La bandeja se abre siempre con el mismo filtro: las ABIERTAS, de un local, por fecha.
create index if not exists punch_exceptions_estado_local_fecha_idx
  on public.punch_exceptions (estado, local, work_date);

drop trigger if exists punch_exceptions_updated_at on public.punch_exceptions;
create trigger punch_exceptions_updated_at
  before update on public.punch_exceptions
  for each row execute function public.handle_updated_at();

comment on table public.punch_exceptions is
  'Salarios F1a: bandeja de excepciones de fichaje (SPEC empleados 2.7). F1d las genera al emparejar in/out; owner/manager/contador las resuelven desde la app.';
comment on column public.punch_exceptions.employee_id is
  'null cuando la excepcion es sin_mapear (todavia no hay empleado). Por eso emp_code/local/work_date van sueltos y la excepcion se describe igual.';
comment on column public.punch_exceptions.tipo is
  'impar (marcas sin par) | turno_largo (supera payroll_config.umbral_turno_largo_h) | sin_mapear (emp_code desconocido) | solapado (dos pares pisandose).';
comment on column public.punch_exceptions.detalle is
  'Contexto del problema: ids de time_punches involucrados, horas calculadas, marcas huerfanas. Para que la bandeja muestre el caso sin recalcular.';
comment on column public.punch_exceptions.estado is
  'abierta | resuelta. Las excepciones NO se borran al resolverse: quedan con resuelto_by/at como rastro.';

-- ── 3. payroll_config — el corte de jornada y el umbral, POR LOCAL ─────────────────────────
-- Los dos parámetros de A1 dejan de estar hardcodeados: viven en la base y se ajustan por local sin
-- deploy. `corte_jornada` = 05:00 CR (SPEC §9): toda marca entre 00:00 y el corte pertenece a la
-- JORNADA DEL DÍA ANTERIOR — así el turno que cierra a las 2am no se parte en dos días civiles.
-- `umbral_turno_largo_h` = 12: un par que dura más que eso no se descarta ni se recorta, se marca
-- como excepción `turno_largo` para que alguien lo mire.
-- La PK es el `local` mismo: una fila por local, sin id sintético — la config ES del local.
create table if not exists public.payroll_config (
  local                text        primary key,
  corte_jornada        time        not null default '05:00'::time,
  umbral_turno_largo_h numeric     not null default 12 check (umbral_turno_largo_h > 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists payroll_config_updated_at on public.payroll_config;
create trigger payroll_config_updated_at
  before update on public.payroll_config
  for each row execute function public.handle_updated_at();

comment on table public.payroll_config is
  'Salarios F1a: parametros de nomina por local. Una fila por local (la PK es el slug). Editable por owner/manager sin deploy.';
comment on column public.payroll_config.corte_jornada is
  'Corte horario de la jornada operativa (A1, default 05:00 CR): una marca entre 00:00 y el corte cuenta a la jornada del dia ANTERIOR. Se alinea al session_date del POS/caja.';
comment on column public.payroll_config.umbral_turno_largo_h is
  'Horas por encima de las cuales un par in/out se marca como excepcion turno_largo (default 12). No recorta ni descarta: solo levanta la bandera.';

-- Semilla: los dos locales con los defaults. Idempotente — si la fila ya existe NO se pisa
-- (re-ejecutar la migración no puede revertir un ajuste que la dueña ya hizo desde la app).
insert into public.payroll_config (local)
values ('santa-teresa'), ('nosara')
on conflict (local) do nothing;

-- ── 4. RLS ─────────────────────────────────────────────────────────────────────────────────
-- Mismo criterio de roles que la mig 056: lee gerencia + contador; la plata la mueve gerencia.
-- Las tres tablas quedan con RLS ACTIVA aunque no tengan policy de escritura: sin policy, `anon` y
-- `authenticated` no pueden escribir NADA, y el `service_role` de la Edge Function bypassa RLS por
-- definición. Eso es exactamente lo que queremos para las marcas crudas (nadie las edita a mano).
alter table public.time_punches      enable row level security;
alter table public.punch_exceptions  enable row level security;
alter table public.payroll_config    enable row level security;

-- 4.1 time_punches — SOLO LECTURA para usuarios. La escritura es exclusiva de la Edge Function
--     `ingest-punches` (F1b), que corre con service-role y por lo tanto bypassa RLS. Deliberadamente
--     NO hay policy de insert/update/delete: la marca cruda es evidencia y no se toca desde la app.
drop policy if exists time_punches_select on public.time_punches;
create policy time_punches_select on public.time_punches for select
  using (get_my_role() in ('owner','manager','contador'));

-- 4.2 punch_exceptions — gerencia + contador leen y RESUELVEN. El insert también es de la Edge
--     Function (F1d las genera al emparejar): sin policy de insert, nadie las crea a mano.
drop policy if exists punch_exceptions_select on public.punch_exceptions;
create policy punch_exceptions_select on public.punch_exceptions for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists punch_exceptions_update on public.punch_exceptions;
create policy punch_exceptions_update on public.punch_exceptions for update
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));

-- 4.3 payroll_config — todos los de gerencia+contador la leen (F1d necesita el corte para derivar
--     la jornada), pero el corte y el umbral los cambia solo owner/manager: mover `corte_jornada`
--     recalcula a qué jornada cae cada marca, y eso mueve la plata de la quincena.
drop policy if exists payroll_config_select on public.payroll_config;
create policy payroll_config_select on public.payroll_config for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists payroll_config_write on public.payroll_config;
create policy payroll_config_write on public.payroll_config for all
  using      (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));
