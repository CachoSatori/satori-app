-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 053 — Saldo a favor de proveedores (Fase B1, backend). ADITIVA e IDEMPOTENTE.            ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ NÚMERO 053: la rama `metas_personales` (que antes reclamaba 051→052) podría reclamar 053 →
--   el número final lo confirma Ismael en el pase (coordinar). El SQL es agnóstico al número.
-- ⚠ Aplicar SOLO a STAGING por `db push` (el ledger está al día → queda registrada). NADA a main aún.
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────────────────────
-- Un proveedor puede quedar con "saldo a favor" (sobrepago / nota de crédito). Ese saldo se APLICA
-- contra facturas pendientes del MISMO proveedor. B1 = backend: 2 tablas append-only (escritas SOLO por
-- RPC SECURITY DEFINER), la RPC de aplicación (idempotente, money-crítica), la reposición del saldo al
-- borrar una factura (cascada mig 044 extendida) y el bloqueo de borrado de un crédito con aplicaciones
-- activas. La UI (B2) y el flujo de crear el crédito van en fase posterior.
--
-- ── FKs / ON DELETE (para que la cascada de borrado NUNCA rompa por FK) ─────────────────────
--   · credit_applications.applied_to_movement_id → cash_movements ON DELETE SET NULL: la RPC de cascada
--     marca reversed=true (repone el saldo) y la fila SOBREVIVE para auditoría; al borrarse el movimiento
--     su applied_to_movement_id queda NULL (no bloquea el delete).
--   · supplier_credits.source_movement_id / document_id → ON DELETE SET NULL (el crédito sobrevive si se
--     borra el movimiento origen o el documento — su saldo es independiente).
--   · credit_applications.credit_id → supplier_credits ON DELETE CASCADE (borrar un crédito —solo permitido
--     sin aplicaciones ACTIVAS— arrastra sus aplicaciones reversadas históricas).

-- ── 1. supplier_credits (append-only; solo la RPC inserta) ──
create table if not exists public.supplier_credits (
  id                 uuid          primary key default gen_random_uuid(),
  supplier_id        uuid          not null references public.suppliers(id),
  origin             text          not null check (origin in ('sobrepago','nota_credito')),
  amount_crc         numeric(12,2) not null,
  amount_usd         numeric(12,2) not null default 0,
  currency           text          not null default 'CRC',
  fecha_origen       date,
  motivo             text,
  referencia         text,
  source_movement_id uuid          references public.cash_movements(id) on delete set null,
  document_id        uuid          references public.documents(id)      on delete set null,
  created_by         uuid          references public.profiles(id),
  created_at         timestamptz   not null default now(),
  client_op_id       uuid          unique
);

-- ── 2. credit_applications (append-only; reversed=true la marca la cascada, no un DELETE) ──
create table if not exists public.credit_applications (
  id                    uuid          primary key default gen_random_uuid(),
  credit_id             uuid          not null references public.supplier_credits(id) on delete cascade,
  applied_to_movement_id uuid         references public.cash_movements(id) on delete set null,
  amount_applied        numeric(12,2) not null,
  currency              text          not null default 'CRC',
  applied_at            timestamptz   not null default now(),
  applied_by            uuid          references public.profiles(id),
  client_op_id          uuid          unique,
  reversed              boolean       not null default false
);

-- ── 3. Índices ──
create index if not exists supplier_credits_supplier_id_idx      on public.supplier_credits (supplier_id);
create index if not exists credit_applications_credit_id_idx     on public.credit_applications (credit_id);
create index if not exists credit_applications_movement_id_idx   on public.credit_applications (applied_to_movement_id);

-- ── 4. RLS: SELECT owner/manager/contador/cajero; SIN INSERT/UPDATE/DELETE directo (todo por RPC) ──
alter table public.supplier_credits    enable row level security;
alter table public.credit_applications enable row level security;

drop policy if exists supplier_credits_select on public.supplier_credits;
create policy supplier_credits_select on public.supplier_credits for select
  using (get_my_role() in ('owner','manager','contador','cajero'));

drop policy if exists credit_applications_select on public.credit_applications;
create policy credit_applications_select on public.credit_applications for select
  using (get_my_role() in ('owner','manager','contador','cajero'));

-- ── 5. Snapshot de la reposición de créditos en la auditoría de borrados (mig 039/044) ──
alter table public.movement_deletions
  add column if not exists credit_applications_snapshot jsonb;

