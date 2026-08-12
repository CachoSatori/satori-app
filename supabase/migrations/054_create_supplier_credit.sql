-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 054 — Saldo a favor de proveedores (Fase B2): RPC para CREAR un crédito. ADITIVA/IDEMPOTENTE║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NÚMERO 054: verificar libre + coordinar con `metas_personales` en el pase. NO edita la 053 (ya aplicada).
-- ⚠ Aplicar SOLO a STAGING por `db push`. NADA a main aún.
--
-- Cierra el hueco de B1: `supplier_credits` es RLS solo-SELECT (todo write por RPC SECURITY DEFINER), así
-- que faltaba la RPC para REGISTRAR el saldo a favor (sobrepago / nota de crédito). NO mueve plata: solo
-- reconoce un prepago ya hecho. La aplicación contra facturas y la reposición al borrar viven en la 053.
--
-- NOTA DE FIRMA: el SPEC lista p_motivo/p_referencia/p_client_op_id sin default, pero van DESPUÉS de params
-- con default (p_amount_usd/p_currency/p_fecha_origen) → en Postgres eso obliga a que también tengan default.
-- Se les pone `default null` y se validan como OBLIGATORIOS en el cuerpo (raise si vacíos/null).

create or replace function public.create_supplier_credit(
  p_supplier_id uuid,
  p_origin text,
  p_amount_crc numeric,
  p_amount_usd numeric default 0,
  p_currency text default 'CRC',
  p_fecha_origen date default current_date,
  p_motivo text default null,
  p_referencia text default null,
  p_source_movement_id uuid default null,
  p_document_id uuid default null,
  p_client_op_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

revoke all on function public.create_supplier_credit(uuid,text,numeric,numeric,text,date,text,text,uuid,uuid,uuid) from public, anon;
grant  execute on function public.create_supplier_credit(uuid,text,numeric,numeric,text,date,text,text,uuid,uuid,uuid) to authenticated;
