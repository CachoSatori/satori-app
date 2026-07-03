-- 043 — Unificación Bandeja↔Caja: cascada extendida + RPCs de revisión de inventario. ADITIVA e IDEMPOTENTE.
--
-- ⚠ BORRADOR DE PLATA — NO MERGEAR / NO APLICAR SIN FIRMA DE LA DUEÑA.
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla (con firma): regenerar los tipos de Supabase.
-- REQUIERE 040 (inventory_review_task) y 042 (accounting_entries + post_accounting_entry) aplicadas antes.
--
-- FUENTE DE VERDAD: docs/SPEC-unificacion-bandeja-caja.md §11.3 (reversión), §12 (extensión del borrado,
-- D5 foto), §7.2 (transiciones COMPLETADA/DESCARTADA), §8 (INV-2 cero huérfanos, INV-7 atomicidad).
--
-- ✅ OPCIÓN A (FIRMADA) — accounting_entries es libro de AUDITORÍA/REVERSIÓN únicamente; NO alimenta el
-- P&L (el P&L se deriva en vivo de cash_movements vía getLiveActuals + carga manual). Por eso acá:
--   · complete_inventory_review REGISTRA su asiento de COGS en el libro (traza auditada), pero como en 042
--     ya NO existe el rollup, ese asiento NO impacta el P&L.
--   · la cascada revierte en el libro (contra-asiento + status='reversed'); al no haber rollup, tampoco
--     impacta el P&L.
-- Propagación automática al P&L = visión futura (SPEC §19).
--
-- create or replace SOBRE la RPC de mig 039: CONSERVA todo su comportamiento (rol owner/manager, nota
-- obligatoria, snapshot+auditoría, borrado de inventario ligado + del movimiento, idempotencia) y AGREGA,
-- en la MISMA transacción: reversión de asientos (en el libro) + descarte de la tarea + (D5) borrado del documento.
-- CERO backfill: solo actúa sobre el movimiento que se borra.

