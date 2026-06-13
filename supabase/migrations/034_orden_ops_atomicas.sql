-- 034: Atomicidad de operaciones multi-paso de órdenes (AUDITORIA-CONSOLIDACION §1.2 🟡).
-- ADITIVA. Envuelve merge/unmerge/reopen en RPC transaccionales SECURITY DEFINER.
-- NO toca la matemática: el merge RECIBE los checks ya calculados por splitByGroup en el
-- cliente y solo los persiste; unmerge/reopen son puro cambio de estado (sin plata).

-- ── Combinar mesas (atómico): mover ítems + marcar merged + traza + checks por mesa ──
create or replace function public.pos_merge_orden(
  p_into uuid, p_from uuid, p_by_name text, p_checks jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from   record;
  v_haspaid boolean;
  c jsonb;
  v_idx int := 0;
begin
  if get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso'; end if;
  if p_into = p_from then raise exception 'No se puede combinar una mesa consigo misma'; end if;
  select id, table_name, status, merge_trace into v_from from pos_orders where id = p_from for update;
  if v_from.id is null then raise exception 'Mesa a combinar no encontrada'; end if;
  if v_from.status <> 'open' then raise exception 'La mesa a combinar no está abierta'; end if;
  -- mover ítems
  update pos_order_items set merged_from_order = p_from, order_id = p_into, updated_at = now()
    where order_id = p_from;
  -- marcar la mesa absorbida
  update pos_orders set status = 'merged', merged_into = p_into,
    merge_trace = coalesce(v_from.merge_trace, '[]'::jsonb) || jsonb_build_object('from_table', v_from.table_name, 'from_order', p_from::text, 'by', p_by_name, 'at', now()),
    updated_at = now()
    where id = p_from;
  -- traza en la receptora
  update pos_orders set notes = case when coalesce(notes,'') = '' then '' else notes || E'\n' end
      || 'combinó ' || v_from.table_name || ' · ' || p_by_name || ' · ' || to_char(now(), 'HH24:MI'),
    updated_at = now() where id = p_into;
  -- checks por mesa (solo si no hay uno pagado): recibidos ya calculados del cliente
  select exists(select 1 from pos_checks where order_id = p_into and paid) into v_haspaid;
  if not v_haspaid then
    delete from pos_checks where order_id = p_into;
    for c in select * from jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) loop
      v_idx := v_idx + 1;
      insert into pos_checks (order_id, idx, label, kind, amount_crc, items_snapshot)
        values (p_into, v_idx, c->>'label', 'merge', (c->>'amount_crc')::numeric, coalesce(c->'items_snapshot','[]'::jsonb));
    end loop;
  end if;
end $$;

-- ── Des-combinar (atómico): devolver ítems + reabrir + borrar checks ──
create or replace function public.pos_unmerge_orden(p_into uuid, p_from uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso'; end if;
  if exists(select 1 from pos_checks where order_id = p_into and paid) then
    raise exception 'No se puede des-combinar: ya hay un check pagado'; end if;
  update pos_order_items set order_id = p_from, merged_from_order = null, updated_at = now()
    where merged_from_order = p_from;
  update pos_orders set status = 'open', merged_into = null, updated_at = now()
    where id = p_from and status = 'merged';
  delete from pos_checks where order_id = p_into;
end $$;

-- ── Reabrir orden cerrada (atómico): borrar checks + reabrir + traza ──
create or replace function public.pos_reopen_orden(p_order_id uuid, p_by text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso'; end if;
  select status into v_status from pos_orders where id = p_order_id for update;
  if v_status is null then raise exception 'Mesa no encontrada'; end if;
  if v_status <> 'closed' then raise exception 'La mesa no está cerrada'; end if;
  delete from pos_checks where order_id = p_order_id;
  update pos_orders set status = 'open', closed_at = null, closed_by = null,
    notes = case when coalesce(notes,'') = '' then '' else notes || E'\n' end
      || 'REABRIÓ la mesa · ' || p_by || ' · ' || p_reason || ' · ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
    updated_at = now()
    where id = p_order_id;
end $$;

revoke execute on function public.pos_merge_orden(uuid,uuid,text,jsonb) from anon;
revoke execute on function public.pos_unmerge_orden(uuid,uuid) from anon;
revoke execute on function public.pos_reopen_orden(uuid,text,text) from anon;
grant execute on function public.pos_merge_orden(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.pos_unmerge_orden(uuid,uuid) to authenticated;
grant execute on function public.pos_reopen_orden(uuid,text,text) to authenticated;
