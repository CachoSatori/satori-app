-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 052 — Auditoría de EDICIONES de cash_movements (tamper-evident). ADITIVA e IDEMPOTENTE. ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NUMERACIÓN PROVISIONAL: la rama `metas_personales` TAMBIÉN apunta a 052. El número final
--   (052 / 053 / …) lo confirma Ismael en el pase. Si cambia, SOLO cambia el nombre del archivo —
--   el SQL de abajo es agnóstico al número (no referencia "052" en ningún lado).
--
-- ⚠ NO MERGEAR / NO APLICAR SIN FIRMA. Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia),
--   NUNCA en producción, y NUNCA vía `db push` sin autorización. Este archivo NO se aplicó a la base.
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- Espejo de la auditoría de BORRADOS (movement_deletions, mig 039) pero para EDICIONES.
-- Un trigger AFTER UPDATE deja una traza append-only de cada cambio a una columna SENSIBLE de
-- cash_movements — cubra el canal que cubra: app online, replay offline, o UPDATE directo por la
-- Management API. Al vivir en la base (no en la app) es tamper-evident: no se puede editar plata
-- "por la espalda" sin dejar rastro.
--
-- ── DISEÑO (por qué así) ───────────────────────────────────────────────────────────────────
--   · Solo registra si cambió una COLUMNA SENSIBLE (plata/estado/clasificación/cuenta/proveedor).
--     Ignora no-ops, cambios cosméticos (p. ej. description) y el toque de updated_at del trigger
--     BEFORE handle_updated_at.
--   · `before`/`after` = snapshot COMPLETO de la fila (to_jsonb) → reversible/inspeccionable.
--     `changed` = solo el diff de las claves sensibles, con forma { campo: {old, new} }.
--   · edited_by = auth.uid(). Por el canal admin (Management API / service_role) auth.uid() es NULL
--     → la fila queda con edited_by NULL A PROPÓSITO (igual deja rastro, sin actor identificado).
--   · Append-only real: RLS on, SOLO policy de SELECT (owner/manager/contador). SIN policies de
--     INSERT/UPDATE/DELETE → ningún cliente logueado puede forjar/alterar/borrar trazas; el ÚNICO
--     escritor es el trigger (SECURITY DEFINER, corre como el dueño de la tabla → RLS no lo frena).
--   · movement_id es un uuid PLANO (sin FK a cash_movements): la traza debe sobrevivir aunque el
--     movimiento se borre luego (delete_movement_cascade). Tamper-evidence > integridad referencial.
--
-- ── NO TOCA (verificado) ───────────────────────────────────────────────────────────────────
--   · cash_movements: ni columnas, ni FK, ni políticas, ni el trigger BEFORE handle_updated_at.
--   · Convive con el trigger hermano cash_movements_unif (mig 042, AFTER INSERT OR UPDATE) sin
--     interferir: solo lee OLD/NEW y escribe en su propia tabla.
--   · Sagrados (tipCalculations / cashUtils / posFiscal): cero cambios de código de app.

-- ── 1. Tabla de auditoría de la edición (append-only) ──
create table if not exists public.movement_edits (
  id          uuid        primary key default gen_random_uuid(),
  movement_id uuid        not null,                         -- id del cash_movement editado (uuid plano, sin FK: ver cabecera)
  edited_by   uuid        references public.profiles(id),   -- = auth.uid(); NULL por canal admin (a propósito)
  edited_at   timestamptz not null default now(),
  before      jsonb       not null,                         -- to_jsonb(OLD): fila completa ANTES
  after       jsonb       not null,                         -- to_jsonb(NEW): fila completa DESPUÉS
  changed     jsonb       not null                          -- diff de columnas sensibles: { campo: {old, new} }
);

create index if not exists movement_edits_movement_id_idx on public.movement_edits (movement_id);
create index if not exists movement_edits_edited_at_idx   on public.movement_edits (edited_at desc);

-- ── 2. RLS append-only: SELECT solo owner/manager/contador; SIN INSERT/UPDATE/DELETE ──
-- (El trigger de abajo es SECURITY DEFINER → escribe la traza sin depender de una policy de INSERT.
--  Al NO haber policy de INSERT/UPDATE/DELETE, ningún cliente logueado puede forjar ni borrar trazas.)
alter table public.movement_edits enable row level security;

drop policy if exists movement_edits_select on public.movement_edits;
create policy movement_edits_select on public.movement_edits for select
  using (get_my_role() in ('owner','manager','contador'));

-- ── 3. Función + trigger AFTER UPDATE: registra solo cambios en columnas sensibles ──
-- SECURITY DEFINER: corre como el dueño de la tabla → puede insertar la traza aunque movement_edits
-- tenga RLS y no tenga policy de INSERT. NOTA (mig 049): es función de TRIGGER — no invocable directo
-- ("trigger functions can only be called as triggers") y un revoke NO frena el disparo; se deja igual
-- que el hermano unif_on_cash_movement (sin revoke). Endurecer aparte si se decide.
create or replace function public.log_movement_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- COLUMNAS SENSIBLES vigiladas (plata / método / tipo / caja / estado / clasif. / cuenta / proveedor):
  v_keys    text[] := array[
    'amount_crc','amount_usd','method','movement_type','caja_origen',
    'status','subcategory','classification','account_id','supplier_id'
  ];
  v_old     jsonb := to_jsonb(OLD);
  v_new     jsonb := to_jsonb(NEW);
  v_old_sub jsonb := '{}'::jsonb;   -- solo las claves sensibles de OLD
  v_new_sub jsonb := '{}'::jsonb;   -- solo las claves sensibles de NEW
  v_changed jsonb := '{}'::jsonb;   -- diff { campo: {old, new} } de las claves sensibles que cambiaron
  v_key     text;
begin
  foreach v_key in array v_keys loop
    v_old_sub := v_old_sub || jsonb_build_object(v_key, v_old -> v_key);
    v_new_sub := v_new_sub || jsonb_build_object(v_key, v_new -> v_key);
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := v_changed || jsonb_build_object(
        v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
      );
    end if;
  end loop;

  -- Ninguna columna sensible cambió (no-op, mismos valores, o solo cosméticas / updated_at) → no registra.
  if v_old_sub is not distinct from v_new_sub then
    return null;   -- AFTER trigger: el valor de retorno se ignora
  end if;

  insert into public.movement_edits (movement_id, edited_by, before, after, changed)
    values (OLD.id, auth.uid(), v_old, v_new, v_changed);

  return null;     -- AFTER trigger: el valor de retorno se ignora
end $$;

drop trigger if exists cash_movements_audit_edit on public.cash_movements;
create trigger cash_movements_audit_edit
  after update on public.cash_movements
  for each row execute function public.log_movement_edit();
