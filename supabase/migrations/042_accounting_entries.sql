-- 042 — Unificación Bandeja↔Caja: libro de asientos contables automáticos. ADITIVA e IDEMPOTENTE.
--
-- ⚠ BORRADOR DE PLATA — NO MERGEAR / NO APLICAR SIN FIRMA DE LA DUEÑA.
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla (con firma): regenerar los tipos de Supabase.
--
-- FUENTE DE VERDAD: docs/SPEC-unificacion-bandeja-caja.md §11 (D1=C modelo append-only, D2=A timing),
-- §8 (INV-3 append-only, INV-4 idempotencia). Implementa EXACTAMENTE el modelo de §11.1/§11.2.
--
-- ⚠ DOBLE-CONTEO (a resolver en la capa de app, NO en esta migración): hoy finance.ts deriva
-- "actuals" del P&L directamente desde cash_movements. Este trigger ADEMÁS acumula en finance_actuals
-- (filas con source='unif_accounting'). Mientras AMBOS caminos estén activos, un gasto operativo se
-- contaría DOS veces. El plan de fases (SPEC §17 F2) cambia la app para leer el libro en vez de derivar.
-- Por eso esta migración se aplica con firma y su activación se coordina con ese cambio de app.
--
-- Solo AGREGA: tabla nueva + funciones + triggers. NO modifica el esquema de finance_actuals ni
-- toca sus filas existentes (el rollup solo escribe/lee filas propias source='unif_accounting').
-- CERO backfill: los triggers solo actúan sobre DML futuro, nunca sobre filas históricas.

-- ── 1. Tabla append-only de asientos (§11.1) ──
create table if not exists public.accounting_entries (
  id                uuid        primary key default gen_random_uuid(),
  entry_date        date        not null,                 -- fecha de registro CR (RN-1)
  year              int         not null,                 -- derivados de entry_date (clave de rollup)
  month             int         not null,
  account_id        text        not null references public.finance_accounts(id),
  amount_crc        numeric(12,2) not null,               -- FIRMADO: + suma al actual, − lo revierte
  currency          text        not null default 'CRC',
  fx_rate           numeric     not null default 1,
  source_type       text        not null,                 -- 'cash_movement'|'inventory_movement'|'reversal'|'manual'
  source_id         uuid,                                  -- id del origen
  kind              text        not null,                 -- 'gasto_operativo'|'compra_inventario'|'cogs'|…
  status            text        not null default 'posted' check (status in ('posted','reversed')),
  reverses_entry_id uuid        references public.accounting_entries(id),
  client_op_id      uuid,                                  -- idempotencia de cliente
  note              text,
  created_by        uuid        references public.profiles(id),
  created_at        timestamptz not null default now()
);

create index if not exists accounting_entries_period_idx on public.accounting_entries (year, month);
create index if not exists accounting_entries_source_idx on public.accounting_entries (source_type, source_id);

-- INV-4: un posteo ACTIVO por (origen + propósito) + idempotencia por client_op_id.
create unique index if not exists accounting_entries_active_uq
  on public.accounting_entries (source_type, source_id, kind)
  where status = 'posted';
create unique index if not exists accounting_entries_client_op_uq
  on public.accounting_entries (client_op_id);

-- ── 2. RLS: lectura owner/manager/contador. La escritura va por funciones SECURITY DEFINER ──
-- (mismo patrón que mig 039: no hay policy de insert directo; el libro solo se escribe vía RPC/trigger).
alter table public.accounting_entries enable row level security;
drop policy if exists accounting_entries_select on public.accounting_entries;
create policy accounting_entries_select on public.accounting_entries for select
  using (get_my_role() in ('owner','manager','contador'));

-- ── 3. Índice parcial para el rollup propio en finance_actuals ──
-- SOLO restringe las filas del libro (source='unif_accounting'); NO toca las filas 'manual'/import
-- existentes (el predicado las excluye). Permite un upsert concurrency-safe del rollup.
create unique index if not exists finance_actuals_unif_uq
  on public.finance_actuals (account_id, year, month)
  where source = 'unif_accounting';

