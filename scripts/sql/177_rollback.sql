-- Rollback de la 177 (origen caja 097): el repo declara los tipos numéricos como prod.
--
-- EN PROD NO HAY NADA QUE DESHACER. Las 39 columnas ya tenían en prod el tipo de destino antes de la 177 (lectura del
-- 15-nov-2026 23:38 -06:00, en docs/pases/PASE-177-esquema-centimos.md): la 177 solo leyó el catálogo y no ejecutó
-- ningún ALTER. Por eso este archivo NO cambia el esquema:
--  · NO vuelve a los tipos viejos del repo (NUMERIC(12,0), numeric sin escala, integer): eso redondearía céntimos de
--    datos reales de caja y propinas, y dejaría prod distinta de lo que siempre fue.
--  · NO borra la fila 177 del ledger ni se saca el .sql de main (regla 10): si saliera, una base armada desde el repo
--    volvería a redondear céntimos, que es justo lo que la 177 arregla. Si hiciera falta otro cambio, va en una
--    migración NUEVA.
-- En una base NUEVA armada desde el repo, la 177 sí cambió tipos (tablas vacías); tampoco se deshace: esos tipos son los
-- de prod.
--
-- Lo único que hace: una lectura (sin escribir) que confirma que prod sigue con los tipos de prod. Esperado: 0 filas.
begin read only;
select c.relname || '.' || a.attname as columna, format_type(a.atttypid, a.atttypmod) as tipo
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  join (values
    ('cash_movements','amount_crc','numeric(12,2)'),('cash_sessions','initial_service_crc','numeric(12,2)'),
    ('cash_sessions','initial_suppliers_crc','numeric(12,2)'),('cash_sessions','final_service_crc','numeric(12,2)'),
    ('cash_sessions','final_suppliers_crc','numeric(12,2)'),('cash_sessions','final_safe_crc','numeric(12,2)'),
    ('cash_sessions','final_bank_crc','numeric(12,2)'),('tip_entries','tip_amount_crc','numeric(12,2)'),
    ('tip_entries','payout_crc','numeric(12,2)'),('tip_entries','tip_amount_usd','numeric(10,2)'),
    ('tip_entries','points','numeric(10,4)'),('tip_entries','hours_worked','numeric(4,2)'),
    ('role_tip_points','points','numeric(4,1)')
  ) e(tabla, col, tipo) on c.relname = e.tabla and a.attname = e.col
 where n.nspname = 'public' and format_type(a.atttypid, a.atttypmod) <> e.tipo;
rollback;