-- ── 6. RPC apply_supplier_credit — money-crítica, idempotente por client_op_id ──
create or replace function public.apply_supplier_credit(
  p_credit_id uuid, p_movement_id uuid, p_amount numeric, p_client_op_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

revoke all on function public.apply_supplier_credit(uuid, uuid, numeric, uuid) from public, anon;
grant  execute on function public.apply_supplier_credit(uuid, uuid, numeric, uuid) to authenticated;

-- ── 7. RPC delete_supplier_credit — BLOQUEA si hay aplicaciones activas (política firmada) ──
create or replace function public.delete_supplier_credit(p_credit_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

revoke all on function public.delete_supplier_credit(uuid, text) from public, anon;
grant  execute on function public.delete_supplier_credit(uuid, text) to authenticated;

-- ── 8. delete_movement_cascade (mig 044) EXTENDIDA: repone el saldo de los créditos aplicados a la
--       factura borrada. Cuerpo IDÉNTICO a 044 salvo: (a) FASE 3 captura el snapshot de aplicaciones,
--       (b) FASE 4 lo audita en movement_deletions.credit_applications_snapshot, (c) NUEVA FASE 6b marca
--       reversed=true. Firma, auth (FASE 1) y todo lo demás INTACTOS. `create or replace` preserva el ACL
--       endurecido por la mig 049. ──
create or replace function public.delete_movement_cascade(
  p_movement_id uuid, p_note text,
  p_manager_email text default null, p_manager_password text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.cash_movements%rowtype;
  v_inv      jsonb;
  v_doc_ids  uuid[];
  v_entry    public.accounting_entries%rowtype;
  v_doc      uuid;
  v_authorized_by uuid;
  v_credit_apps jsonb;   -- (053) snapshot de las aplicaciones de crédito repuestas
begin
  -- ── FASE 1 · AUTORIZACIÓN (CAMBIO 1 vs 043) ──────────────────────────────────────────
  if get_my_role() in ('owner','manager') then
    v_authorized_by := auth.uid();
  elsif p_manager_email is not null and p_manager_password is not null then
    select u.id into v_authorized_by
      from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_manager_email))
       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)
       and p.role in ('owner','manager') and p.is_active;
    if v_authorized_by is null then
      raise exception 'No autorizado para borrar movimientos';
    end if;
  else
    raise exception 'No autorizado para borrar movimientos';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'La nota de motivo es obligatoria';
  end if;

  -- ── FASE 2 · LOCK + GUARD DE IDEMPOTENCIA ────────────────────────────────────────────
  select * into v_movement from public.cash_movements where id = p_movement_id for update;
  if not found then
    return;
  end if;

  -- ── FASE 3 · SNAPSHOTS (antes de borrar nada) ────────────────────────────────────────
  select coalesce(jsonb_agg(to_jsonb(im.*)), '[]'::jsonb)
    into v_inv
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  select coalesce(array_agg(distinct im.document_id) filter (where im.document_id is not null), '{}'::uuid[])
    into v_doc_ids
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  -- (053) snapshot de las aplicaciones de crédito ACTIVAS de esta factura (las que se van a reponer).
  select coalesce(jsonb_agg(to_jsonb(ca.*)), '[]'::jsonb)
    into v_credit_apps
    from public.credit_applications ca
   where ca.applied_to_movement_id = p_movement_id and not ca.reversed;

  -- ── FASE 4 · AUDITORÍA (CAMBIO 2 vs 043; + credit_applications_snapshot de 053) ───────
  insert into public.movement_deletions (deleted_by, authorized_by, note, movement_snapshot, inventory_snapshot, credit_applications_snapshot)
    values (auth.uid(), v_authorized_by, btrim(p_note), to_jsonb(v_movement), v_inv, v_credit_apps);

  -- ── FASE 5 · REVERSA DE ASIENTOS (§11.3) ─────────────────────────────────────────────
  for v_entry in
    select * from public.accounting_entries ae
     where ae.status = 'posted'
       and (
         (ae.source_type = 'cash_movement'      and ae.source_id = p_movement_id)
         or (ae.source_type = 'inventory_movement' and ae.source_id in (
               select t.id from public.inventory_review_task t where t.cash_movement_id = p_movement_id))
       )
  loop
    insert into public.accounting_entries (
      entry_date, year, month, account_id, amount_crc, currency, fx_rate,
      source_type, source_id, kind, status, reverses_entry_id, note, created_by
    ) values (
      v_entry.entry_date, v_entry.year, v_entry.month, v_entry.account_id, -v_entry.amount_crc,
      v_entry.currency, v_entry.fx_rate, 'reversal', v_entry.source_id, v_entry.kind, 'posted',
      v_entry.id, 'reversión por borrado en cascada (unificación Bandeja↔Caja)', auth.uid()
    );
    update public.accounting_entries set status = 'reversed' where id = v_entry.id;
  end loop;

  -- ── FASE 6 · DESCARTE DE TAREA DE INVENTARIO (§7.2) ──────────────────────────────────
  update public.inventory_review_task
     set status = 'DESCARTADA', discarded_by = auth.uid(), discarded_at = now(), discard_reason = 'cascade'
   where cash_movement_id = p_movement_id
     and status in ('PENDIENTE','EN_REVISION','COMPLETADA');

  -- ── FASE 6b · REPOSICIÓN DE CRÉDITOS (053) ───────────────────────────────────────────
  -- Marcar reversed=true las aplicaciones de crédito de esta factura → REPONE el saldo del crédito
  -- (queda disponible para reaplicar). Idempotente (re-run: 0 filas; y FASE 2 corta antes si ya no existe).
  update public.credit_applications
     set reversed = true
   where applied_to_movement_id = p_movement_id and not reversed;

  -- ── FASE 7 · BORRADO (inventario ligado + el movimiento) ─────────────────────────────
  delete from public.inventory_movements where cash_movement_id = p_movement_id;
  delete from public.cash_movements      where id               = p_movement_id;

  -- ── FASE 8 · LIMPIEZA DE DOCUMENTOS HUÉRFANOS (D5) ───────────────────────────────────
  for v_doc in
    select d.id from public.documents d
     where d.linked_movement_id = p_movement_id
        or d.id = any (v_doc_ids)
  loop
    if not exists (select 1 from public.inventory_movements im where im.document_id = v_doc)
       and not exists (select 1 from public.ingredient_prices ip where ip.document_id = v_doc) then
      delete from public.documents where id = v_doc;
    end if;
  end loop;
end $$;

revoke all on function public.delete_movement_cascade(uuid, text, text, text) from public, anon;
grant  execute on function public.delete_movement_cascade(uuid, text, text, text) to authenticated;
