-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 060 — Salarios U0b: el pago de la quincena no se puede registrar dos veces.           ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
--    ⚠ Prod ni siquiera tiene estas tablas: la mig 056 vive solo en staging. El pase de Salarios
--      a producción es un cambio de esquema con su propio ciclo, DIFERIDO.
-- ⚠ Número 060: verificado libre contra el ledger REAL de staging (última = 059) y contra TODAS
--   las ramas del remoto al 2026-08-24.
--
-- ── EL DEFECTO QUE CIERRA ──────────────────────────────────────────────────────────────────
-- `markPeriodPaid` (src/shared/api/salarios.ts) escribe en tres viajes SIN transacción:
--   1. relee `salary_periods.estado` (el guard contra el doble pago),
--   2. inserta N filas en `employee_payments` (+ el snapshot en `salary_lines`),
--   3. pasa el período a 'pagado'.
-- El guard del paso 1 mira EXACTAMENTE lo que escribe el paso 3. Si el 3 falla —red, timeout,
-- sesión vencida— el período NO queda 'pagado' aunque los pagos ya estén escritos, la pantalla
-- rehabilita el botón, el operador reintenta, el guard no ve nada raro y se DUPLICA la nómina
-- entera. Nada en la base lo impedía: el índice de la 056 sobre (period_id, employee_id) es
-- común, no único, y la RLS filtra QUIÉN escribe, no CUÁNTAS veces.
-- Segundo vector, que ningún guard de aplicación puede atrapar: el dueño y el gerente en dos
-- dispositivos leyendo 'cerrado' al mismo tiempo. Ese solo lo para un candado en la base.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
-- Dos índices ÚNICOS sobre (period_id, employee_id): un empleado, un pago por período.
-- Del lado del cliente el insert pasa a `upsert ... on conflict do nothing`, así el reintento
-- converge a las MISMAS filas en vez de rebotar: sin eso, el unique convertiría el bug
-- silencioso en un bloqueo sin salida (el reintento moriría con 23505 y el período nunca se
-- podría marcar pagado, con la transferencia ya hecha por homebanking).
--
-- `do nothing` y no `do update` a propósito: `employee_payments` es el registro de cuánto se
-- transfirió de verdad. Pisarlo con un monto nuevo borraría la evidencia del pago original y
-- la tabla dejaría de ser append-only. Corregir un pago ya hecho es otro flujo (la REAPERTURA
-- de período que la 056 ya tiene reservada en reopened_by/at/motivo) y tendrá que decidir
-- explícitamente qué hacer con las filas viejas.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
-- Ni una fila de datos: son índices. Sin RLS nueva, sin columnas, sin funciones. No toca Caja ·
-- Tips · POS · Proveedores · los sagrados · realtime. Re-ejecutable sin efecto.

-- ── Guarda: no se crea un unique sobre datos sucios ────────────────────────────────────────
-- Si ya existieran duplicados, el `create unique index` fallaría con un mensaje de Postgres
-- que no dice a quién le pasó. Preferimos frenar con el conteo y el nombre de la tabla: son
-- registros de PLATA, se limpian a mano y con criterio, nunca a ciegas desde una migración.
-- (Verificado el 2026-08-24 en staging: 0 duplicados en las dos tablas, ambas en 0 filas.)
do $$
declare
  v_pagos int;
  v_lines int;
begin
  select count(*) into v_pagos from (
    select 1 from public.employee_payments group by period_id, employee_id having count(*) > 1
  ) x;
  select count(*) into v_lines from (
    select 1 from public.salary_lines group by period_id, employee_id having count(*) > 1
  ) y;

  if v_pagos > 0 or v_lines > 0 then
    raise exception
      'No se puede crear el unique: hay % par(es) duplicado(s) en employee_payments y % en salary_lines. Resolvelos a mano antes de aplicar (es registro de plata: decidir cuál vale, no borrar a ciegas).',
      v_pagos, v_lines;
  end if;
end $$;

-- ── Los candados ───────────────────────────────────────────────────────────────────────────
-- `create unique index if not exists` y no `alter table add constraint`: Postgres no soporta
-- IF NOT EXISTS en ADD CONSTRAINT, y todo el esquema del repo está escrito re-ejecutable.
-- PostgREST acepta un índice único como destino de `on_conflict`, así que alcanza para el
-- upsert del cliente.
create unique index if not exists employee_payments_period_employee_uidx
  on public.employee_payments (period_id, employee_id);

create unique index if not exists salary_lines_period_employee_uidx
  on public.salary_lines (period_id, employee_id);

-- Los índices comunes de la 056 quedan redundantes: el unique ya crea el mismo btree sobre
-- las mismas dos columnas en el mismo orden, así que sirve igual para las lecturas
-- (`getPeriodPayments` filtra por period_id, que es el prefijo). Mantenerlos solo costaría
-- escrituras.
drop index if exists public.employee_payments_period_employee_idx;
drop index if exists public.salary_lines_period_employee_idx;

comment on index public.employee_payments_period_employee_uidx is
  'U0b: un pago por (periodo, empleado). Junto con el upsert on conflict do nothing de markPeriodPaid hace el registro del pago idempotente: reintentar despues de un fallo no duplica la nomina, y dos gerentes pagando a la vez no se pisan.';
comment on index public.salary_lines_period_employee_uidx is
  'U0b: una linea de detalle por (periodo, empleado). Espeja el unique de employee_payments para que el snapshot del cierre (tarifa usada) tampoco se duplique al reintentar.';
