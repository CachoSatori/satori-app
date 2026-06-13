-- 035: Integración Propina PoS → Pool del turno (P1 SAGRADO). ADITIVA.
-- NO toca tipCalculations ni el reparto. SOLO agrega un campo SEPARADO con la suma de
-- las propinas capturadas en el cobro del PoS (pos_payments.tip_crc), con etiqueta de
-- origen, recomputado de forma idempotente (SET, no ADD) → re-correr no duplica.
-- El campo manual (pool_efectivo_crc, ingresado en Propinas) NO se toca: el pool
-- EFECTIVO del turno pasa a ser manual + pool_pos (el reparto recibe la suma).

alter table public.tip_sessions add column if not exists pool_pos_crc numeric(12,2) not null default 0;
alter table public.tip_sessions add column if not exists pool_pos_usd numeric(12,2) not null default 0;

-- RPC idempotente: recalcula el total de propinas del PoS para una FECHA y lo escribe
-- en la sesión de propinas indicada. SET (no ADD) → idempotente. Suma las tip_crc de
-- los pagos de pedidos CERRADOS de esa fecha (la propina se captura al cobrar).
-- Devuelve el desglose por salonero (atribución) para mostrar/auditar.
create or replace function public.sync_pos_tips_to_pool(p_session_id uuid, p_date date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_crc numeric := 0;
  v_usd numeric := 0;
  v_by  jsonb;
begin
  if get_my_role() not in ('owner','manager') then
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
end $$;

revoke execute on function public.sync_pos_tips_to_pool(uuid, date) from anon;
grant  execute on function public.sync_pos_tips_to_pool(uuid, date) to authenticated;
