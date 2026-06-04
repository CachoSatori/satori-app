-- 014 — Cuenta de ingreso "Otros ingresos" (P&L)
-- Para registrar ingresos de caja que SÍ son ingreso real (venta de aceite usado /
-- reciclaje y otros), separados de las ventas (que entran por el POS) y del
-- "Ingreso de cambio" (float, excluido del P&L).
insert into finance_accounts (id, code, name, parent_id, section, sort, is_leaf)
values ('otros_ingresos', null, 'Otros ingresos', 'income', 'income', 5, true)
on conflict (id) do nothing;
