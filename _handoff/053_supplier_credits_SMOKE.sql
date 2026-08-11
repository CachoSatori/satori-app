-- ════════════════════════════════════════════════════════════════════════════════════════════
--  SMOKE de las RPCs de la mig 053 (saldo a favor). NO es migración; corre a mano en staging.
--  TODO en UN solo DO block (1 statement = 1 tx); el RAISE final fuerza ROLLBACK → nada persiste.
--  Impersona un owner real vía request.jwt.claims (las RPCs exigen get_my_role() in owner/manager).
--  El setup corre como el rol de sesión (superuser → bypassa la RLS append-only para sembrar datos).
-- ════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_owner uuid; v_sup uuid; v_f1 uuid; v_f2 uuid; v_cred uuid;
  v_op1 uuid := gen_random_uuid(); v_op2 uuid := gen_random_uuid(); v_op4 uuid := gen_random_uuid();
  v_app1 uuid; v_status text; v_saldo numeric; v_resid numeric; v_cnt int; v_rev boolean; v_snap jsonb;
  v_log text := '';
begin
  select id into v_owner from public.profiles where role in ('owner','manager') and is_active limit 1;
  if v_owner is null then raise exception 'SMOKE: no hay owner/manager para impersonar'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- SETUP: proveedor + 2 facturas pendientes (60k c/u) + 1 crédito (100k).
  insert into public.suppliers (name) values ('SMOKE Credit Prov') returning id into v_sup;
  insert into public.cash_movements (created_by, movement_type, amount_crc, currency, description, status, supplier_id, subcategory)
    values (v_owner, 'egreso_mercaderia', 60000, 'CRC', 'SMOKE f1', 'pendiente', v_sup, 'Proveedor mercadería') returning id into v_f1;
  insert into public.cash_movements (created_by, movement_type, amount_crc, currency, description, status, supplier_id, subcategory)
    values (v_owner, 'egreso_mercaderia', 60000, 'CRC', 'SMOKE f2', 'pendiente', v_sup, 'Proveedor mercadería') returning id into v_f2;
  insert into public.supplier_credits (supplier_id, origin, amount_crc, created_by, client_op_id)
    values (v_sup, 'sobrepago', 100000, v_owner, gen_random_uuid()) returning id into v_cred;

  -- A · apply TOTAL: cubre f1 entera → f1 'aprobado', saldo 100k→40k.
  v_app1 := public.apply_supplier_credit(v_cred, v_f1, 60000, v_op1);
  select status into v_status from public.cash_movements where id = v_f1;
  select amount_crc - coalesce((select sum(amount_applied) from public.credit_applications where credit_id = v_cred and not reversed), 0) into v_saldo from public.supplier_credits where id = v_cred;
  if v_status <> 'aprobado' then raise exception 'A FALLO: f1 status=% (esperaba aprobado)', v_status; end if;
  if v_saldo <> 40000 then raise exception 'A FALLO: saldo=% (esperaba 40000)', v_saldo; end if;
  v_log := v_log || 'A OK (total→aprobado, saldo 40000)';

  -- B · apply PARCIAL: 20k a f2 → f2 sigue 'pendiente', residual 40k, saldo 40k→20k.
  perform public.apply_supplier_credit(v_cred, v_f2, 20000, v_op2);
  select status into v_status from public.cash_movements where id = v_f2;
  select amount_crc - coalesce((select sum(amount_applied) from public.credit_applications where applied_to_movement_id = v_f2 and not reversed), 0) into v_resid from public.cash_movements where id = v_f2;
  select amount_crc - coalesce((select sum(amount_applied) from public.credit_applications where credit_id = v_cred and not reversed), 0) into v_saldo from public.supplier_credits where id = v_cred;
  if v_status <> 'pendiente' then raise exception 'B FALLO: f2 status=%', v_status; end if;
  if v_resid <> 40000 then raise exception 'B FALLO: residual=%', v_resid; end if;
  if v_saldo <> 20000 then raise exception 'B FALLO: saldo=%', v_saldo; end if;
  v_log := v_log || ' | B OK (parcial→pendiente, residual 40000, saldo 20000)';

  -- C · apply > min → RAISE.
  begin
    perform public.apply_supplier_credit(v_cred, v_f2, 999999, gen_random_uuid());
    raise exception 'C FALLO: no rechazó un monto excesivo';
  exception when others then
    if sqlerrm like 'C FALLO%' then raise; end if;
    v_log := v_log || ' | C OK (excedente rechazado)';
  end;

  -- D · doble apply mismo client_op_id (v_op2) → idempotente (1 sola fila).
  perform public.apply_supplier_credit(v_cred, v_f2, 5000, v_op2);
  select count(*)::int into v_cnt from public.credit_applications where client_op_id = v_op2;
  if v_cnt <> 1 then raise exception 'D FALLO: % filas con el mismo client_op_id', v_cnt; end if;
  v_log := v_log || ' | D OK (idempotente: 1 fila)';

  -- E · cascada: borrar f1 → su aplicación reversed=true, saldo repuesto 20k→80k, snapshot auditado.
  perform public.delete_movement_cascade(v_f1, 'SMOKE borrado');
  select reversed into v_rev from public.credit_applications where id = v_app1;
  select amount_crc - coalesce((select sum(amount_applied) from public.credit_applications where credit_id = v_cred and not reversed), 0) into v_saldo from public.supplier_credits where id = v_cred;
  select credit_applications_snapshot into v_snap from public.movement_deletions where (movement_snapshot->>'id')::uuid = v_f1 order by deleted_at desc limit 1;
  if v_rev is not true then raise exception 'E FALLO: la aplicación de f1 no quedó reversed'; end if;
  if v_saldo <> 80000 then raise exception 'E FALLO: saldo repuesto=% (esperaba 80000)', v_saldo; end if;
  if v_snap is null or jsonb_array_length(v_snap) < 1 then raise exception 'E FALLO: snapshot de aplicaciones vacío'; end if;
  v_log := v_log || ' | E OK (cascada: reversed, saldo repuesto 80000, snapshot ok)';

  -- F · reaplicar el saldo repuesto a f2: 30k → ok.
  perform public.apply_supplier_credit(v_cred, v_f2, 30000, v_op4);
  v_log := v_log || ' | F OK (reaplica saldo repuesto)';

  -- G · delete_supplier_credit con aplicaciones activas → BLOQUEADO.
  begin
    perform public.delete_supplier_credit(v_cred, 'SMOKE');
    raise exception 'G FALLO: borró un crédito con aplicaciones activas';
  exception when others then
    if sqlerrm like 'G FALLO%' then raise; end if;
    v_log := v_log || ' | G OK (delete bloqueado con aplicaciones activas)';
  end;

  raise exception 'SMOKE053_OK :: %', v_log;   -- éxito → fuerza ROLLBACK y surfacea el log
end $$;
