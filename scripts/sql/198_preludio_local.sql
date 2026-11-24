-- 198_preludio_local · SOLO con `198_pruebas.py --local` (Postgres vacío armado con scripts/sql/193_base_local.sql + la
-- 190). Corre DENTRO de la transacción descartada de la batería, antes de todo. En staging NO va: ahí esto ya existe.
--   1. Privilegios por defecto como Supabase: toda tabla y función nueva de public nace con permisos para anon y
--      authenticated (por eso la 198 los revoca; sin esto, las pruebas de permisos no muerden).
--   2. `product_map` (la 198 hereda de ahí el «rinde»), con las columnas del baseline.
--   3. Facturas FICTICIAS de santa-teresa con códigos de la lista de la 198 (familias 11, 15 y 25), para que la herencia
--      de categoría tenga algo que heredar: 124 y 192 en la 11, 930 y 519 en la 25, y 238 —que está en la lista— en la
--      familia 3, que NO tiene que heredar nada. Nombres inventados.
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create table if not exists public.product_map (
  nombre text primary key, tipo text, clasificacion text, subclasificacion text, multiplicador integer,
  updated_at timestamptz, costo_unitario numeric);

insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('santa-teresa', 'L1', '2025-01-10 20:00-06', 'C', 'salon', 'salonero', true, 'ok', 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, x.cod, x.nom, x.cant, x.monto, x.fam
from (values ('124', 'FICTICIO PASO 1', 2, 0, 11), ('192', 'FICTICIO MENU POR PERSONA', 2, 90000, 11),
             ('238', 'FICTICIO EN OTRA FAMILIA', 1, 3000, 3), ('930', 'FICTICIO PROMO COMIDA', 1, 5000, 25),
             ('519', 'FICTICIO PROMO BEBIDA', 2, 6000, 25)) x(cod, nom, cant, monto, fam)
join public.pos_ndf_tickets t on t.local = 'santa-teresa' and t.numero_factura = 'L1';
