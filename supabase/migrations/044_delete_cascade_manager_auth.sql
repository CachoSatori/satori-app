-- 044 — Autorización de gerencia INLINE en el borrado en cascada. ADITIVA e IDEMPOTENTE.
--
-- ✅ FIRMADA POR LA DUEÑA. Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla: regenerar los tipos de Supabase.
-- REQUIERE 043 (delete_movement_cascade 2-args) aplicada antes.
--
-- PROBLEMA: en móvil el cajero validaba credenciales de gerencia en el modal, pero la RPC
-- delete_movement_cascade igual rechazaba el borrado porque get_my_role() = 'cajero'. El modal
-- verificaba en el cliente, no en la RPC → "No autorizado" pese a credenciales válidas.
--
-- FIX: la RPC acepta credenciales de manager opcionales y las valida server-side (mismo crypt que
-- verify_manager, mig 019). owner/manager logueado → autoriza por su rol (sin credenciales). cajero
-- con credenciales válidas de owner/manager activo → autoriza. Se audita QUIÉN autorizó (authorized_by),
-- además de QUIÉN apretó (deleted_by). El resto del cuerpo es IDÉNTICO a 043 (verbatim).

-- 1) Auditar quién autorizó (además de quién apretó)
alter table public.movement_deletions
  add column if not exists authorized_by uuid references public.profiles(id);

-- 2) La firma pasa de 2 a 4 args → dropear la vieja (evita ambigüedad de overload)
drop function if exists public.delete_movement_cascade(uuid, text);

-- 3) Recrear con autorización de manager inline. Cuerpo IDÉNTICO a 043 salvo el bloque de auth
--    (CAMBIO 1) y el insert de auditoría (CAMBIO 2).
create or replace function public.delete_movement_cascade(
  p_movement_id uuid, p_note text,
  p_manager_email text default null, p_manager_password text default null
) returns void
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
  v_authorized_by uuid;
begin
  -- CAMBIO 1: autorización por rol logueado O por credenciales de gerencia validadas server-side.
  if get_my_role() in ('owner','manager') then
    v_authorized_by := auth.uid();
  elsif p_manager_email is not null and p_manager_password is not null then
    select u.id into v_authorized_by
      from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_manager_email))
       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)
       and p.role in ('owner','manager') and p.is_active;
    if v_authorized_by is null then
      raise exception 'No autorizado para borrar movimientos';
    end if;
  else
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

  -- CAMBIO 2: la auditoría agrega authorized_by (quién autorizó el borrado).
  insert into public.movement_deletions (deleted_by, authorized_by, note, movement_snapshot, inventory_snapshot)
    values (auth.uid(), v_authorized_by, btrim(p_note), to_jsonb(v_movement), v_inv);

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

revoke execute on function public.delete_movement_cascade(uuid, text, text, text) from anon;
grant  execute on function public.delete_movement_cascade(uuid, text, text, text) to authenticated;
