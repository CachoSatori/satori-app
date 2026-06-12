-- 021: idempotencia del replay offline (FASE B del sprint offline-first).
-- client_op_id UNIQUE (nullable): cada operación encolada sin red viaja con su
-- UUID; si el replay se repite (reconexión doble, dos pestañas, app reabierta),
-- el duplicado rebota con 23505 y el cliente lo descarta de la cola — JAMÁS se
-- duplica plata. Nullable: todo lo histórico y lo escrito online-directo queda
-- sin client_op_id y no participa de la restricción. Idempotente.

alter table public.cash_movements add column if not exists client_op_id uuid;
alter table public.tip_entries    add column if not exists client_op_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_movements_client_op_id_key') then
    alter table public.cash_movements add constraint cash_movements_client_op_id_key unique (client_op_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tip_entries_client_op_id_key') then
    alter table public.tip_entries add constraint tip_entries_client_op_id_key unique (client_op_id);
  end if;
end $$;
