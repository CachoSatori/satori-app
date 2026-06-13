-- 033: FIX 🔴 doble cobro (AUDITORIA-CONSOLIDACION §1.2). ADITIVA e idempotente.
-- NO toca la matemática del cobro: las RPC reciben los totales YA calculados por
-- computeTotals/vuelto/conversión y solo los PERSISTEN de forma segura.
--
-- Doble candado:
--  (1) client_op_id UNIQUE parcial → un reenvío del MISMO intento (doble-tap, dos
--      dispositivos mandando el mismo cobro) colapsa en una fila (idempotente).
--  (2) RPC atómica con FOR UPDATE + precondición → dos cajas DISTINTAS cobrando la
--      misma mesa: solo una gana; la otra recibe "Esta cuenta ya fue cobrada".

-- ── 1. client_op_id (generado por el cliente, 1 por pantalla de cobro) ──
alter table public.pos_payments add column if not exists client_op_id uuid;

-- Las filas viejas (datos de prueba) tienen client_op_id NULL → el índice PARCIAL las
-- ignora (en Postgres varios NULL no colisionan; igual lo restringimos a NOT NULL).
-- No hay duplicados previos por order/check (verificado), así que no requiere dedupe.
create unique index if not exists pos_payments_client_op_id_uk
  on public.pos_payments (client_op_id) where client_op_id is not null;

-- ── 2. RPC: cobrar la ORDEN entera (sin split) — atómica ──
create or replace function public.pos_cobrar_orden(
  p_order_id uuid, p_client_op_id uuid, p_method text, p_amount_crc numeric,
  p_currency text, p_exchange_rate_used numeric, p_received_crc numeric,
  p_received_usd numeric, p_change_crc numeric, p_tip_crc numeric,
  p_tip_currency text, p_note text, p_closed_by uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_pid    uuid;
begin
  if get_my_role() not in ('owner','manager','cajero','salonero','barman') then
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
end $$;

-- ── 3. RPC: cobrar UN check (split) — atómica; cierra la mesa si todos pagos ──
create or replace function public.pos_cobrar_check(
  p_check_id uuid, p_order_id uuid, p_client_op_id uuid, p_method text, p_amount_crc numeric,
  p_currency text, p_exchange_rate_used numeric, p_received_crc numeric,
  p_received_usd numeric, p_change_crc numeric, p_tip_crc numeric,
  p_tip_currency text, p_note text, p_closed_by uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_paid     boolean;
  v_pid      uuid;
  v_allpaid  boolean;
begin
  if get_my_role() not in ('owner','manager','cajero','salonero','barman') then
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
end $$;

revoke execute on function public.pos_cobrar_orden(uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) from anon;
revoke execute on function public.pos_cobrar_check(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) from anon;
grant execute on function public.pos_cobrar_orden(uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated;
grant execute on function public.pos_cobrar_check(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated;
