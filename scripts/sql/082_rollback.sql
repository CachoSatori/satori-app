-- 082_rollback · deshace supabase/migrations/082_my_turno_stats_higiene.sql
-- Vuelve a la definición VIVA de staging del 07/11 (= 026) y a su EXECUTE (PUBLIC incluido).
-- NO toca el ledger: borrar la fila 082 en la misma transacción si se corre.
begin;

CREATE OR REPLACE FUNCTION public.my_turno_stats(p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_date  date := coalesce(p_date, (now() at time zone 'America/Costa_Rica')::date);
  v_ventas numeric := 0;
  v_mesas  int := 0;
  v_pax    int := 0;
  v_abiertas text[] := '{}';
  v_propinas numeric := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  -- ventas del día: ítems de pedidos cuyo dueño VIGENTE soy yo (price_crc ya
  -- incluye modificadores; precio final IVA incl. — mismo criterio que la cuenta)
  select coalesce(sum(i.qty * i.price_crc), 0)
    into v_ventas
    from pos_orders o
    join pos_order_items i on i.order_id = o.id
   where coalesce(o.current_salonero_id, o.opened_by) = v_uid
     and (o.created_at at time zone 'America/Costa_Rica')::date = v_date
     and o.status <> 'cancelled';

  select count(*), coalesce(sum(o.pax), 0)
    into v_mesas, v_pax
    from pos_orders o
   where coalesce(o.current_salonero_id, o.opened_by) = v_uid
     and (o.created_at at time zone 'America/Costa_Rica')::date = v_date
     and o.status <> 'cancelled';

  select coalesce(array_agg(o.table_name order by o.created_at), '{}')
    into v_abiertas
    from pos_orders o
   where coalesce(o.current_salonero_id, o.opened_by) = v_uid
     and o.status = 'open';

  -- propinas propias del día (payout ya calculado por el pool — solo lectura)
  select coalesce(sum(te.payout_crc), 0)
    into v_propinas
    from tip_entries te
    join tip_sessions ts on ts.id = te.session_id
    join employees e on e.id = te.employee_id
   where e.profile_id = v_uid
     and ts.session_date = v_date;

  return jsonb_build_object(
    'date',          v_date,
    'ventas_crc',    v_ventas,
    'mesas',         v_mesas,
    'pax',           v_pax,
    'ticket_mesa',   case when v_mesas > 0 then round(v_ventas / v_mesas) else 0 end,
    'ticket_pax',    case when v_pax   > 0 then round(v_ventas / v_pax)   else 0 end,
    'propinas_crc',  v_propinas,
    'mesas_abiertas', to_jsonb(v_abiertas)
  );
end;
$function$
;

grant execute on function public.my_turno_stats(date) to public;
revoke execute on function public.my_turno_stats(date) from anon;
grant execute on function public.my_turno_stats(date) to authenticated;

commit;
