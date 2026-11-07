-- 081_rollback.sql — saca las columnas del ítem 11 de pos_ndf_* y la fila 081 del ledger.
-- ⚠️ ANTES de correrlo, volver el Edge `ingest-ndf` a la versión anterior: el Edge nuevo escribe
-- estas columnas y, sin ellas, el upsert del lote falla y no entra ninguna venta.
-- Pierde los datos de esas columnas (se recuperan con el backfill del agente).
begin;
drop index if exists public.pos_ndf_tickets_consecutivo_fe_idx;
drop index if exists public.pos_ndf_tickets_pedido_idx;
drop index if exists public.pos_ndf_tickets_factura_clave_idx;
drop index if exists public.pos_ndf_tickets_mesa_sin_pedido_idx;
alter table public.pos_ndf_tickets
  drop column if exists area_factura,
  drop column if exists mesa_factura,
  drop column if exists consecutivo_fe,
  drop column if exists clave_fe,
  drop column if exists pedido_abierto_en;
alter table public.pos_ndf_open drop column if exists pedido_abierto_en, drop column if exists area;
delete from supabase_migrations.schema_migrations where version = '081';
commit;
