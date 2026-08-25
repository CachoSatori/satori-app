-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 061 — Salarios Capa 3: hora habitual de entrada/salida por empleado. ADITIVA.         ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod sin firma de Ismael (pushear una mig a `main` la AUTO-APLICA a la base de prod).
--    ⚠ Prod ni siquiera tiene el módulo: la 056 y siguientes viven solo en staging.
-- ⚠ Número 061: verificado libre contra los archivos de TODAS las ramas del remoto al 2026-08-25
--   (la última es la 060). Confirmar igual contra el ledger real de staging antes de aplicar.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────────────────────
-- Cada quincena se corrige a mano la misma gente: quien marca UNA sola vez en el día (entró y
-- se olvidó de salir, o al revés) deja un `impar` que alguien tiene que completar. Para la mayoría
-- la mitad que falta es SIEMPRE la misma hora — el turno de esa persona no cambia. Guardarla acá
-- convierte esa corrección repetida en un dato del empleado, y la bandeja la propone en vez de
-- pedirla de nuevo.
--
-- `time` sin zona a propósito: es una hora de reloj de pared ("entra a las 08:00"), no un instante.
-- Costa Rica es UTC−6 FIJO y sin horario de verano, así que no hay borde que reconciliar.
--
-- NULL y sin default, las dos: null = ESTE empleado no tiene regla, y su impar sigue yendo a
-- corrección manual. No existe una hora "por defecto" honesta — inventarla sería inventar horas,
-- y las horas son plata. Por eso tampoco hay backfill.
--
-- Solo son un PRE-RELLENO: la regla nunca escribe sola en `work_days`. Las horas siguen saliendo
-- de la resta entre dos marcas de reloj (Capa 2) y de un override `manual` auditado, con su motivo.
--
-- NO toca `auth`/`profiles`, Caja, Tips, POS, Proveedores, el enum `user_role` ni el 10% de
-- servicio. Ninguna columna existente cambia de tipo, de default ni de nullability.

alter table public.employees
  add column if not exists hora_entrada_habitual time,
  add column if not exists hora_salida_habitual  time;

comment on column public.employees.hora_entrada_habitual is
  'Salarios Capa 3: hora de entrada habitual (reloj de pared, hora CR). Pre-rellena la mitad que falta de un fichaje impar cuando la marca real es la SALIDA. null = sin regla → corrección manual.';

comment on column public.employees.hora_salida_habitual is
  'Salarios Capa 3: hora de salida habitual (reloj de pared, hora CR). Pre-rellena la mitad que falta de un fichaje impar cuando la marca real es la ENTRADA. null = sin regla → corrección manual.';
