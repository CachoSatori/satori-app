-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 055 — Salarios · Fase 0: maestro de nómina en public.employees                        ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING. ⚠ Se escribe en la rama; se aplica a staging con el ritual
--    (ref hwiatgicyyqyezqwldia; cat supabase/.temp/project-ref → confirmar antes de tocar DB).
--    NUNCA a prod sin firma de Ismael.
--
-- Base: claude/SPEC-modulo-salarios.md §2.1 (Fase 0) + §9 A3 (identidades y maestro).
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────
-- Los datos maestros de nómina dejan de vivir en el Excel y pasan a la ficha del empleado:
-- tarifa por hora, salario fijo, si participa del reparto del 10% de servicio, el código de
-- BioTime (identidad del reloj) y la fecha de ingreso. NADA de cálculo: esta migración solo
-- guarda los datos que Fase 1+ va a consumir.
--
-- ── SIN CAMBIOS RETROACTIVOS ───────────────────────────────────────────────────────────
-- Todo aditivo e idempotente (add column if not exists). Los defaults (0 / 0 / true) dejan a
-- los empleados existentes exactamente como están: ninguna lectura o cálculo vivo mira estas
-- columnas todavía. No toca RLS (hereda las policies de employees: SELECT para activos +
-- owner/manager/contador, ALL para owner/manager), ni realtime, ni otra tabla, ni el enum
-- user_role, ni auth.
--
-- ── IDENTIDAD (A3) ─────────────────────────────────────────────────────────────────────
-- La identidad del empleado es employees.id + biotime_emp_code. NUNCA se casa por nombre
-- (el Excel lo hace y ya produjo drift). El código de BioTime es ÚNICO cuando no es null →
-- índice único PARCIAL: muchos empleados pueden estar sin código (null) mientras Ismael los
-- consigue, pero dos filas no pueden compartir el mismo código.
-- Caso legítimo y esperado: una misma persona física con dos usuarios en el reloj (ej. jefe
-- de barra y manager) = dos filas employees con códigos DISTINTOS. El índice no se viola y
-- NO se fusionan acá (agrupar "misma persona" es Fase 3/5).

alter table public.employees
  add column if not exists hourly_rate_crc    numeric not null default 0,
  add column if not exists fixed_salary_crc   numeric not null default 0,
  add column if not exists participa_servicio boolean not null default true,
  add column if not exists biotime_emp_code   text,
  add column if not exists fecha_ingreso      date;

-- Único cuando no es null (A3). Parcial: los null no compiten entre sí.
create unique index if not exists employees_biotime_emp_code_key
  on public.employees (biotime_emp_code)
  where biotime_emp_code is not null;

comment on column public.employees.hourly_rate_crc is
  'Salarios: tarifa por hora en colones. 0 = no cobra por hora (SPEC §2.1).';
comment on column public.employees.fixed_salary_crc is
  'Salarios: salario fijo por quincena en colones. 0 = no aplica (SPEC §2.1).';
comment on column public.employees.participa_servicio is
  'Salarios: Y/N del reparto del 10% de servicio (R4). false = no entra ni al numerador ni al denominador del reparto.';
comment on column public.employees.biotime_emp_code is
  'Salarios: código del empleado en BioTime (R7/A3). Único cuando no es null. null = sin mapear, no entra al cálculo automático de horas.';
comment on column public.employees.fecha_ingreso is
  'Salarios: fecha de ingreso, para vacaciones/aguinaldo (Fase 5). null = pendiente de cargar.';
