-- 040 — Unificación Bandeja↔Caja: cola de revisión de inventario. ADITIVA e IDEMPOTENTE.
--
-- ⚠ BORRADOR — NO MERGEAR / NO APLICAR SIN FIRMA DE LA DUEÑA.
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla (con firma): regenerar los tipos de Supabase.
--
-- FUENTE DE VERDAD: docs/SPEC-unificacion-bandeja-caja.md §7.2 (máquina de estados), §8 (INV-1),
-- §9 (roles), §13 (modelo de datos). Implementa la "vía de inventario" desacoplada de la vía de pago.
--
-- Solo AGREGA una tabla nueva + sus políticas. NO toca cash_movements, inventory_movements,
-- ni ninguna política existente. Cero backfill, cero UPDATE de datos históricos.

-- ── 1. Tabla: una tarea de revisión de inventario por pago de mercadería ──
-- La crea el SISTEMA (trigger de 042, SECURITY DEFINER) cuando se confirma un pago
-- classification='mercaderia'. El cajero NO la toca; la completa contador/manager.
create table if not exists public.inventory_review_task (
  id                       uuid        primary key default gen_random_uuid(),
  -- ON DELETE SET NULL: el borrado del pago lo maneja la cascada (043), que la marca DESCARTADA
  -- en la misma transacción ANTES de borrar el movimiento (no la deja huérfana con motivo nulo).
  cash_movement_id         uuid        references public.cash_movements(id) on delete set null,
  supplier_id              uuid        references public.suppliers(id)       on delete set null,
  document_id              uuid        references public.documents(id)       on delete set null,
  status                   text        not null default 'PENDIENTE'
                             check (status in ('PENDIENTE','EN_REVISION','COMPLETADA','DESCARTADA')),
  -- copia advisory de la clasificación al momento de crear la tarea (§6; el humano confirma)
  classification           text,
  suggested_classification text,
  suggested_confidence     numeric,
  -- datos del pago (para mostrar en la cola sin re-join), en hora CR (RN-1 = fecha de registro)
  amount_crc               numeric(12,2),
  currency                 text        not null default 'CRC',
  fx_rate                  numeric     not null default 1,
  entry_date               date,
  -- claim suave (D7=B): indicador, sin estado duro de bloqueo en v1
  claimed_by               uuid        references public.profiles(id),
  claimed_at               timestamptz,
  completed_by             uuid        references public.profiles(id),
  completed_at             timestamptz,
  discarded_by             uuid        references public.profiles(id),
  discarded_at             timestamptz,
  discard_reason           text,
  created_by               uuid        references public.profiles(id),
  created_at               timestamptz not null default now()
);

create index if not exists inventory_review_task_status_idx
  on public.inventory_review_task (status, created_at desc);
create index if not exists inventory_review_task_movement_idx
  on public.inventory_review_task (cash_movement_id);
create index if not exists inventory_review_task_supplier_idx
  on public.inventory_review_task (supplier_id);

-- INV-1: a lo sumo UNA tarea activa por pago de mercadería (PENDIENTE/EN_REVISION/COMPLETADA).
-- Una DESCARTADA + una nueva activa SÍ se permiten (recarga tras borrado). El índice parcial solo
-- restringe filas activas → no choca con las descartadas.
create unique index if not exists inventory_review_task_one_active_per_movement
  on public.inventory_review_task (cash_movement_id)
  where status in ('PENDIENTE','EN_REVISION','COMPLETADA') and cash_movement_id is not null;

-- ── 2. RLS: select + escritura directa para owner/manager/contador (cajero NO; §9) ──
-- Las transiciones reales pasan por RPCs SECURITY DEFINER (042/043) que bypassan RLS; estas
-- políticas acotan el acceso directo y dejan LEER la cola al contador. Mismo patrón que mig 039.
alter table public.inventory_review_task enable row level security;

drop policy if exists inventory_review_task_select on public.inventory_review_task;
create policy inventory_review_task_select on public.inventory_review_task for select
  using (get_my_role() in ('owner','manager','contador'));

drop policy if exists inventory_review_task_write on public.inventory_review_task;
create policy inventory_review_task_write on public.inventory_review_task for all
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));
