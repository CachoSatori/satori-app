-- SMOKE de create_supplier_credit (mig 054). Transaccional; el RAISE final fuerza ROLLBACK (nada persiste).
-- Impersona un owner por request.jwt.claims; el setup corre como superuser (bypassa RLS append-only).
do $$
declare
  v_owner uuid; v_sup uuid; v_id uuid; v_cnt int; v_op uuid := gen_random_uuid(); v_log text := '';
begin
  select id into v_owner from public.profiles where role in ('owner','manager') and is_active limit 1;
  if v_owner is null then raise exception 'SMOKE: sin owner/manager'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  insert into public.suppliers (name) values ('SMOKE054 Prov') returning id into v_sup;

  -- A · crear sobrepago OK (motivo + referencia).
  v_id := public.create_supplier_credit(v_sup, 'sobrepago', 50000, 0, 'CRC', current_date, 'Sobrepago fact X', 'TRF-123', null, null, v_op);
  select count(*)::int into v_cnt from public.supplier_credits where id = v_id and supplier_id = v_sup and amount_crc = 50000 and origin = 'sobrepago';
  if v_cnt <> 1 then raise exception 'A FALLO: no creó el crédito'; end if;
  v_log := v_log || 'A OK (sobrepago creado)';

  -- B · sin referencia → rechaza.
  begin
    perform public.create_supplier_credit(v_sup, 'sobrepago', 50000, 0, 'CRC', current_date, 'motivo', '', null, null, gen_random_uuid());
    raise exception 'B FALLO: aceptó sin referencia';
  exception when others then if sqlerrm like 'B FALLO%' then raise; end if; v_log := v_log || ' | B OK (sin referencia rechazado)'; end;

  -- C · monto 0 (CRC y USD) → rechaza.
  begin
    perform public.create_supplier_credit(v_sup, 'sobrepago', 0, 0, 'CRC', current_date, 'motivo', 'ref', null, null, gen_random_uuid());
    raise exception 'C FALLO: aceptó monto 0';
  exception when others then if sqlerrm like 'C FALLO%' then raise; end if; v_log := v_log || ' | C OK (monto 0 rechazado)'; end;

  -- D · no-gerencia (jwt sub sin rol de gerencia) → rechaza.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
    perform public.create_supplier_credit(v_sup, 'sobrepago', 50000, 0, 'CRC', current_date, 'motivo', 'ref', null, null, gen_random_uuid());
    raise exception 'D FALLO: aceptó sin gerencia';
  exception when others then if sqlerrm like 'D FALLO%' then raise; end if; v_log := v_log || ' | D OK (no-gerencia rechazado)'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- E · doble client_op_id (v_op) → idempotente (1 fila).
  perform public.create_supplier_credit(v_sup, 'sobrepago', 50000, 0, 'CRC', current_date, 'Sobrepago fact X', 'TRF-123', null, null, v_op);
  select count(*)::int into v_cnt from public.supplier_credits where client_op_id = v_op;
  if v_cnt <> 1 then raise exception 'E FALLO: % filas con el mismo client_op_id', v_cnt; end if;
  v_log := v_log || ' | E OK (idempotente: 1 fila)';

  raise exception 'SMOKE054_OK :: %', v_log;
end $$;
