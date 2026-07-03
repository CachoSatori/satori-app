-- 038 — Fusión de Bandejas (feat/bandeja-fusion)
-- ADITIVA e IDEMPOTENTE. Solo agrega; NO modifica ni dropea políticas existentes.
--
-- ⚠ PERMISO DE PLATA — NO MERGEAR SIN FIRMA DE LA DUEÑA.
-- Habilita que el CONTADOR pueda INSERTAR egresos NO-efectivo (pendientes o pagados
-- desde banco) y que cualquier rol operativo marque una factura como "verificada".
--
-- Aplicar SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en producción.
-- Tras aplicarla: regenerar los tipos de Supabase.

-- ── 1. Verificado de factura (quién + cuándo) sobre el movimiento de caja ──
alter table public.cash_movements
  add column if not exists factura_verified_by uuid references public.profiles(id);
alter table public.cash_movements
  add column if not exists factura_verified_at timestamptz;

-- ── 2. RLS: el CONTADOR puede INSERTAR egresos NO-efectivo ──
-- Solo agrega una policy nueva; NO toca las de 012/026. WITH CHECK exige:
-- rol contador · método distinto de Efectivo · y (pendiente O pagado desde Banco).
drop policy if exists "cash_movements_contador_insert" on public.cash_movements;
create policy "cash_movements_contador_insert" on public.cash_movements for insert
  with check (
    get_my_role() = 'contador'
    and method <> 'Efectivo'
    and (status = 'pendiente' or caja_origen = 'Banco')
  );

-- ── 3. RPC de verificado (en vez de abrir un UPDATE ancho de cash_movements) ──
-- SECURITY DEFINER: solo sella factura_verified_by/at; ningún otro campo se toca.
create or replace function public.mark_factura_verified(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if get_my_role() not in ('owner','manager','cajero','contador') then
    raise exception 'no autorizado';
  end if;
  update public.cash_movements
    set factura_verified_by = auth.uid(), factura_verified_at = now()
    where id = p_movement_id;
end $$;

grant execute on function public.mark_factura_verified(uuid) to authenticated;
