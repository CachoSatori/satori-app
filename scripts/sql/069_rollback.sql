-- 069_rollback · deshace la 069 con los textos del Paso 0 de SEC-01b
-- (pg_get_functiondef y pg_policies de PROD, 05-nov-2026; idénticos en staging).
begin;

CREATE OR REPLACE FUNCTION public.mark_factura_verified(p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if get_my_role() not in ('owner','manager','cajero','contador') then
    raise exception 'no autorizado';
  end if;
  update public.cash_movements
    set factura_verified_by = auth.uid(), factura_verified_at = now()
    where id = p_movement_id;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_inventory_review(p_task_id uuid, p_lines jsonb, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.discard_inventory_review(p_task_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.apply_supplier_credit(p_credit_id uuid, p_movement_id uuid, p_amount numeric, p_client_op_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit         public.supplier_credits%rowtype;
  v_movement       public.cash_movements%rowtype;
  v_saldo_credito  numeric(12,2);
  v_saldo_residual numeric(12,2);
  v_max            numeric(12,2);
  v_existing       uuid;
  v_app_id         uuid;
begin
  -- Auth: aplicar crédito es acción de PLATA → owner/manager.
  if get_my_role() not in ('owner','manager') then
    raise exception 'No autorizado para aplicar créditos';
  end if;
  if p_client_op_id is null then
    raise exception 'client_op_id es obligatorio (idempotencia)';
  end if;

  -- Idempotencia (fast-path): si ya existe una aplicación con ese client_op_id, devolverla sin re-aplicar.
  select id into v_existing from public.credit_applications where client_op_id = p_client_op_id;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a aplicar debe ser > 0';
  end if;

  -- Lock del crédito y de la factura (evita carreras de doble aplicación sobre el mismo saldo).
  select * into v_credit   from public.supplier_credits where id = p_credit_id   for update;
  if not found then raise exception 'Crédito no encontrado'; end if;
  select * into v_movement from public.cash_movements   where id = p_movement_id for update;
  if not found then raise exception 'Movimiento no encontrado'; end if;

  -- El movimiento debe ser del MISMO proveedor que el crédito.
  if v_movement.supplier_id is distinct from v_credit.supplier_id then
    raise exception 'El movimiento no pertenece al mismo proveedor que el crédito';
  end if;

  -- Saldos (SOLO aplicaciones NO reversadas). saldo_credito = monto − Σaplicado; residual = factura − Σaplicado.
  v_saldo_credito := v_credit.amount_crc - coalesce((
    select sum(ca.amount_applied) from public.credit_applications ca
     where ca.credit_id = p_credit_id and not ca.reversed), 0);
  v_saldo_residual := v_movement.amount_crc - coalesce((
    select sum(ca.amount_applied) from public.credit_applications ca
     where ca.applied_to_movement_id = p_movement_id and not ca.reversed), 0);
  v_max := least(v_saldo_credito, v_saldo_residual);

  if p_amount > v_max then
    raise exception 'Monto % excede el máximo aplicable % (saldo crédito %, residual factura %)',
      p_amount, v_max, v_saldo_credito, v_saldo_residual;
  end if;

  -- Insertar la aplicación. NO muta amount_crc de la factura.
  insert into public.credit_applications (credit_id, applied_to_movement_id, amount_applied, currency, applied_by, client_op_id)
    values (p_credit_id, p_movement_id, p_amount, v_credit.currency, auth.uid(), p_client_op_id)
    returning id into v_app_id;

  -- Flippear la factura a 'aprobado' SOLO si el crédito la cubre ENTERA (residual llega a 0). Si queda
  -- residual, sigue 'pendiente' y el resto se salda por el flujo normal de "Pagado" (pago parcial acotado).
  if (v_saldo_residual - p_amount) <= 0 then
    update public.cash_movements set status = 'aprobado' where id = p_movement_id;
  end if;

  return v_app_id;
exception when unique_violation then
  -- Carrera con el mismo client_op_id → devolver la existente (idempotente, 1 sola fila).
  select id into v_app_id from public.credit_applications where client_op_id = p_client_op_id;
  return v_app_id;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_supplier_credit(p_credit_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_activas int;
begin
  if get_my_role() not in ('owner','manager') then
    raise exception 'No autorizado para borrar créditos';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'La nota de motivo es obligatoria';
  end if;
  -- Política firmada: NO se borra un crédito con aplicaciones activas (no-reversed). Reabrir facturas = fase posterior.
  select count(*) into v_activas from public.credit_applications
   where credit_id = p_credit_id and not reversed;
  if v_activas > 0 then
    raise exception 'El crédito tiene % aplicación(es) activa(s); no se puede borrar', v_activas;
  end if;
  delete from public.supplier_credits where id = p_credit_id;  -- arrastra aplicaciones reversadas (ON DELETE CASCADE)
end $function$;

CREATE OR REPLACE FUNCTION public.create_supplier_credit(p_supplier_id uuid, p_origin text, p_amount_crc numeric, p_amount_usd numeric DEFAULT 0, p_currency text DEFAULT 'CRC'::text, p_fecha_origen date DEFAULT CURRENT_DATE, p_motivo text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_source_movement_id uuid DEFAULT NULL::uuid, p_document_id uuid DEFAULT NULL::uuid, p_client_op_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing     uuid;
  v_src_supplier uuid;
  v_id           uuid;
begin
  -- Auth: registrar saldo a favor es acción de gerencia.
  if get_my_role() not in ('owner','manager') then
    raise exception 'No autorizado para registrar saldo a favor';
  end if;
  if p_origin not in ('sobrepago','nota_credito') then
    raise exception 'origin inválido (esperado sobrepago|nota_credito): %', p_origin;
  end if;
  if p_client_op_id is null then
    raise exception 'client_op_id es obligatorio (idempotencia)';
  end if;
  -- R3: motivo Y referencia obligatorios.
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  if coalesce(btrim(p_referencia), '') = '' then
    raise exception 'La referencia (nº de transferencia) es obligatoria';
  end if;
  if coalesce(p_amount_crc, 0) <= 0 and coalesce(p_amount_usd, 0) <= 0 then
    raise exception 'Al menos un monto (CRC o USD) debe ser > 0';
  end if;

  -- Idempotencia (fast-path por client_op_id).
  select id into v_existing from public.supplier_credits where client_op_id = p_client_op_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Proveedor existe.
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Proveedor no encontrado';
  end if;
  -- Si viene source_movement_id: existe y es del MISMO proveedor.
  if p_source_movement_id is not null then
    select supplier_id into v_src_supplier from public.cash_movements where id = p_source_movement_id;
    if not found then
      raise exception 'Movimiento origen no encontrado';
    end if;
    if v_src_supplier is distinct from p_supplier_id then
      raise exception 'El movimiento origen no pertenece a este proveedor';
    end if;
  end if;

  insert into public.supplier_credits (
    supplier_id, origin, amount_crc, amount_usd, currency, fecha_origen, motivo, referencia,
    source_movement_id, document_id, created_by, client_op_id
  ) values (
    p_supplier_id, p_origin, coalesce(p_amount_crc, 0), coalesce(p_amount_usd, 0), coalesce(p_currency, 'CRC'),
    coalesce(p_fecha_origen, current_date), btrim(p_motivo), btrim(p_referencia),
    p_source_movement_id, p_document_id, auth.uid(), p_client_op_id
  ) returning id into v_id;

  return v_id;
exception when unique_violation then
  -- Carrera con el mismo client_op_id → devolver la existente (idempotente, 1 sola fila).
  select id into v_id from public.supplier_credits where client_op_id = p_client_op_id;
  return v_id;
end $function$;

alter policy cierre_write on public.cash_cierres_dia
  using (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role, 'contador'::user_role])))));

alter policy inv_write_ri on public.recipe_ingredients
  using (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role])))));

alter policy inv_write_recipes on public.recipes
  using (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role])))));

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$;

commit;
