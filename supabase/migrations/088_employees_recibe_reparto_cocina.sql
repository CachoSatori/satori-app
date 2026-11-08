-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 088 — employees.recibe_reparto_cocina (PROP-AUD-01). ADITIVA e IDEMPOTENTE.            ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NO APLICAR NI MERGEAR SIN FIRMA DE ISMAEL. Primero staging (recorrido real y limpieza), después prod.
--
-- Qué cierra: el reparto semanal de cocina (TipCocina) dejaba afuera a una persona comparando una
-- subcadena fija contra su nombre (homónimos, renombres, nombre real en un repo público). Ahora lo
-- decide esta marca. Spec: docs/SPEC-reparto-cocina-marca.md.
--
--   · default true + not null: hoy todos reciben → nadie cambia al aplicar.
--   · El valor de la persona hoy excluida se carga DESPUÉS, por el owner en Admin → Empleados, o con
--     un `update public.employees set recibe_reparto_cocina = false where id = '<ID>'` corrido FUERA
--     del repo, con firma. Este archivo no tiene nombres ni ids reales.
--   · RLS: la de employees (owner/manager gestionan). La pantalla la muestra y edita solo al owner.
--   · No toca tipCalculations.ts ni el pozo: quien no recibe sigue aportando.
--
-- Rollback: scripts/sql/088_rollback.sql.

alter table public.employees
  add column if not exists recibe_reparto_cocina boolean not null default true;

comment on column public.employees.recibe_reparto_cocina is
  'PROP-AUD-01: false = aporta al pozo semanal de cocina pero no recibe (TipCocina). La edita el owner.';
