-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 044 — Autorización de gerencia INLINE en el borrado en cascada. ADITIVA e IDEMPOTENTE.  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ FIRMADA POR LA DUEÑA (Opción A). Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en
--    producción. Tras aplicarla: regenerar los tipos de Supabase. REQUIERE 043 (delete_movement_cascade
--    de 2 args) aplicada antes.
--
-- ── QUÉ RESUELVE ───────────────────────────────────────────────────────────────────────
-- Un cajero NO podía borrar un movimiento aunque ingresara credenciales de gerencia VÁLIDAS.
-- Por qué: el modal del front llama verify_manager (mig 019), que SOLO verifica las credenciales
-- pero NO cambia la sesión del navegador (a propósito: crear una sesión paralela colgaba el refresh
-- de token). Entonces la RPC delete_movement_cascade seguía viendo get_my_role() = 'cajero' y
-- abortaba con "No autorizado" — el cajero veía el rechazo pese a haber dado credenciales correctas.
-- (Especialmente visible en móvil, donde el flujo completo se da en el teléfono.)
--
-- ── DECISIÓN (Opción A, firmada) ─────────────────────────────────────────────────────────
-- Validar las credenciales de gerencia DENTRO de la RPC (server-side), con el MISMO mecanismo que
-- verify_manager (extensions.crypt contra auth.users.encrypted_password). Así la autorización del
-- borrado no depende de la sesión del llamador: owner/manager logueado autoriza por su rol; un
-- cajero autoriza pasando credenciales de un owner/manager activo, que la RPC re-valida.
--
-- ── POR QUÉ SE DROPEA LA VERSIÓN DE 2 ARGS ───────────────────────────────────────────────
-- La firma pasa de (uuid,text) a (uuid,text,text,text). Si dejáramos ambas, PostgREST/Postgres
-- tendrían DOS overloads de delete_movement_cascade y la llamada con 2 args sería AMBIGUA. Por eso
-- se hace drop explícito de la de 2 args ANTES de crear la de 4 (paso 2).
--
-- ── AUDITORÍA ────────────────────────────────────────────────────────────────────────────
-- movement_deletions.authorized_by = QUIÉN AUTORIZÓ el borrado (el manager validado, o el propio
-- owner/manager logueado). Es distinto de deleted_by = QUIÉN APRETÓ (siempre auth.uid(), que puede
-- ser el cajero). Juntos dan la traza completa: "el cajero X borró con autorización del encargado Y".
--
-- ⚠ La LÓGICA EJECUTABLE de la función es IDÉNTICA a 043 salvo CAMBIO 1 (bloque de autorización) y
--   CAMBIO 2 (el insert de auditoría agrega authorized_by). Esta migración del pase de calidad SOLO
--   agregó comentarios de fase dentro del cuerpo — ninguna sentencia ejecutable cambió.

-- 1) Auditar QUIÉN AUTORIZÓ (authorized_by) — distinto de deleted_by (quién apretó, ya existente).
--    Nullable + FK a profiles. En borrados viejos (pre-044) queda null; de acá en más se llena siempre.
alter table public.movement_deletions
  add column if not exists authorized_by uuid references public.profiles(id);

-- 2) La firma pasa de 2 a 4 args → dropear la vieja para EVITAR OVERLOAD AMBIGUO (ver encabezado).
drop function if exists public.delete_movement_cascade(uuid, text);

-- 3) Recrear con autorización de manager inline. Cuerpo IDÉNTICO a 043 salvo CAMBIO 1 (autorización,
--    FASE 1) y CAMBIO 2 (auditoría, FASE 4). Los banners "── FASE n ──" son solo guía de lectura.
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
begin
  -- ── FASE 1 · AUTORIZACIÓN (CAMBIO 1 vs 043) ──────────────────────────────────────────
  -- Autoriza por rol logueado O por credenciales de gerencia validadas server-side (mismo crypt
  -- que verify_manager). v_authorized_by = quién autoriza; se audita en FASE 4. Sin credenciales
  -- válidas ni rol de gerencia → raise 'No autorizado para borrar movimientos'.
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
  -- La nota de motivo es OBLIGATORIA (queda en la auditoría de FASE 4).
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'La nota de motivo es obligatoria';
  end if;

  -- ── FASE 2 · LOCK + GUARD DE IDEMPOTENCIA ────────────────────────────────────────────
  -- Lock + lectura del movimiento. Si ya no existe → idempotente (return sin auditar).
  select * into v_movement from public.cash_movements where id = p_movement_id for update;
  if not found then
    return;
  end if;

  -- ── FASE 3 · SNAPSHOTS (antes de borrar nada: para auditoría y limpieza de docs) ─────
  -- Snapshot del inventario ligado + ids de documentos referenciados (antes de borrar nada).
  select coalesce(jsonb_agg(to_jsonb(im.*)), '[]'::jsonb)
    into v_inv
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  select coalesce(array_agg(distinct im.document_id) filter (where im.document_id is not null), '{}'::uuid[])
    into v_doc_ids
    from public.inventory_movements im
   where im.cash_movement_id = p_movement_id;

  -- ── FASE 4 · AUDITORÍA (CAMBIO 2 vs 043) ─────────────────────────────────────────────
  -- deleted_by = quién apretó (auth.uid(), puede ser el cajero); authorized_by = quién autorizó
  -- (FASE 1). La RPC es SECURITY DEFINER → puede escribir la auditoría aunque el llamador sea cajero.
  insert into public.movement_deletions (deleted_by, authorized_by, note, movement_snapshot, inventory_snapshot)
    values (auth.uid(), v_authorized_by, btrim(p_note), to_jsonb(v_movement), v_inv);

  -- ── FASE 5 · REVERSA DE ASIENTOS (§11.3) ─────────────────────────────────────────────
  -- (§11.3) Revertir los asientos del movimiento (gasto_operativo) y de su inventario (compra_inventario,
  -- cuyo source_id = id de la inventory_review_task del movimiento). Contra-asiento + status='reversed'.
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
  -- (§7.2) Cerrar la(s) tarea(s) de inventario activas → DESCARTADA con motivo 'cascade'.
  update public.inventory_review_task
     set status = 'DESCARTADA', discarded_by = auth.uid(), discarded_at = now(), discard_reason = 'cascade'
   where cash_movement_id = p_movement_id
     and status in ('PENDIENTE','EN_REVISION','COMPLETADA');

  -- ── FASE 7 · BORRADO (inventario ligado + el movimiento) ─────────────────────────────
  -- Borrar el inventario ligado (lo que el ON DELETE SET NULL dejaba huérfano) y luego el movimiento.
  delete from public.inventory_movements where cash_movement_id = p_movement_id;
  delete from public.cash_movements      where id               = p_movement_id;

  -- ── FASE 8 · LIMPIEZA DE DOCUMENTOS HUÉRFANOS (D5) ───────────────────────────────────
  -- (D5) Borrar el/los documento(s) ligado(s) si NADA MÁS los referencia → permite recargar la factura
  -- sin que el dedupe por sha256 la frene. "Referencia que importa" = inventario o historial de precios
  -- que todavía la usen (las tareas/movimientos ya cerrados tienen FK on delete set null).
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

revoke execute on function public.delete_movement_cascade(uuid, text, text, text) from anon;
grant  execute on function public.delete_movement_cascade(uuid, text, text, text) to authenticated;
