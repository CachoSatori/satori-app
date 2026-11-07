-- Datos sintéticos de las carreras. Como postgres. Ver README.md.
begin;
insert into club_miembros (id, tipo, nombre, origen, created_at) values
  ('00000000-0000-4000-8000-0000000c0003', 'referente', 'Carrera 03 vencer', 'app', now() - interval '2 years'),
  ('00000000-0000-4000-8000-0000000c0007', 'referente', 'Carrera 07 baja', 'app', now()),
  ('00000000-0000-4000-8000-0000000c0008', 'referente', 'Carrera 08 op', 'app', now()),
  ('00000000-0000-4000-8000-0000000c000a', 'referente', 'Carrera 15 A', 'app', now()),
  ('00000000-0000-4000-8000-0000000c000b', 'referente', 'Carrera 15 B', 'app', now()),
  ('00000000-0000-4000-8000-0000000c0016', 'referente', 'Carrera 16 codigo', 'app', now());
insert into club_movimientos (miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, origen) values
  ('00000000-0000-4000-8000-0000000c0003', 'tarjeta', 12, 6, 18000, now() - interval '13 months', 'migracion'),
  ('00000000-0000-4000-8000-0000000c0008', 'tarjeta', 24, 6, 18000, now() - interval '3 days', 'migracion'),
  ('00000000-0000-4000-8000-0000000c0016', 'tarjeta', 24, 6, 18000, now() - interval '3 days', 'migracion');
-- R-01: códigos de canje de las carreras (el canje los exige). 16: el mismo código en dos canjes a la vez.
insert into club_codigos_canje (miembro_id, codigo_hash, vence_en) values
  ('00000000-0000-4000-8000-0000000c0003', public.club_codigo_hash('CARRZ3'), now() + interval '10 minutes'),
  ('00000000-0000-4000-8000-0000000c0008', public.club_codigo_hash('CARRZ8'), now() + interval '10 minutes'),
  ('00000000-0000-4000-8000-0000000c0016', public.club_codigo_hash('CARRZG'), now() + interval '10 minutes');
insert into club_cupones (codigo, referente_id, vence_en) values ('CARRERA777', '00000000-0000-4000-8000-0000000c0007', now() + interval '5 days');
insert into pos_ndf_tickets (numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, mesa, mesa_factura, numero_pedido, pedido_abierto_en, total_crc, pax)
values ('990951', now() - interval '10 minutes', 'C', 'salon', 'cajero', true, 'ok', '7', '7', '9501', now() - interval '40 minutes', 40000, 4);
commit;
