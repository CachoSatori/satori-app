-- 026: Operación por roles (pedido de la dueña 2026-06-12 — ROADMAP §Operación por roles).
-- ADITIVA e idempotente.
--
-- NOTA DE EJECUCIÓN: el rol nuevo se agrega con ALTER TYPE ... ADD VALUE. Para que
-- esta migración pueda correr en UNA transacción, las políticas nuevas comparan
-- get_my_role()::text (un enum recién agregado no puede usarse como literal en la
-- misma transacción que lo crea).

-- ── 1. Rol nuevo: proveedor (la "bandeja" — teléfono fijo de recepción de mercadería) ──
alter type user_role add value if not exists 'proveedor';

-- ── 2. Fotos de factura vinculadas al movimiento de caja ──
-- Array de paths del bucket 'facturas': ["2026-06-12/uuid.jpg", ...]
alter table public.cash_movements add column if not exists attachments jsonb not null default '[]'::jsonb;

-- ── 3. Bucket privado 'facturas' + políticas de Storage por rol ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

drop policy if exists "facturas_insert" on storage.objects;
create policy "facturas_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas'
              and get_my_role()::text in ('owner','manager','cajero','proveedor'));

drop policy if exists "facturas_select" on storage.objects;
create policy "facturas_select" on storage.objects for select to authenticated
  using (bucket_id = 'facturas'
         and get_my_role()::text in ('owner','manager','cajero','contador','proveedor'));

-- borrar fotos: solo gerencia (un pago borrado con autorización limpia sus fotos)
drop policy if exists "facturas_delete" on storage.objects;
create policy "facturas_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'facturas' and get_my_role()::text in ('owner','manager'));

-- ── 4. Permisos del rol proveedor (mínimos: registrar pago de mercadería con foto) ──
-- ver la lista de proveedores para elegir a quién se le paga
drop policy if exists "suppliers_proveedor_select" on public.suppliers;
create policy "suppliers_proveedor_select" on public.suppliers for select
  using (get_my_role()::text = 'proveedor');

-- ver sesiones de caja (solo para vincular el pago a la caja abierta del día)
drop policy if exists "cash_sessions_proveedor_select" on public.cash_sessions;
create policy "cash_sessions_proveedor_select" on public.cash_sessions for select
  using (get_my_role()::text = 'proveedor');

-- registrar SOLO pagos de mercadería, SOLO a su propio nombre
drop policy if exists "cash_movements_proveedor_insert" on public.cash_movements;
create policy "cash_movements_proveedor_insert" on public.cash_movements for insert
  with check (get_my_role()::text = 'proveedor'
              and movement_type = 'egreso_mercaderia'
              and created_by = auth.uid());

-- ver SOLO sus propios movimientos (lo que registró en su turno de bandeja)
drop policy if exists "cash_movements_proveedor_select_own" on public.cash_movements;
create policy "cash_movements_proveedor_select_own" on public.cash_movements for select
  using (get_my_role()::text = 'proveedor' and created_by = auth.uid());

-- ── 5. RPC my_turno_stats — métricas del salonero, SOLO las propias ──
-- SECURITY DEFINER que computa exclusivamente auth.uid(): garantía estructural de
-- que un salonero no puede pedir los números de otro (no recibe ningún id ajeno).
-- Ventas/mesas/pax salen de pos_orders por current_salonero_id (la transferencia de
-- mesa ya reasigna la atribución); propinas de tip_entries vía employees.profile_id.
create or replace function public.my_turno_stats(p_date date default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
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
$$;

revoke execute on function public.my_turno_stats(date) from anon;
grant  execute on function public.my_turno_stats(date) to authenticated;
