-- ============================================================================
-- 083_my_turno_stats_higiene.sql — auditoría r5, higiene de my_turno_stats (026)
-- ----------------------------------------------------------------------------
-- my_turno_stats solo existe en STAGING (PoS propio; no está en prod): esta migración va con el
-- pase del PoS propio. Texto = la definición VIVA de staging (catálogo del 07/11, igual a la 026)
-- con tres cambios y nada más:
--   1. search_path = public, pg_temp (antes solo public).
--   2. Si la cuenta no tiene rol ACTIVO → 42501 (antes una cuenta inactiva veía sus números).
--   3. EXECUTE: se le quita a PUBLIC y a anon (la 026 solo lo revocó de anon, pero el EXECUTE por
--      defecto de PUBLIC seguía vigente, ACL «=X/postgres»). Queda para authenticated.
-- Lo que devuelve a un usuario activo no cambia. Rollback: scripts/sql/083_rollback.sql.
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION public.my_turno_stats(p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  -- r5 (higiene): solo cuentas con rol y ACTIVAS (get_my_role() es null para una cuenta inactiva).
  if public.get_my_role() is null then
    raise exception 'No autorizado' using errcode = '42501';
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

revoke all on function public.my_turno_stats(date) from public, anon;
grant execute on function public.my_turno_stats(date) to authenticated;

commit;
