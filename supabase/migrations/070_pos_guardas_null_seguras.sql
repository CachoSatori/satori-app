-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 070 · SEC-01b (línea PoS propio) · guardas NULL-seguras + sin EXECUTE para anon      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Solo existe en la línea `staging` (PoS propio). Se aplica en staging ANTES que la 069
-- (`get_my_role()` mira `is_active`), porque con la 069 un usuario inactivo recibe NULL y
-- `NULL not in (...)` no dispara el raise.
--
-- 1. Las 6 funciones: texto COMPLETO vigente en staging (pg_get_functiondef, 05-nov-2026),
--    cambiando SOLO la línea de la guarda:
--      if get_my_role() not in (...)  →  if get_my_role() is null or get_my_role() not in (...)
--    El resto del cuerpo es idéntico (diff = 1 línea por función). La lógica de plata no cambia.
-- 2. EXECUTE: se revoca a public/anon (anon lo tenía vía PUBLIC) y se mantiene para
--    authenticated y service_role. Aplicado en staging el 05/11 08:44 CR con firma.
--
-- Número: 070 y no 069 porque la 069 es la de SEC-01b en `main` (numeración compartida).
-- Re-ejecutable: create or replace + revoke/grant. Rollback: scripts/sql/070_rollback.sql.

-- ── pos_cobrar_check ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_cobrar_check(p_check_id uuid, p_order_id uuid, p_client_op_id uuid, p_method text, p_amount_crc numeric, p_currency text, p_exchange_rate_used numeric, p_received_crc numeric, p_received_usd numeric, p_change_crc numeric, p_tip_crc numeric, p_tip_currency text, p_note text, p_closed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paid     boolean;
  v_pid      uuid;
  v_allpaid  boolean;
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso para cobrar';
  end if;
  -- lock del check
  select paid into v_paid from pos_checks where id = p_check_id for update;
  if v_paid is null then raise exception 'Cuenta (check) no encontrada'; end if;
  -- reenvío del MISMO intento → idempotente
  select id into v_pid from pos_payments where check_id = p_check_id and client_op_id = p_client_op_id;
  if v_pid is not null then
    select count(*) filter (where not paid) = 0 into v_allpaid from pos_checks where order_id = p_order_id;
    return jsonb_build_object('payment_id', v_pid, 'order_closed', coalesce(v_allpaid,false), 'idempotent', true);
  end if;
  -- ya pagado por otra caja → rechazo claro
  if v_paid then raise exception 'Esta cuenta ya fue cobrada'; end if;
  insert into pos_payments (order_id, check_id, client_op_id, method, amount_crc, currency,
      exchange_rate_used, received_crc, received_usd, change_crc, tip_crc, tip_currency, note, created_by)
    values (p_order_id, p_check_id, p_client_op_id, p_method, p_amount_crc, p_currency,
      p_exchange_rate_used, p_received_crc, p_received_usd, p_change_crc, coalesce(p_tip_crc,0), coalesce(p_tip_currency,'CRC'), coalesce(p_note,''), p_closed_by)
    returning id into v_pid;
  update pos_checks set paid = true, paid_at = now() where id = p_check_id;
  select count(*) filter (where not paid) = 0 into v_allpaid from pos_checks where order_id = p_order_id;
  if v_allpaid then
    update pos_orders set status = 'closed', closed_at = now(), closed_by = p_closed_by, updated_at = now()
      where id = p_order_id and status = 'open';
  end if;
  return jsonb_build_object('payment_id', v_pid, 'order_closed', v_allpaid, 'idempotent', false);
end $function$;

-- ── pos_cobrar_orden ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_cobrar_orden(p_order_id uuid, p_client_op_id uuid, p_method text, p_amount_crc numeric, p_currency text, p_exchange_rate_used numeric, p_received_crc numeric, p_received_usd numeric, p_change_crc numeric, p_tip_crc numeric, p_tip_currency text, p_note text, p_closed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_pid    uuid;
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso para cobrar';
  end if;
  -- lock de la fila de la orden: serializa dos cajas concurrentes
  select status into v_status from pos_orders where id = p_order_id for update;
  if v_status is null then raise exception 'Mesa no encontrada'; end if;
  -- reenvío del MISMO intento → idempotente (no duplica)
  select id into v_pid from pos_payments where order_id = p_order_id and client_op_id = p_client_op_id;
  if v_pid is not null then
    return jsonb_build_object('payment_id', v_pid, 'order_closed', true, 'idempotent', true);
  end if;
  -- otra caja ya la cobró/cerró → rechazo claro
  if v_status <> 'open' then raise exception 'Esta cuenta ya fue cobrada'; end if;
  insert into pos_payments (order_id, client_op_id, method, amount_crc, currency,
      exchange_rate_used, received_crc, received_usd, change_crc, tip_crc, tip_currency, note, created_by)
    values (p_order_id, p_client_op_id, p_method, p_amount_crc, p_currency,
      p_exchange_rate_used, p_received_crc, p_received_usd, p_change_crc, coalesce(p_tip_crc,0), coalesce(p_tip_currency,'CRC'), coalesce(p_note,''), p_closed_by)
    returning id into v_pid;
  update pos_orders set status = 'closed', closed_at = now(), closed_by = p_closed_by, updated_at = now()
    where id = p_order_id;
  return jsonb_build_object('payment_id', v_pid, 'order_closed', true, 'idempotent', false);
end $function$;

-- ── pos_merge_orden ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_merge_orden(p_into uuid, p_from uuid, p_by_name text, p_checks jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from   record;
  v_haspaid boolean;
  c jsonb;
  v_idx int := 0;
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager','cajero','salonero','barman') then
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
end $function$;

-- ── pos_reopen_orden ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_reopen_orden(p_order_id uuid, p_by text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_status text;
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager','cajero','salonero','barman') then
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
end $function$;

-- ── pos_unmerge_orden ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_unmerge_orden(p_into uuid, p_from uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager','cajero','salonero','barman') then
    raise exception 'Sin permiso'; end if;
  if exists(select 1 from pos_checks where order_id = p_into and paid) then
    raise exception 'No se puede des-combinar: ya hay un check pagado'; end if;
  update pos_order_items set order_id = p_from, merged_from_order = null, updated_at = now()
    where merged_from_order = p_from;
  update pos_orders set status = 'open', merged_into = null, updated_at = now()
    where id = p_from and status = 'merged';
  delete from pos_checks where order_id = p_into;
end $function$;

-- ── sync_pos_tips_to_pool ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_pos_tips_to_pool(p_session_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_crc numeric := 0;
  v_usd numeric := 0;
  v_by  jsonb;
begin
  if get_my_role() is null or get_my_role() not in ('owner','manager') then
    raise exception 'Solo gerencia puede sincronizar propinas';
  end if;
  -- total por moneda (tip_currency); la propina en $ se guarda como tip_crc (ya convertida
  -- al TC del pago) — sumamos tip_crc para el pool en colones, y reportamos el detalle.
  select coalesce(sum(p.tip_crc),0),
         coalesce(sum(p.tip_crc) filter (where p.tip_currency = 'USD'),0)
    into v_crc, v_usd
  from pos_payments p
  join pos_orders o on o.id = p.order_id
  where p.tip_crc > 0
    and (o.closed_at at time zone 'America/Costa_Rica')::date = p_date;
  -- atribución por salonero vigente del pedido (current_salonero_id)
  select coalesce(jsonb_object_agg(coalesce(sal, 'sin-asignar'), monto), '{}'::jsonb) into v_by
  from (
    select coalesce(o.current_salonero_id::text, o.opened_by::text) sal, sum(p.tip_crc) monto
    from pos_payments p join pos_orders o on o.id = p.order_id
    where p.tip_crc > 0 and (o.closed_at at time zone 'America/Costa_Rica')::date = p_date
    group by 1
  ) t;
  -- SET idempotente del campo separado (no toca pool_efectivo_crc manual)
  update tip_sessions set pool_pos_crc = v_crc, pool_pos_usd = v_usd, updated_at = now()
    where id = p_session_id;
  return jsonb_build_object('pool_pos_crc', v_crc, 'pool_pos_usd', v_usd, 'por_salonero', v_by);
end $function$;

-- ── EXECUTE ───────────────────────────────────────────────────────────────────────────────
revoke execute on function public.pos_cobrar_check(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) from public, anon;
revoke execute on function public.pos_cobrar_orden(uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) from public, anon;
revoke execute on function public.pos_merge_orden(uuid,uuid,text,jsonb) from public, anon;
revoke execute on function public.pos_reopen_orden(uuid,text,text) from public, anon;
revoke execute on function public.pos_unmerge_orden(uuid,uuid) from public, anon;
revoke execute on function public.sync_pos_tips_to_pool(uuid,date) from public, anon;
grant execute on function public.pos_cobrar_check(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated, service_role;
grant execute on function public.pos_cobrar_orden(uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated, service_role;
grant execute on function public.pos_merge_orden(uuid,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.pos_reopen_orden(uuid,text,text) to authenticated, service_role;
grant execute on function public.pos_unmerge_orden(uuid,uuid) to authenticated, service_role;
grant execute on function public.sync_pos_tips_to_pool(uuid,date) to authenticated, service_role;