-- ── 1. RPC: completar revisión de inventario (PENDIENTE/EN_REVISION → COMPLETADA) ──
-- Crea inventory_movements 'purchase' por línea + registra el asiento 'compra_inventario' EN EL LIBRO
-- (auditoría; NO impacta el P&L — Opción A). Online. Idempotente: si ya está COMPLETADA, no hace nada.
create or replace function public.complete_inventory_review(p_task_id uuid, p_lines jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task  public.inventory_review_task%rowtype;
  v_line  jsonb;
  v_total numeric(12,2) := 0;
  v_acct  text;
  v_date  date;
begin
  if get_my_role() not in ('owner','manager','contador') then
    raise exception 'No autorizado para completar revisión de inventario';
  end if;

  select * into v_task from public.inventory_review_task where id = p_task_id for update;
  if not found then
    raise exception 'Tarea de revisión no encontrada';
  end if;
  if v_task.status = 'COMPLETADA' then
    return;   -- idempotente
  end if;
  if v_task.status = 'DESCARTADA' then
    raise exception 'La tarea está descartada; no se puede completar (RN-4: re-cargar = borrar el pago)';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then
    raise exception 'Se requiere al menos una línea de inventario';
  end if;

  v_date := coalesce(v_task.entry_date, (now() at time zone 'America/Costa_Rica')::date);

  -- Crear los movimientos de inventario (entrada por compra), ligados al pago y al documento.
  for v_line in select value from jsonb_array_elements(p_lines) as t(value) loop
    insert into public.inventory_movements (
      ingredient_id, movement_type, qty_delta, unit, unit_cost,
      reference_id, notes, created_by, created_at, document_id, cash_movement_id
    ) values (
      (v_line->>'ingredient_id')::uuid, 'purchase',
      (v_line->>'qty_delta')::numeric, v_line->>'unit', (v_line->>'unit_cost')::numeric,
      p_task_id::text, coalesce(p_note, v_line->>'notes'), auth.uid()::text, now(),
      v_task.document_id, v_task.cash_movement_id
    );
    v_total := v_total
      + coalesce((v_line->>'qty_delta')::numeric, 0) * coalesce((v_line->>'unit_cost')::numeric, 0);
  end loop;

  -- Asiento de compra de inventario (COGS) EN EL LIBRO (auditoría; NO impacta el P&L — Opción A).
  -- Cuenta: 'a5200' (Food Costs) por defecto.
  -- (Asunción de borrador: una sola cuenta COGS por tarea; el split por categoría de ingrediente
  --  —food vs beverage— es un refinamiento posterior. Ver reporte.)
  v_acct := 'a5200';
  if not exists (select 1 from public.finance_accounts where id = v_acct) then
    raise exception 'Cuenta COGS % inexistente en finance_accounts', v_acct;
  end if;

  perform public.post_accounting_entry(
    v_date, v_acct, v_total, 'inventory_movement', p_task_id, 'compra_inventario',
    coalesce(v_task.currency, 'CRC'), coalesce(v_task.fx_rate, 1), null,
    coalesce(p_note, 'asiento de compra de inventario (unificación Bandeja↔Caja)')
  );

  update public.inventory_review_task
     set status = 'COMPLETADA', completed_by = auth.uid(), completed_at = now()
   where id = p_task_id;
end $$;
revoke execute on function public.complete_inventory_review(uuid,jsonb,text) from public, anon;
grant  execute on function public.complete_inventory_review(uuid,jsonb,text) to authenticated;

-- ── 2. RPC: descartar una tarea de revisión (PENDIENTE/EN_REVISION → DESCARTADA, con motivo) ──
create or replace function public.discard_inventory_review(p_task_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_task public.inventory_review_task%rowtype;
begin
  if get_my_role() not in ('owner','manager','contador') then
    raise exception 'No autorizado para descartar revisión de inventario';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'El motivo de descarte es obligatorio';
  end if;

  select * into v_task from public.inventory_review_task where id = p_task_id for update;
  if not found then
    raise exception 'Tarea de revisión no encontrada';
  end if;
  if v_task.status = 'DESCARTADA' then
    return;   -- idempotente
  end if;
  if v_task.status = 'COMPLETADA' then
    raise exception 'No se descarta una tarea COMPLETADA (RN-4: para revertir, borrar el pago)';
  end if;

  update public.inventory_review_task
     set status = 'DESCARTADA', discarded_by = auth.uid(), discarded_at = now(),
         discard_reason = btrim(p_reason)
   where id = p_task_id;
end $$;
revoke execute on function public.discard_inventory_review(uuid,text) from public, anon;
grant  execute on function public.discard_inventory_review(uuid,text) to authenticated;

-- ── 3. Cascada extendida (create or replace de la RPC de mig 039) ──
-- Conserva 039 + agrega: revertir asientos (§11.3) + descartar tarea + (D5) borrar documento. Atómica (INV-7).
create or replace function public.delete_movement_cascade(p_movement_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.cash_movements%rowtype;
  v_inv      jsonb;
  v_doc_ids  uuid[];
  v_entry    public.accounting_entries%rowtype;
  v_doc      uuid;
begin
  if get_my_role() not in ('owner','manager') then
    raise exception 'No autorizado para borrar movimientos';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'La nota de motivo es obligatoria';
  end if;

  -- Lock + lectura del movimiento. Si ya no existe → idempotente (return sin auditar).
  select * into v_movement from public.cash_movements where id = p_movement_id for update;
  if not found then
    return;
  end if;

  -- Snapshot del inventario ligado + ids de documentos referenciados (antes de borrar nada).
  select coalesce(jsonb_agg(to_jsonb(im.*)), '[]'::jsonb)
    into v_inv
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  select coalesce(array_agg(distinct im.document_id) filter (where im.document_id is not null), '{}'::uuid[])
    into v_doc_ids
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  -- Auditoría (la escribe la RPC como definer) — igual que mig 039.
  insert into public.movement_deletions (deleted_by, note, movement_snapshot, inventory_snapshot)
    values (auth.uid(), btrim(p_note), to_jsonb(v_movement), v_inv);

  -- (§11.3) Revertir los asientos del movimiento (gasto_operativo) y de su inventario (compra_inventario,
  -- cuyo source_id = id de la inventory_review_task del movimiento). Contra-asiento + status='reversed'.
  for v_entry in
    select * from public.accounting_entries ae
     where ae.status = 'posted'
       and (
         (ae.source_type = 'cash_movement'      and ae.source_id = p_movement_id)
         or (ae.source_type = 'inventory_movement' and ae.source_id in (
               select t.id from public.inventory_review_task t where t.cash_movement_id = p_movement_id))
       )
  loop
    insert into public.accounting_entries (
      entry_date, year, month, account_id, amount_crc, currency, fx_rate,
      source_type, source_id, kind, status, reverses_entry_id, note, created_by
    ) values (
      v_entry.entry_date, v_entry.year, v_entry.month, v_entry.account_id, -v_entry.amount_crc,
      v_entry.currency, v_entry.fx_rate, 'reversal', v_entry.source_id, v_entry.kind, 'posted',
      v_entry.id, 'reversión por borrado en cascada (unificación Bandeja↔Caja)', auth.uid()
    );
    update public.accounting_entries set status = 'reversed' where id = v_entry.id;
  end loop;

  -- (§7.2) Cerrar la(s) tarea(s) de inventario activas → DESCARTADA con motivo 'cascade'.
  update public.inventory_review_task
     set status = 'DESCARTADA', discarded_by = auth.uid(), discarded_at = now(), discard_reason = 'cascade'
   where cash_movement_id = p_movement_id
     and status in ('PENDIENTE','EN_REVISION','COMPLETADA');

  -- Borrar el inventario ligado (lo que el ON DELETE SET NULL dejaba huérfano) y luego el movimiento.
  delete from public.inventory_movements where cash_movement_id = p_movement_id;
  delete from public.cash_movements      where id               = p_movement_id;

  -- (D5) Borrar el/los documento(s) ligado(s) si NADA MÁS los referencia → permite recargar la factura
  -- sin que el dedupe por sha256 la frene. "Referencia que importa" = inventario o historial de precios
  -- que todavía la usen (las tareas/movimientos ya cerrados tienen FK on delete set null).
  for v_doc in
    select d.id from public.documents d
     where d.linked_movement_id = p_movement_id
        or d.id = any (v_doc_ids)
  loop
    if not exists (select 1 from public.inventory_movements im where im.document_id = v_doc)
       and not exists (select 1 from public.ingredient_prices ip where ip.document_id = v_doc) then
      delete from public.documents where id = v_doc;
    end if;
  end loop;
end $$;

revoke execute on function public.delete_movement_cascade(uuid, text) from anon;
grant  execute on function public.delete_movement_cascade(uuid, text) to authenticated;
