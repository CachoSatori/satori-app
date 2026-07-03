-- 039 — Borrado de movimiento de caja CON cascada de inventario + auditoría. ADITIVA e IDEMPOTENTE.
--
-- ⚠ NO MERGEAR / NO APLICAR SIN FIRMA DE LA DUEÑA.
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla: regenerar los tipos de Supabase (aparece la RPC delete_movement_cascade).
--
-- PROBLEMA QUE CIERRA:
-- inventory_movements.cash_movement_id es ON DELETE SET NULL (mig 017). Al borrar el
-- cash_movement de una factura, su entrada de inventario quedaba HUÉRFANA (cash_movement_id
-- → NULL pero la fila sigue) → inventario inflado y asientos duplicados al recargar.
-- Solución: un borrado que, en UNA transacción, deja auditoría, borra el inventario ligado
-- y borra el cash_movement. Solo AGREGA (tabla + RPC); NO toca políticas ni la FK de mig 017.

-- ── 1. Tabla de auditoría del borrado (snapshot reversible) ──
create table if not exists public.movement_deletions (
  id                 uuid        primary key default gen_random_uuid(),
  deleted_by         uuid        references public.profiles(id),
  deleted_at         timestamptz not null default now(),
  note               text        not null,
  movement_snapshot  jsonb       not null,   -- la fila de cash_movements borrada
  inventory_snapshot jsonb                   -- las filas de inventory_movements borradas (puede no haber)
);

create index if not exists movement_deletions_deleted_at_idx
  on public.movement_deletions (deleted_at desc);

-- ── 2. RLS: INSERT/SELECT solo para owner/manager/contador ──
-- (La RPC de abajo es SECURITY DEFINER → inserta la auditoría sin depender de estas policies;
--  igual las dejamos para que un INSERT directo quede acotado y el contador pueda LEER la traza.)
alter table public.movement_deletions enable row level security;

drop policy if exists movement_deletions_select on public.movement_deletions;
create policy movement_deletions_select on public.movement_deletions for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists movement_deletions_insert on public.movement_deletions;
create policy movement_deletions_insert on public.movement_deletions for insert
  with check (get_my_role() in ('owner','manager','contador'));

-- ── 3. RPC: borrar el movimiento arrastrando su inventario, en UNA transacción ──
-- SECURITY DEFINER: bypassa RLS para escribir la auditoría y borrar el inventario ligado.
-- Idempotente: si el movimiento ya no existe, no hace nada (no audita, no falla).
create or replace function public.delete_movement_cascade(p_movement_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.cash_movements%rowtype;
  v_inv      jsonb;
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

  -- Snapshot del inventario ligado ANTES de borrarlo (auditoría reversible).
  select coalesce(jsonb_agg(to_jsonb(im.*)), '[]'::jsonb)
    into v_inv
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  -- Auditoría (la escribe la RPC como definer).
  insert into public.movement_deletions (deleted_by, note, movement_snapshot, inventory_snapshot)
    values (auth.uid(), btrim(p_note), to_jsonb(v_movement), v_inv);

  -- Borrar el inventario ligado (lo que el ON DELETE SET NULL dejaba huérfano) y luego el movimiento.
  delete from public.inventory_movements where cash_movement_id = p_movement_id;
  delete from public.cash_movements      where id               = p_movement_id;
end $$;

revoke execute on function public.delete_movement_cascade(uuid, text) from anon;
grant  execute on function public.delete_movement_cascade(uuid, text) to authenticated;