-- ── 4. Helper interno: postear un asiento idempotente (no expuesto al cliente) ──
create or replace function public.post_accounting_entry(
  p_entry_date date, p_account_id text, p_amount_crc numeric,
  p_source_type text, p_source_id uuid, p_kind text,
  p_currency text default 'CRC', p_fx_rate numeric default 1,
  p_client_op_id uuid default null, p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.accounting_entries (
    entry_date, year, month, account_id, amount_crc, currency, fx_rate,
    source_type, source_id, kind, status, client_op_id, note, created_by
  ) values (
    p_entry_date,
    extract(year  from p_entry_date)::int,
    extract(month from p_entry_date)::int,
    p_account_id, p_amount_crc, coalesce(p_currency,'CRC'), coalesce(p_fx_rate,1),
    p_source_type, p_source_id, p_kind, 'posted', p_client_op_id, p_note, auth.uid()
  )
  on conflict (source_type, source_id, kind) where (status = 'posted') do nothing
  returning id into v_id;
  return v_id;   -- NULL si ya existía → idempotente
end $$;
-- Interno: solo lo invocan funciones/triggers SECURITY DEFINER. Quitamos el execute por defecto a PUBLIC.
revoke execute on function public.post_accounting_entry(date,text,numeric,text,uuid,text,text,numeric,uuid,text) from public, anon;

-- ── 5. Rollup append-only a finance_actuals (§11.1) ──
-- after insert: acumula amount_crc en la fila propia (source='unif_accounting') de ese (cuenta,año,mes).
-- Las reversiones son filas negativas → el neto cuadra solo (INV-3). NUNCA toca filas de otra source.
create or replace function public.unif_rollup_to_finance_actuals() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.finance_actuals (account_id, year, month, amount, source, note)
    values (NEW.account_id, NEW.year, NEW.month, NEW.amount_crc, 'unif_accounting',
            'rollup del libro de asientos (unificación Bandeja↔Caja)')
  on conflict (account_id, year, month) where (source = 'unif_accounting')
    do update set amount = finance_actuals.amount + EXCLUDED.amount;
  return null;
end $$;

drop trigger if exists accounting_entries_rollup on public.accounting_entries;
create trigger accounting_entries_rollup
  after insert on public.accounting_entries
  for each row execute function public.unif_rollup_to_finance_actuals();

-- ── 6. Recalcular el rollup desde el libro (reparación/auditoría, §11.1) ──
-- Recompone la fila source='unif_accounting' de un período desde accounting_entries. SOLO toca filas
-- propias (source='unif_accounting'); jamás las 'manual'/import. Suma TODAS las filas (la reversión ya
-- aportó su negativo y el original su positivo → neto correcto).
create or replace function public.recompute_finance_actuals(p_year int, p_month int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if get_my_role() not in ('owner','manager') then
    raise exception 'No autorizado';
  end if;
  delete from public.finance_actuals
   where year = p_year and month = p_month and source = 'unif_accounting';
  insert into public.finance_actuals (account_id, year, month, amount, source, note)
    select account_id, p_year, p_month, sum(amount_crc), 'unif_accounting',
           'recompute desde accounting_entries'
      from public.accounting_entries
     where year = p_year and month = p_month
     group by account_id;
end $$;
revoke execute on function public.recompute_finance_actuals(int,int) from public, anon;
grant  execute on function public.recompute_finance_actuals(int,int) to authenticated;

-- ── 7. Trigger sobre cash_movements: asiento OPERATIVO + creación de tarea de MERCADERÍA (§11.2, §7.2) ──
-- Es SECURITY DEFINER para poder escribir el libro y crear la tarea sin abrir RLS de escritura.
-- Robusto offline: un movimiento creado offline postea/crea al sincronizar (el trigger corre en el server).
-- Idempotente: el asiento por la unicidad parcial; la tarea por el guard de "no existe activa".
--   · classification='operativa' + status='aprobado' (pagado) → asiento 'gasto_operativo' a su account_id.
--     (Asunción: status='aprobado' = "pagado/confirmado"; el enum movement_status es
--      ('pendiente','aprobado','rechazado'). Confirmar con la dueña si cambia el criterio.)
--   · classification='mercaderia' → crea inventory_review_task PENDIENTE (INV-1) si no hay una activa.
create or replace function public.unif_on_cash_movement() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_date date;
begin
  v_date := (NEW.created_at at time zone 'America/Costa_Rica')::date;

  -- (a) Vía operativa: asiento de gasto al confirmarse el pago.
  if NEW.classification = 'operativa' and NEW.status = 'aprobado' and NEW.account_id is not null then
    perform public.post_accounting_entry(
      v_date, NEW.account_id, NEW.amount_crc::numeric,
      'cash_movement', NEW.id, 'gasto_operativo',
      NEW.currency::text, coalesce(NEW.exchange_rate, 1), null,
      'asiento operativo automático (unificación Bandeja↔Caja)'
    );
  end if;

  -- (b) Vía mercadería: crear la tarea de revisión de inventario (INV-1) si no hay una activa.
  if NEW.classification = 'mercaderia' then
    if not exists (
      select 1 from public.inventory_review_task
       where cash_movement_id = NEW.id
         and status in ('PENDIENTE','EN_REVISION','COMPLETADA')
    ) then
      insert into public.inventory_review_task (
        cash_movement_id, supplier_id, document_id, status,
        classification, suggested_classification, suggested_confidence,
        amount_crc, currency, fx_rate, entry_date, created_by
      ) values (
        NEW.id, NEW.supplier_id,
        (select id from public.documents
           where linked_movement_id = NEW.id order by created_at desc limit 1),
        'PENDIENTE',
        NEW.classification, NEW.suggested_classification, NEW.suggested_confidence,
        NEW.amount_crc::numeric, NEW.currency::text, coalesce(NEW.exchange_rate, 1), v_date, auth.uid()
      );
    end if;
  end if;

  return null;
end $$;

drop trigger if exists cash_movements_unif on public.cash_movements;
create trigger cash_movements_unif
  after insert or update on public.cash_movements
  for each row execute function public.unif_on_cash_movement();
