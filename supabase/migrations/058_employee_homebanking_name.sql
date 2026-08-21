-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 058 — Empleados U0b: alias del beneficiario en el homebanking. ADITIVA e IDEMPOTENTE.  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
-- ⚠ Número 058: última aplicada en staging = 057 (BioTime F1a) y libre en todas las ramas del
--   remoto al 2026-08-21.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────────────────────
-- El archivo que se sube al homebanking identifica al beneficiario POR EL NOMBRE (columna A),
-- no por cuenta: el banco ya tiene la cuenta asociada a ese nombre. Ese nombre es el que figura
-- en la lista de beneficiarios del banco y NO siempre coincide con `employees.full_name` (que la
-- app guarda en mayúsculas y suele ser solo el nombre de pila).
--
-- null = todavía no se cargó el alias → la exportación cae a `full_name`. Por eso es nullable y
-- sin default: no hay valor "correcto" que inventar, y un '' silencioso rompería el archivo.
--
-- Única columna que U0b agrega: el resto del ciclo (períodos, horas, tarifas, pagos) ya lo cubre
-- la mig 056. NO toca `auth`/`profiles`, Caja, Tips, POS, Proveedores ni el enum `user_role`.

alter table public.employees
  add column if not exists nombre_homebanking text;

comment on column public.employees.nombre_homebanking is
  'Salarios U0b: nombre del beneficiario TAL CUAL figura en el homebanking (columna A del archivo del banco). null = usar full_name.';
