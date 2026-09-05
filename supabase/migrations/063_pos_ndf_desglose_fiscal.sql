-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 063 — PoS "Nube de Fuego": desglose fiscal + regalías. ADITIVA e IDEMPOTENTE.          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⛔ NO APLICADA. Se entrega en rama para revisión (`feat/pos-desglose`).
-- ✅ Para STAGING (ref hwiatgicyyqyezqwldia; confirmar `cat supabase/.temp/project-ref` ANTES de tocar la DB).
--    NUNCA a prod (`yiczgdtirrkdvohdquzf`): pushear una mig a `main` la AUTO-APLICA a la base de prod.
-- ⚠ Número 063: verificado libre contra los archivos de TODAS las ramas del remoto (la última es
--   la 062). Confirmar igual contra el ledger real de staging (`supabase migration list --linked`)
--   antes de aplicar: el `db push` aplica TODO lo pendiente, no solo esta.
--
-- FIRMADO por Ismael 2026-09-04. Spec: `SPEC-valor-servido-regalias.md`. Continúa la mig 062.
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- SOLO 4 columnas + 1 CHECK + 1 índice, todo sobre `pos_ndf_tickets` (tabla que creó la 062 y
-- que hoy no lee ninguna pantalla de la app). Nada más: sin tablas nuevas, sin backfill, sin
-- triggers, sin RPCs, sin tocar RLS.
--
--   valor_servido_crc — el NETO: suma del monto de las líneas de comida 2,3,4,13,16,29 + bebida 5.
--   iva_crc           — el ImpV que dijo el PoS. NUNCA derivado de neto x 0,13.
--   regalia_crc       — cortesías (17) + dueños (28) + el neto de los tickets sin cobro.
--   clase_ingreso     — cómo se cobró: cobrada | cortesia | duenos | sin_cobro | descuento | mixta.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
-- `total_crc`, `servicio_crc` y `descuento_crc` quedan EXACTAMENTE como están (la 062 ya creó
-- `descuento_crc`; acá no se re-crea ni se re-interpreta). Ninguna columna existente cambia de
-- tipo, de default ni de nullability. No toca Caja, Tips, Proveedores, `auth`/`profiles`, el enum
-- `user_role` ni los sagrados (`posFiscal` · `tipCalculations` · `cashUtils`).
-- Todo es `add column if not exists` / `drop constraint if exists` → re-ejecutable sin efecto.
--
-- ── POR QUÉ NO SE PERSISTE EL BRUTO ────────────────────────────────────────────────────────
-- `bruto_servido` es una SUMA de tres columnas que ya están acá. Guardarlo sería un cuarto lugar
-- donde el mismo número puede quedar desincronizado. Se deriva en la consulta:
--
--   valor_servido_crc + coalesce(iva_crc, 0) + coalesce(servicio_crc, 0)
--
-- ── POR QUÉ `iva_crc` NO LLEVA DEFAULT 0 ───────────────────────────────────────────────────
-- NULL y 0 dicen cosas distintas: `0` = el PoS informó cero IVA (las facturas de 2024 son así);
-- `NULL` = todavía no se ingestó esa columna para ese ticket. Un default 0 borraría esa diferencia
-- justo en el campo donde inventar un número es inventar plata en un reporte fiscal.

alter table public.pos_ndf_tickets
  add column if not exists valor_servido_crc numeric,
  add column if not exists iva_crc           numeric,
  add column if not exists regalia_crc       numeric,
  add column if not exists clase_ingreso     text;

-- `drop` + `add` en vez de `add ... if not exists` (que Postgres no soporta para constraints):
-- así la migración es re-ejecutable y, si mañana se agrega una clase, el CHECK se actualiza solo.
alter table public.pos_ndf_tickets
  drop constraint if exists pos_ndf_tickets_clase_ingreso_chk;

alter table public.pos_ndf_tickets
  add constraint pos_ndf_tickets_clase_ingreso_chk
  check (clase_ingreso is null or clase_ingreso in
    ('cobrada','cortesia','duenos','sin_cobro','descuento','mixta'));

-- Todo reporte de regalías arranca filtrando por clase.
create index if not exists pos_ndf_tickets_clase_idx
  on public.pos_ndf_tickets (clase_ingreso);

comment on column public.pos_ndf_tickets.valor_servido_crc is
  'NETO fiscal: suma del monto de las lineas de comida (familias 2,3,4,13,16,29) y bebida (5). Se compara contra la Venta Neta del reporte oficial; el gap esperado son las familias de cajon/personal (1,6,9,11,15,25), que quedan afuera a proposito. La familia 6 NO entra: es el cajon mixto donde tambien se carga la comida del personal.';
comment on column public.pos_ndf_tickets.iva_crc is
  'Impuesto de venta TAL CUAL lo informo el PoS (ImpV). NUNCA derivado de neto x 0,13: las facturas de 2024 vienen con ImpV=0 y calcularles un IVA que nadie cobro inventaria plata. null = no ingestado; 0 = el PoS informo cero.';
comment on column public.pos_ndf_tickets.regalia_crc is
  'Lo regalado, medido en NETO (no bruto menos cobrado): monto de las lineas de cortesias (17) y duenos (28), mas el valor servido completo de un ticket que no cobro nada. NO incluye descuento_crc: un Local Club o una promo autorizada es una decision comercial sobre una venta cobrada, no un regalo.';
comment on column public.pos_ndf_tickets.clase_ingreso is
  'Como se cobro: cobrada | cortesia (17) | duenos (28) | sin_cobro (se sirvio y no se cobro) | descuento (descuento_crc>0 y el resto cobrado) | mixta (dos o mas de las anteriores, p.ej. 17 y 28 en el mismo ticket). null = ni venta ni regalo (no clasificable). El bruto servido se deriva: valor_servido_crc + coalesce(iva_crc,0) + coalesce(servicio_crc,0).';
